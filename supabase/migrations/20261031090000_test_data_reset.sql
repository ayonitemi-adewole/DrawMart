-- Test data, as database functions, so it can be put back at any time.
--
--   private.seed_demo_data()     the sample stores and listings (seed.sql runs it)
--   private.seed_test_accounts() password accounts for testing: 6 buyers (one an
--                                ID-verified seller) and 5 stores. Test mode only.
--   public.reset_test_data()     admins, test mode only: wipes every listing,
--                                ticket, order, payment, chat, boost and view,
--                                puts the sample data back, and gives every buyer
--                                the starting balance again. Accounts and their
--                                roles are kept.
--
-- Keep the listings in step with the mock (src/api/mock.ts) and the accounts
-- with src/api/demoAccounts.ts. All test accounts share the password
-- drawmart-demo, so they're only created while test mode is on.

create or replace function private.seed_listing(
  p_merchant uuid,
  p_title text,
  p_category text,
  p_images text[],
  p_description text,
  p_price_naira bigint,
  p_ticket_naira bigint,
  p_sold int,
  p_closes_in interval,
  p_status text default 'live',
  p_unsold text default 'refund',
  p_fallback_naira bigint default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_seed text := encode(extensions.gen_random_bytes(32), 'hex');
  v_ref text := 'P-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
  v_price bigint := p_price_naira * 100;
  v_ticket bigint := p_ticket_naira * 100;
  v_count int := (v_price + v_ticket - 1) / v_ticket;
  v_id uuid;
begin
  insert into public.listings (
    merchant_id, title, description, category, images, price_kobo, ticket_price_kobo, buyer_ticket_price_kobo,
    ticket_count, fee_mode, fee_bps, unsold_policy, fallback_price_kobo, duration_days, status,
    caution_fee_kobo, caution_fee_status, commitment, created_at, closes_at)
  values (
    p_merchant, p_title, p_description, p_category, p_images, v_price, v_ticket, v_ticket,
    v_count, 'seller', private.platform_fee_bps(v_price), p_unsold, p_fallback_naira * 100,
    least(60, greatest(3, ceil(extract(epoch from p_closes_in) / 86400)::int)), p_status,
    (select amount_kobo from public.caution_fees where category = p_category),
    case when p_status in ('for_sale', 'refunded', 'rejected') then 'kept' else 'held' end,
    encode(sha256(convert_to(v_seed, 'UTF8')), 'hex'), now() - interval '2 days', now() + p_closes_in)
  returning id into v_id;

  insert into private.listing_seeds (listing_id, seed) values (v_id, v_seed);
  insert into public.listing_handovers (listing_id, method, address, contact_phone, date, slot)
  select v_id, case when p_category = 'Cars' then 'inspection' else 'pickup' end,
         m.name || ', ' || m.area || ', Lagos', '0803 000 0000',
         (now() at time zone 'Africa/Lagos')::date + case when p_status = 'pending_review' then 2 else -3 end, 'morning'
    from public.merchants m where m.id = p_merchant;

  if p_sold > 0 then
    insert into public.tickets (listing_id, user_id, number, purchase_ref, purchased_at)
    select v_id, null, n, v_ref, now() - interval '1 day' from generate_series(1, p_sold) n;
    update public.listings set tickets_sold = p_sold where id = v_id;
  end if;
  return v_id;
end $$;

create function private.seed_demo_data() returns void
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
  perform private.seed_listing(vi, 'Mercedes-AMG GLE 63 S Coupé 2025', 'Cars', array['/assets/mercedesBenzGle63s2025.jpg'],
    'Foreign-used, inspected, papers complete. Registration in the winner’s name.', 210000000, 50000, 1130, interval '480 hours');
  perform private.seed_listing(vi, 'Mercedes-AMG G 63 2025', 'Cars', array['/assets/MercedesG-wagon.jpg'],
    'Brand new with full dealer history. Registration in the winner’s name.', 330000000, 50000, 540, interval '600 hours');
  perform private.seed_listing(yaba, '5kVA inverter + battery', 'Home', '{}',
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
      (vi, 'Toyota Camry 2018', 'Cars', array['/assets/toyotaCamry2018.jpg'], 'Foreign-used, inspected, papers complete.', 14000000, 10000, 6)
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

  -- More live draws
  perform private.seed_listing('11111111-1111-4111-8111-000000000002', 'Samsung Galaxy S26, 256GB', 'Phones', '{}',
    'Brand new and sealed, with local warranty.', 1350000, 2500, 120, interval '72 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000004', 'Google Pixel 10 Pro, 256GB', 'Phones', '{}',
    'Brand new, unlocked, with a one-year warranty.', 1500000, 5000, 60, interval '120 hours', 'live', 'extend_once', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000003', 'Tecno Phantom V Fold 2', 'Phones', '{}',
    'Brand new foldable with charger and case.', 950000, 2000, 300, interval '30 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000004', 'PlayStation 5 Pro bundle', 'Electronics', '{}',
    'Console, two controllers and three games.', 1200000, 2000, 410, interval '20 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000003', 'Sony 65-inch Bravia 7', 'Electronics', '{}',
    '4K mini-LED TV. Delivery and wall mounting included.', 1650000, 5000, 90, interval '150 hours', 'live', 'convert_to_sale', 1700000);
  perform private.seed_listing('11111111-1111-4111-8111-000000000001', 'Apple Watch Ultra 3', 'Electronics', '{}',
    'Titanium, GPS + cellular, brand new.', 1050000, 2500, 200, interval '60 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000004', '10kVA solar system, installed', 'Home', '{}',
    'Inverter, lithium batteries and 12 panels, installed by the store.', 6500000, 10000, 230, interval '400 hours', 'live', 'extend_once', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000002', 'Samsung 2-door fridge, 450L', 'Home', '{}',
    'Frost-free, inverter compressor, brand new.', 1100000, 2500, 150, interval '90 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000003', 'LG front-load washer, 9kg', 'Home', '{}',
    'Inverter direct drive, brand new with warranty.', 780000, 2000, 80, interval '110 hours', 'live', 'convert_to_sale', 800000);
  perform private.seed_listing('11111111-1111-4111-8111-000000000005', 'Lexus RX 350 2023', 'Cars', '{}',
    'Foreign-used, inspected, papers complete. Registration in the winner’s name.', 95000000, 20000, 1500, interval '500 hours', 'live', 'extend_once', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000005', 'Honda Accord 2022', 'Cars', '{}',
    'Foreign-used, low mileage, inspected.', 38000000, 10000, 900, interval '350 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000002', 'Rolex Datejust 41', 'Fashion', '{}',
    'Brand new with box and papers.', 18000000, 10000, 420, interval '300 hours', 'live', 'refund', null);
  perform private.seed_listing('11111111-1111-4111-8111-000000000001', 'Louis Vuitton Keepall 50', 'Fashion', '{}',
    'Authentic, with receipt and dust bag.', 4200000, 5000, 260, interval '180 hours', 'live', 'convert_to_sale', 4000000);
  perform private.seed_listing('11111111-1111-4111-8111-000000000004', 'Air Jordan 1 bundle, 3 pairs', 'Fashion', '{}',
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
      ('11111111-1111-4111-8111-000000000001'::uuid, 'AirPods Pro 3', 'Brand new and sealed.', 'Electronics', '{}'::text[], 420000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'Samsung Galaxy Watch 8', 'Brand new, 44mm, with charger.', 'Electronics', '{}'::text[], 380000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000001'::uuid, 'UK-used iPhone 18 Pro Max, 256GB', 'UK-used, battery health 96%. Comes with a 3-month store warranty.', 'Phones', array['/assets/iphone18pmBlack.jpg'], 2150000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Samsung Galaxy S26 Ultra, 1TB', 'Brand new and sealed, with S Pen.', 'Phones', array['/assets/samsungS26Ultra.jpg'], 2450000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Dyson V15 cordless vacuum', 'Brand new with all attachments.', 'Home', '{}'::text[], 1250000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Gucci horsebit loafers', 'Authentic, sizes 41 to 45.', 'Fashion', '{}'::text[], 1100000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'LG UHD 55-inch smart TV', 'With wall bracket. Delivery anywhere in Lagos.', 'Electronics', array['/assets/LG55inchSmartTv.jpg'], 690000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Hisense 1.5HP inverter AC', 'Installation in Lagos included.', 'Home', '{}'::text[], 520000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000003'::uuid, 'Office desk and chair set', 'Solid wood desk with an ergonomic mesh chair.', 'Home', '{}'::text[], 350000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'MacBook Air 13-inch, M4', '16GB, 512GB SSD, brand new.', 'Electronics', '{}'::text[], 1650000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'HP LaserJet Pro printer', 'Wireless, prints and scans.', 'Electronics', '{}'::text[], 285000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'JBL Charge 6 speaker', 'Waterproof Bluetooth speaker, brand new.', 'Electronics', '{}'::text[], 240000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000004'::uuid, 'Ankara fabric bundle, 5 × 6 yards', 'Assorted prints, 100% cotton.', 'Fashion', '{}'::text[], 85000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Toyota Camry 2018, Nigerian-used', 'One owner, inspected, papers complete. View at our VI showroom.', 'Cars', array['/assets/toyotaCamry2018.jpg'], 13500000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Mercedes-Benz GLE 450 2021', 'Foreign-used, full service history.', 'Cars', array['/assets/mercedesBenzGle63s2025.jpg'], 78000000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000005'::uuid, 'Front and rear dashcam', 'Installed while you wait at our VI showroom.', 'Electronics', '{}'::text[], 120000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000006'::uuid, 'PS5 Slim, barely used', 'With two controllers. Pickup in Yaba or delivery.', 'Electronics', '{}'::text[], 650000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000006'::uuid, 'iPad 10th gen, 64GB', 'Like new, with case and charger.', 'Electronics', '{}'::text[], 420000::bigint, 'for_sale'),
      ('11111111-1111-4111-8111-000000000006'::uuid, 'Nintendo Switch 2', 'Sealed. Bought abroad.', 'Electronics', '{}'::text[], 520000::bigint, 'pending_review'),
      ('11111111-1111-4111-8111-000000000002'::uuid, 'Samsung soundbar Q800', 'With wireless subwoofer.', 'Electronics', '{}'::text[], 560000::bigint, 'pending_review')
    ) as t(m, title, description, category, images, price, status);
end $$;

create function private.seed_test_accounts() returns void
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
    ('a0000000-0000-4000-8000-00000000000c'::uuid, 'vi@drawmart.test', 'Victoria Island Partner Dealer', 'store', '11111111-1111-4111-8111-000000000005'::uuid);

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

create function public.reset_test_data() returns void
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
           public.seller_applications;

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

revoke execute on function
  private.seed_listing(uuid, text, text, text[], text, bigint, bigint, int, interval, text, text, bigint),
  private.seed_demo_data(), private.seed_test_accounts(), public.reset_test_data()
from public, anon, authenticated;
grant execute on function public.reset_test_data() to authenticated;
