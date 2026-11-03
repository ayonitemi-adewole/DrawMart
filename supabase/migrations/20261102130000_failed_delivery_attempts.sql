-- A buyer who isn't there (deliveryAttempts.ts). The rider says they've arrived,
-- waits 10 minutes and records a failed attempt with a photo and their location near
-- the pin. The buyer has 24 hours to pick a new window or a pickup location, and
-- DrawMart pays for the second trip. A second failure, or no choice in time, sends it
-- back to the seller and refunds the price, not delivery. Won items can't be failed here.

alter table public.orders
  add column arrived_at timestamptz,
  add column failed_attempts int not null default 0 check (failed_attempts between 0 and 2),
  add column last_failed_at timestamptz,
  add column redelivery_choice text check (redelivery_choice in ('redeliver', 'pickup')),
  add column redeliver_at timestamptz;

-- Where and when each failed attempt happened, with the rider's photo. Admins only.
create table private.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  rider_id uuid not null references public.profiles (id),
  photo text not null,
  lat double precision not null,
  lng double precision not null,
  arrived_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index delivery_attempts_order_idx on private.delivery_attempts (order_id);
alter table private.delivery_attempts enable row level security;
revoke all on private.delivery_attempts from public, anon, authenticated;

alter table public.orders drop constraint orders_cancel_reason_check;
alter table public.orders add constraint orders_cancel_reason_check check (cancel_reason in ('out_of_stock', 'damaged', 'cant_send', 'other', 'not_confirmed', 'not_sent', 'failed_check', 'refused_wrong', 'refused_damaged', 'not_collected', 'not_delivered'));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'draw_sold_out', 'draw_won', 'draw_lost',
  'saved_almost_sold', 'saved_closing_soon', 'saved_relisted', 'saved_back_on_sale', 'saved_price_drop',
  'store_new_order', 'store_listing_approved', 'store_listing_rejected', 'store_draw_sold_out',
  'store_winner_picked', 'store_draw_closing', 'store_pickup_tomorrow', 'store_new_message',
  'store_payout_sent', 'store_bank_changed',
  'store_price_approved', 'store_price_rejected',
  'order_cancelled',
  'store_order_confirm_soon', 'store_order_expired',
  'store_order_failed', 'store_suspended',
  'order_claim_update', 'store_order_claim',
  'store_new_review', 'review_reply',
  'store_approved',
  'store_support_reply',
  'rider_new_job', 'rider_new_return', 'rider_collect_soon', 'rider_job_released', 'rider_pin_unlocked',
  'order_ready_to_collect', 'order_collect_reminder', 'store_order_uncollected',
  'order_delivery_failed', 'store_order_undelivered', 'rider_redelivery_chosen'
));

-- The order this rider is at the door with: collected, for delivery, not a won item.
create function private.door_order(p_order_id uuid, p_rider uuid) returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id and rider_id = p_rider and status = 'dispatched' and collected_at is not null for update;
  if not found then perform private.fail('invalid_input', 'Only deliveries you’re carrying can be marked.'); end if;
  if o.fulfilment <> 'delivery' then perform private.fail('invalid_input', 'Hand pickup orders to the counter staff.'); end if;
  if o.is_prize then perform private.fail('invalid_input', 'Won items can’t be marked as not delivered. Contact DrawMart.'); end if;
  if o.failed_attempts = 1 and o.redelivery_choice is distinct from 'redeliver' then
    perform private.fail('invalid_input', 'The buyer hasn’t chosen a new time yet.');
  end if;
  return o;
end $$;

-- Starts the wait. Returns when it started.
create function public.mark_arrived(p_order_id uuid) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare o public.orders := private.door_order(p_order_id, private.require_delivery());
begin
  update public.orders set arrived_at = coalesce(arrived_at, now()) where id = o.id returning arrived_at into o.arrived_at;
  return o.arrived_at;
end $$;

-- Back to the seller: refunded the price, not delivery, and not the seller's fault.
create function private.return_undelivered(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.orders;
begin
  perform private.cancel_order_now(p_order_id, 'not_delivered', null);
  update public.orders set return_state = 'returning', arrived_at = null where id = p_order_id returning * into o;
  perform private.notify_shop(o.merchant_id, 'store_order_undelivered', o.listing_id);
end $$;

-- deliveryAttempts.ts attemptError.
create function public.fail_delivery_attempt(p_order_id uuid, p_photo text, p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  o public.orders := private.door_order(p_order_id, v_uid);
begin
  if o.arrived_at is null then perform private.fail('invalid_input', 'Say you’ve arrived first, then call the buyer.'); end if;
  if o.arrived_at > now() - interval '10 minutes' then perform private.fail('invalid_input', 'Wait 10 minutes after arriving, and call the buyer.'); end if;
  perform private.check_delivery_photos(array[p_photo]);
  if p_lat is null or p_lng is null then perform private.fail('invalid_input', 'Share your location, so we know you were there.'); end if;
  -- deliveryAttempts.ts metresBetween.
  if o.delivery_lat is not null and sqrt(power(radians(p_lng - o.delivery_lng) * cos(radians((p_lat + o.delivery_lat) / 2)), 2) + power(radians(p_lat - o.delivery_lat), 2)) * 6371000 > 500 then
    perform private.fail('invalid_input', 'You need to be at the buyer’s address to record this.');
  end if;

  insert into private.delivery_attempts (order_id, rider_id, photo, lat, lng, arrived_at) values (o.id, v_uid, p_photo, p_lat, p_lng, o.arrived_at);
  if o.failed_attempts = 0 then
    update public.orders set failed_attempts = 1, last_failed_at = now(), arrived_at = null, redelivery_choice = null, redeliver_at = null where id = o.id;
    insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_delivery_failed', o.listing_id);
  else
    update public.orders set failed_attempts = 2, last_failed_at = now() where id = o.id;
    perform private.return_undelivered(o.id);
  end if;
end $$;

-- deliveryAttempts.ts redeliveryWindowError. A window, or a pickup location instead.
create function public.choose_redelivery(p_order_id uuid, p_window_start timestamptz, p_pickup_point_id text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_local timestamp;
begin
  perform private.require_user();
  select * into o from public.orders where id = p_order_id and user_id = auth.uid() for update;
  if not found then perform private.fail('not_found', 'That order doesn’t exist.'); end if;
  if o.status <> 'dispatched' or o.failed_attempts <> 1 or o.redelivery_choice is not null then
    perform private.fail('invalid_input', 'This order doesn’t need a new time.');
  end if;
  if o.last_failed_at <= now() - interval '24 hours' then perform private.fail('invalid_input', 'The time to choose has passed.'); end if;
  if (p_window_start is null) = (p_pickup_point_id is null) then perform private.fail('invalid_input', 'Pick a time or a pickup location.'); end if;

  if p_pickup_point_id is not null then
    if not exists (select 1 from public.pickup_points where id = p_pickup_point_id and active) then
      perform private.fail('invalid_input', 'Choose a pickup location.');
    end if;
    update public.orders
       set fulfilment = 'pickup', pickup_point_id = p_pickup_point_id, delivery_address = null, delivery_lat = null, delivery_lng = null, redelivery_choice = 'pickup'
     where id = o.id;
  else
    v_local := p_window_start at time zone 'Africa/Lagos';
    if extract(hour from v_local)::int not in (9, 11, 13, 15, 17) or date_trunc('hour', v_local) <> v_local
       or p_window_start < now() + interval '1 hour' or p_window_start > o.last_failed_at + interval '48 hours' then
      perform private.fail('invalid_input', 'Pick one of the times shown.');
    end if;
    update public.orders set redelivery_choice = 'redeliver', redeliver_at = p_window_start where id = o.id;
  end if;
  if o.rider_id is not null then
    insert into public.notifications (user_id, kind, listing_id) values (o.rider_id, 'rider_redelivery_chosen', o.listing_id);
  end if;
end $$;

-- deliveryAttempts.ts CHOOSE_WITHIN_HOURS. Run by process_deadlines.
create function private.redelivery_deadlines() returns void
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  for v_id in
    select id from public.orders
     where status = 'dispatched' and failed_attempts = 1 and redelivery_choice is null and last_failed_at <= now() - interval '24 hours'
       for update skip locked
  loop
    perform private.return_undelivered(v_id);
  end loop;
end $$;

revoke all on function private.door_order(uuid, uuid), private.return_undelivered(uuid), private.redelivery_deadlines() from public, anon, authenticated;
revoke all on function public.mark_arrived(uuid), public.fail_delivery_attempt(uuid, text, double precision, double precision), public.choose_redelivery(uuid, timestamptz, text) from public, anon;
grant execute on function public.mark_arrived(uuid), public.fail_delivery_attempt(uuid, text, double precision, double precision), public.choose_redelivery(uuid, timestamptz, text) to authenticated;

-- Same as before, for a buyer who couldn't be reached: the fee isn't refunded.
create or replace function private.cancel_order_now(p_order_id uuid, p_reason text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  l public.listings;
  p private.order_payments;
  v_stock int;
  v_other uuid;
begin
  -- Same lock order as checkout: the listing, then what hangs off it.
  select * into o from public.orders where id = p_order_id;
  select * into l from public.listings where id = o.listing_id for update;
  select * into o from public.orders where id = p_order_id for update;
  if o.is_prize then perform private.fail('invalid_input', 'Won items can’t be cancelled here. Contact DrawMart.'); end if;
  -- A failed check or a refusal happens once a rider has it; everything else is before that.
  if o.status <> 'paid' and not (o.status = 'dispatched' and p_reason in ('failed_check', 'refused_wrong', 'refused_damaged', 'not_collected', 'not_delivered')) then
    perform private.fail('invalid_input', 'Only orders that aren’t ready for a rider yet can be cancelled.');
  end if;

  update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, cancel_note = nullif(btrim(coalesce(p_note, '')), '') where id = o.id;
  delete from private.order_pins where order_id = o.id;
  delete from public.payouts where order_id = o.id and status = 'waiting';

  select * into p from private.order_payments where order_id = o.id;
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  values (o.user_id, 'order_refund', coalesce(p.cash_kobo, o.price_kobo), coalesce(p.credit_kobo, 0), 'Refund · ' || l.title, l.id);

  -- One fee covers everything from this seller in this checkout. If something's still
  -- coming, the fee moves to it; if this was the last, it comes back too.
  -- Not collected: the trip happened, so the fee isn't refunded.
  if o.delivery_fee_kobo > 0 and p_reason not in ('not_collected', 'not_delivered') then
    select id into v_other from public.orders
     where checkout_id = o.checkout_id and merchant_id = o.merchant_id and id <> o.id and status <> 'cancelled' and not is_prize
     limit 1;
    if v_other is not null then
      update public.orders set delivery_fee_kobo = delivery_fee_kobo + o.delivery_fee_kobo where id = v_other;
      update private.order_payments set fee_cash_kobo = fee_cash_kobo + p.fee_cash_kobo, fee_credit_kobo = fee_credit_kobo + p.fee_credit_kobo where order_id = v_other;
      update public.orders set delivery_fee_kobo = 0 where id = o.id;
    elsif p.fee_cash_kobo + p.fee_credit_kobo > 0 then
      insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
      values (o.user_id, 'order_refund', p.fee_cash_kobo, p.fee_credit_kobo, 'Delivery refund · ' || l.title, l.id);
    end if;
  end if;

  v_stock := case when p_reason = 'out_of_stock' then 0 when p_reason in ('damaged', 'failed_check', 'refused_wrong', 'refused_damaged', 'not_collected', 'not_delivered') then l.stock else l.stock + o.quantity end;
  update public.listings
     set stock = v_stock,
         status = case when p_reason in ('not_confirmed', 'not_sent') and kind = 'product' and status in ('for_sale', 'sold') then 'paused' when status = 'for_sale' and v_stock = 0 then 'sold' when status = 'sold' and v_stock > 0 then 'for_sale' else status end
   where id = l.id;

  insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_cancelled', l.id);
end $$;

-- Same as before: a buyer who couldn't be reached isn't the seller's cancellation.
create or replace function public.merchant_cancel_rates() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('merchantId', m.id, 'merchantName', m.name, 'orders', coalesce(x.orders, 0), 'cancelled', coalesce(x.cancelled, 0), 'failed', coalesce(x.failed, 0), 'suspended', m.suspended_at is not null))
    from public.merchants m
    left join (
      select merchant_id, count(*)::int as orders, count(*) filter (where status = 'cancelled' and coalesce(cancel_reason, '') not in ('not_collected', 'not_delivered'))::int as cancelled,
             count(*) filter (where cancel_reason in ('failed_check', 'refused_wrong', 'refused_damaged'))::int as failed
        from public.orders
       where not is_prize and created_at >= now() - interval '30 days'
       group by merchant_id
    ) x on x.merchant_id = m.id
    where x.merchant_id is not null or m.suspended_at is not null
  ), '[]'::jsonb);
end $$;

-- Same as before, with failed attempts.
create or replace function public.delivery_jobs() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_mins int := (private.settings()).rider_collect_minutes;
begin
  return (
    select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."deliveredAt" desc nulls first, x."dispatchedAt"), '[]'::jsonb)
    from (
      select
        o.id,
        l.product_code as "productCode",
        l.title as "listingTitle",
        o.quantity,
        o.confirm_photo as "confirmPhoto",
        o.collected_at is not null as collected,
        o.return_state is not distinct from 'returning' as returning,
        l.images[1] as "listingImage",
        l.category,
        o.fulfilment,
        o.status,
        o.dispatched_at as "dispatchedAt",
        o.delivered_at as "deliveredAt",
        o.rider_id is not null as mine,
        case when o.status in ('dispatched', 'delivered') then o.counter_at end as "atCounterAt",
        o.return_state = 'returning' and o.counter_at is not null and o.counter_out_at is null as "waitingAtCounter",
        o.arrived_at as "arrivedAt",
        o.failed_attempts as "failedAttempts",
        o.status = 'dispatched' and o.failed_attempts = 1 and o.redelivery_choice is null as "awaitingBuyer",
        case when o.redelivery_choice = 'redeliver' then o.redeliver_at end as "redeliverAt",
        case when o.rider_id = v_uid and o.status = 'dispatched' and o.collected_at is null
          then o.rider_assigned_at + make_interval(mins => v_mins) end as "collectBy",
        case when o.handled_by = 'drawmart'
          then jsonb_build_object('name', 'DrawMart escrow', 'area', 'Lagos')
          else jsonb_build_object('name', m.name, 'area', m.area) || case
            -- Only for the rider on the way there, or bringing a refused item back.
            when o.rider_id = v_uid and ((o.status = 'dispatched' and o.collected_at is null) or o.return_state = 'returning') then coalesce((
              select jsonb_build_object('address', sp.address, 'contactPhone', sp.contact_phone, 'location', jsonb_build_object('lat', sp.lat, 'lng', sp.lng))
                from public.shop_pickups sp where sp.merchant_id = m.id
            ), '{}'::jsonb)
            else '{}'::jsonb
          end end as "collectFrom",
        case when pp.id is not null then jsonb_build_object(
          'id', pp.id, 'name', pp.name, 'area', pp.area, 'address', pp.address, 'hours', pp.hours,
          'location', jsonb_build_object('lat', pp.lat, 'lng', pp.lng)) end as "pickupPoint",
        case when o.rider_id = v_uid and o.status = 'dispatched' and o.collected_at is not null and o.counter_at is null then jsonb_build_object(
          'buyerName', b.display_name,
          'address', coalesce(o.delivery_address, ''),
          'location', case when o.delivery_lat is not null then jsonb_build_object('lat', o.delivery_lat, 'lng', o.delivery_lng) end,
          'contactPhone', o.delivery_phone) end as "dropOff",
        case when o.status = 'dispatched' then (select p.locked_until from private.order_pins p where p.order_id = o.id and p.locked_until > now()) end as "pinLockedUntil"
      from public.orders o
      join public.listings l on l.id = o.listing_id
      join public.merchants m on m.id = o.merchant_id
      join public.profiles b on b.id = o.user_id
      left join public.pickup_points pp on pp.id = o.pickup_point_id
      where (o.status = 'dispatched' and o.rider_id is null and o.counter_at is null)
         or (o.return_state = 'returning' and o.rider_id is null and o.counter_at is not null and o.counter_out_at is null)
         or (o.rider_id = v_uid and (o.status in ('dispatched', 'delivered') or o.return_state = 'returning'))
      order by o.delivered_at desc nulls first
      limit 200
    ) x
  );
end $$;

-- Same as before, with failed attempts.
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
    when 'store_order_confirm_soon' then
      perform private.queue_push(new.user_id, 'store_orders', 'Confirm this order', 'Confirm ' || v_title || ' soon, or it will be cancelled.', v_home || '?tab=orders', 'order-confirm-' || new.id);
    when 'store_order_expired' then
      perform private.queue_push(new.user_id, 'store_orders', 'Order cancelled', v_title || ' wasn’t confirmed or made ready in time. The buyer was refunded and the item is paused.', v_home || '?tab=orders', 'order-expired-' || new.id);
    when 'store_order_failed' then
      perform private.queue_push(new.user_id, 'store_orders', 'An order failed', v_title || ' failed a check or was refused. The buyer was refunded and you’ve been charged.', v_home || '?tab=orders', 'order-failed-' || new.id);
    when 'store_suspended' then
      perform private.queue_push(new.user_id, 'store_orders', 'Your shop is suspended', 'Too many orders have failed. Contact DrawMart.', v_home, 'store-suspended');
    when 'order_claim_update' then
      perform private.queue_push(new.user_id, 'orders', 'Your return or claim', 'There’s an update on ' || v_title || '.', '/tickets?view=orders', 'claim-' || new.listing_id);
    when 'store_order_claim' then
      perform private.queue_push(new.user_id, 'store_orders', 'A return or claim', 'There’s an update on ' || v_title || '.', v_home || '?tab=orders', 'store-claim-' || new.listing_id);
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
    when 'store_new_review' then
      perform private.queue_push(new.user_id, 'store_orders', 'New review', 'A buyer reviewed ' || v_title || '.', case when v_home = '/store' then '/store/reviews' else '/sell?tab=reviews' end, 'review-new-' || new.id);
    when 'review_reply' then
      perform private.queue_push(new.user_id, 'orders', 'The seller replied', 'The seller replied to your review of ' || v_title || '.', '/tickets?view=orders', 'review-reply-' || new.listing_id);
    when 'store_approved' then
      perform private.queue_push(new.user_id, 'store_listings', 'Your store is approved', 'Open DrawMart to set it up.', '/store', 'store-approved');
    when 'store_support_reply' then
      -- Never the message itself on a lock screen.
      perform private.queue_push(new.user_id, 'messages', 'DrawMart replied', 'Open DrawMart to read it.', case when v_home = '/store' then '/store/help' else '/sell/help' end, 'support');
    when 'order_ready_to_collect' then
      perform private.queue_push(new.user_id, 'orders', 'Ready to collect', v_title || ' is at the pickup location. Bring your PIN.', '/tickets?view=orders', 'order-counter-' || new.listing_id);
    when 'order_collect_reminder' then
      perform private.queue_push(new.user_id, 'orders', 'Still waiting for you', 'Collect ' || v_title || ' within 7 days, or it goes back to the seller.', '/tickets?view=orders', 'order-counter-' || new.listing_id);
    when 'store_order_uncollected' then
      perform private.queue_push(new.user_id, 'store_orders', 'Not collected', 'The buyer didn’t collect ' || v_title || ', so it’s coming back to you.', v_home || '?tab=orders', 'order-uncollected-' || new.id);
    when 'order_delivery_failed' then
      perform private.queue_push(new.user_id, 'orders', 'We missed you', 'Your rider couldn’t deliver ' || v_title || '. Choose a new time within 24 hours.', '/tickets?view=orders', 'order-attempt-' || new.listing_id);
    when 'store_order_undelivered' then
      perform private.queue_push(new.user_id, 'store_orders', 'Not delivered', 'The buyer couldn’t be reached, so ' || v_title || ' is coming back to you.', v_home || '?tab=orders', 'order-undelivered-' || new.id);
    -- store_new_message: push_for_message sends this one, since it knows the conversation.
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, with rebooked deliveries.
create or replace function private.push_for_rider_notification() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_what text := coalesce((select category from public.listings where id = new.listing_id), 'An item');
  v_where text := coalesce((select name from public.delivery_areas where id = new.area), 'Lagos');
begin
  case new.kind
    when 'rider_new_job' then
      perform private.queue_push(new.user_id, 'rider_new_jobs', 'New delivery job', v_what || ', to collect in ' || v_where || '.', '/delivery?tab=available', 'rider-new-jobs');
    when 'rider_new_return' then
      perform private.queue_push(new.user_id, 'rider_returns', 'Return to collect', v_what || ', to collect from a buyer in ' || v_where || '.', '/delivery?tab=returns', 'rider-returns');
    when 'rider_collect_soon' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'Collect it soon', 'A job you took goes back to the list in 30 minutes unless you collect it.', '/delivery?tab=mine', 'rider-collect-' || new.listing_id);
    when 'rider_job_released' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'A job went back to the list', 'It wasn’t collected in time, so another rider can take it.', '/delivery?tab=available', 'rider-collect-' || new.listing_id);
    when 'rider_pin_unlocked' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'You can try the PIN again', 'The pause on a delivery’s PIN is over.', '/delivery?tab=mine', 'rider-pin-' || new.listing_id);
    when 'rider_redelivery_chosen' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'Delivery rebooked', 'A buyer you missed chose a new time or a pickup location.', '/delivery?tab=mine', 'rider-rebooked-' || new.listing_id);
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_rider_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, with buyers who didn't choose a new time.
create or replace function private.process_deadlines() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  s public.app_settings := private.settings();
  n int := 0;
begin
  for l in
    select * from public.listings where status = 'live' and closes_at <= now() for update skip locked
  loop
    n := n + 1;
    if l.unsold_policy = 'extend_once' and not l.extended then
      update public.listings set extended = true, closes_at = now() + make_interval(days => s.extension_days) where id = l.id;
      continue;
    end if;
    perform private.refund_buyers(l.id);
    update public.listings
       set status = case when l.unsold_policy = 'convert_to_sale' and l.fallback_price_kobo is not null then 'for_sale' else 'refunded' end,
           caution_fee_status = case when caution_fee_status = 'held' then 'kept' else caution_fee_status end
     where id = l.id;
  end loop;

  -- Also apply any raised weekly limits that are now due.
  with due as (delete from public.pending_limits where effective_at <= now() returning user_id, amount_kobo)
  update public.profiles p set weekly_limit_kobo = due.amount_kobo from due where p.id = due.user_id;

  perform private.run_due_draws();
  perform private.closing_soon_alerts();
  perform private.store_reminders();
  perform private.order_confirm_deadlines();
  perform private.release_sale_payouts();
  perform private.rider_reminders();
  perform private.release_late_jobs();
  perform private.counter_deadlines();
  perform private.redelivery_deadlines();

  return n;
end $$;

-- Same as before, wiping failed attempts too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate private.delivery_attempts, private.job_releases, public.store_activity, public.store_invites, private.owed_checks, private.discount_redemptions, public.discount_listings, public.discounts, public.quick_replies, public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
           public.listing_views, public.tickets, public.draw_results, public.ledger_entries, public.deposits,
           public.pending_limits, public.listing_handovers, private.listing_seeds, public.listings,
           public.store_applications, public.seller_applications, public.saved_pickups, public.notifications, public.cart_items, public.saved_addresses,
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
