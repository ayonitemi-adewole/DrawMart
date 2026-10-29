-- Clear photos for the sample listings: the store's own photos of the Camry
-- and GLE models, and freely licensed photos from Wikimedia Commons for items
-- that had none (credits: docs/photo-credits.md, and /credits in the app).
-- The GLE product is renamed to match its photos (a GLE 350).
--
-- Updates the listings already in the database, and the sample data that
-- reset_test_data() puts back.

update public.listings set images = array['/assets/samsung-galaxy-s-series.jpg'] where title = 'Samsung Galaxy S26, 256GB';
update public.listings set images = array['/assets/google-pixel-pro.jpg'] where title = 'Google Pixel 10 Pro, 256GB';
update public.listings set images = array['/assets/foldable-phones.jpg'] where title = 'Tecno Phantom V Fold 2';
update public.listings set images = array['/assets/playstation-5-home.jpg'] where title = 'PlayStation 5 Pro bundle';
update public.listings set images = array['/assets/sony-bravia.jpg'] where title = 'Sony 65-inch Bravia 7';
update public.listings set images = array['/assets/apple-watch-ultra.jpg'] where title = 'Apple Watch Ultra 3';
update public.listings set images = array['/assets/rooftop-solar.jpg'] where title = '10kVA solar system, installed';
update public.listings set images = array['/assets/side-by-side-fridge.jpg'] where title = 'Samsung 2-door fridge, 450L';
update public.listings set images = array['/assets/lg-front-load-washer.jpg'] where title = 'LG front-load washer, 9kg';
update public.listings set images = array['/assets/lexus-rx-2023.jpg'] where title = 'Lexus RX 350 2023';
update public.listings set images = array['/assets/honda-accord.jpg'] where title = 'Honda Accord 2022';
update public.listings set images = array['/assets/rolex-datejust-41.jpg'] where title = 'Rolex Datejust 41';
update public.listings set images = array['/assets/louis-vuitton-monogram-bags.jpg'] where title = 'Louis Vuitton Keepall 50';
update public.listings set images = array['/assets/air-jordan-1.jpg'] where title = 'Air Jordan 1 bundle, 3 pairs';
update public.listings set images = array['/assets/inverter-and-batteries.jpg'] where title = '5kVA inverter + battery';
update public.listings set images = array['/assets/airpods-pro.jpg'] where title = 'AirPods Pro 3';
update public.listings set images = array['/assets/samsung-galaxy-watch.jpg'] where title = 'Samsung Galaxy Watch 8';
update public.listings set images = array['/assets/dyson-cordless-vacuum.jpg'] where title = 'Dyson V15 cordless vacuum';
update public.listings set images = array['/assets/leather-loafer.jpg'] where title = 'Gucci horsebit loafers';
update public.listings set images = array['/assets/split-air-conditioner.jpg'] where title = 'Hisense 1.5HP inverter AC';
update public.listings set images = array['/assets/macbook-air.jpg'] where title = 'MacBook Air 13-inch, M4';
update public.listings set images = array['/assets/hp-laserjet.jpg'] where title = 'HP LaserJet Pro printer';
update public.listings set images = array['/assets/jbl-charge.jpg'] where title = 'JBL Charge 6 speaker';
update public.listings set images = array['/assets/ankara-fabric.jpg'] where title = 'Ankara fabric bundle, 5 × 6 yards';
update public.listings set images = array['/assets/dashcam.jpg'] where title = 'Front and rear dashcam';
update public.listings set images = array['/assets/playstation-5-black.jpg'] where title = 'PS5 Slim, barely used';
update public.listings set images = array['/assets/ipad-10th-gen.jpg'] where title = 'iPad 10th gen, 64GB';
update public.listings set images = array['/assets/nintendo-switch-2.jpg'] where title = 'Nintendo Switch 2';
update public.listings set images = array['/assets/samsung-soundbar.jpg'] where title = 'Samsung soundbar Q800';
update public.listings set images = array['/assets/mercedes-amg-gle-63-s-coupe.jpg'] where title = 'Mercedes-AMG GLE 63 S Coupé 2025';
update public.listings set images = array['/assets/toyota-camry-2018-1.jpg', '/assets/toyota-camry-2018-2.jpg', '/assets/toyota-camry-2018-3.jpg'] where title = 'Toyota Camry 2018';
update public.listings set images = array['/assets/toyota-camry-2018-1.jpg', '/assets/toyota-camry-2018-2.jpg', '/assets/toyota-camry-2018-3.jpg'] where title = 'Toyota Camry 2018, Nigerian-used';
update public.listings set title = 'Mercedes-Benz GLE 350 2021', images = array['/assets/mercedes-gle-350-1.jpg', '/assets/mercedes-gle-350-2.jpg', '/assets/mercedes-gle-350-3.jpg'] where title = 'Mercedes-Benz GLE 450 2021';

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
