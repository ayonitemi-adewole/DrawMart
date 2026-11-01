-- A buyer can order several of a product at once: one order, one delivery and one PIN.
-- orders.price_kobo and fee_kobo are for the whole order. Rules mirror src/domain/orders.ts.

alter table public.orders add column quantity int not null default 1 check (quantity >= 1);
alter table public.cart_items add column quantity int not null default 1 check (quantity >= 1);

-- orders.ts maxOrderQuantity. Draws, won items and cars are one at a time.
create function private.max_order_quantity(l public.listings) returns int
language sql immutable set search_path = ''
as $$
  select case when l.kind = 'product' and l.status = 'for_sale' and l.category <> 'Cars' then least(l.stock, 99) else 1 end
$$;

-- orders.ts quantityError. p.quantities is { listingId: number }; a listing not in it is one.
create function private.order_quantity(p jsonb, l public.listings) returns int
language plpgsql stable set search_path = ''
as $$
declare
  v_raw text := p -> 'quantities' ->> l.id::text;
  v_max int := private.max_order_quantity(l);
begin
  if v_raw is null then return 1; end if;
  if v_raw !~ '^[0-9]{1,5}$' or v_raw::int < 1 then perform private.fail('invalid_input', 'Choose at least one.'); end if;
  if v_raw::int > v_max then
    perform private.fail('invalid_input', case when v_max = 1 then 'You can only buy one of ' || l.title || ' at a time.' when v_max = 99 then 'You can buy up to 99 of ' || l.title || ' at a time.' else 'Only ' || v_max || ' left of ' || l.title || '.' end);
  end if;
  return v_raw::int;
end $$;
revoke execute on function private.max_order_quantity(public.listings), private.order_quantity(jsonb, public.listings) from public, anon, authenticated;

-- Same as before, charging for and taking the quantity asked for.
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
      -- orders.ts takeStock. The row has been locked since the first loop, so two buyers can't both get the last one.
      update public.listings set stock = stock - v_qty, status = case when stock <= v_qty then 'sold' else status end where id = l.id;
    end if;
  end loop;

  delete from public.cart_items where user_id = v_uid and listing_id = any (v_ids);
  return to_jsonb(v_orders);
end $$;

-- Same as before, with a quantity. Adding what's already there changes its quantity.
drop function public.add_to_cart(uuid);
create function public.add_to_cart(p_listing_id uuid, p_quantity int default 1) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  l public.listings;
begin
  perform private.require_buyer(v_uid);
  select * into l from public.listings where id = p_listing_id;
  if not found then perform private.fail('not_found', 'That item doesn’t exist.'); end if;
  if l.merchant_id = private.my_merchant_id() then perform private.fail('forbidden', 'You can’t buy your own item.'); end if;
  if l.category = 'Cars' then perform private.fail('invalid_input', 'Cars don’t go in the cart. Each one is arranged on its own.'); end if;
  if not (l.status = 'for_sale' or private.has_won(v_uid, l.id)) then
    perform private.fail('invalid_input', 'Only items on sale, and draws you’ve won, can go in your cart.');
  end if;
  if l.status <> 'for_sale' and exists (select 1 from public.orders where listing_id = l.id and user_id = v_uid) then
    perform private.fail('invalid_input', 'You’ve already arranged this item.');
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > private.max_order_quantity(l) then
    perform private.fail('invalid_input', 'You can’t have that many of ' || l.title || '.');
  end if;
  insert into public.cart_items (user_id, listing_id, quantity) values (v_uid, l.id, p_quantity)
  on conflict (user_id, listing_id) do update set quantity = excluded.quantity;
end $$;
revoke all on function public.add_to_cart(uuid, int) from public, anon;
grant execute on function public.add_to_cart(uuid, int) to authenticated;

-- Same as before: a rider needs to know how many to collect.
create or replace function public.delivery_jobs() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  return (
    select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."deliveredAt" desc nulls first, x."dispatchedAt"), '[]'::jsonb)
    from (
      select
        o.id,
        l.product_code as "productCode",
        l.title as "listingTitle",
        o.quantity,
        l.images[1] as "listingImage",
        l.category,
        o.fulfilment,
        o.status,
        o.dispatched_at as "dispatchedAt",
        o.delivered_at as "deliveredAt",
        o.rider_id is not null as mine,
        case when o.handled_by = 'drawmart'
          then jsonb_build_object('name', 'DrawMart escrow', 'area', 'Lagos')
          else jsonb_build_object('name', m.name, 'area', m.area) end as "collectFrom",
        case when pp.id is not null then jsonb_build_object(
          'id', pp.id, 'name', pp.name, 'area', pp.area, 'address', pp.address, 'hours', pp.hours,
          'location', jsonb_build_object('lat', pp.lat, 'lng', pp.lng)) end as "pickupPoint",
        case when o.rider_id = v_uid and o.status = 'dispatched' then jsonb_build_object(
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
      where (o.status = 'dispatched' and o.rider_id is null) or o.rider_id = v_uid
      order by o.delivered_at desc nulls first
      limit 200
    ) x
  );
end $$;

-- Same as before, counting items rather than orders.
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
           where od.listing_id = l.id and not od.is_prize and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
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
           where od.merchant_id = v_merchant and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
           group by 1
        ) u
        group by day
      ) d
    ), '[]'::jsonb)
  );
end $$;
