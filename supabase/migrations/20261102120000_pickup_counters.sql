-- Pickup counters (counter.ts). Counter staff are delivery accounts linked to one
-- pickup location. A rider brings a pickup order there; staff check its product ID
-- and take it in, which closes the rider's job and tells the buyer it's ready. The
-- buyer collects it with their PIN. After 7 days a reminder; after 14 it goes back to
-- the seller and the buyer is refunded, less delivery. Every change of hands has a time.

alter table public.profiles add column pickup_point_id text references public.pickup_points (id);
alter table public.profiles add constraint profiles_counter_is_delivery check (pickup_point_id is null or role = 'delivery');

alter table public.orders
  add column counter_at timestamptz,
  add column counter_by uuid references public.profiles (id),
  add column counter_reminded_at timestamptz,
  -- An uncollected item handed to the rider taking it back.
  add column counter_out_at timestamptz;
create index orders_counter_idx on public.orders (pickup_point_id) where counter_at is not null;

alter table public.orders drop constraint orders_cancel_reason_check;
alter table public.orders add constraint orders_cancel_reason_check check (cancel_reason in ('out_of_stock', 'damaged', 'cant_send', 'other', 'not_confirmed', 'not_sent', 'failed_check', 'refused_wrong', 'refused_damaged', 'not_collected'));

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
  'order_ready_to_collect', 'order_collect_reminder', 'store_order_uncollected'
));

-- Counter staff, and the location they work at.
create function private.require_counter() returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_point text := (select pickup_point_id from public.profiles where id = v_uid);
begin
  if v_point is null then perform private.fail('forbidden', 'Only pickup counter staff can do this.'); end if;
  return v_point;
end $$;

-- The location this account works at, or null for a rider.
create function public.my_counter() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  return (
    select jsonb_build_object('id', pp.id, 'name', pp.name, 'area', pp.area, 'address', pp.address, 'hours', pp.hours, 'location', jsonb_build_object('lat', pp.lat, 'lng', pp.lng))
      from public.profiles p join public.pickup_points pp on pp.id = p.pickup_point_id
     where p.id = v_uid
  );
end $$;

-- What's coming, on the shelf, and going back. Named fields; the buyer's name only
-- once it's on the shelf, for handing it over. Never their phone, address or PIN.
create function public.counter_items() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_point text := private.require_counter();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'productCode', l.product_code, 'listingTitle', l.title, 'listingImage', l.images[1], 'category', l.category, 'quantity', o.quantity,
      'stage', case when o.counter_at is null then 'incoming' when o.status = 'dispatched' then 'shelf' else 'send_back' end,
      'atCounterAt', o.counter_at,
      'buyerName', case when o.counter_at is not null and o.status = 'dispatched' then b.display_name end,
      'isPrize', o.is_prize,
      'riderAssigned', o.rider_id is not null,
      'pinLockedUntil', case when o.status = 'dispatched' then (select p.locked_until from private.order_pins p where p.order_id = o.id and p.locked_until > now()) end
    ) order by o.counter_at nulls first, o.dispatched_at)
    from public.orders o
    join public.listings l on l.id = o.listing_id
    join public.profiles b on b.id = o.user_id
    where o.pickup_point_id = v_point and o.fulfilment = 'pickup'
      and ((o.status = 'dispatched' and (o.counter_at is not null or (o.rider_id is not null and o.collected_at is not null)))
           or (o.return_state = 'returning' and o.counter_at is not null and o.counter_out_at is null))
  ), '[]'::jsonb);
end $$;

-- counter.ts counterCodeError. The rider hands it over; staff check the label.
create function public.receive_at_counter(p_order_id uuid, p_product_code text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_point text := private.require_counter();
  o public.orders;
  v_code text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.pickup_point_id is distinct from v_point or o.fulfilment <> 'pickup' then
    perform private.fail('not_found', 'That order isn’t coming to this counter.');
  end if;
  if o.status <> 'dispatched' or o.rider_id is null or o.collected_at is null or o.counter_at is not null then
    perform private.fail('invalid_input', 'Only items a rider has brought can be taken in.');
  end if;
  select product_code into v_code from public.listings where id = o.listing_id;
  if regexp_replace(upper(regexp_replace(coalesce(p_product_code, ''), '[^A-Za-z0-9]', '', 'g')), '^PRD', '') <> substr(v_code, 5) then
    perform private.fail('invalid_input', 'That product ID doesn’t match this order. Check the label.');
  end if;
  update public.orders set counter_at = now(), counter_by = auth.uid() where id = o.id;
  insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_ready_to_collect', o.listing_id);
end $$;

-- Like confirm_delivery, at the counter. A wrong PIN returns rather than raises,
-- because raising would undo the count.
create function public.counter_hand_over(p_order_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_point text := private.require_counter();
  v_max constant int := 5;
  p private.order_pins;
  v_attempts int;
  v_locked timestamptz;
begin
  select pins.* into p
    from private.order_pins pins join public.orders o on o.id = pins.order_id
   where o.id = p_order_id and o.pickup_point_id = v_point and o.status = 'dispatched' and o.counter_at is not null
     for update of pins;
  if not found then perform private.fail('invalid_input', 'Only items on your shelf can be handed over.'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then perform private.fail('invalid_input', 'Enter the buyer’s 6-digit PIN.'); end if;

  if p.locked_until > now() then
    return jsonb_build_object('confirmed', false, 'attemptsLeft', 0, 'lockedUntil', p.locked_until);
  end if;

  if p_pin = p.pin then
    update public.orders set status = 'delivered', delivered_at = now() where id = p_order_id;
    delete from private.order_pins where order_id = p_order_id;
    return jsonb_build_object('confirmed', true, 'attemptsLeft', 0, 'lockedUntil', null);
  end if;

  v_attempts := case when p.locked_until is not null then 1 else p.attempts + 1 end;
  v_locked := case when v_attempts >= v_max then now() + interval '30 minutes' end;
  update private.order_pins set attempts = v_attempts, locked_until = v_locked where order_id = p_order_id;
  return jsonb_build_object('confirmed', false, 'attemptsLeft', greatest(v_max - v_attempts, 0), 'lockedUntil', v_locked);
end $$;

-- An uncollected item leaves with the rider taking it back to the seller.
create function public.release_to_rider(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_point text := private.require_counter();
begin
  update public.orders set counter_out_at = now()
   where id = p_order_id and pickup_point_id = v_point and return_state = 'returning' and counter_at is not null and counter_out_at is null and rider_id is not null;
  if not found then perform private.fail('invalid_input', 'Only items a rider has taken to send back can be handed over.'); end if;
end $$;

-- counter.ts counterReminderDue and counterReturnDue. Run by process_deadlines.
create function private.counter_deadlines() returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.orders;
begin
  for o in
    select * from public.orders
     where status = 'dispatched' and counter_at is not null and counter_reminded_at is null and counter_at <= now() - interval '7 days'
       for update skip locked
  loop
    update public.orders set counter_reminded_at = now() where id = o.id;
    insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_collect_reminder', o.listing_id);
  end loop;

  -- Won items stay until they're collected.
  for o in
    select * from public.orders
     where status = 'dispatched' and counter_at is not null and not is_prize and counter_at <= now() - interval '14 days'
       for update skip locked
  loop
    perform private.cancel_order_now(o.id, 'not_collected', null);
    update public.orders set return_state = 'returning', rider_id = null, rider_assigned_at = null where id = o.id;
    perform private.notify_shop(o.merchant_id, 'store_order_uncollected', o.listing_id);
  end loop;
end $$;

-- Same as before, without counter staff, and taking items going back from a counter.
create or replace function public.take_delivery(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  if (select pickup_point_id from public.profiles where id = v_uid) is not null then
    perform private.fail('forbidden', 'Counter staff don’t take deliveries.');
  end if;
  perform private.require_job_room(v_uid);
  update public.orders set rider_id = v_uid, rider_assigned_at = now(), collected_at = case when is_prize then now() else collected_at end
   where id = p_order_id and rider_id is null
     and ((status = 'dispatched' and counter_at is null)
          or (return_state = 'returning' and counter_at is not null and counter_out_at is null));
  if not found then perform private.fail('invalid_input', 'Another rider has taken this delivery.'); end if;
end $$;

-- Same as before, also handing back an item not yet taken from the counter.
create or replace function public.release_delivery(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id and rider_id = v_uid for update;
  if found and o.return_state = 'returning' and o.counter_at is not null and o.counter_out_at is null then
    update public.orders set rider_id = null, rider_assigned_at = null where id = o.id;
    insert into private.job_releases (order_id, rider_id, reason, taken_at) values (o.id, v_uid, 'handed_back', o.rider_assigned_at);
    return;
  end if;
  if not found or o.status <> 'dispatched' or o.counter_at is not null then
    perform private.fail('invalid_input', 'Only deliveries you’re carrying can be handed back.');
  end if;
  update public.orders set rider_id = null, rider_assigned_at = null, collected_at = null, collection_photos = null where id = o.id;
  insert into private.job_releases (order_id, rider_id, reason, taken_at) values (o.id, v_uid, 'handed_back', o.rider_assigned_at);
end $$;

-- Same as before, not before the counter has handed it over.
create or replace function public.complete_return(p_order_id uuid, p_photo text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  perform private.check_delivery_photos(array[p_photo]);
  update public.orders set return_state = 'returned', return_photo = p_photo, returned_at = now()
   where id = p_order_id and rider_id = v_uid and return_state = 'returning' and (counter_at is null or counter_out_at is not null);
  if not found then perform private.fail('invalid_input', 'Only items you’re taking back can be returned.'); end if;
end $$;

-- Same as before: an item at the counter isn't the rider's any more.
create or replace function private.rider_jobs_held(p_rider uuid) returns int
language sql stable security definer set search_path = ''
as $$
  select (select count(*) from public.orders where rider_id = p_rider and ((status = 'dispatched' and counter_at is null) or return_state = 'returning'))::int
       + (select count(*) from public.order_claims where rider_id = p_rider and status in ('awaiting_pickup', 'returning'))::int
$$;

-- Same as before, also for items going back from a counter.
create or replace function private.alert_riders_for_order() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'dispatched' and new.rider_id is null and new.counter_at is null and (old.status <> 'dispatched' or old.rider_id is not null) then
    perform private.alert_riders('rider_new_job', new.listing_id,
      case when new.handled_by = 'drawmart' then null else (select delivery_area from public.merchants where id = new.merchant_id) end,
      old.rider_id);
  elsif new.return_state = 'returning' and new.rider_id is null and new.counter_at is not null and new.counter_out_at is null
        and (old.rider_id is not null or old.return_state is distinct from 'returning') then
    perform private.alert_riders('rider_new_job', new.listing_id,
      (select private.nearest_area(pp.lat, pp.lng) from public.pickup_points pp where pp.id = new.pickup_point_id),
      old.rider_id);
  end if;
  return null;
exception when others then
  raise warning 'alert_riders_for_order: %', sqlerrm;
  return null;
end $$;

-- Same as before, without riders' reminders about items already at a counter.
create or replace function private.rider_reminders() returns void
language plpgsql security definer set search_path = ''
as $$
declare v_soon interval := make_interval(mins => greatest((private.settings()).rider_collect_minutes - 30, 0));
begin
  insert into public.notifications (user_id, kind, listing_id)
  select distinct o.rider_id, 'rider_collect_soon', o.listing_id from public.orders o
   where o.status = 'dispatched' and o.rider_id is not null and o.collected_at is null and o.rider_assigned_at + v_soon <= now()
     and not exists (select 1 from public.notifications n where n.user_id = o.rider_id and n.kind = 'rider_collect_soon' and n.listing_id = o.listing_id and n.created_at >= o.rider_assigned_at);

  insert into public.notifications (user_id, kind, listing_id)
  select distinct c.rider_id, 'rider_collect_soon', o.listing_id from public.order_claims c join public.orders o on o.id = c.order_id
   where c.status = 'awaiting_pickup' and c.rider_id is not null and c.rider_assigned_at + v_soon <= now()
     and not exists (select 1 from public.notifications n where n.user_id = c.rider_id and n.kind = 'rider_collect_soon' and n.listing_id = o.listing_id and n.created_at >= c.rider_assigned_at);

  insert into public.notifications (user_id, kind, listing_id)
  select distinct o.rider_id, 'rider_pin_unlocked', o.listing_id from public.orders o join private.order_pins p on p.order_id = o.id
   where o.status = 'dispatched' and o.rider_id is not null and o.counter_at is null and p.locked_until <= now() and p.locked_until > now() - interval '1 hour'
     and not exists (select 1 from public.notifications n where n.user_id = o.rider_id and n.kind = 'rider_pin_unlocked' and n.listing_id = o.listing_id and n.created_at >= p.locked_until);
exception when others then
  raise warning 'rider_reminders: %', sqlerrm;
end $$;

-- Same as before, with counters' deadlines.
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

  return n;
end $$;

revoke all on function private.require_counter(), private.counter_deadlines() from public, anon, authenticated;
revoke all on function public.my_counter(), public.counter_items(), public.receive_at_counter(uuid, text), public.counter_hand_over(uuid, text), public.release_to_rider(uuid) from public, anon;
grant execute on function public.my_counter(), public.counter_items(), public.receive_at_counter(uuid, text), public.counter_hand_over(uuid, text), public.release_to_rider(uuid) to authenticated;

-- Same as before: pickup orders are finished at the counter.
create or replace function public.confirm_delivery(p_order_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_max constant int := 5;
  p private.order_pins;
  v_attempts int;
  v_locked timestamptz;
begin
  if exists (select 1 from public.orders where id = p_order_id and rider_id = v_uid and fulfilment = 'pickup') then
    perform private.fail('invalid_input', 'Hand pickup orders to the counter staff. They complete them with the buyer.');
  end if;
  select pins.* into p
    from private.order_pins pins join public.orders o on o.id = pins.order_id
   where o.id = p_order_id and o.rider_id = v_uid and o.status = 'dispatched' and o.collected_at is not null
     for update of pins;
  if not found then perform private.fail('invalid_input', 'Only deliveries you’re carrying can be confirmed.'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then perform private.fail('invalid_input', 'Enter the buyer’s 6-digit PIN.'); end if;

  if p.locked_until > now() then
    return jsonb_build_object('confirmed', false, 'attemptsLeft', 0, 'lockedUntil', p.locked_until);
  end if;

  if p_pin = p.pin then
    update public.orders set status = 'delivered', delivered_at = now() where id = p_order_id;
    delete from private.order_pins where order_id = p_order_id;
    return jsonb_build_object('confirmed', true, 'attemptsLeft', 0, 'lockedUntil', null);
  end if;

  -- A lock that's run out starts the count again.
  v_attempts := case when p.locked_until is not null then 1 else p.attempts + 1 end;
  v_locked := case when v_attempts >= v_max then now() + interval '30 minutes' end;
  update private.order_pins set attempts = v_attempts, locked_until = v_locked where order_id = p_order_id;
  return jsonb_build_object('confirmed', false, 'attemptsLeft', greatest(v_max - v_attempts, 0), 'lockedUntil', v_locked);
end $$;

-- Same as before: pickup orders are finished at the counter.
create or replace function public.refuse_delivery(p_order_id uuid, p_pin text, p_reason text, p_note text, p_photo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_max constant int := 5;
  p private.order_pins;
  v_prize boolean;
  v_attempts int;
  v_locked timestamptz;
begin
  if exists (select 1 from public.orders where id = p_order_id and rider_id = v_uid and fulfilment = 'pickup') then
    perform private.fail('invalid_input', 'Hand pickup orders to the counter staff. They complete them with the buyer.');
  end if;
  select pins.*  into p
    from private.order_pins pins join public.orders o on o.id = pins.order_id
   where o.id = p_order_id and o.rider_id = v_uid and o.status = 'dispatched' and o.collected_at is not null
     for update of pins;
  if not found then perform private.fail('invalid_input', 'Only deliveries you’re carrying can be refused.'); end if;
  select is_prize into v_prize from public.orders where id = p_order_id;
  if v_prize then perform private.fail('invalid_input', 'Won items can’t be refused here. Contact DrawMart.'); end if;
  if p_reason is null or p_reason not in ('refused_wrong', 'refused_damaged') then perform private.fail('invalid_input', 'Pick why it’s being refused.'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then perform private.fail('invalid_input', 'Enter the buyer’s 6-digit PIN.'); end if;
  perform private.check_delivery_photos(array[p_photo]);
  if length(btrim(coalesce(p_note, ''))) > 300 then perform private.fail('invalid_input', 'Keep the note to 300 characters.'); end if;

  if p.locked_until > now() then
    return jsonb_build_object('confirmed', false, 'attemptsLeft', 0, 'lockedUntil', p.locked_until);
  end if;

  if p_pin = p.pin then
    perform private.cancel_order_now(p_order_id, p_reason, p_note);
    update public.orders set refusal_photo = p_photo, return_state = 'returning' where id = p_order_id;
    perform private.penalise_seller(p_order_id);
    return jsonb_build_object('confirmed', true, 'attemptsLeft', 0, 'lockedUntil', null);
  end if;

  v_attempts := case when p.locked_until is not null then 1 else p.attempts + 1 end;
  v_locked := case when v_attempts >= v_max then now() + interval '30 minutes' end;
  update private.order_pins set attempts = v_attempts, locked_until = v_locked where order_id = p_order_id;
  return jsonb_build_object('confirmed', false, 'attemptsLeft', greatest(v_max - v_attempts, 0), 'lockedUntil', v_locked);
end $$;

-- Same as before, with pickup counters: jobs end there, and uncollected items go back from there.
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

-- Same as before, for items left at a counter.
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
  if o.status <> 'paid' and not (o.status = 'dispatched' and p_reason in ('failed_check', 'refused_wrong', 'refused_damaged', 'not_collected')) then
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
  if o.delivery_fee_kobo > 0 and p_reason <> 'not_collected' then
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

  v_stock := case when p_reason = 'out_of_stock' then 0 when p_reason in ('damaged', 'failed_check', 'refused_wrong', 'refused_damaged', 'not_collected') then l.stock else l.stock + o.quantity end;
  update public.listings
     set stock = v_stock,
         status = case when p_reason in ('not_confirmed', 'not_sent') and kind = 'product' and status in ('for_sale', 'sold') then 'paused' when status = 'for_sale' and v_stock = 0 then 'sold' when status = 'sold' and v_stock > 0 then 'for_sale' else status end
   where id = l.id;

  insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_cancelled', l.id);
end $$;

-- Same as before: a buyer not collecting isn't the seller's cancellation.
create or replace function public.merchant_cancel_rates() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('merchantId', m.id, 'merchantName', m.name, 'orders', coalesce(x.orders, 0), 'cancelled', coalesce(x.cancelled, 0), 'failed', coalesce(x.failed, 0), 'suspended', m.suspended_at is not null))
    from public.merchants m
    left join (
      select merchant_id, count(*)::int as orders, count(*) filter (where status = 'cancelled' and cancel_reason is distinct from 'not_collected')::int as cancelled,
             count(*) filter (where cancel_reason in ('failed_check', 'refused_wrong', 'refused_damaged'))::int as failed
        from public.orders
       where not is_prize and created_at >= now() - interval '30 days'
       group by merchant_id
    ) x on x.merchant_id = m.id
    where x.merchant_id is not null or m.suspended_at is not null
  ), '[]'::jsonb);
end $$;

-- Same as before, with pickup counters.
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
    -- store_new_message: push_for_message sends this one, since it knows the conversation.
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, with counter staff at DrawMart Ikeja.
create or replace function private.seed_test_accounts() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not (private.settings()).test_mode then
    raise notice 'Test accounts skipped: test mode is off.';
    return;
  end if;

  drop table if exists pg_temp.test_accounts;
  create temporary table test_accounts (id uuid, email text, name text, role text, merchant_id uuid) on commit drop;
  insert into test_accounts values
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'buyer@drawmart.test', 'Ada Okafor', 'buyer', null::uuid),
    ('a0000000-0000-4000-8000-000000000004'::uuid, 'chidi@drawmart.test', 'Chidi Eze', 'buyer', null::uuid),
    ('a0000000-0000-4000-8000-000000000005'::uuid, 'ngozi@drawmart.test', 'Ngozi Bello', 'buyer', null::uuid),
    ('a0000000-0000-4000-8000-000000000006'::uuid, 'emeka@drawmart.test', 'Emeka Nwosu', 'buyer', null::uuid),
    ('a0000000-0000-4000-8000-000000000007'::uuid, 'funke@drawmart.test', 'Funke Ade', 'buyer', null::uuid),
    ('a0000000-0000-4000-8000-000000000008'::uuid, 'seller@drawmart.test', 'Tolu Adebayo', 'buyer', null::uuid),
    ('a0000000-0000-4000-8000-000000000002'::uuid, 'store@drawmart.test', 'Ikeja Partner Store', 'store', '11111111-1111-4111-8111-000000000001'::uuid),
    ('a0000000-0000-4000-8000-000000000009'::uuid, 'lekki@drawmart.test', 'Lekki Partner Store', 'store', '11111111-1111-4111-8111-000000000002'::uuid),
    ('a0000000-0000-4000-8000-00000000000a'::uuid, 'surulere@drawmart.test', 'Surulere Partner Store', 'store', '11111111-1111-4111-8111-000000000003'::uuid),
    ('a0000000-0000-4000-8000-00000000000b'::uuid, 'yaba@drawmart.test', 'Yaba Partner Store', 'store', '11111111-1111-4111-8111-000000000004'::uuid),
    ('a0000000-0000-4000-8000-00000000000c'::uuid, 'vi@drawmart.test', 'Victoria Island Partner Dealer', 'store', '11111111-1111-4111-8111-000000000005'::uuid),
    ('a0000000-0000-4000-8000-00000000000d'::uuid, 'rider@drawmart.test', 'Bayo Rider', 'delivery', null::uuid),
    ('a0000000-0000-4000-8000-00000000000e'::uuid, 'counter@drawmart.test', 'Kemi Counter', 'delivery', null::uuid);

  -- New accounts get a buyer profile and the starting balance from the sign-up trigger.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', a.id, 'authenticated', 'authenticated', a.email,
         extensions.crypt('drawmart-demo', extensions.gen_salt('bf')), now(),
         '{"provider": "email", "providers": ["email"]}', jsonb_build_object('display_name', a.name), now(), now(),
         '', '', '', ''
    from test_accounts a
   where not exists (select 1 from auth.users u where u.id = a.id or lower(u.email) = a.email);

  -- Email sign-in needs a matching identity row.
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
    from auth.users u join test_accounts a on lower(u.email) = a.email
   where not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

  -- Matched by email, so accounts made before keep working.
  update public.profiles p
     set role = a.role, merchant_id = a.merchant_id, display_name = a.name
    from auth.users u join test_accounts a on lower(u.email) = a.email
   where p.id = u.id;

  update public.profiles p set pickup_point_id = 'ikeja'
    from auth.users u
   where p.id = u.id and lower(u.email) = 'counter@drawmart.test';

  update public.profiles p set seller_id = '11111111-1111-4111-8111-000000000006'
    from auth.users u
   where p.id = u.id and lower(u.email) = 'seller@drawmart.test';

  insert into public.seller_applications (user_id, shop_name, legal_name, nin, phone, address, area, id_photo_path, selfie_path, status, reviewed_at)
  select u.id, 'Tolu’s Gadgets', 'Toluwani Adebayo', '12345678901', '0803 123 4567', '12 Herbert Macaulay Way, Yaba', 'Yaba',
         u.id::text || '/seed-id.jpg', u.id::text || '/seed-selfie.jpg', 'approved', now()
    from auth.users u
   where lower(u.email) = 'seller@drawmart.test'
  on conflict (user_id) do update set status = 'approved', review_note = null, reviewed_at = now();
end $$;

-- Same as before: counter staff don't take jobs, so they aren't alerted to them.
create or replace function private.alert_riders(p_kind text, p_listing uuid, p_area text, p_except uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_max int := (private.settings()).rider_max_jobs;
begin
  insert into public.notifications (user_id, kind, listing_id, area)
  select r.id, p_kind, p_listing, p_area
    from public.profiles r
    left join public.push_preferences pp on pp.user_id = r.id
   where r.role = 'delivery' and r.pickup_point_id is null
     and r.id is distinct from p_except
     and coalesce(case p_kind when 'rider_new_job' then pp.rider_new_jobs else pp.rider_returns end, true)
     and (p_area is null
          or not exists (select 1 from public.rider_areas ra where ra.rider_id = r.id)
          or exists (select 1 from public.rider_areas ra where ra.rider_id = r.id and ra.area = p_area))
     and private.rider_jobs_held(r.id) < v_max
     and (select count(*) from public.notifications n
           where n.user_id = r.id and n.kind in ('rider_new_job', 'rider_new_return') and n.created_at > now() - interval '1 hour') < 4;
exception when others then
  raise warning 'alert_riders: %', sqlerrm;
end $$;
