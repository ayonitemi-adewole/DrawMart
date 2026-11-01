-- A seller confirms each order with a fresh photo of the item within 12 hours, before it
-- can go to a rider. If they don't, it cancels, the buyer is refunded and the product is
-- paused, so the next buyer doesn't wait on a seller who isn't there. Rules mirror
-- src/domain/orderConfirm.ts.

alter table public.orders
  -- Null for won items, and for orders from before this: those don't need confirming.
  add column confirm_by timestamptz,
  add column confirmed_at timestamptz,
  add column confirm_photo text,
  add column confirm_reminded_at timestamptz;

alter table public.orders drop constraint orders_cancel_reason_check;
alter table public.orders add constraint orders_cancel_reason_check check (cancel_reason in ('out_of_stock', 'damaged', 'cant_send', 'other', 'not_confirmed'));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'draw_sold_out', 'draw_won', 'draw_lost',
  'saved_almost_sold', 'saved_closing_soon', 'saved_relisted', 'saved_back_on_sale', 'saved_price_drop',
  'store_new_order', 'store_listing_approved', 'store_listing_rejected', 'store_draw_sold_out',
  'store_winner_picked', 'store_draw_closing', 'store_pickup_tomorrow', 'store_new_message',
  'store_payout_sent', 'store_bank_changed',
  'store_price_approved', 'store_price_rejected',
  'order_cancelled',
  'store_order_confirm_soon', 'store_order_expired'
));

create function private.set_confirm_by() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not new.is_prize and new.handled_by = 'store' then new.confirm_by := now() + interval '12 hours'; end if;
  return new;
end $$;
create trigger orders_confirm_by before insert on public.orders
  for each row execute function private.set_confirm_by();

create function public.seller_confirm_order(p_order_id uuid, p_photo text) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.orders;
begin
  perform private.require_user();
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.handled_by <> 'store' or o.merchant_id is distinct from private.my_merchant_id() then
    perform private.fail('not_found', 'That order doesn’t exist.');
  end if;
  if o.status <> 'paid' or o.confirm_by is null then perform private.fail('invalid_input', 'This order doesn’t need confirming.'); end if;
  if o.confirmed_at is null and o.confirm_by <= now() then perform private.fail('invalid_input', 'The time to confirm has passed, so this order is being cancelled.'); end if;
  if coalesce(p_photo, '') !~ '^(https://|/assets/)' then perform private.fail('invalid_input', 'Add a photo of the item.'); end if;
  update public.orders set confirmed_at = now(), confirm_photo = p_photo where id = o.id;
end $$;
revoke all on function public.seller_confirm_order(uuid, text) from public, anon;
grant execute on function public.seller_confirm_order(uuid, text) to authenticated;

create or replace function public.dispatch_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.orders
     where id = p_order_id and status = 'paid' and handled_by = 'store' and merchant_id = private.my_merchant_id()
       and confirm_by is not null and confirmed_at is null
  ) then
    perform private.fail('invalid_input', 'Confirm it with a photo first.');
  end if;
  update public.orders set status = 'dispatched', dispatched_at = now()
   where id = p_order_id and status = 'paid'
     and case handled_by when 'store' then merchant_id = private.my_merchant_id() else private.is_admin() end;
  if not found then perform private.fail('invalid_input', 'Only paid orders you send yourself can be marked as sent.'); end if;
end $$;

-- Same as before, pausing the product when a seller didn't respond.
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
  if o.status <> 'paid' then perform private.fail('invalid_input', 'Only orders that aren’t ready for a rider yet can be cancelled.'); end if;

  update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, cancel_note = nullif(btrim(coalesce(p_note, '')), '') where id = o.id;
  delete from private.order_pins where order_id = o.id;
  delete from public.payouts where order_id = o.id and status = 'waiting';

  select * into p from private.order_payments where order_id = o.id;
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  values (o.user_id, 'order_refund', coalesce(p.cash_kobo, o.price_kobo), coalesce(p.credit_kobo, 0), 'Refund · ' || l.title, l.id);

  -- One fee covers everything from this seller in this checkout. If something's still
  -- coming, the fee moves to it; if this was the last, it comes back too.
  if o.delivery_fee_kobo > 0 then
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

  v_stock := case p_reason when 'out_of_stock' then 0 when 'damaged' then l.stock else l.stock + o.quantity end;
  update public.listings
     set stock = v_stock,
         status = case when p_reason = 'not_confirmed' and kind = 'product' and status in ('for_sale', 'sold') then 'paused' when status = 'for_sale' and v_stock = 0 then 'sold' when status = 'sold' and v_stock > 0 then 'for_sale' else status end
   where id = l.id;

  insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_cancelled', l.id);
end $$;

-- orderConfirm.ts confirmReminderDue. One order failing can't stop the rest.
create function private.order_confirm_deadlines() returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    update public.orders set confirm_reminded_at = now()
     where status = 'paid' and confirmed_at is null and confirm_reminded_at is null and confirm_by > now() and confirm_by <= now() + interval '3 hours'
    returning merchant_id, listing_id
  loop
    perform private.notify_shop(r.merchant_id, 'store_order_confirm_soon', r.listing_id);
  end loop;

  for r in select id, merchant_id, listing_id from public.orders where status = 'paid' and confirmed_at is null and confirm_by <= now() loop
    begin
      perform private.cancel_order_now(r.id, 'not_confirmed', null);
      perform private.notify_shop(r.merchant_id, 'store_order_expired', r.listing_id);
    exception when others then
      raise warning 'order_confirm_deadlines %: %', r.id, sqlerrm;
    end;
  end loop;
end $$;
revoke execute on function private.set_confirm_by(), private.order_confirm_deadlines() from public, anon, authenticated;

-- Same as before, also running the confirm deadlines.
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

  return n;
end $$;

-- Same as before, with the confirm reminder and a missed order.
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
      perform private.queue_push(new.user_id, 'store_orders', 'Order cancelled', v_title || ' wasn’t confirmed in time. The buyer was refunded and the item is paused.', v_home || '?tab=orders', 'order-expired-' || new.id);
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
