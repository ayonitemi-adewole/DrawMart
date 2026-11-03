-- Several jobs on one trip (trips.ts). Pool jobs say where they're collected, so
-- jobs from one place can be offered together, and a rider can take several at
-- once: all or none, within their job limit. Each still has its own check and PIN.

-- Same as before, with where each job is collected.
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
        private.rider_pay(coalesce(a."fromArea", a."toArea"), coalesce(a."toArea", a."fromArea"), a.size) as "payKobo",
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

-- trips.ts tripRoomError. Each one goes through take_delivery, so every rule for one job
-- applies; if any can't be taken, none are.
create function public.take_deliveries(p_order_ids uuid[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_max int := (private.settings()).rider_max_jobs;
  v_count int := coalesce(array_length(p_order_ids, 1), 0);
  v_room int;
  v_id uuid;
begin
  if v_count < 2 or v_count <> (select count(distinct x) from unnest(p_order_ids) x) then
    perform private.fail('invalid_input', 'Choose two or more different jobs.');
  end if;
  -- Locked, like require_job_room, so two quick taps can't both fit.
  perform 1 from public.profiles where id = v_uid for update;
  v_room := greatest(v_max - private.rider_jobs_held(v_uid), 0);
  if v_count > v_room then
    perform private.fail('invalid_input', format('That’s %s jobs, and you have room for %s more.', v_count, v_room));
  end if;
  foreach v_id in array p_order_ids loop
    perform public.take_delivery(v_id);
  end loop;
end $$;

revoke all on function public.take_deliveries(uuid[]) from public, anon;
grant execute on function public.take_deliveries(uuid[]) to authenticated;
