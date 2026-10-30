-- Exact locations for deliveries and pickups (src/domain/location.ts). Buyers
-- and stores pin the spot on a map, and new orders and bookings must have a pin
-- inside Lagos. Existing rows keep null.
--
-- A pin is as private as the address beside it: orders are readable only by the
-- buyer, the store and admins; handovers only by the store and admins.

alter table public.orders add column delivery_lat double precision, add column delivery_lng double precision;
alter table public.listing_handovers add column lat double precision, add column lng double precision;

-- location.ts locationError. Null when the pin is fine; otherwise the message.
create function private.location_error(p_lat double precision, p_lng double precision) returns text
language sql immutable
as $$
  select case
    when p_lat is null or p_lng is null or p_lat = 'NaN' or p_lng = 'NaN' then 'Pin the exact spot on the map.'
    when p_lat not between 6.35 and 6.75 or p_lng not between 2.7 and 4.35 then 'That pin is outside Lagos, where we operate for now.'
  end
$$;

create or replace function public.create_listing(p jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_merchant public.merchants;
  v_errors text[] := '{}';
  v_title text := btrim(coalesce(p ->> 'title', ''));
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
  v_seed text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
begin
  select m.* into v_merchant from public.merchants m join public.profiles pr on pr.merchant_id = m.id where pr.id = v_uid;
  if not found then perform private.fail('forbidden', 'This account isn’t linked to a store.'); end if;
  if not v_merchant.verified then perform private.fail('forbidden', 'Your store hasn’t been verified yet.'); end if;

  begin v_date := (h ->> 'date')::date; exception when others then v_date := null; end;
  begin
    v_lat := (h -> 'location' ->> 'lat')::double precision;
    v_lng := (h -> 'location' ->> 'lng')::double precision;
  exception when others then
    v_lat := null;
  end;
  v_pin_error := private.location_error(v_lat, v_lng);

  -- fees.ts validateListingEconomics
  if v_title = '' then v_errors := array_append(v_errors, 'Give the item a name.'); end if;
  if v_price is null or v_price <= 0 then v_errors := array_append(v_errors, 'Enter your price.'); end if;
  if v_ticket is null or v_ticket < 10000 then v_errors := array_append(v_errors, 'Tickets must cost at least ₦100.'); end if;
  if v_price > 0 and v_ticket > v_price then v_errors := array_append(v_errors, 'A ticket can’t cost more than the item.'); end if;
  if v_price > 0 and v_ticket > 0 and (v_price + v_ticket - 1) / v_ticket > 10000 then
    v_errors := array_append(v_errors, 'That would need more than 10,000 tickets. Raise the ticket price.');
  end if;
  if v_fee_mode is null or v_fee_mode not in ('seller', 'buyer', 'split') then v_errors := array_append(v_errors, 'Pick who pays the fee.'); end if;
  if v_category is null or v_category not in ('Phones', 'Electronics', 'Home', 'Cars', 'Fashion') then v_errors := array_append(v_errors, 'Pick a category.'); end if;
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
  if cardinality(v_images) > 4 or exists (select 1 from unnest(v_images) u where u !~ '^(https://|/assets/)') then
    v_errors := array_append(v_errors, 'Upload up to 4 photos.');
  end if;

  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  -- DrawMart sets the fee from the item's value; whatever the client sends is ignored.
  v_fee_bps := private.platform_fee_bps(v_price);

  -- fees.ts computeListingEconomics
  v_ticket_count := (v_price + v_ticket - 1) / v_ticket;
  v_buyer_bps := case v_fee_mode when 'buyer' then v_fee_bps when 'split' then v_fee_bps / 2.0 else 0 end;
  v_buyer_ticket := v_ticket + round(v_ticket * v_buyer_bps / 10000.0)::bigint;

  insert into public.listings (
    merchant_id, title, description, category, images, price_kobo, ticket_price_kobo, buyer_ticket_price_kobo,
    ticket_count, fee_mode, fee_bps, unsold_policy, fallback_price_kobo, duration_days, status,
    caution_fee_kobo, commitment, closes_at)
  values (
    v_merchant.id, v_title, btrim(coalesce(p ->> 'description', '')), v_category, v_images, v_price, v_ticket, v_buyer_ticket,
    v_ticket_count, v_fee_mode, v_fee_bps, v_unsold, case when v_unsold = 'convert_to_sale' then v_fallback end, v_duration, 'pending_review',
    (select amount_kobo from public.caution_fees where category = v_category),
    encode(sha256(convert_to(v_seed, 'UTF8')), 'hex'),
    now() + make_interval(days => v_duration))
  returning id into v_id;

  insert into public.listing_handovers (listing_id, method, address, contact_phone, date, slot, lat, lng)
  values (v_id, case when v_category = 'Cars' then 'inspection' else 'pickup' end, v_address, v_phone, v_date, v_slot, v_lat, v_lng);
  insert into private.listing_seeds (listing_id, seed) values (v_id, v_seed);
  return v_id;
end $$;

drop function public.buy_now(uuid, text, text);

create function public.buy_now(p_listing_id uuid, p_address text, p_phone text, p_lat double precision, p_lng double precision) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  l public.listings;
  v_price bigint;
  v_cash bigint;
  v_credit bigint;
  v_from_credit bigint;
  v_errors text[] := '{}';
  v_pin_error text := private.location_error(p_lat, p_lng);
  v_id uuid;
begin
  perform private.require_buyer(v_uid);
  -- Same lock order as buy_tickets: the buyer's profile (wallet), then the listing.
  perform 1 from public.profiles where id = v_uid for update;
  select * into l from public.listings where id = p_listing_id for update;
  if not found then perform private.fail('not_found', 'That item doesn’t exist.'); end if;
  v_price := case when l.status <> 'for_sale' then null when l.kind = 'product' then l.price_kobo else l.fallback_price_kobo end;
  if v_price is null then perform private.fail('not_for_sale', 'This item isn’t for sale any more.'); end if;

  if length(btrim(coalesce(p_address, ''))) < 10 then v_errors := array_append(v_errors, 'Enter the full delivery address, with street and area.'); end if;
  if v_pin_error is not null then v_errors := array_append(v_errors, v_pin_error); end if;
  if regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  select coalesce(sum(cash_kobo), 0), coalesce(sum(credit_kobo), 0) into v_cash, v_credit from public.ledger_entries where user_id = v_uid;
  if v_cash + v_credit < v_price then perform private.fail('insufficient_funds'); end if;
  v_from_credit := least(greatest(v_credit, 0), v_price);

  insert into public.orders (listing_id, user_id, merchant_id, price_kobo, fee_kobo, delivery_address, delivery_phone, delivery_lat, delivery_lng)
  values (l.id, v_uid, l.merchant_id, v_price, round(v_price * l.fee_bps / 10000.0)::bigint, btrim(p_address), btrim(p_phone), p_lat, p_lng)
  returning id into v_id;
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  values (v_uid, 'order_payment', -(v_price - v_from_credit), -v_from_credit, 'Bought · ' || l.title, l.id);
  update public.listings set status = 'sold' where id = l.id;
  return v_id;
end $$;

revoke execute on function private.location_error(double precision, double precision), public.buy_now(uuid, text, text, double precision, double precision) from public, anon, authenticated;
grant execute on function public.buy_now(uuid, text, text, double precision, double precision) to authenticated;
