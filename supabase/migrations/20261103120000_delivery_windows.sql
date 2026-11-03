-- Delivery windows (deliveryWindows.ts, built 3 Nov 2026). At checkout a delivery buyer
-- can pick a morning, afternoon or evening on one of the first 3 days the seller is sure
-- to make: windows start no sooner than the latest the seller can mark the order ready
-- (confirm, then ready, each 12 hours of the seller's day). Riders can take a job from
-- 7am on its window's day, and are told then; the dispatch board counts its wait from
-- then too. The pool puts today's windows first, on the phone.

alter table public.orders
  add column window_start timestamptz,
  add column window_end timestamptz,
  -- Riders were told about it on its day (rider_reminders).
  add column window_alerted_at timestamptz,
  add constraint orders_window_check check ((window_start is null) = (window_end is null) and (window_start is null or window_end > window_start));

-- deliveryWindows.ts WINDOW_PARTS / windowTimes. Lagos hours.
create function private.window_times(p_day date, p_part text, out w_start timestamptz, out w_end timestamptz)
language sql stable set search_path = ''
as $$
  select (p_day + make_time(h.f, 0, 0)) at time zone 'Africa/Lagos', (p_day + make_time(h.t, 0, 0)) at time zone 'Africa/Lagos'
    from (values ('morning', 9, 12), ('afternoon', 12, 16), ('evening', 16, 20)) h(part, f, t)
   where h.part = p_part
$$;

-- deliveryWindows.ts latestReadyMs: confirming, then readying, both at the last minute.
create function private.latest_ready(p_at timestamptz) returns timestamptz
language sql stable set search_path = ''
as $$ select private.add_confirm_time(private.add_confirm_time(p_at, interval '12 hours'), interval '12 hours') $$;

-- deliveryWindows.ts offeredWindows: starting once the seller must be ready, on the first 3 days with one.
create function private.offered_windows(p_now timestamptz) returns table (day date, part text)
language sql stable set search_path = ''
as $$
  with r as (select private.latest_ready(p_now) as t),
  c as (
    select d::date as day, h.part, h.n
      from r
      cross join generate_series((r.t at time zone 'Africa/Lagos')::date, (r.t at time zone 'Africa/Lagos')::date + 4, interval '1 day') d
      cross join (values ('morning', 1), ('afternoon', 2), ('evening', 3)) h(part, n)
      cross join lateral private.window_times(d::date, h.part) w
     where w.w_start >= r.t
  )
  select x.day, x.part from (select c.*, dense_rank() over (order by c.day) as k from c) x where x.k <= 3 order by x.day, x.n
$$;

-- deliveryWindows.ts windowError.
create function private.window_error(p_day date, p_part text, p_now timestamptz) returns text
language sql stable set search_path = ''
as $$
  select case when exists (select 1 from private.offered_windows(p_now) w where w.day = p_day and w.part = p_part) then null else 'Pick one of the times shown.' end
$$;

-- deliveryWindows.ts windowOpens: 7am on the window's day. Null without a window.
create function private.window_opens(p_start timestamptz) returns timestamptz
language sql stable set search_path = ''
as $$ select ((p_start at time zone 'Africa/Lagos')::date + time '07:00') at time zone 'Africa/Lagos' $$;

revoke all on function private.window_times(date, text), private.latest_ready(timestamptz), private.offered_windows(timestamptz),
  private.window_error(date, text, timestamptz), private.window_opens(timestamptz) from public, anon, authenticated;

-- Same as before, with the buyer's delivery window.
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
  v_fees jsonb;
  v_fee bigint;
  v_fee_credit bigint;
  v_to_lat double precision;
  v_to_lng double precision;
  v_orders uuid[] := '{}';
  v_code public.discounts;
  v_code_text text := upper(btrim(coalesce(p ->> 'code', '')));
  v_unit jsonb;
  v_code_used boolean := false;
  v_window_day date;
  v_window_part text := p -> 'window' ->> 'part';
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_window_error text;
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
  -- deliveryWindows.ts windowError. Delivery only; none means as soon as it's ready.
  if jsonb_typeof(p -> 'window') = 'object' then
    if v_fulfilment <> 'delivery' then
      v_errors := array_append(v_errors, 'Delivery windows are only for delivery.');
    else
      begin
        v_window_day := (p -> 'window' ->> 'day')::date;
      exception when others then
        v_window_day := null;
      end;
      v_window_error := private.window_error(v_window_day, v_window_part, now());
      if v_window_error is not null then
        v_errors := array_append(v_errors, v_window_error);
      else
        select w.w_start, w.w_end into v_window_start, v_window_end from private.window_times(v_window_day, v_window_part) w;
      end if;
    end if;
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  -- A discount code, checked like check_discount_code. Its use is counted at the end.
  if v_code_text <> '' then
    v_code := private.usable_code(v_code_text, v_uid);
  end if;

  -- Same lock order as buy_tickets: the buyer's wallet, then the listings.
  perform 1 from public.profiles where id = v_uid for update;

  for l in select * from public.listings where id = any (v_ids) order by id for update loop
    v_won := l.status = 'drawn' and private.has_won(v_uid, l.id);
    v_price := case when v_won then 0 when l.status <> 'for_sale' then null when l.kind = 'product' then (private.unit_price(l, v_code.id) ->> 'unitKobo')::bigint else l.fallback_price_kobo end;
    if v_price is null then perform private.fail('not_for_sale', l.title || ' isn’t for sale any more.'); end if;
    if l.category = 'Cars' and cardinality(v_ids) > 1 then perform private.fail('invalid_input', 'Cars are arranged on their own, not with other items.'); end if;
    if l.category = 'Cars' and v_fulfilment = 'pickup' then perform private.fail('invalid_input', 'Cars stay with the dealer, so they can’t be collected from a pickup location.'); end if;
    if l.category = 'Cars' and v_window_start is not null then perform private.fail('invalid_input', 'Cars are arranged with the dealer, so there’s no delivery window.'); end if;
    if v_won and exists (select 1 from public.orders where listing_id = l.id) then perform private.fail('invalid_input', l.title || ' has already been arranged.'); end if;
    v_total := v_total + v_price * private.order_quantity(p, l);
  end loop;
  if (select count(*) from public.listings where id = any (v_ids)) <> cardinality(v_ids) then perform private.fail('not_found', 'One of those items no longer exists.'); end if;

  -- deliveryFees.ts checkoutDeliveryFees: one fee per seller, for their largest package. Cars and won items don't pay.
  if v_fulfilment = 'pickup' then
    select lat, lng into v_to_lat, v_to_lng from public.pickup_points where id = v_point;
  else
    v_to_lat := v_lat;
    v_to_lng := v_lng;
  end if;
  select coalesce(jsonb_object_agg(x.id, private.delivery_fee(x.delivery_area, v_to_lat, v_to_lng, (array['small', 'medium', 'large'])[x.size_rank])), '{}'::jsonb) into v_fees
    from (
      select m.id, m.delivery_area, max(array_position(array['small', 'medium', 'large'], private.package_size_of(s.package_size, s.category))) as size_rank
        from public.listings s join public.merchants m on m.id = s.merchant_id
       where s.id = any (v_ids) and s.status = 'for_sale' and s.category <> 'Cars'
       group by m.id, m.delivery_area
    ) x;
  v_total := v_total + coalesce((select sum(value::bigint) from jsonb_each_text(v_fees)), 0);

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
    v_unit := case when not v_won and l.kind = 'product' then private.unit_price(l, v_code.id) end;
    v_price := v_qty * case when v_won then 0 when l.kind = 'product' then (v_unit ->> 'unitKobo')::bigint else l.fallback_price_kobo end;
    if v_code.id is not null and (v_unit ->> 'discountId')::uuid = v_code.id then v_code_used := true; end if;
    v_fee := case when v_won then 0 else coalesce((v_fees ->> l.merchant_id::text)::bigint, 0) end;
    v_fees := v_fees - l.merchant_id::text;
    insert into public.orders (discount_kobo, discount_id, delivery_fee_kobo, quantity, listing_id, user_id, merchant_id, price_kobo, fee_kobo, delivery_address, delivery_phone, delivery_lat, delivery_lng,
                               fulfilment, pickup_point_id, is_prize, handled_by, checkout_id, window_start, window_end)
    values (coalesce(v_qty * (l.price_kobo - (v_unit ->> 'unitKobo')::bigint), 0), (v_unit ->> 'discountId')::uuid, v_fee, v_qty, l.id, v_uid, l.merchant_id, v_price, round(v_price * l.fee_bps / 10000.0)::bigint, v_address, v_phone, v_lat, v_lng,
            v_fulfilment, v_point, v_won, case when v_won and l.category <> 'Cars' then 'drawmart' else 'store' end, v_checkout, v_window_start, v_window_end)
    returning id into v_order;
    v_orders := array_append(v_orders, v_order);
    if not v_won then
      v_from_credit := least(v_credit, v_price);
      v_credit := v_credit - v_from_credit;
      insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
      values (v_uid, 'order_payment', -(v_price - v_from_credit), -v_from_credit, 'Bought · ' || l.title || case when v_qty > 1 then ' × ' || v_qty else '' end, l.id);
      v_fee_credit := least(v_credit, v_fee);
      v_credit := v_credit - v_fee_credit;
      if v_fee > 0 then
        insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
        values (v_uid, 'delivery_fee', -(v_fee - v_fee_credit), -v_fee_credit, 'Delivery · ' || l.title, l.id);
      end if;
      insert into private.order_payments (order_id, cash_kobo, credit_kobo, fee_cash_kobo, fee_credit_kobo)
      values (v_order, v_price - v_from_credit, v_from_credit, v_fee - v_fee_credit, v_fee_credit);
      -- orders.ts takeStock. The row has been locked since the first loop, so two buyers can't both get the last one.
      update public.listings set stock = stock - v_qty, status = case when stock <= v_qty then 'sold' else status end where id = l.id;
    end if;
  end loop;

  -- Counted only now, on the locked row, so a code can't go past its limit.
  if v_code.id is not null then
    if not v_code_used then perform private.fail('invalid_input', 'That code isn’t for anything you’re buying.'); end if;
    update public.discounts set uses = uses + 1 where id = v_code.id and (max_uses is null or uses < max_uses);
    if not found then perform private.fail('invalid_input', 'That code has just been used up.'); end if;
    insert into private.discount_redemptions (discount_id, user_id) values (v_code.id, v_uid) on conflict do nothing;
    if not found then perform private.fail('invalid_input', 'You’ve already used that code.'); end if;
  end if;

  delete from public.cart_items where user_id = v_uid and listing_id = any (v_ids);
  return to_jsonb(v_orders);
end $$;

-- Same as before, not before the window's day.
create or replace function private.take_group(p_order_id uuid, p_rider uuid) returns boolean
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
  -- deliveryWindows.ts canTakeYet: not before 7am on the buyer's window's day.
  if o.status = 'dispatched' and o.window_start is not null and private.window_opens(o.window_start) > now() then
    perform private.fail('invalid_input', format('This one is for %s. It can be taken from 7am that day.', to_char(o.window_start at time zone 'Africa/Lagos', 'Dy FMDD Mon')));
  end if;
  v_from_counter := o.return_state = 'returning';
  update public.orders x set rider_id = p_rider, rider_assigned_at = now(), collected_at = case when x.is_prize then now() else x.collected_at end
   where (x.id = o.id or (x.checkout_id = o.checkout_id and x.merchant_id = o.merchant_id and private.same_fee_group(x, o)))
     and x.rider_id is null
     and case when v_from_counter then x.return_state = 'returning' and x.counter_at is not null and x.counter_out_at is null
              else x.status = 'dispatched' and x.counter_at is null end;
  return true;
end $$;

-- Same as before, with the window.
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
        o.window_start as "windowStart",
        o.window_end as "windowEnd",
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

-- Same as before, with the window, and waiting counted from its day.
create or replace function public.dispatch_board() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  return jsonb_build_object(
    'waitingHours', s.dispatch_waiting_hours,
    'carryingHours', s.dispatch_carrying_hours,
    'maxJobs', s.rider_max_jobs,
    'jobs', coalesce((
      select jsonb_agg(to_jsonb(j) order by j.stuck desc, j.since nulls last)
      from (
        select
          'delivery' as kind, o.id, o.id as "orderId", st.stage, st.since, private.dispatch_stuck(st.stage, st.since) as stuck,
          l.product_code as "productCode", l.title as "listingTitle", l.images[1] as "listingImage",
          case when o.handled_by = 'drawmart' then 'DrawMart escrow' else m.name end as "shopName",
          case when o.return_state = 'returning' then case when o.counter_at is not null then private.point_area(o.pickup_point_id) else private.buyer_area(o) end
               when o.handled_by = 'drawmart' then null
               else m.delivery_area end as "fromArea",
          case when o.return_state = 'returning' then m.delivery_area
               when o.fulfilment = 'pickup' then private.point_area(o.pickup_point_id)
               else private.buyer_area(o) end as "toArea",
          o.is_prize as "isPrize", o.fulfilment, pp.name as "pickupPointName",
          o.failed_attempts as "failedAttempts",
          o.status = 'dispatched' and o.failed_attempts = 1 and o.redelivery_choice is null as "awaitingBuyer",
          case when o.redelivery_choice = 'redeliver' then o.redeliver_at end as "redeliverAt",
          o.window_start as "windowStart", o.window_end as "windowEnd",
          case when o.rider_id is not null then private.rider_json(o.rider_id) end as rider
        from public.orders o
        join public.listings l on l.id = o.listing_id
        join public.merchants m on m.id = o.merchant_id
        left join public.pickup_points pp on pp.id = o.pickup_point_id
        -- dispatch.ts orderStage.
        cross join lateral (
          select
            case when o.return_state = 'returning' then
                   case when o.counter_at is not null and o.counter_out_at is null then case when o.rider_id is null then 'waiting' else 'taken' end else 'returning' end
                 when o.counter_at is not null then 'at_counter'
                 when o.rider_id is null then 'waiting'
                 when o.collected_at is null then 'taken'
                 when o.failed_attempts > 0 then 'failed'
                 else 'carrying' end as stage,
            case when o.return_state = 'returning' then
                   case when o.counter_at is not null and o.counter_out_at is null then case when o.rider_id is null then o.cancelled_at else o.rider_assigned_at end
                        else coalesce(o.counter_out_at, o.cancelled_at) end
                 when o.counter_at is not null then o.counter_at
                 -- A job for a later day's window waits from when riders can take it.
                 when o.rider_id is null then greatest(o.dispatched_at, private.window_opens(o.window_start))
                 when o.collected_at is null then o.rider_assigned_at
                 when o.failed_attempts > 0 then o.last_failed_at
                 else o.collected_at end as since
        ) st
        where o.status = 'dispatched' or o.return_state = 'returning'

        union all

        select
          'return', c.id, c.order_id, st.stage, st.since, private.dispatch_stuck(st.stage, st.since),
          l.product_code, l.title, l.images[1], m.name,
          private.nearest_area(c.return_lat, c.return_lng), m.delivery_area,
          o.is_prize, o.fulfilment, null, 0, false, null, null, null,
          case when c.rider_id is not null then private.rider_json(c.rider_id) end
        from public.order_claims c
        join public.orders o on o.id = c.order_id
        join public.listings l on l.id = o.listing_id
        join public.merchants m on m.id = o.merchant_id
        -- dispatch.ts claimStage.
        cross join lateral (
          select
            case when c.status = 'returning' then 'returning' when c.rider_id is null then 'waiting' else 'taken' end as stage,
            case when c.status = 'returning' then c.picked_up_at when c.rider_id is null then coalesce(c.reviewed_at, c.created_at) else c.rider_assigned_at end as since
        ) st
        where c.status in ('awaiting_pickup', 'returning')
      ) j
    ), '[]'::jsonb)
  );
end $$;

-- Same as before, waiting for the window's day.
create or replace function private.alert_riders_for_order() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- A job for a later day's window is announced on its day, by rider_reminders.
  if new.status = 'dispatched' and new.rider_id is null and new.counter_at is null and (old.status <> 'dispatched' or old.rider_id is not null)
     and (new.window_start is null or private.window_opens(new.window_start) <= now()) then
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

-- Same as before, announcing jobs on their window's day.
create or replace function private.rider_reminders() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_soon interval := make_interval(mins => greatest((private.settings()).rider_collect_minutes - 30, 0));
  r record;
begin
  -- deliveryWindows.ts: a job made ready before its window's day reaches riders at 7am that day.
  for r in
    update public.orders o set window_alerted_at = now()
     where o.status = 'dispatched' and o.rider_id is null and o.counter_at is null and o.window_alerted_at is null
       and o.window_start is not null and private.window_opens(o.window_start) <= now() and o.dispatched_at < private.window_opens(o.window_start)
    returning o.listing_id, o.handled_by, o.merchant_id
  loop
    perform private.alert_riders('rider_new_job', r.listing_id,
      case when r.handled_by = 'drawmart' then null else (select delivery_area from public.merchants where id = r.merchant_id) end, null);
  end loop;

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
