-- An admin gives a reason (and maybe a note) when rejecting a listing. The store
-- sees it on its own listing and can fix the listing and send it again.
-- Rules mirror src/domain/rejection.ts. Only rejected rows carry these columns,
-- and rejected rows are only readable by their store and admins.

alter table public.listings
  add column rejection_reason text
    check (rejection_reason in ('photos_unclear', 'price_wrong', 'item_not_allowed', 'failed_escrow_check', 'other')),
  add column rejection_note text;

drop function public.reject_listing(uuid);

create function public.reject_listing(p_listing_id uuid, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.require_admin();
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.status <> 'pending_review' then
    perform private.fail('invalid_input', 'Only listings in review can be rejected.');
  end if;
  if p_reason is null or p_reason not in ('photos_unclear', 'price_wrong', 'item_not_allowed', 'failed_escrow_check', 'other')
     or (p_reason = 'failed_escrow_check' and l.kind = 'product') then
    perform private.fail('invalid_input', 'Pick a reason.');
  end if;
  if length(coalesce(v_note, '')) > 300 then perform private.fail('invalid_input', 'Keep the note to 300 characters.'); end if;
  if p_reason = 'other' and length(coalesce(v_note, '')) < 5 then
    perform private.fail('invalid_input', 'Say what’s wrong, so the store can fix it.');
  end if;

  update public.listings
     set status = 'rejected',
         rejection_reason = p_reason,
         rejection_note = v_note,
         caution_fee_status = case when caution_fee_status = 'held' then 'kept' else caution_fee_status end
   where id = p_listing_id;
end $$;

-- Takes a rejected listing back to review with the store's fixed details, on the
-- same row: same product code, same draw seed (no ticket has ever been sold on it).
-- Checks are the same as create_listing and create_product. The caution fee was
-- paid on the first send, so it goes back on hold rather than being charged again.
create function public.resubmit_listing(p_listing_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_merchant public.merchants;
  l public.listings;
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
begin
  select m.* into v_merchant from public.merchants m where m.id = private.my_merchant_id();
  if not found then perform private.fail('forbidden', 'This account isn’t linked to a store.'); end if;
  if not v_merchant.verified then perform private.fail('forbidden', 'Your store hasn’t been verified yet.'); end if;

  select * into l from public.listings where id = p_listing_id and merchant_id = v_merchant.id for update;
  if not found then perform private.fail('not_found', 'That listing doesn’t exist.'); end if;
  if l.status <> 'rejected' then perform private.fail('invalid_input', 'Only rejected listings can be sent again.'); end if;

  if v_category is null or v_category not in ('Phones', 'Electronics', 'Home', 'Cars', 'Fashion') then v_errors := array_append(v_errors, 'Pick a category.'); end if;
  if cardinality(v_images) > 4 or exists (select 1 from unnest(v_images) u where u !~ '^(https://|/assets/)') then
    v_errors := array_append(v_errors, 'Upload up to 4 photos.');
  end if;
  if v_title = '' then v_errors := array_append(v_errors, 'Give the item a name.'); end if;

  if l.kind = 'product' then
    if v_price is null or v_price < 10000 then v_errors := array_append(v_errors, 'Set a price of at least ₦100.'); end if;
    if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

    update public.listings
       set title = v_title, description = v_description, category = v_category, images = v_images, price_kobo = v_price,
           fee_bps = private.platform_fee_bps(v_price), status = 'pending_review', closes_at = now(),
           rejection_reason = null, rejection_note = null
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

  -- For a shared pickup, the settle_pickup_fee trigger then has the last word on the fee's status.
  update public.listings
     set title = v_title, description = v_description, category = v_category, images = v_images,
         price_kobo = v_price, ticket_price_kobo = v_ticket, buyer_ticket_price_kobo = v_buyer_ticket,
         ticket_count = v_ticket_count, fee_mode = v_fee_mode, fee_bps = v_fee_bps,
         unsold_policy = v_unsold, fallback_price_kobo = case when v_unsold = 'convert_to_sale' then v_fallback end,
         duration_days = v_duration, closes_at = now() + make_interval(days => v_duration),
         status = 'pending_review', caution_fee_kobo = v_fee, caution_fee_status = 'held',
         rejection_reason = null, rejection_note = null
   where id = l.id;

  insert into public.listing_handovers (listing_id, method, address, contact_phone, date, slot, lat, lng)
  values (l.id, case when v_category = 'Cars' then 'inspection' else 'pickup' end, v_address, v_phone, v_date, v_slot, v_lat, v_lng)
  on conflict (listing_id) do update
    set method = excluded.method, address = excluded.address, contact_phone = excluded.contact_phone,
        date = excluded.date, slot = excluded.slot, lat = excluded.lat, lng = excluded.lng;
end $$;

revoke all on function public.reject_listing(uuid, text, text), public.resubmit_listing(uuid, jsonb) from public, anon;
grant execute on function public.reject_listing(uuid, text, text), public.resubmit_listing(uuid, jsonb) to authenticated;
