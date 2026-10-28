-- Sample stores and draws, matching the in-browser mock (src/api/mock.ts).
-- Safe to run more than once: it does nothing if any store already exists.
-- "Other buyers" tickets have no user (user_id is null).

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
language plpgsql
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
    v_count, 'seller', 1000, p_unsold, p_fallback_naira * 100,
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

do $$
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
  if exists (select 1 from public.merchants) then
    raise notice 'Seed skipped: stores already exist.';
    return;
  end if;

  insert into public.merchants (id, name, area, cac_number, verified) values
    (ikeja, 'Ikeja Partner Store', 'Ikeja', 'RC [NUMBER]', true),
    (lekki, 'Lekki Partner Store', 'Lekki', 'RC [NUMBER]', true),
    (surulere, 'Surulere Partner Store', 'Surulere', 'RC [NUMBER]', true),
    (yaba, 'Yaba Partner Store', 'Yaba', 'RC [NUMBER]', true),
    (vi, 'Victoria Island Partner Dealer', 'Victoria Island', 'RC [NUMBER]', true);

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
end $$;

drop function private.seed_listing(uuid, text, text, text[], text, bigint, bigint, int, interval, text, text, bigint);
