-- Proof a seller has a product before it's listed: a short video recorded in the app,
-- showing the item with a code DrawMart gave them; a serial or IMEI number for phones
-- and electronics; and, from individuals, proof of purchase for dearer items. Individuals
-- always; stores for their first listings, then on random spot checks. New individual
-- sellers also have limits until they've delivered a few orders. Rules mirror
-- src/domain/listingChecks.ts.

alter table public.app_settings
  add column check_first_listings int not null default 5 check (check_first_listings >= 0),
  add column spot_check_percent int not null default 10 check (spot_check_percent between 0 and 100);

-- One code at a time per shop, decided when it's issued so asking again can't dodge a spot check.
create table private.listing_check_tickets (
  merchant_id uuid primary key references public.merchants (id) on delete cascade,
  code text not null,
  video_required boolean not null,
  issued_at timestamptz not null default now()
);
alter table private.listing_check_tickets enable row level security;
revoke all on private.listing_check_tickets from public, anon, authenticated;

-- Only the seller and admins: these can show a home, and a receipt.
create table public.listing_checks (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  code text,
  video_path text,
  serial text,
  proof_path text,
  created_at timestamptz not null default now()
);
alter table public.listing_checks enable row level security;
create policy "own listing checks, or admins" on public.listing_checks for select to authenticated
  using ((select private.is_admin()) or exists (select 1 from public.listings l where l.id = listing_id and l.merchant_id = (select private.my_merchant_id())));
revoke all on public.listing_checks from anon, authenticated;
grant select on public.listing_checks to authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('listing-checks', 'listing-checks', false, 20971520, array['video/webm', 'video/mp4', 'image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    create policy "sellers upload listing checks" on storage.objects for insert to authenticated
      with check (bucket_id = 'listing-checks' and (storage.foldername(name))[1] = (select private.my_merchant_id())::text);
    create policy "sellers and admins read listing checks" on storage.objects for select to authenticated
      using (bucket_id = 'listing-checks' and ((storage.foldername(name))[1] = (select private.my_merchant_id())::text or (select private.is_admin())));
  end if;
end $$;

-- listingChecks.ts imeiValid: 15 digits with a Luhn check digit.
create function private.imei_valid(p text) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_sum int := 0;
  v_d int;
begin
  if p !~ '^[0-9]{15}$' then return false; end if;
  for i in 1..15 loop
    v_d := substr(p, i, 1)::int;
    if i % 2 = 0 then
      v_d := v_d * 2;
      if v_d > 9 then v_d := v_d - 9; end if;
    end if;
    v_sum := v_sum + v_d;
  end loop;
  return v_sum % 10 = 0;
end $$;

-- listingChecks.ts videoRequired. The ticket only adds a spot check; it never removes a rule.
create function private.video_required(m public.merchants) returns boolean
language sql stable security definer set search_path = ''
as $$
  select m.kind = 'individual'
      or (select count(*) from public.listings where merchant_id = m.id and kind = 'product') < (private.settings()).check_first_listings
      or coalesce((select video_required from private.listing_check_tickets where merchant_id = m.id), false)
$$;

-- listingChecks.ts proofErrors.
create function private.check_listing_proof(m public.merchants, p_category text, p_price bigint, c jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t private.listing_check_tickets;
  v_errors text[] := '{}';
  v_serial text := nullif(btrim(coalesce(c ->> 'serial', '')), '');
begin
  select * into t from private.listing_check_tickets where merchant_id = m.id;
  if private.video_required(m) then
    if t.code is null or c ->> 'code' is distinct from t.code then
      v_errors := array_append(v_errors, 'Get a new code and record the video again.');
    elsif coalesce(c ->> 'videoPath', '') not like m.id::text || '/%' then
      v_errors := array_append(v_errors, 'Record a short video of the item with your code.');
    end if;
  end if;
  if v_serial is null and p_category in ('Phones', 'Electronics') and p_price >= 5000000 then
    v_errors := array_append(v_errors, 'Add the serial or IMEI number.');
  elsif v_serial is not null and (v_serial !~ '^[A-Za-z0-9-]{4,40}$' or (v_serial ~ '^[0-9]{15}$' and p_category = 'Phones' and not private.imei_valid(v_serial))) then
    v_errors := array_append(v_errors, 'That serial or IMEI number doesn’t look right.');
  end if;
  if m.kind = 'individual' and p_price > 10000000 and coalesce(c ->> 'proofPath', '') not like m.id::text || '/%' then
    v_errors := array_append(v_errors, 'Add a photo of your receipt or other proof you bought it.');
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;
end $$;

create function private.record_listing_proof(p_listing uuid, p_merchant uuid, c jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.listing_checks (listing_id, code, video_path, serial, proof_path)
  values (p_listing, c ->> 'code', nullif(c ->> 'videoPath', ''), nullif(btrim(coalesce(c ->> 'serial', '')), ''), nullif(c ->> 'proofPath', ''));
  delete from private.listing_check_tickets where merchant_id = p_merchant;
end $$;

-- listingChecks.ts newSellerLimitError. Only individuals, until they've had 3 deliveries that weren't refunded.
create function private.check_new_seller_limits(p_merchant uuid, p_price bigint, p_adding int) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.merchants where id = p_merchant and kind = 'individual') then return; end if;
  if (select count(*) from public.orders where merchant_id = p_merchant and status = 'delivered' and refunded_at is null and not is_prize) >= 3 then return; end if;
  if p_price > 20000000 then
    perform private.fail('invalid_input', 'New sellers can list items up to ₦200,000 until they’ve had 3 successful deliveries.');
  end if;
  if (select count(*) from public.listings where merchant_id = p_merchant and status in ('pending_review', 'for_sale', 'paused')) + p_adding > 5 then
    perform private.fail('invalid_input', 'New sellers can have 5 items on sale or in review until they’ve had 3 successful deliveries.');
  end if;
end $$;

-- What the listing form needs to ask for. Issues the code, and decides any spot check, once.
create function public.listing_check_plan() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m public.merchants;
  t private.listing_check_tickets;
  s public.app_settings := private.settings();
  v_alphabet constant text := 'ACDEFHJKMNPRTUVWXY3479';
  v_code text := '';
  v_done int;
begin
  perform private.require_user();
  select * into m from public.merchants where id = private.my_merchant_id();
  if not found then perform private.fail('forbidden', 'This account isn’t linked to a shop.'); end if;
  select * into t from private.listing_check_tickets where merchant_id = m.id;
  if not found or t.issued_at < now() - interval '24 hours' then
    for i in 1..4 loop v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1); end loop;
    insert into private.listing_check_tickets (merchant_id, code, video_required) values (m.id, v_code, random() * 100 < s.spot_check_percent)
    on conflict (merchant_id) do update set code = excluded.code, video_required = excluded.video_required, issued_at = now()
    returning * into t;
  end if;
  select count(*) into v_done from public.orders where merchant_id = m.id and status = 'delivered' and refunded_at is null and not is_prize;
  return jsonb_build_object(
    'code', t.code,
    'videoRequired', private.video_required(m),
    'individual', m.kind = 'individual',
    'newSeller', case when m.kind = 'individual' and v_done < 3 then jsonb_build_object(
      'deliveries', v_done,
      'live', (select count(*) from public.listings where merchant_id = m.id and status in ('pending_review', 'for_sale', 'paused'))
    ) end
  );
end $$;

revoke execute on function private.imei_valid(text), private.video_required(public.merchants), private.check_listing_proof(public.merchants, text, bigint, jsonb), private.record_listing_proof(uuid, uuid, jsonb), private.check_new_seller_limits(uuid, bigint, int) from public, anon, authenticated;
revoke all on function public.listing_check_plan() from public, anon;
grant execute on function public.listing_check_plan() to authenticated;

-- Same as before, with proof and new sellers' limits.
create or replace function public.create_product(p jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_merchant public.merchants;
  v_errors text[] := '{}';
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_category text := p ->> 'category';
  v_price bigint := (p ->> 'priceKobo')::bigint;
  v_fee_bps int;
  v_images text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'images', '[]'::jsonb))), '{}');
  v_id uuid;
  v_stock int := private.parse_stock(p, 1);
  v_size text := p ->> 'packageSize';
begin
  select m.* into v_merchant from public.merchants m where m.id = private.my_merchant_id();
  if not found then perform private.fail('forbidden', 'Get verified as a seller, or sign in with a store account, to list products.'); end if;
  if v_merchant.suspended_at is not null then perform private.fail('forbidden', 'Your shop is suspended. Contact DrawMart.'); end if;
  if not v_merchant.verified then perform private.fail('forbidden', 'Your store hasn’t been verified yet.'); end if;

  if v_title = '' then v_errors := array_append(v_errors, 'Give the item a name.'); end if;
  if v_size is not null and v_size not in ('small', 'medium', 'large') then v_errors := array_append(v_errors, 'Pick a package size.'); end if;
  if v_stock is null then v_errors := array_append(v_errors, 'Enter how many you have, from 1 to 10,000.'); end if;
  if v_price is null or v_price < 10000 then v_errors := array_append(v_errors, 'Set a price of at least ₦100.'); end if;
  if v_category is null or v_category not in ('Phones', 'Electronics', 'Home', 'Cars', 'Fashion') then v_errors := array_append(v_errors, 'Pick a category.'); end if;
  if cardinality(v_images) > 4 or exists (select 1 from unnest(v_images) u where u !~ '^(https://|/assets/)') then
    v_errors := array_append(v_errors, 'Upload up to 4 photos.');
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  -- listingChecks.ts: proof the seller has it, and new sellers' limits.
  perform private.check_listing_proof(v_merchant, v_category, v_price, p -> 'check');
  perform private.check_new_seller_limits(v_merchant.id, v_price, 1);

  -- DrawMart sets the fee from the item's value; whatever the client sends is ignored.
  v_fee_bps := private.platform_fee_bps(v_price);

  insert into public.listings (
    package_size, stock, kind, merchant_id, title, description, category, images, price_kobo, ticket_price_kobo, buyer_ticket_price_kobo,
    ticket_count, fee_mode, fee_bps, unsold_policy, duration_days, status, caution_fee_kobo, caution_fee_status, commitment, closes_at)
  values (
    v_size, v_stock, 'product', v_merchant.id, v_title, btrim(coalesce(p ->> 'description', '')), v_category, v_images, v_price, 0, 0,
    0, 'seller', v_fee_bps, 'refund', 0, 'pending_review', 0, 'none', '', now())
  returning id into v_id;
  perform private.record_listing_proof(v_id, v_merchant.id, p -> 'check');
  return v_id;
end $$;

-- Same as before: an admin can't approve past a new seller's limits.
create or replace function public.approve_listing(p_listing_id uuid, p_revision int default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
begin
  perform private.require_admin();
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.status <> 'pending_review' then
    perform private.fail('invalid_input', 'Only listings in review can be approved.');
  end if;
  if p_revision is not null and p_revision <> l.revision then
    perform private.fail('invalid_input', 'The store just changed this listing. Check it again.');
  end if;
  if exists (select 1 from public.merchants where id = l.merchant_id and suspended_at is not null) then perform private.fail('invalid_input', 'This seller is suspended. Lift it first.'); end if;
  if l.kind = 'product' then perform private.check_new_seller_limits(l.merchant_id, l.price_kobo, 0); end if;
  -- A raffle's clock starts when the draw goes live.
  update public.listings
     set reviewed_price_kobo = price_kobo,
         status = case when kind = 'product' then 'for_sale' else 'live' end,
         closes_at = case when kind = 'product' then closes_at else now() + make_interval(days => duration_days) end,
         was_rejected = false
   where id = p_listing_id;
end $$;

-- Same as before: nor can a new seller resume past them.
create or replace function public.resume_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare l public.listings := private.my_listing_for_update(p_listing_id);
begin
  if exists (select 1 from public.merchants where id = l.merchant_id and suspended_at is not null) then perform private.fail('forbidden', 'Your shop is suspended. Contact DrawMart.'); end if;
  if l.status <> 'paused' then perform private.fail('invalid_input', 'Only paused products can be resumed.'); end if;
  perform private.check_new_seller_limits(l.merchant_id, l.price_kobo, 0);
  update public.listings set status = case when stock > 0 then 'for_sale' else 'sold' end where id = l.id;
end $$;

-- Same as before: nor price past them.
create or replace function public.change_price(p_listing_id uuid, p_price_kobo bigint) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings := private.my_listing_for_update(p_listing_id);
  v_base bigint;
begin
  if l.kind <> 'product' or l.status not in ('for_sale', 'paused', 'sold') then perform private.fail('invalid_input', 'Only products on sale, paused or sold out can change price.'); end if;
  if p_price_kobo is null or p_price_kobo < 10000 then perform private.fail('invalid_input', 'Set a price of at least ₦100.'); end if;
  perform private.check_new_seller_limits(l.merchant_id, p_price_kobo, 0);
  v_base := coalesce(l.reviewed_price_kobo, l.price_kobo);
  if abs(p_price_kobo - v_base) * 100 > v_base * 20 then
    insert into public.price_reviews (listing_id, new_price_kobo) values (l.id, p_price_kobo)
    on conflict (listing_id) do update set new_price_kobo = excluded.new_price_kobo, requested_at = now();
    return true;
  end if;
  delete from public.price_reviews where listing_id = l.id;
  update public.listings set price_kobo = p_price_kobo, fee_bps = private.platform_fee_bps(p_price_kobo) where id = l.id;
  return false;
end $$;

-- Same as before: nor edit past them.
create or replace function private.set_listing_details(l public.listings, p jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_errors text[] := '{}';
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_description text := btrim(coalesce(p ->> 'description', ''));
  v_category text := p ->> 'category';
  v_price bigint := (p ->> 'priceKobo')::bigint;
  v_ticket bigint := (p ->> 'ticketPriceKobo')::bigint;
  v_fee_mode text := p ->> 'feeMode';
  v_fee_bps int;
  v_duration int := (p ->> 'durationDays')::int;
  v_unsold text := p ->> 'unsoldPolicy';
  v_fallback bigint := nullif(p ->> 'fallbackPriceKobo', '')::bigint;
  v_images text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'images', '[]'::jsonb))), '{}');
  h jsonb := coalesce(p -> 'handover', '{}'::jsonb);
  v_address text := btrim(coalesce(h ->> 'address', ''));
  v_phone text := coalesce(h ->> 'contactPhone', '');
  v_date date;
  v_slot text := h ->> 'slot';
  v_lat double precision;
  v_lng double precision;
  v_pin_error text;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_ticket_count int;
  v_buyer_bps numeric;
  v_buyer_ticket bigint;
  v_fee bigint;
  v_stock int := private.parse_stock(p, l.stock);
  v_size text := p ->> 'packageSize';
begin
  if v_category is null or v_category not in ('Phones', 'Electronics', 'Home', 'Cars', 'Fashion') then v_errors := array_append(v_errors, 'Pick a category.'); end if;
  if cardinality(v_images) > 4 or exists (select 1 from unnest(v_images) u where u !~ '^(https://|/assets/)') then
    v_errors := array_append(v_errors, 'Upload up to 4 photos.');
  end if;
  if v_title = '' then v_errors := array_append(v_errors, 'Give the item a name.'); end if;


  if l.kind = 'product' then
    if v_price is null or v_price < 10000 then v_errors := array_append(v_errors, 'Set a price of at least ₦100.'); end if;
    if v_size is not null and v_size not in ('small', 'medium', 'large') then v_errors := array_append(v_errors, 'Pick a package size.'); end if;
    if v_stock is null then v_errors := array_append(v_errors, 'Enter how many you have, from 1 to 10,000.'); end if;
    if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;
    perform private.check_new_seller_limits(l.merchant_id, v_price, 0);

    update public.listings
       set title = v_title, description = v_description, category = v_category, images = v_images, price_kobo = v_price, stock = v_stock, package_size = coalesce(v_size, l.package_size),
           fee_bps = private.platform_fee_bps(v_price), closes_at = now()
     where id = l.id;
    return;
  end if;

  begin v_date := (h ->> 'date')::date; exception when others then v_date := null; end;
  begin
    v_lat := (h -> 'location' ->> 'lat')::double precision;
    v_lng := (h -> 'location' ->> 'lng')::double precision;
  exception when others then
    v_lat := null;
  end;
  v_pin_error := private.location_error(v_lat, v_lng);

  -- fees.ts validateListingEconomics
  if v_price is null or v_price <= 0 then v_errors := array_append(v_errors, 'Enter your price.'); end if;
  if v_ticket is null or v_ticket < 10000 then v_errors := array_append(v_errors, 'Tickets must cost at least ₦100.'); end if;
  if v_price > 0 and v_ticket > v_price then v_errors := array_append(v_errors, 'A ticket can’t cost more than the item.'); end if;
  if v_price > 0 and v_ticket > 0 and (v_price + v_ticket - 1) / v_ticket > 10000 then
    v_errors := array_append(v_errors, 'That would need more than 10,000 tickets. Raise the ticket price.');
  end if;
  if v_fee_mode is null or v_fee_mode not in ('seller', 'buyer', 'split') then v_errors := array_append(v_errors, 'Pick who pays the fee.'); end if;
  -- listing.ts validateListingTerms
  if v_duration is null or v_duration not between 3 and 60 then v_errors := array_append(v_errors, 'Pick a deadline between 3 and 60 days.'); end if;
  if v_unsold is null or v_unsold not in ('refund', 'extend_once', 'convert_to_sale') then v_errors := array_append(v_errors, 'Pick what happens if it doesn’t sell out.'); end if;
  if v_unsold = 'convert_to_sale' and not coalesce(v_fallback > 0, false) then
    v_errors := array_append(v_errors, 'Enter the price you’ll sell it for if the draw doesn’t sell out.');
  end if;
  -- listing.ts validateHandover
  if length(v_address) < 10 then v_errors := array_append(v_errors, 'Enter the full address, with street and area.'); end if;
  if v_pin_error is not null then v_errors := array_append(v_errors, v_pin_error); end if;
  if regexp_replace(v_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  if v_date is null or v_date < v_today + 1 or v_date > v_today + 14 then
    v_errors := array_append(v_errors, 'Pick a date between tomorrow and 14 days from now.');
  end if;
  if v_slot is null or v_slot not in ('morning', 'afternoon') then v_errors := array_append(v_errors, 'Pick a time slot.'); end if;
  -- listing.ts validatePickup
  if l.pickup_batch_id is not null and v_category = 'Cars' then
    v_errors := array_append(v_errors, 'Cars are inspected where they are, so they can’t share a pickup. List them on their own.');
  end if;

  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  v_fee_bps := private.platform_fee_bps(v_price);
  -- fees.ts computeListingEconomics
  v_ticket_count := (v_price + v_ticket - 1) / v_ticket;
  v_buyer_bps := case v_fee_mode when 'buyer' then v_fee_bps when 'split' then v_fee_bps / 2.0 else 0 end;
  v_buyer_ticket := v_ticket + round(v_ticket * v_buyer_bps / 10000.0)::bigint;
  -- rejection.ts resentCautionFee
  v_fee := greatest(l.caution_fee_kobo, (select amount_kobo from public.caution_fees where category = v_category));

  -- Every item in a shared pickup shows the same fee.
  if l.pickup_batch_id is not null then
    update public.listings set caution_fee_kobo = v_fee where pickup_batch_id = l.pickup_batch_id;
  end if;

  update public.listings
     set title = v_title, description = v_description, category = v_category, images = v_images,
         price_kobo = v_price, ticket_price_kobo = v_ticket, buyer_ticket_price_kobo = v_buyer_ticket,
         ticket_count = v_ticket_count, fee_mode = v_fee_mode, fee_bps = v_fee_bps,
         unsold_policy = v_unsold, fallback_price_kobo = case when v_unsold = 'convert_to_sale' then v_fallback end,
         duration_days = v_duration, closes_at = now() + make_interval(days => v_duration),
         caution_fee_kobo = v_fee
   where id = l.id;

  insert into public.listing_handovers (listing_id, method, address, contact_phone, date, slot, lat, lng)
  values (l.id, case when v_category = 'Cars' then 'inspection' else 'pickup' end, v_address, v_phone, v_date, v_slot, v_lat, v_lng)
  on conflict (listing_id) do update
    set method = excluded.method, address = excluded.address, contact_phone = excluded.contact_phone,
        date = excluded.date, slot = excluded.slot, lat = excluded.lat, lng = excluded.lng;
end $$;

-- Same as before, wiping listing checks too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
           public.listing_views, public.tickets, public.draw_results, public.ledger_entries, public.deposits,
           public.pending_limits, public.listing_handovers, private.listing_seeds, public.listings,
           public.seller_applications, public.saved_pickups, public.notifications, public.cart_items, public.saved_addresses,
           public.saved_listings, public.winner_stories, private.winner_consent_log, private.push_outbox, private.saved_alerts_sent;

  -- Individual sellers go back to being plain buyers; their shops go.
  update public.profiles set seller_id = null where seller_id is not null;
  delete from public.merchants where kind = 'individual';

  -- Back to how a new account starts.
  update public.profiles set state = 'Lagos', age_verified = true, weekly_limit_kobo = s.default_weekly_limit_kobo, phone = null where role = 'buyer';
  update public.app_settings set boosts_forced_on = false, boost_min_active_buyers = 1000, boost_max_active = 12 where id;

  -- The starting balance for every buyer. Test accounts created below get theirs from the sign-up trigger.
  insert into public.ledger_entries (user_id, kind, cash_kobo, memo)
  select id, 'topup', s.welcome_credit_kobo, 'Welcome top-up (test money)' from public.profiles where role = 'buyer' and s.welcome_credit_kobo > 0;

  perform private.seed_demo_data();
  perform private.seed_test_accounts();
end $$;
