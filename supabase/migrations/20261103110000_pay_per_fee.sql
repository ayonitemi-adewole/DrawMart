-- Rider pay follows the delivery fee (feeGroups.ts, decided 3 Nov 2026). Orders from one
-- seller in one checkout share one fee, so they travel as one job: taking or assigning one
-- takes every one of them that's ready, one made ready later joins the rider if they
-- haven't collected yet, and the group counts as one job towards the limit. The trip pays
-- once, at its largest package; a failed visit at the door pays once. An order made ready
-- after the rest were collected is its own trip and pays on its own. Won items have no
-- fee and stay their own job.

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
  'order_delivery_failed', 'store_order_undelivered', 'rider_redelivery_chosen',
  'rider_paid', 'rider_bank_changed',
  'rider_approved',
  'rider_job_assigned', 'rider_job_taken_back',
  'rider_job_added'
));

create index orders_checkout_idx on public.orders (checkout_id, merchant_id);

-- feeGroups.ts feeGroupOf.
create function private.fee_group(o public.orders) returns text
language sql immutable set search_path = ''
as $$ select case when o.is_prize or o.checkout_id is null then o.id::text else o.checkout_id::text || ':' || o.merchant_id::text end $$;

create function private.same_fee_group(a public.orders, b public.orders) returns boolean
language sql immutable set search_path = ''
as $$ select a.id = b.id or (a.checkout_id = b.checkout_id and a.merchant_id = b.merchant_id and not a.is_prize and not b.is_prize) $$;

-- The orders on one trip: taken together by one rider, or, in the pool, the ready ones that would be.
create function private.on_trip_with(s public.orders, o public.orders) returns boolean
language sql immutable set search_path = ''
as $$
  select s.id = o.id or (private.same_fee_group(s, o) and case
    when o.rider_id is null then s.rider_id is null and s.status = 'dispatched' and s.counter_at is null and o.status = 'dispatched' and o.counter_at is null
    else s.rider_id = o.rider_id and s.rider_assigned_at = o.rider_assigned_at end)
$$;

-- feeGroups.ts largestSize, over the trip.
create function private.trip_size(o public.orders) returns text
language sql stable security definer set search_path = ''
as $$
  select (array['small', 'medium', 'large'])[max(array_position(array['small', 'medium', 'large'], private.package_size_of(l.package_size, l.category)))]
  from public.orders s join public.listings l on l.id = s.listing_id
  where s.checkout_id is not distinct from o.checkout_id and s.merchant_id = o.merchant_id and private.on_trip_with(s, o)
$$;

-- feeGroups.ts tripAlreadyPaid, for deliveries and returns.
create function private.trip_paid(o public.orders, p_kind text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.rider_earnings e join public.orders s on s.id = e.order_id
     where e.kind = p_kind and e.rider_id = o.rider_id and e.claim_id is null and s.id <> o.id
       and s.checkout_id = o.checkout_id and s.merchant_id = o.merchant_id and private.on_trip_with(s, o)
  )
$$;

-- Takes the named order and every one ready on the same fee, in the same place. False if the named one isn't free.
create function private.take_group(p_order_id uuid, p_rider uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_from_counter boolean;
begin
  select * into o from public.orders
   where id = p_order_id and rider_id is null
     and ((status = 'dispatched' and counter_at is null) or (return_state = 'returning' and counter_at is not null and counter_out_at is null))
     for update;
  if not found then return false; end if;
  v_from_counter := o.return_state = 'returning';
  update public.orders x set rider_id = p_rider, rider_assigned_at = now(), collected_at = case when x.is_prize then now() else x.collected_at end
   where (x.id = o.id or (x.checkout_id = o.checkout_id and x.merchant_id = o.merchant_id and private.same_fee_group(x, o)))
     and x.rider_id is null
     and case when v_from_counter then x.return_state = 'returning' and x.counter_at is not null and x.counter_out_at is null
              else x.status = 'dispatched' and x.counter_at is null end;
  return true;
end $$;

-- What a new rider would be carrying: the whole group that comes with it.
create function private.group_limit(p_rider uuid, p_order_id uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select private.new_rider_limit(p_rider, sum(x.price_kobo)::bigint, bool_or(x.is_prize))
  from public.orders o join public.orders x on x.checkout_id is not distinct from o.checkout_id and x.merchant_id = o.merchant_id and private.on_trip_with(x, o)
  where o.id = p_order_id
$$;

revoke all on function private.fee_group(public.orders), private.same_fee_group(public.orders, public.orders), private.on_trip_with(public.orders, public.orders),
  private.trip_size(public.orders), private.trip_paid(public.orders, text), private.take_group(uuid, uuid), private.group_limit(uuid, uuid) from public, anon, authenticated;

-- Same as before, a group counting as one job.
create or replace function private.rider_jobs_held(p_rider uuid) returns int
language sql stable security definer set search_path = ''
as $$
  select (select count(distinct private.fee_group(o)) from public.orders o where o.rider_id = p_rider and ((o.status = 'dispatched' and o.counter_at is null) or o.return_state = 'returning'))::int
       + (select count(*) from public.order_claims where rider_id = p_rider and status in ('awaiting_pickup', 'returning'))::int
$$;

-- Same as before, taking the group, and limiting new riders by what the group is worth.
create or replace function public.take_delivery(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_limit text;
begin
  if (select pickup_point_id from public.profiles where id = v_uid) is not null then
    perform private.fail('forbidden', 'Counter staff don’t take deliveries.');
  end if;
  perform private.require_job_room(v_uid);
  -- riderApplications.ts newRiderLimitError.
  v_limit := private.group_limit(v_uid, p_order_id);
  if v_limit is not null then perform private.fail('invalid_input', v_limit); end if;
  if not private.take_group(p_order_id, v_uid) then perform private.fail('invalid_input', 'Another rider has taken this delivery.'); end if;
end $$;

-- Same as before, skipping ones that came with another in the list.
create or replace function public.take_deliveries(p_order_ids uuid[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_max int := (private.settings()).rider_max_jobs;
  v_count int;
  v_room int;
  v_id uuid;
begin
  if coalesce(array_length(p_order_ids, 1), 0) < 2 or array_length(p_order_ids, 1) <> (select count(distinct x) from unnest(p_order_ids) x) then
    perform private.fail('invalid_input', 'Choose two or more different jobs.');
  end if;
  -- Locked, like require_job_room, so two quick taps can't both fit.
  perform 1 from public.profiles where id = v_uid for update;
  v_count := (select count(distinct private.fee_group(o)) from public.orders o where o.id = any(p_order_ids));
  v_room := greatest(v_max - private.rider_jobs_held(v_uid), 0);
  if v_count > v_room then
    perform private.fail('invalid_input', format('That’s %s jobs, and you have room for %s more.', v_count, v_room));
  end if;
  foreach v_id in array p_order_ids loop
    if not exists (select 1 from public.orders where id = v_id and rider_id = v_uid) then
      perform public.take_delivery(v_id);
    end if;
  end loop;
end $$;

-- Same as before, handing back the whole group the rider holds.
create or replace function public.release_delivery(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id and rider_id = v_uid for update;
  if found and o.return_state = 'returning' and o.counter_at is not null and o.counter_out_at is null then
    with freed as (
      update public.orders x set rider_id = null, rider_assigned_at = null
       where x.checkout_id is not distinct from o.checkout_id and x.merchant_id = o.merchant_id and (x.id = o.id or private.same_fee_group(x, o))
         and x.rider_id = v_uid and x.return_state = 'returning' and x.counter_at is not null and x.counter_out_at is null
      returning x.id
    )
    insert into private.job_releases (order_id, rider_id, reason, taken_at) select id, v_uid, 'handed_back', o.rider_assigned_at from freed;
    return;
  end if;
  if not found or o.status <> 'dispatched' or o.counter_at is not null then
    perform private.fail('invalid_input', 'Only deliveries you’re carrying can be handed back.');
  end if;
  with freed as (
    update public.orders x set rider_id = null, rider_assigned_at = null, collected_at = null, collection_photos = null
     where x.checkout_id is not distinct from o.checkout_id and x.merchant_id = o.merchant_id and (x.id = o.id or private.same_fee_group(x, o))
       and x.rider_id = v_uid and x.status = 'dispatched' and x.counter_at is null
    returning x.id
  )
  insert into private.job_releases (order_id, rider_id, reason, taken_at) select id, v_uid, 'handed_back', o.rider_assigned_at from freed;
end $$;

-- Same as before, giving the whole group.
create or replace function public.assign_job(p_kind text, p_id uuid, p_rider uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_max int := (private.settings()).rider_max_jobs;
  v_limit text;
  v_listing uuid;
begin
  perform private.require_admin();
  -- Locked, like require_job_room, so this and the rider's own tap can't both get under the limit.
  perform 1 from public.profiles where id = p_rider and role = 'delivery' and pickup_point_id is null for update;
  if not found then perform private.fail('not_found', 'That rider doesn’t exist.'); end if;
  if private.rider_jobs_held(p_rider) >= v_max then
    perform private.fail('invalid_input', format('This rider has %s jobs, the most they can hold. Choose another, or take one back from them first.', v_max));
  end if;

  if p_kind = 'delivery' then
    v_limit := private.group_limit(p_rider, p_id);
    if v_limit is not null then perform private.fail('invalid_input', 'This rider is new. ' || v_limit); end if;
    if not private.take_group(p_id, p_rider) then
      perform private.fail('invalid_input', 'Only jobs waiting in the pool can be assigned. A rider may have just taken it.');
    end if;
    v_listing := (select listing_id from public.orders where id = p_id);
    insert into private.job_assignments (order_id, rider_id, assigned_by) values (p_id, p_rider, auth.uid());
  elsif p_kind = 'return' then
    v_limit := (select private.new_rider_limit(p_rider, o.price_kobo, o.is_prize) from public.order_claims c join public.orders o on o.id = c.order_id where c.id = p_id);
    if v_limit is not null then perform private.fail('invalid_input', 'This rider is new. ' || v_limit); end if;
    update public.order_claims set rider_id = p_rider, rider_assigned_at = now()
     where id = p_id and status = 'awaiting_pickup' and rider_id is null;
    if not found then perform private.fail('invalid_input', 'Only returns waiting in the pool can be assigned. A rider may have just taken it.'); end if;
    v_listing := (select o.listing_id from public.order_claims c join public.orders o on o.id = c.order_id where c.id = p_id);
    insert into private.job_assignments (claim_id, rider_id, assigned_by) values (p_id, p_rider, auth.uid());
  else
    perform private.fail('invalid_input', 'That isn’t a kind of job.');
  end if;

  insert into public.notifications (user_id, kind, listing_id) values (p_rider, 'rider_job_assigned', v_listing);
end $$;

-- Same as before, taking back the whole group.
create or replace function public.unassign_job(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  c public.order_claims;
begin
  perform private.require_admin();
  if p_kind = 'delivery' then
    select * into o from public.orders where id = p_id and rider_id is not null for update;
    if not found or not ((o.status = 'dispatched' and o.counter_at is null and o.collected_at is null)
                         or (o.return_state = 'returning' and o.counter_at is not null and o.counter_out_at is null)) then
      perform private.fail('invalid_input', 'Only jobs the rider hasn’t collected yet can be taken back.');
    end if;
    with freed as (
      update public.orders x set rider_id = null, rider_assigned_at = null, collection_photos = null
       where x.checkout_id is not distinct from o.checkout_id and x.merchant_id = o.merchant_id and (x.id = o.id or private.same_fee_group(x, o))
         and x.rider_id = o.rider_id and x.rider_assigned_at = o.rider_assigned_at
         and ((x.status = 'dispatched' and x.counter_at is null and x.collected_at is null)
              or (x.return_state = 'returning' and x.counter_at is not null and x.counter_out_at is null))
      returning x.id
    )
    insert into private.job_releases (order_id, rider_id, reason, taken_at, released_by) select id, o.rider_id, 'taken_back', o.rider_assigned_at, auth.uid() from freed;
    insert into public.notifications (user_id, kind, listing_id) values (o.rider_id, 'rider_job_taken_back', o.listing_id);
  elsif p_kind = 'return' then
    select * into c from public.order_claims where id = p_id and rider_id is not null and status = 'awaiting_pickup' for update;
    if not found then perform private.fail('invalid_input', 'Only returns the rider hasn’t collected yet can be taken back.'); end if;
    update public.order_claims set rider_id = null, rider_assigned_at = null where id = c.id;
    insert into private.job_releases (claim_id, rider_id, reason, taken_at, released_by) values (c.id, c.rider_id, 'taken_back', c.rider_assigned_at, auth.uid());
    insert into public.notifications (user_id, kind, listing_id) values (c.rider_id, 'rider_job_taken_back', (select listing_id from public.orders where id = c.order_id));
  else
    perform private.fail('invalid_input', 'That isn’t a kind of job.');
  end if;
end $$;

-- An order made ready after the rest of its group was taken goes to the same rider,
-- on the same trip, as long as they haven't collected yet.
create function private.join_rider_on_ready() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare s public.orders;
begin
  if new.status = 'dispatched' and old.status <> 'dispatched' and new.rider_id is null and not new.is_prize and new.checkout_id is not null then
    select * into s from public.orders x
     where x.checkout_id = new.checkout_id and x.merchant_id = new.merchant_id and x.id <> new.id and not x.is_prize
       and x.status = 'dispatched' and x.rider_id is not null and x.counter_at is null
     order by x.rider_assigned_at limit 1;
    -- Only while none of the trip has been collected: once they've left the seller, it's a new trip.
    if found and not exists (
      select 1 from public.orders x where x.checkout_id = s.checkout_id and x.merchant_id = s.merchant_id
         and x.rider_id = s.rider_id and x.rider_assigned_at = s.rider_assigned_at and x.collected_at is not null
    ) then
      new.rider_id := s.rider_id;
      new.rider_assigned_at := s.rider_assigned_at;
      insert into public.notifications (user_id, kind, listing_id) values (s.rider_id, 'rider_job_added', new.listing_id);
    end if;
  end if;
  return new;
end $$;
create trigger join_rider_on_ready before update of status on public.orders
  for each row execute function private.join_rider_on_ready();

-- Same as before, paying each trip once, at its largest package.
create or replace function private.earn_for_order() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_seller text;
  v_size text;
  v_point text;
begin
  if new.rider_id is null then return null; end if;
  select delivery_area into v_seller from public.merchants where id = new.merchant_id;
  v_size := private.trip_size(new);
  select private.nearest_area(lat, lng) into v_point from public.pickup_points where id = new.pickup_point_id;

  -- At the door, or refused there: the trip happened either way.
  if ((new.status = 'delivered' and old.status <> 'delivered' and new.counter_at is null)
      or (new.cancel_reason in ('refused_wrong', 'refused_damaged') and old.status <> 'cancelled'))
     and not private.trip_paid(new, 'delivery') then
    perform private.earn(new.rider_id, 'delivery', new.id, new.id, null, v_seller, private.buyer_area(new), v_size);
  end if;
  if new.counter_at is not null and old.counter_at is null and not private.trip_paid(new, 'delivery') then
    perform private.earn(new.rider_id, 'delivery', new.id, new.id, null, v_seller, v_point, v_size);
  end if;
  if new.return_state = 'returned' and old.return_state is distinct from 'returned' and not private.trip_paid(new, 'return') then
    perform private.earn(new.rider_id, 'return', new.id, new.id, null, case when new.counter_at is not null then v_point else private.buyer_area(new) end, v_seller, v_size);
  end if;
  return null;
end $$;

-- Same as before, paying a visit to the door once, however many orders it was for.
create or replace function private.earn_for_attempt() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare o public.orders;
begin
  select * into o from public.orders where id = new.order_id;
  if exists (
    select 1 from private.delivery_attempts a
      join public.orders s on s.id = a.order_id
      join public.rider_earnings e on e.source_id = a.id and e.kind = 'failed_attempt'
     where a.id <> new.id and a.rider_id = new.rider_id and s.id <> o.id
       and s.checkout_id = o.checkout_id and s.merchant_id = o.merchant_id and private.on_trip_with(s, o)
       and abs(extract(epoch from a.created_at - new.created_at)) <= 30 * 60
  ) then
    return null;
  end if;
  perform private.earn(new.rider_id, 'failed_attempt', new.id, new.order_id, null, null, null, null);
  return null;
end $$;

-- Same as before, with each job's fee group and what its trip pays.
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
        -- trips.ts: where it's collected, so jobs from one place can go together.
        case when o.return_state = 'returning' and o.counter_at is not null then 'point:' || o.pickup_point_id
             when o.handled_by = 'drawmart' then 'drawmart'
             else 'shop:' || o.merchant_id end as "collectKey",
        a."fromArea",
        a."toArea",
        a.size,
        -- What the trip pays, once for the group (feeGroups.ts).
        private.rider_pay(coalesce(a."fromArea", a."toArea"), coalesce(a."toArea", a."fromArea"), private.trip_size(o)) as "payKobo",
        private.fee_group(o) as "feeGroup",
        case when o.return_state = 'returning' then coalesce(o.cancelled_at, o.dispatched_at) else o.dispatched_at end as "postedAt",
        o.rider_id is null and private.new_rider_limit(v_uid, o.price_kobo, o.is_prize) is not null as locked,
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
      -- Going back to the seller: from the counter or the buyer. Otherwise from the seller (or DrawMart's escrow, unknown).
      cross join lateral (
        select
          case when o.return_state = 'returning' then case when o.counter_at is not null then private.point_area(o.pickup_point_id) else private.buyer_area(o) end
               when o.handled_by = 'drawmart' then null
               else m.delivery_area end as "fromArea",
          case when o.return_state = 'returning' then m.delivery_area
               when o.fulfilment = 'pickup' then private.point_area(o.pickup_point_id)
               else private.buyer_area(o) end as "toArea",
          private.package_size_of(l.package_size, l.category) as size
      ) a
      where (o.status = 'dispatched' and o.rider_id is null and o.counter_at is null)
         or (o.return_state = 'returning' and o.rider_id is null and o.counter_at is not null and o.counter_out_at is null)
         or (o.rider_id = v_uid and (o.status in ('dispatched', 'delivered') or o.return_state = 'returning'))
      order by o.delivered_at desc nulls first
      limit 200
    ) x
  );
end $$;

-- Same as before, with an order joining a trip.
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
    when 'rider_paid' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'Pay sent', 'We’ve sent your pay to your bank account.', '/delivery/earnings', 'rider-paid-' || new.id);
    when 'rider_bank_changed' then
      -- Not a kind anyone can switch off: it's how they find out if it wasn't them.
      perform private.queue_push(new.user_id, 'security', 'Bank account changed', 'Your bank account for pay was changed. If this wasn’t you, contact DrawMart now.', '/delivery/earnings', 'rider-bank-' || new.id);
    when 'rider_approved' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'You’re approved to ride', 'Open DrawMart to add your photo and bank account.', '/delivery', 'rider-approved');
    when 'rider_job_assigned' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'A job for you', v_what || ': DrawMart gave you this job. Collect it within the time shown.', '/delivery?tab=mine', 'rider-assigned-' || new.listing_id);
    when 'rider_job_taken_back' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'A job was taken back', 'DrawMart moved a job you hadn’t collected. You don’t need to collect it.', '/delivery?tab=mine', 'rider-assigned-' || new.listing_id);
    when 'rider_job_added' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'One more for the same buyer', v_what || ' from the same seller is ready too. Collect it with the rest.', '/delivery?tab=mine', 'rider-added-' || new.listing_id);
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_rider_notification: %', sqlerrm;
  return null;
end $$;
