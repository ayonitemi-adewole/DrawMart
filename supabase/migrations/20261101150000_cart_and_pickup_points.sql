-- The buyer's cart and pickup locations (src/domain/cart.ts).
--
-- A cart holds regular products and draw items the buyer has won, so they all
-- come together. Cars never go in it: each is checked out on its own, and only
-- by delivery, because it stays with the dealer. The cart doesn't reserve
-- anything: an item sold to someone else first shows as unavailable.
--
-- A won item is free (the tickets paid for it) and becomes an order too. Most
-- are held in DrawMart's escrow, so DrawMart sends them and the store doesn't
-- see the winner's details. A won car stays with the dealer, so the store does.

-- Sample locations. Edit them in the Table Editor; keep src/api/mock.ts in step.
create table public.pickup_points (
  id text primary key,
  name text not null,
  area text not null,
  address text not null,
  hours text not null,
  lat double precision not null,
  lng double precision not null,
  active boolean not null default true
);
insert into public.pickup_points (id, name, area, address, hours, lat, lng) values
  ('ikeja', 'DrawMart Ikeja', 'Ikeja', '12 Allen Avenue, Ikeja', 'Mon–Sat, 9am–6pm', 6.6018, 3.3515),
  ('yaba', 'DrawMart Yaba', 'Yaba', '48 Herbert Macaulay Way, Yaba', 'Mon–Sat, 9am–6pm', 6.5095, 3.3711),
  ('surulere', 'DrawMart Surulere', 'Surulere', '20 Adeniran Ogunsanya Street, Surulere', 'Mon–Sat, 9am–6pm', 6.4969, 3.3528),
  ('lekki', 'DrawMart Lekki', 'Lekki', '5 Admiralty Way, Lekki Phase 1', 'Mon–Sat, 10am–7pm', 6.4478, 3.4723),
  ('vi', 'DrawMart Victoria Island', 'Victoria Island', '10 Adeola Odeku Street, Victoria Island', 'Mon–Fri, 9am–6pm', 6.4281, 3.4219);

alter table public.pickup_points enable row level security;
create policy "pickup points are public" on public.pickup_points for select using (active);
revoke all on public.pickup_points from anon, authenticated;
grant select on public.pickup_points to anon, authenticated;

create table public.cart_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
alter table public.cart_items enable row level security;
create policy "own cart" on public.cart_items for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.cart_items from anon, authenticated;
grant select on public.cart_items to authenticated;

alter table public.orders
  drop constraint orders_price_kobo_check,
  add constraint orders_price_kobo_check check (price_kobo >= 0),
  alter column delivery_address drop not null,
  add column fulfilment text not null default 'delivery' check (fulfilment in ('delivery', 'pickup')),
  add column pickup_point_id text references public.pickup_points (id),
  add column is_prize boolean not null default false,
  add column handled_by text not null default 'store' check (handled_by in ('store', 'drawmart')),
  add column checkout_id uuid,
  add constraint orders_fulfilment_details check (
    case fulfilment when 'pickup' then pickup_point_id is not null else delivery_address is not null end);

-- A store only sees the orders it sends itself.
drop policy "buyer, store and admins read orders" on public.orders;
create policy "buyer, sending store and admins read orders" on public.orders for select to authenticated
  using (
    user_id = (select auth.uid())
    or (handled_by = 'store' and merchant_id = (select private.my_merchant_id()))
    or (select private.is_admin())
  );

create or replace function public.dispatch_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.orders set status = 'dispatched', dispatched_at = now()
   where id = p_order_id and status = 'paid'
     and case handled_by when 'store' then merchant_id = private.my_merchant_id() else private.is_admin() end;
  if not found then perform private.fail('invalid_input', 'Only paid orders you send yourself can be marked as sent.'); end if;
end $$;

create function private.has_won(p_user uuid, p_listing_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.draw_results where listing_id = p_listing_id and winner_user_id = p_user) $$;

-- cart.ts cartError
create function public.add_to_cart(p_listing_id uuid) returns void
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
  if exists (select 1 from public.orders where listing_id = l.id and user_id = v_uid) then
    perform private.fail('invalid_input', 'You’ve already arranged this item.');
  end if;
  insert into public.cart_items (user_id, listing_id) values (v_uid, l.id) on conflict do nothing;
end $$;

create function public.remove_from_cart(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  delete from public.cart_items where user_id = v_uid and listing_id = p_listing_id;
end $$;

-- p: {listingIds, fulfilment, address, phone, lat, lng, pickupPointId}. All or
-- nothing, paid from the wallet, store credit first. Returns the new order ids.
create function public.checkout(p jsonb) returns jsonb
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
    if exists (select 1 from public.orders where listing_id = l.id) then perform private.fail('invalid_input', l.title || ' has already been arranged.'); end if;
    v_total := v_total + v_price;
  end loop;
  if (select count(*) from public.listings where id = any (v_ids)) <> cardinality(v_ids) then perform private.fail('not_found', 'One of those items no longer exists.'); end if;

  select coalesce(sum(cash_kobo), 0), coalesce(sum(credit_kobo), 0) into v_cash, v_credit from public.ledger_entries where user_id = v_uid;
  if v_cash + v_credit < v_total then perform private.fail('insufficient_funds'); end if;
  v_credit := greatest(v_credit, 0);

  for l in select * from public.listings where id = any (v_ids) order by id loop
    v_won := l.status = 'drawn';
    v_price := case when v_won then 0 when l.kind = 'product' then l.price_kobo else l.fallback_price_kobo end;
    insert into public.orders (listing_id, user_id, merchant_id, price_kobo, fee_kobo, delivery_address, delivery_phone, delivery_lat, delivery_lng,
                               fulfilment, pickup_point_id, is_prize, handled_by, checkout_id)
    values (l.id, v_uid, l.merchant_id, v_price, round(v_price * l.fee_bps / 10000.0)::bigint, v_address, v_phone, v_lat, v_lng,
            v_fulfilment, v_point, v_won, case when v_won and l.category <> 'Cars' then 'drawmart' else 'store' end, v_checkout)
    returning id into v_order;
    v_orders := array_append(v_orders, v_order);
    if not v_won then
      v_from_credit := least(v_credit, v_price);
      v_credit := v_credit - v_from_credit;
      insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
      values (v_uid, 'order_payment', -(v_price - v_from_credit), -v_from_credit, 'Bought · ' || l.title, l.id);
      update public.listings set status = 'sold' where id = l.id;
    end if;
  end loop;

  delete from public.cart_items where user_id = v_uid and listing_id = any (v_ids);
  return to_jsonb(v_orders);
end $$;

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
          l.id as "listingId", l.title, l.images[1] as image, l.category, l.kind, l.status, l.created_at as "createdAt",
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
          select count(*)::int as units, count(distinct od.user_id)::int as buyers, coalesce(sum(od.price_kobo), 0)::bigint as sales
            from public.orders od
           where od.listing_id = l.id and not od.is_prize and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
        ) o on true
        where l.merchant_id = v_merchant and l.status <> 'rejected'
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

create or replace function private.listing_stats(p_listing_id uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'views', (select count(*) from public.listing_views v where v.listing_id = l.id and v.day between p_from and p_to),
    'visitors', (select count(distinct v.visitor) from public.listing_views v where v.listing_id = l.id and v.day between p_from and p_to),
    'chats', (select count(*) from public.conversations c where c.listing_id = l.id and (c.created_at at time zone 'Africa/Lagos')::date between p_from and p_to),
    'units', coalesce(t.units, 0) + o.units,
    'buyers', coalesce(t.buyers, 0) + o.buyers,
    'salesKobo', coalesce(t.sales, 0) + o.sales)
  from public.listings l
  left join lateral (
    select count(*)::int as units, count(distinct coalesce(tk.user_id::text, tk.purchase_ref))::int as buyers, (count(*) * l.buyer_ticket_price_kobo)::bigint as sales
      from public.tickets tk
     where tk.listing_id = l.id and l.status in ('live', 'sold_out', 'drawn')
       and (tk.purchased_at at time zone 'Africa/Lagos')::date between p_from and p_to
  ) t on l.kind = 'raffle'
  left join lateral (
    select count(*)::int as units, count(distinct od.user_id)::int as buyers, coalesce(sum(od.price_kobo), 0)::bigint as sales
      from public.orders od
     where od.listing_id = l.id and not od.is_prize and (od.created_at at time zone 'Africa/Lagos')::date between p_from and p_to
  ) o on true
  where l.id = p_listing_id
$$;

create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.messages, public.conversations, public.merchant_contacts, public.orders, public.boosts,
           public.listing_views, public.tickets, public.draw_results, public.ledger_entries, public.deposits,
           public.pending_limits, public.listing_handovers, private.listing_seeds, public.listings,
           public.seller_applications, public.saved_pickups, public.notifications, public.cart_items;

  -- Individual sellers go back to being plain buyers; their shops go.
  update public.profiles set seller_id = null where seller_id is not null;
  delete from public.merchants where kind = 'individual';

  -- Back to how a new account starts.
  update public.profiles set state = 'Lagos', age_verified = true, weekly_limit_kobo = s.default_weekly_limit_kobo where role = 'buyer';
  update public.app_settings set boosts_forced_on = false, boost_min_active_buyers = 1000, boost_max_active = 12 where id;

  -- The starting balance for every buyer. Test accounts created below get theirs from the sign-up trigger.
  insert into public.ledger_entries (user_id, kind, cash_kobo, memo)
  select id, 'topup', s.welcome_credit_kobo, 'Welcome top-up (test money)' from public.profiles where role = 'buyer' and s.welcome_credit_kobo > 0;

  perform private.seed_demo_data();
  perform private.seed_test_accounts();
end $$;

-- A tiny draw, so testers can be sure of winning and try the won-item flow.
create or replace function private.seed_demo_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ikeja constant uuid := '11111111-1111-4111-8111-000000000001';
  lekki constant uuid := '11111111-1111-4111-8111-000000000002';
  surulere constant uuid := '11111111-1111-4111-8111-000000000003';
  yaba constant uuid := '11111111-1111-4111-8111-000000000004';
  vi constant uuid := '11111111-1111-4111-8111-000000000005';
  v_id uuid;
  v_ref text;
  r record;
begin
  insert into public.merchants (id, kind, name, area, cac_number, verified) values
    (ikeja, 'store', 'Ikeja Partner Store', 'Ikeja', 'RC [NUMBER]', true),
    (lekki, 'store', 'Lekki Partner Store', 'Lekki', 'RC [NUMBER]', true),
    (surulere, 'store', 'Surulere Partner Store', 'Surulere', 'RC [NUMBER]', true),
    (yaba, 'store', 'Yaba Partner Store', 'Yaba', 'RC [NUMBER]', true),
    (vi, 'store', 'Victoria Island Partner Dealer', 'Victoria Island', 'RC [NUMBER]', true),
    -- seller@drawmart.test's own shop (an ID-verified individual).
    ('11111111-1111-4111-8111-000000000006', 'individual', 'Tolu’s Gadgets', 'Yaba', '', true)
  on conflict (id) do update set kind = excluded.kind, name = excluded.name, area = excluded.area, cac_number = excluded.cac_number, verified = excluded.verified;

  if exists (select 1 from public.listings) then
    raise notice 'Sample listings skipped: listings already exist.';
    return;
  end if;

  -- Live draws
  perform private.seed_listing(ikeja, 'iPhone 18 Pro Max, 256GB', 'Phones',
    array['/assets/iphone18pmBurgundy.jpg', '/assets/iphone18pmBlack.jpg', '/assets/iphone18pmGlacier.jpg'],
    'Brand new and sealed, with a one-year store warranty. The winner picks Burgundy, Black or Glacier.',
    2600000, 5000, 448, interval '28 hours');
  perform private.seed_listing(lekki, 'Samsung Galaxy S26 Ultra, 512GB', 'Phones', array['/assets/samsungS26Ultra.jpg'],
    'Brand new and sealed, with S Pen and local warranty.', 2100000, 5000, 230, interval '60 hours');
  perform private.seed_listing(lekki, 'LG 55-inch 4K UHD TV + soundbar', 'Electronics', array['/assets/LG55inchSmartTv.jpg'],
    'Smart TV with matching soundbar. Delivery and wall mounting anywhere in Lagos included.',
    650000, 2500, 241, interval '9 hours', 'live', 'extend_once');
  perform private.seed_listing(surulere, 'Samsung 65-inch 4K smart TV', 'Electronics', array['/assets/samsung65inch4KTV.jpg'],
    'Crystal UHD smart TV with remote and wall bracket.', 950000, 2500, 190, interval '48 hours', 'live', 'convert_to_sale', 990000);
  perform private.seed_listing(ikeja, 'MacBook Pro 14-inch, M5', 'Electronics', array['/assets/macbookProM5.jpg', '/assets/macbookProM5-2.jpg'],
    '16GB unified memory, 512GB SSD. Brand new with manufacturer warranty.', 3200000, 5000, 85, interval '144 hours');
  perform private.seed_listing(yaba, 'LG 75-inch smart TV', 'Electronics', array['/assets/LG75inchSmartTv.jpg'],
    'Big-screen 4K smart TV. Delivery and installation included.', 1450000, 5000, 122, interval '96 hours');
  perform private.seed_listing(vi, 'Toyota Camry 2025', 'Cars', array['/assets/toyotaCamry2025.jpg'],
    'Brand new with dealer warranty. Registration and plates in the winner’s name.', 48000000, 20000, 760, interval '288 hours');
  perform private.seed_listing(vi, 'Mercedes-AMG GLE 63 S Coupé 2025', 'Cars', array['/assets/mercedes-amg-gle-63-s-coupe.jpg'],
    'Foreign-used, inspected, papers complete. Registration in the winner’s name.', 210000000, 50000, 1130, interval '480 hours');
  perform private.seed_listing(vi, 'Mercedes-AMG G 63 2025', 'Cars', array['/assets/MercedesG-wagon.jpg'],
    'Brand new with full dealer history. Registration in the winner’s name.', 330000000, 50000, 540, interval '600 hours');
  perform private.seed_listing(yaba, '5kVA inverter + battery', 'Home', array['/assets/inverter-and-batteries.jpg'],
    'Inverter with two batteries, installed by the store.', 1800000, 6000, 122, interval '96 hours');

  -- A draw that ended unsold and stayed on as a regular product
  perform private.seed_listing(lekki, 'Samsung Galaxy S26 Ultra, 256GB', 'Phones', array['/assets/samsungS26UltraBlack.jpg'],
    'Brand new and sealed, Titanium Black, with local warranty.', 1700000, 5000, 0, interval '-48 hours', 'for_sale', 'convert_to_sale', 1650000);

  -- Waiting in the admin queue
  perform private.seed_listing(ikeja, 'MacBook Pro 14-inch, M1 Pro', 'Electronics', array['/assets/macbookProM1Pro.jpg'],
    'UK-used, excellent condition, battery health 92%. Charger included.', 1100000, 2500, 0, interval '168 hours', 'pending_review');
  perform private.seed_listing(vi, 'Mercedes-Benz S-Class 2025', 'Cars', array['/assets/mercedesBenzSClass2025.jpg'],
    'Brand new S 580. Registration in the winner’s name.', 280000000, 50000, 0, interval '720 hours', 'pending_review');

  -- Finished draws, so the results page isn't empty
  for r in
    select * from (values
      (ikeja, 'MacBook Pro 13-inch, M1', 'Electronics', array['/assets/macbookProM1.jpg'], 'UK-used, 8GB RAM, 256GB SSD.', 900000::bigint, 2500::bigint, 2),
      (lekki, 'Samsung 50-inch smart TV', 'Electronics', array['/assets/samsung50inchTV.jpg'], 'Crystal UHD smart TV with wall bracket.', 420000, 1500, 4),
      (vi, 'Toyota Camry 2018', 'Cars', array['/assets/toyota-camry-2018-1.jpg', '/assets/toyota-camry-2018-2.jpg', '/assets/toyota-camry-2018-3.jpg'], 'Foreign-used, inspected, papers complete.', 14000000, 10000, 6)
    ) as t(merchant, title, category, images, description, price, ticket, days_ago)
  loop
    v_id := private.seed_listing(r.merchant, r.title, r.category, r.images, r.description, r.price, r.ticket, 0, interval '1 hour');
    v_ref := 'P-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
    insert into public.tickets (listing_id, user_id, number, purchase_ref)
    select v_id, null, n, v_ref from generate_series(1, (select ticket_count from public.listings where id = v_id)) n;
    update public.listings set tickets_sold = ticket_count where id = v_id;
    perform private.run_draw(v_id, v_ref);
    update public.draw_results set drawn_at = now() - make_interval(days => r.days_ago) where listing_id = v_id;
    update public.listings set created_at = now() - make_interval(days => r.days_ago + 2), closes_at = now() - make_interval(days => r.days_ago)
     where id = v_id;
  end loop;

  perform private.seed_listing(yaba, 'JBL Go speaker, 2-ticket test draw', 'Electronics', array['/assets/jbl-charge.jpg'],
    'A tiny draw for trying the whole flow: buy both tickets and you’re sure to win.', 20000, 10000, 0, interval '720 hours');
  -- More live draws
  perform private.seed_listing('11111111-1111-4111-8111-000000000002', 'Samsung Galaxy S26, 256GB', 'Phones', array['/assets/samsung-galaxy-s-series.jpg'],
    'Brand new and sealed, with local warranty.', 1350000, 2500, 120, interval '72 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000004', 'Google Pixel 10 Pro, 256GB', 'Phones', array['/assets/google-pixel-pro.jpg'],
    'Brand new, unlocked, with a one-year warranty.', 1500000, 5000, 60, interval '120 hours', 'live', 'extend_once', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000003', 'Tecno Phantom V Fold 2', 'Phones', array['/assets/foldable-phones.jpg'],
    'Brand new foldable with charger and case.', 950000, 2000, 300, interval '30 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000004', 'PlayStation 5 Pro bundle', 'Electronics', array['/assets/playstation-5-home.jpg'],
    'Console, two controllers and three games.', 1200000, 2000, 410, interval '20 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000003', 'Sony 65-inch Bravia 7', 'Electronics', array['/assets/sony-bravia.jpg'],
    '4K mini-LED TV. Delivery and wall mounting included.', 1650000, 5000, 90, interval '150 hours', 'live', 'convert_to_sale', 1700000);
  perform private.seed_listing('11111111-1111-4111-8111-000000000001', 'Apple Watch Ultra 3', 'Electronics', array['/assets/apple-watch-ultra.jpg'],
    'Titanium, GPS + cellular, brand new.', 1050000, 2500, 200, interval '60 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000004', '10kVA solar system, installed', 'Home', array['/assets/rooftop-solar.jpg'],
    'Inverter, lithium batteries and 12 panels, installed by the store.', 6500000, 10000, 230, interval '400 hours', 'live', 'extend_once', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000002', 'Samsung 2-door fridge, 450L', 'Home', array['/assets/side-by-side-fridge.jpg'],
    'Frost-free, inverter compressor, brand new.', 1100000, 2500, 150, interval '90 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000003', 'LG front-load washer, 9kg', 'Home', array['/assets/lg-front-load-washer.jpg'],
    'Inverter direct drive, brand new with warranty.', 780000, 2000, 80, interval '110 hours', 'live', 'convert_to_sale', 800000);
  perform private.seed_listing('11111111-1111-4111-8111-000000000005', 'Lexus RX 350 2023', 'Cars', array['/assets/lexus-rx-2023.jpg'],
    'Foreign-used, inspected, papers complete. Registration in the winner’s name.', 95000000, 20000, 1500, interval '500 hours', 'live', 'extend_once', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000005', 'Honda Accord 2022', 'Cars', array['/assets/honda-accord.jpg'],
    'Foreign-used, low mileage, inspected.', 38000000, 10000, 900, interval '350 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000002', 'Rolex Datejust 41', 'Fashion', array['/assets/rolex-datejust-41.jpg'],
    'Brand new with box and papers.', 18000000, 10000, 420, interval '300 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000001', 'Louis Vuitton Keepall 50', 'Fashion', array['/assets/louis-vuitton-monogram-bags.jpg'],
    'Authentic, with receipt and dust bag.', 4200000, 5000, 260, interval '180 hours', 'live', 'convert_to_sale', 4000000);
  perform private.seed_listing('11111111-1111-4111-8111-000000000004', 'Air Jordan 1 bundle, 3 pairs', 'Fashion', array['/assets/air-jordan-1.jpg'],
    'Three colourways, any size from 40 to 46.', 650000, 1000, 380, interval '40 hours', 'live', 'refund', null);

  -- Regular products (no draw)
  insert into public.listings (
    kind, merchant_id, title, description, category, images, price_kobo, ticket_price_kobo, buyer_ticket_price_kobo,
    ticket_count, fee_mode, fee_bps, unsold_policy, duration_days, status, caution_fee_kobo, caution_fee_status, commitment, closes_at)
  select 'product', m, title, description, category, images, price * 100, 0, 0, 0, 'seller', private.platform_fee_bps(price * 100), 'refund', 0, status, 0, 'none', '', now()
    from (values
      ('11111111-1111-4111-8111-000000000001'::uuid, 'iPhone 18 Pro Max, 512GB, Glacier', 'Brand new and sealed, with a one-year store warranty. Ships in 2 days.', 'Phones', array['/assets/iphone18pmGlacier.jpg'], 2950000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Samsung 50-inch smart TV', 'Crystal UHD smart TV with wall bracket. Delivery anywhere in Lagos.', 'Electronics', array['/assets/samsung50inchTV.jpg'], 480000, 'for_sale'),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'MacBook Pro 14-inch, M5, 1TB', '24GB unified memory, 1TB SSD. Brand new with manufacturer warranty.', 'Electronics', array['/assets/macbookProM5-2.jpg'], 3850000, 'for_sale'),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Mercedes-AMG G 63 2025, Night Black', 'Brand new, dealer warranty, registration in the buyer’s name. View at our VI showroom.', 'Cars', array['/assets/mercedesBenzG632025.jpg'], 345000000, 'pending_review'),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'AirPods Pro 3', 'Brand new and sealed.', 'Electronics', array['/assets/airpods-pro.jpg']::text[], 420000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Samsung Galaxy Watch 8', 'Brand new, 44mm, with charger.', 'Electronics', array['/assets/samsung-galaxy-watch.jpg']::text[], 380000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'UK-used iPhone 18 Pro Max, 256GB', 'UK-used, battery health 96%. Comes with a 3-month store warranty.', 'Phones', array['/assets/iphone18pmBlack.jpg'], 2150000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Samsung Galaxy S26 Ultra, 1TB', 'Brand new and sealed, with S Pen.', 'Phones', array['/assets/samsungS26Ultra.jpg'], 2450000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Dyson V15 cordless vacuum', 'Brand new with all attachments.', 'Home', array['/assets/dyson-cordless-vacuum.jpg']::text[], 1250000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Gucci horsebit loafers', 'Authentic, sizes 41 to 45.', 'Fashion', array['/assets/leather-loafer.jpg']::text[], 1100000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'LG UHD 55-inch smart TV', 'With wall bracket. Delivery anywhere in Lagos.', 'Electronics', array['/assets/LG55inchSmartTv.jpg'], 690000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Hisense 1.5HP inverter AC', 'Installation in Lagos included.', 'Home', array['/assets/split-air-conditioner.jpg']::text[], 520000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Office desk and chair set', 'Solid wood desk with an ergonomic mesh chair.', 'Home', '{}'::text[], 350000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'MacBook Air 13-inch, M4', '16GB, 512GB SSD, brand new.', 'Electronics', array['/assets/macbook-air.jpg']::text[], 1650000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'HP LaserJet Pro printer', 'Wireless, prints and scans.', 'Electronics', array['/assets/hp-laserjet.jpg']::text[], 285000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'JBL Charge 6 speaker', 'Waterproof Bluetooth speaker, brand new.', 'Electronics', array['/assets/jbl-charge.jpg']::text[], 240000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Ankara fabric bundle, 5 × 6 yards', 'Assorted prints, 100% cotton.', 'Fashion', array['/assets/ankara-fabric.jpg']::text[], 85000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Toyota Camry 2018, Nigerian-used', 'One owner, inspected, papers complete. View at our VI showroom.', 'Cars', array['/assets/toyota-camry-2018-1.jpg', '/assets/toyota-camry-2018-2.jpg', '/assets/toyota-camry-2018-3.jpg'], 13500000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Mercedes-Benz GLE 350 2021', 'Foreign-used, full service history.', 'Cars', array['/assets/mercedes-gle-350-1.jpg', '/assets/mercedes-gle-350-2.jpg', '/assets/mercedes-gle-350-3.jpg'], 78000000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Front and rear dashcam', 'Installed while you wait at our VI showroom.', 'Electronics', array['/assets/dashcam.jpg']::text[], 120000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000006'::uuid, 'PS5 Slim, barely used', 'With two controllers. Pickup in Yaba or delivery.', 'Electronics', array['/assets/playstation-5-black.jpg']::text[], 650000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000006'::uuid, 'iPad 10th gen, 64GB', 'Like new, with case and charger.', 'Electronics', array['/assets/ipad-10th-gen.jpg']::text[], 420000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000006'::uuid, 'Nintendo Switch 2', 'Sealed. Bought abroad.', 'Electronics', array['/assets/nintendo-switch-2.jpg']::text[], 520000::bigint, 'pending_review'),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Samsung soundbar Q800', 'With wireless subwoofer.', 'Electronics', array['/assets/samsung-soundbar.jpg']::text[], 560000::bigint, 'pending_review')
    ) as t(m, title, description, category, images, price, status);
end $$;

revoke execute on function private.has_won(uuid, uuid), public.add_to_cart(uuid), public.remove_from_cart(uuid), public.checkout(jsonb) from public, anon, authenticated;
grant execute on function public.add_to_cart(uuid), public.remove_from_cart(uuid), public.checkout(jsonb) to authenticated;

-- Add it to a database that's already seeded (test mode only).
do $$
begin
  if (select test_mode from public.app_settings) and exists (select 1 from public.listings) and not exists (select 1 from public.listings where title = 'JBL Go speaker, 2-ticket test draw') then
    perform private.seed_listing('11111111-1111-4111-8111-000000000004', 'JBL Go speaker, 2-ticket test draw', 'Electronics', array['/assets/jbl-charge.jpg'],
      'A tiny draw for trying the whole flow: buy both tickets and you’re sure to win.', 20000, 10000, 0, interval '720 hours');
  end if;
end $$;
