-- A seller can cancel an order they can't fulfil, before it's ready for a rider. The
-- buyer is refunded straight away, the way they paid, and told why. Rules mirror
-- src/domain/orderCancel.ts.

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('paid', 'dispatched', 'delivered', 'cancelled'));
alter table public.orders
  add column cancelled_at timestamptz,
  add column cancel_reason text check (cancel_reason in ('out_of_stock', 'damaged', 'cant_send', 'other')),
  add column cancel_note text;

-- Its own kind, because a fixed-price refund must not touch the weekly ticket limit, which counts 'refund'.
alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check
  check (kind in ('topup', 'ticket_purchase', 'refund', 'store_credit', 'order_payment', 'order_refund', 'adjustment'));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'draw_sold_out', 'draw_won', 'draw_lost',
  'saved_almost_sold', 'saved_closing_soon', 'saved_relisted', 'saved_back_on_sale', 'saved_price_drop',
  'store_new_order', 'store_listing_approved', 'store_listing_rejected', 'store_draw_sold_out',
  'store_winner_picked', 'store_draw_closing', 'store_pickup_tomorrow', 'store_new_message',
  'store_payout_sent', 'store_bank_changed',
  'store_price_approved', 'store_price_rejected',
  'order_cancelled'
));

-- How each order was paid, so it can go back the same way. Private: a seller has no
-- business knowing how much of it was store credit.
create table private.order_payments (
  order_id uuid primary key references public.orders (id) on delete cascade,
  cash_kobo bigint not null check (cash_kobo >= 0),
  credit_kobo bigint not null check (credit_kobo >= 0)
);
alter table private.order_payments enable row level security;
revoke all on private.order_payments from public, anon, authenticated;

-- Orders from before this, matched to their payment.
insert into private.order_payments (order_id, cash_kobo, credit_kobo)
select o.id, -e.cash_kobo, -e.credit_kobo
  from public.orders o
  join lateral (
    select cash_kobo, credit_kobo from public.ledger_entries e
     where e.user_id = o.user_id and e.listing_id = o.listing_id and e.kind = 'order_payment' and e.cash_kobo + e.credit_kobo = -o.price_kobo
     order by abs(extract(epoch from e.created_at - o.created_at))
     limit 1
  ) e on true
 where not o.is_prize and e.cash_kobo <= 0 and e.credit_kobo <= 0;

-- Does the cancelling, for whoever has already been allowed to. orderCancel.ts stockAfterCancel.
create function private.cancel_order_now(p_order_id uuid, p_reason text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  l public.listings;
  p private.order_payments;
  v_stock int;
begin
  -- Same lock order as checkout: the listing, then what hangs off it.
  select * into o from public.orders where id = p_order_id;
  select * into l from public.listings where id = o.listing_id for update;
  select * into o from public.orders where id = p_order_id for update;
  if o.is_prize then perform private.fail('invalid_input', 'Won items can’t be cancelled here. Contact DrawMart.'); end if;
  if o.status <> 'paid' then perform private.fail('invalid_input', 'Only orders that aren’t ready for a rider yet can be cancelled.'); end if;

  update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, cancel_note = nullif(btrim(coalesce(p_note, '')), '') where id = o.id;
  delete from private.order_pins where order_id = o.id;
  delete from public.payouts where order_id = o.id and status = 'waiting';

  select * into p from private.order_payments where order_id = o.id;
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  values (o.user_id, 'order_refund', coalesce(p.cash_kobo, o.price_kobo), coalesce(p.credit_kobo, 0), 'Refund · ' || l.title, l.id);

  v_stock := case p_reason when 'out_of_stock' then 0 when 'damaged' then l.stock else l.stock + o.quantity end;
  update public.listings
     set stock = v_stock,
         status = case when status = 'for_sale' and v_stock = 0 then 'sold' when status = 'sold' and v_stock > 0 then 'for_sale' else status end
   where id = l.id;

  insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_cancelled', l.id);
end $$;
revoke execute on function private.cancel_order_now(uuid, text, text) from public, anon, authenticated;

create function public.cancel_order(p_order_id uuid, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.require_user();
  select * into o from public.orders where id = p_order_id;
  if not found or o.handled_by <> 'store' or o.merchant_id is distinct from private.my_merchant_id() then
    perform private.fail('not_found', 'That order doesn’t exist.');
  end if;
  if p_reason is null or p_reason not in ('out_of_stock', 'damaged', 'cant_send', 'other') then perform private.fail('invalid_input', 'Pick a reason.'); end if;
  if length(v_note) > 300 then perform private.fail('invalid_input', 'Keep the note to 300 characters.'); end if;
  if p_reason = 'other' and length(v_note) < 5 then perform private.fail('invalid_input', 'Say why, so the buyer understands.'); end if;
  perform private.cancel_order_now(p_order_id, p_reason, v_note);
end $$;

-- Last 30 days, for admins. Won items aren't the seller's to cancel, so they don't count.
create function public.merchant_cancel_rates() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('merchantId', m.id, 'merchantName', m.name, 'orders', x.orders, 'cancelled', x.cancelled))
    from (
      select merchant_id, count(*)::int as orders, count(*) filter (where status = 'cancelled')::int as cancelled
        from public.orders
       where not is_prize and created_at >= now() - interval '30 days'
       group by merchant_id
    ) x join public.merchants m on m.id = x.merchant_id
  ), '[]'::jsonb);
end $$;

revoke all on function public.cancel_order(uuid, text, text), public.merchant_cancel_rates() from public, anon;
grant execute on function public.cancel_order(uuid, text, text), public.merchant_cancel_rates() to authenticated;

-- Same as before, remembering how it was paid.
create or replace function public.checkout(p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_ids uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'listingIds', '[]'::jsonb))::uuid), '{}');
  v_fulfilment text := p ->> 'fulfilment';
  v_address text := btrim(coalesce(p ->> 'address', ''));
  v_phone text := btrim(coalesce(p ->> 'phone', ''));
  v_point text := p ->> 'pickupPointId';
  v_lat double precision;
  v_lng double precision;
  v_pin_error text;
  v_errors text[] := '{}';
  v_checkout uuid := gen_random_uuid();
  l public.listings;
  v_won boolean;
  v_price bigint;
  v_total bigint := 0;
  v_cash bigint;
  v_credit bigint;
  v_from_credit bigint;
  v_order uuid;
  v_qty int;
  v_orders uuid[] := '{}';
begin
  perform private.require_buyer(v_uid);
  if cardinality(v_ids) = 0 then perform private.fail('invalid_input', 'Your cart is empty.'); end if;
  if v_fulfilment is null or v_fulfilment not in ('delivery', 'pickup') then perform private.fail('invalid_input', 'Choose delivery or pickup.'); end if;

  if v_fulfilment = 'delivery' then
    begin
      v_lat := (p ->> 'lat')::double precision;
      v_lng := (p ->> 'lng')::double precision;
    exception when others then
      v_lat := null;
    end;
    v_pin_error := private.location_error(v_lat, v_lng);
    if length(v_address) < 10 then v_errors := array_append(v_errors, 'Enter the full delivery address, with street and area.'); end if;
    if v_pin_error is not null then v_errors := array_append(v_errors, v_pin_error); end if;
    v_point := null;
  else
    v_address := null;
    if not exists (select 1 from public.pickup_points where id = v_point and active) then v_errors := array_append(v_errors, 'Choose a pickup location.'); end if;
  end if;
  if regexp_replace(v_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  -- Same lock order as buy_tickets: the buyer's wallet, then the listings.
  perform 1 from public.profiles where id = v_uid for update;

  for l in select * from public.listings where id = any (v_ids) order by id for update loop
    v_won := l.status = 'drawn' and private.has_won(v_uid, l.id);
    v_price := case when v_won then 0 when l.status <> 'for_sale' then null when l.kind = 'product' then l.price_kobo else l.fallback_price_kobo end;
    if v_price is null then perform private.fail('not_for_sale', l.title || ' isn’t for sale any more.'); end if;
    if l.category = 'Cars' and cardinality(v_ids) > 1 then perform private.fail('invalid_input', 'Cars are arranged on their own, not with other items.'); end if;
    if l.category = 'Cars' and v_fulfilment = 'pickup' then perform private.fail('invalid_input', 'Cars stay with the dealer, so they can’t be collected from a pickup location.'); end if;
    if v_won and exists (select 1 from public.orders where listing_id = l.id) then perform private.fail('invalid_input', l.title || ' has already been arranged.'); end if;
    v_total := v_total + v_price * private.order_quantity(p, l);
  end loop;
  if (select count(*) from public.listings where id = any (v_ids)) <> cardinality(v_ids) then perform private.fail('not_found', 'One of those items no longer exists.'); end if;

  -- A seller can change a price at any time, so never charge one the buyer hasn't seen. Older apps don't send this.
  if p ->> 'expectedTotalKobo' is not null and (p ->> 'expectedTotalKobo')::bigint <> v_total then
    perform private.fail('invalid_input', 'A price has just changed. Check the new total.');
  end if;

  select coalesce(sum(cash_kobo), 0), coalesce(sum(credit_kobo), 0) into v_cash, v_credit from public.ledger_entries where user_id = v_uid;
  if v_cash + v_credit < v_total then perform private.fail('insufficient_funds'); end if;
  v_credit := greatest(v_credit, 0);

  for l in select * from public.listings where id = any (v_ids) order by id loop
    v_won := l.status = 'drawn';
    v_qty := private.order_quantity(p, l);
    v_price := v_qty * case when v_won then 0 when l.kind = 'product' then l.price_kobo else l.fallback_price_kobo end;
    insert into public.orders (quantity, listing_id, user_id, merchant_id, price_kobo, fee_kobo, delivery_address, delivery_phone, delivery_lat, delivery_lng,
                               fulfilment, pickup_point_id, is_prize, handled_by, checkout_id)
    values (v_qty, l.id, v_uid, l.merchant_id, v_price, round(v_price * l.fee_bps / 10000.0)::bigint, v_address, v_phone, v_lat, v_lng,
            v_fulfilment, v_point, v_won, case when v_won and l.category <> 'Cars' then 'drawmart' else 'store' end, v_checkout)
    returning id into v_order;
    v_orders := array_append(v_orders, v_order);
    if not v_won then
      v_from_credit := least(v_credit, v_price);
      v_credit := v_credit - v_from_credit;
      insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
      values (v_uid, 'order_payment', -(v_price - v_from_credit), -v_from_credit, 'Bought · ' || l.title || case when v_qty > 1 then ' × ' || v_qty else '' end, l.id);
      insert into private.order_payments (order_id, cash_kobo, credit_kobo) values (v_order, v_price - v_from_credit, v_from_credit);
      -- orders.ts takeStock. The row has been locked since the first loop, so two buyers can't both get the last one.
      update public.listings set stock = stock - v_qty, status = case when stock <= v_qty then 'sold' else status end where id = l.id;
    end if;
  end loop;

  delete from public.cart_items where user_id = v_uid and listing_id = any (v_ids);
  return to_jsonb(v_orders);
end $$;

-- Same as before, leaving cancelled orders out.
create or replace function private.sync_payouts(p_listing uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  o public.orders;
  v_seller_bps numeric;
  v_delivered boolean;
  v_anchor uuid;
begin
  select * into l from public.listings where id = p_listing;
  if not found then return; end if;

  for o in select * from public.orders where listing_id = p_listing and not is_prize and status <> 'cancelled' loop
    insert into public.payouts (merchant_id, listing_id, order_id, kind, amount_kobo)
    select o.merchant_id, o.listing_id, o.id, 'sale', o.price_kobo - o.fee_kobo
     where o.price_kobo - o.fee_kobo > 0
    on conflict (order_id) where kind = 'sale' do nothing;
    if o.status = 'delivered' then
      update public.payouts set status = 'due', due_at = now() where order_id = o.id and kind = 'sale' and status = 'waiting';
    end if;
  end loop;

  v_delivered := exists (select 1 from public.orders where listing_id = p_listing and is_prize and status = 'delivered');

  if l.kind = 'raffle' and l.status in ('sold_out', 'drawn') then
    -- fees.ts computeListingEconomics
    v_seller_bps := case l.fee_mode when 'seller' then l.fee_bps when 'split' then l.fee_bps / 2.0 else 0 end;
    insert into public.payouts (merchant_id, listing_id, kind, amount_kobo)
    values (l.merchant_id, l.id, 'draw', l.price_kobo - round(l.price_kobo * v_seller_bps / 10000.0)::bigint)
    on conflict (listing_id, kind) where kind in ('draw', 'caution_fee') do nothing;
    if v_delivered then
      update public.payouts set status = 'due', due_at = now() where listing_id = l.id and kind = 'draw' and status = 'waiting';
    end if;
  end if;

  if l.caution_fee_status = 'refunded' and l.caution_fee_kobo > 0 then
    -- A shared pickup has one fee: its line sits on one of its items, due once all are delivered.
    if l.pickup_batch_id is not null then
      select id into v_anchor from public.listings where pickup_batch_id = l.pickup_batch_id order by id limit 1;
      v_delivered := not exists (
        select 1 from public.listings m
         where m.pickup_batch_id = l.pickup_batch_id
           and not exists (select 1 from public.orders o2 where o2.listing_id = m.id and o2.is_prize and o2.status = 'delivered')
      );
    else
      v_anchor := l.id;
    end if;
    insert into public.payouts (merchant_id, listing_id, kind, amount_kobo)
    values (l.merchant_id, v_anchor, 'caution_fee', l.caution_fee_kobo)
    on conflict (listing_id, kind) where kind in ('draw', 'caution_fee') do nothing;
    if v_delivered or l.status = 'withdrawn' then
      update public.payouts set status = 'due', due_at = now() where listing_id = v_anchor and kind = 'caution_fee' and status = 'waiting';
    end if;
  end if;
end $$;

-- Same as before, with cancelled orders.
create or replace function private.push_for_notification() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_title text;
  v_batch uuid;
  v_category text;
  v_home text;
begin
  select title, pickup_batch_id, category into v_title, v_batch, v_category from public.listings where id = new.listing_id;
  -- Individual sellers work from /sell in the buyer app.
  select case when role = 'store' then '/store' else '/sell' end into v_home from public.profiles where id = new.user_id;
  case new.kind
    when 'draw_won' then
      perform private.queue_push(new.user_id, 'wins', 'You won a draw', v_title || '. Open DrawMart to arrange it.', '/draws/' || new.listing_id, 'draw-' || new.listing_id);
    when 'draw_lost' then
      perform private.queue_push(new.user_id, 'draw_results', 'Draw result', 'The result for ' || v_title || ' is in.', '/draws/' || new.listing_id, 'draw-' || new.listing_id);
    when 'draw_sold_out' then
      perform private.queue_push(new.user_id, 'draw_results', 'All tickets sold', v_title || ' has sold out. We’ll tell you when the winner is announced.', '/listings/' || new.listing_id, 'draw-' || new.listing_id);
    when 'saved_almost_sold' then
      perform private.queue_push(new.user_id, 'saved_items', 'A draw you saved', '90% of the tickets for ' || v_title || ' have sold.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'saved_closing_soon' then
      perform private.queue_push(new.user_id, 'saved_items', 'A draw you saved', v_title || ' closes within 24 hours.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'saved_relisted' then
      perform private.queue_push(new.user_id, 'saved_items', 'An item you saved', 'The store has listed ' || v_title || ' again as a new draw.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'saved_back_on_sale' then
      perform private.queue_push(new.user_id, 'saved_items', 'An item you saved', v_title || ' is on sale.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'saved_price_drop' then
      perform private.queue_push(new.user_id, 'saved_items', 'An item you saved', v_title || ' now costs less.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'store_new_order' then
      perform private.queue_push(new.user_id, 'store_orders', 'New order', v_title || ' has been bought. Get it ready for a rider.', v_home || '?tab=orders', 'order-' || new.listing_id);
    when 'store_listing_approved' then
      perform private.queue_push(new.user_id, 'store_listings', 'Listing approved', v_title || ' is now live for buyers.', v_home, 'review-' || new.listing_id);
    when 'store_listing_rejected' then
      perform private.queue_push(new.user_id, 'store_listings', 'Listing not approved', 'See why ' || v_title || ' wasn’t approved, and fix it.', v_home || '?fix=' || new.listing_id, 'review-' || new.listing_id);
    when 'order_cancelled' then
      perform private.queue_push(new.user_id, 'orders', 'Order cancelled', v_title || ' was cancelled and you’ve been refunded.', '/tickets?view=orders', 'order-cancelled-' || new.id);
    when 'store_price_approved' then
      perform private.queue_push(new.user_id, 'store_listings', 'Price approved', 'The new price for ' || v_title || ' is live.', v_home, 'review-' || new.listing_id);
    when 'store_price_rejected' then
      perform private.queue_push(new.user_id, 'store_listings', 'Price not approved', v_title || ' stays at its current price.', v_home, 'review-' || new.listing_id);
    when 'store_draw_sold_out' then
      perform private.queue_push(new.user_id, 'store_draws', 'All tickets sold', v_title || ' has sold out.', v_home, 'store-draw-' || new.listing_id);
    when 'store_winner_picked' then
      perform private.queue_push(new.user_id, 'store_draws', 'Winner announced', 'The draw for ' || v_title || ' has run.', v_home, 'store-draw-' || new.listing_id);
    when 'store_draw_closing' then
      perform private.queue_push(new.user_id, 'store_draws', 'Draw closing soon', v_title || ' closes within 24 hours and hasn’t sold out.', v_home, 'store-draw-' || new.listing_id);
    when 'store_pickup_tomorrow' then
      perform private.queue_push(new.user_id, 'store_pickups',
        case when v_category = 'Cars' then 'Inspection tomorrow' else 'Pickup tomorrow' end,
        -- A shared pickup's items collapse into one notification, so it can't name just one.
        case when v_batch is not null then 'Have the items in your shared pickup ready.' else 'Have ' || v_title || ' ready.' end,
        v_home, 'pickup-' || coalesce(v_batch, new.listing_id));
    when 'store_payout_sent' then
      perform private.queue_push(new.user_id, 'store_payouts', 'Payout sent', 'We’ve sent a payout to your bank account.', case when v_home = '/store' then '/store/payouts' else '/sell?tab=payouts' end, 'payout-' || new.id);
    when 'store_bank_changed' then
      -- Not a kind anyone can switch off: it's how they find out if it wasn't them.
      perform private.queue_push(new.user_id, 'security', 'Bank account changed', 'Your payout account was changed. If this wasn’t you, contact DrawMart now.', case when v_home = '/store' then '/store/payouts' else '/sell?tab=payouts' end, 'bank-' || new.id);
    -- store_new_message: push_for_message sends this one, since it knows the conversation.
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before: a cancelled order isn't a sale.
create or replace function public.merchant_metrics(p_days int) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_merchant uuid := private.my_merchant_id();
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_from date;
begin
  if v_merchant is null then perform private.fail('forbidden', 'Only sellers have insights.'); end if;
  if p_days not in (7, 30) then perform private.fail('invalid_input', 'Pick 7 or 30 days.'); end if;
  v_from := v_today - (p_days - 1);

  return jsonb_build_object(
    'listings', coalesce((
      select jsonb_agg(x order by x."views" desc, x."createdAt" desc)
      from (
        select
          l.id as "listingId", l.product_code as "productCode", l.title, l.images[1] as image, l.category, l.kind, l.status, l.created_at as "createdAt",
          (select count(*) from public.listing_views v where v.listing_id = l.id and v.day >= v_from)::int as views,
          (select count(distinct v.visitor) from public.listing_views v where v.listing_id = l.id and v.day >= v_from)::int as visitors,
          (select count(*) from public.conversations c where c.listing_id = l.id and (c.created_at at time zone 'Africa/Lagos')::date >= v_from)::int as chats,
          -- A raffle that ended unsold can still sell at a fixed price, so add both.
          coalesce(t.units, 0) + o.units as units,
          coalesce(t.buyers, 0) + o.buyers as buyers,
          coalesce(t.sales, 0) + o.sales as "salesKobo"
        from public.listings l
        left join lateral (
          select count(*)::int as units,
                 count(distinct coalesce(tk.user_id::text, tk.purchase_ref))::int as buyers,
                 (count(*) * l.buyer_ticket_price_kobo)::bigint as sales
            from public.tickets tk
           where tk.listing_id = l.id and l.kind = 'raffle' and l.status in ('live', 'sold_out', 'drawn')
             and (tk.purchased_at at time zone 'Africa/Lagos')::date >= v_from
        ) t on l.kind = 'raffle'
        left join lateral (
          select coalesce(sum(od.quantity), 0)::int as units, count(distinct od.user_id)::int as buyers, coalesce(sum(od.price_kobo), 0)::bigint as sales
            from public.orders od
           where od.listing_id = l.id and not od.is_prize and od.status <> 'cancelled' and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
        ) o on true
        where l.merchant_id = v_merchant and l.status not in ('rejected', 'withdrawn')
      ) x
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'views', d.views, 'salesKobo', d.sales) order by d.day)
      from (
        select day, sum(views)::int as views, sum(sales)::bigint as sales
        from (
          select v.day, count(*) as views, 0::bigint as sales
            from public.listing_views v join public.listings l on l.id = v.listing_id
           where l.merchant_id = v_merchant and v.day >= v_from
           group by v.day
          union all
          select (tk.purchased_at at time zone 'Africa/Lagos')::date, 0, sum(l.buyer_ticket_price_kobo)
            from public.tickets tk join public.listings l on l.id = tk.listing_id
           where l.merchant_id = v_merchant and l.kind = 'raffle' and l.status in ('live', 'sold_out', 'drawn')
             and (tk.purchased_at at time zone 'Africa/Lagos')::date >= v_from
           group by 1
          union all
          select (od.created_at at time zone 'Africa/Lagos')::date, 0, sum(od.price_kobo)
            from public.orders od
           where od.merchant_id = v_merchant and od.status <> 'cancelled' and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
           group by 1
        ) u
        group by day
      ) d
    ), '[]'::jsonb)
  );
end $$;

-- Same as before, wiping how orders were paid too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
           public.listing_views, public.tickets, public.draw_results, public.ledger_entries, public.deposits,
           public.pending_limits, public.listing_handovers, private.listing_seeds, public.listings,
           public.seller_applications, public.saved_pickups, public.notifications, public.cart_items, public.saved_addresses,
           public.saved_listings, public.winner_stories, private.winner_consent_log, private.push_outbox, private.saved_alerts_sent;

  -- Individual sellers go back to being plain buyers; their shops go.
  update public.profiles set seller_id = null where seller_id is not null;
  delete from public.merchants where kind = 'individual';

  -- Back to how a new account starts.
  update public.profiles set state = 'Lagos', age_verified = true, weekly_limit_kobo = s.default_weekly_limit_kobo, phone = null where role = 'buyer';
  update public.app_settings set boosts_forced_on = false, boost_min_active_buyers = 1000, boost_max_active = 12 where id;

  -- The starting balance for every buyer. Test accounts created below get theirs from the sign-up trigger.
  insert into public.ledger_entries (user_id, kind, cash_kobo, memo)
  select id, 'topup', s.welcome_credit_kobo, 'Welcome top-up (test money)' from public.profiles where role = 'buyer' and s.welcome_credit_kobo > 0;

  perform private.seed_demo_data();
  perform private.seed_test_accounts();
end $$;
