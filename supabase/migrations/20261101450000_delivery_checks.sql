-- The rider checks an item against its listing before leaving the seller, and the buyer
-- checks it at the door. Either can fail it: the buyer is refunded straight away with a
-- small credit, and the seller is charged. Rules mirror src/domain/deliveryChecks.ts.

alter table public.orders
  -- A seller who confirms has this long to make it ready for a rider.
  add column ready_by timestamptz,
  add column collected_at timestamptz,
  add column collection_photos text[],
  add column collection_problems text[],
  add column refusal_photo text,
  add column return_state text check (return_state in ('returning', 'returned')),
  add column return_photo text,
  add column returned_at timestamptz;

-- Riders already carrying something have collected it.
update public.orders set collected_at = coalesce(rider_assigned_at, now()) where status in ('dispatched', 'delivered') and rider_id is not null;

alter table public.orders drop constraint orders_cancel_reason_check;
alter table public.orders add constraint orders_cancel_reason_check check (cancel_reason in ('out_of_stock', 'damaged', 'cant_send', 'other', 'not_confirmed', 'not_sent', 'failed_check', 'refused_wrong', 'refused_damaged'));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'draw_sold_out', 'draw_won', 'draw_lost',
  'saved_almost_sold', 'saved_closing_soon', 'saved_relisted', 'saved_back_on_sale', 'saved_price_drop',
  'store_new_order', 'store_listing_approved', 'store_listing_rejected', 'store_draw_sold_out',
  'store_winner_picked', 'store_draw_closing', 'store_pickup_tomorrow', 'store_new_message',
  'store_payout_sent', 'store_bank_changed',
  'store_price_approved', 'store_price_rejected',
  'order_cancelled',
  'store_order_confirm_soon', 'store_order_expired',
  'store_order_failed', 'store_suspended'
));

alter table public.merchants add column suspended_at timestamptz;

-- A charge is a negative line, due at once, which comes off the seller's next payout.
alter table public.payouts drop constraint payouts_kind_check;
alter table public.payouts add constraint payouts_kind_check check (kind in ('sale', 'draw', 'caution_fee', 'charge'));
alter table public.payouts drop constraint payouts_amount_kobo_check;
alter table public.payouts add constraint payouts_amount_kobo_check check ((kind = 'charge' and amount_kobo < 0) or (kind <> 'charge' and amount_kobo > 0));
create unique index payouts_one_charge_per_order on public.payouts (order_id) where kind = 'charge';

-- Riders can add photos, only in their own folder.
do $$
begin
  if to_regclass('storage.objects') is not null then
    create policy "riders upload delivery photos" on storage.objects for insert to authenticated
      with check (
        bucket_id = 'listing-photos' and (storage.foldername(name))[1] = 'riders' and (storage.foldername(name))[2] = (select auth.uid())::text
        and exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'delivery')
      );
  end if;
end $$;

-- deliveryChecks.ts photosError.
create function private.check_delivery_photos(p_photos text[]) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if coalesce(cardinality(p_photos), 0) < 1 or cardinality(p_photos) > 3 or exists (select 1 from unnest(p_photos) u where u !~ '^(https://|/assets/)') then
    perform private.fail('invalid_input', 'Add 1 to 3 photos.');
  end if;
end $$;

-- The seller's fault, so: their charge, the buyer's apology, and suspension if it keeps happening.
-- deliveryChecks.ts FAILURE_CHARGE_KOBO, APOLOGY_CREDIT_KOBO, SUSPEND_AFTER_FAILURES.
create function private.penalise_seller(p_order uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  insert into public.payouts (merchant_id, listing_id, order_id, kind, amount_kobo, status, due_at)
  values (o.merchant_id, o.listing_id, o.id, 'charge', -250000, 'due', now());
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  values (o.user_id, 'store_credit', 0, 50000, 'Sorry about your order', o.listing_id);
  perform private.notify_shop(o.merchant_id, 'store_order_failed', o.listing_id);

  if (select count(*) from public.orders
       where merchant_id = o.merchant_id and cancel_reason in ('failed_check', 'refused_wrong', 'refused_damaged') and cancelled_at >= now() - interval '30 days') >= 3
     and exists (select 1 from public.merchants where id = o.merchant_id and suspended_at is null) then
    update public.merchants set suspended_at = now() where id = o.merchant_id;
    update public.listings set status = 'paused' where merchant_id = o.merchant_id and kind = 'product' and status = 'for_sale';
    perform private.notify_shop(o.merchant_id, 'store_suspended', null);
  end if;
end $$;

create function public.pass_collection(p_order_id uuid, p_photos text[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  perform private.check_delivery_photos(p_photos);
  update public.orders set collected_at = now(), collection_photos = p_photos
   where id = p_order_id and rider_id = v_uid and status = 'dispatched' and collected_at is null;
  if not found then perform private.fail('invalid_input', 'Only deliveries you’re about to collect can be checked.'); end if;
end $$;

create function public.fail_collection(p_order_id uuid, p_problems text[], p_note text, p_photos text[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  o public.orders;
  v_problems text[] := coalesce(p_problems, '{}');
begin
  select * into o from public.orders where id = p_order_id and rider_id = v_uid and status = 'dispatched' and collected_at is null;
  if not found then perform private.fail('invalid_input', 'Only deliveries you’re about to collect can be checked.'); end if;
  if o.is_prize then perform private.fail('invalid_input', 'Won items aren’t checked here. Contact DrawMart.'); end if;
  if cardinality(v_problems) = 0 or not v_problems <@ array['wrong_item', 'wrong_quantity', 'damaged', 'wont_power_on', 'no_item'] then
    perform private.fail('invalid_input', 'Pick what’s wrong.');
  end if;
  if length(btrim(coalesce(p_note, ''))) > 300 then perform private.fail('invalid_input', 'Keep the note to 300 characters.'); end if;
  -- Without an item, there's nothing to photograph.
  if not (v_problems = array['no_item'] and coalesce(cardinality(p_photos), 0) = 0) then perform private.check_delivery_photos(p_photos); end if;

  perform private.cancel_order_now(o.id, 'failed_check', p_note);
  update public.orders set collection_problems = v_problems, collection_photos = p_photos where id = o.id;
  perform private.penalise_seller(o.id);
end $$;

-- Needs the buyer's PIN, so a rider can't claim a refusal that didn't happen. Like
-- confirm_delivery, a wrong PIN returns a result, because raising would undo the count.
create function public.refuse_delivery(p_order_id uuid, p_pin text, p_reason text, p_note text, p_photo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_max constant int := 5;
  p private.order_pins;
  v_prize boolean;
  v_attempts int;
  v_locked timestamptz;
begin
  select pins.*  into p
    from private.order_pins pins join public.orders o on o.id = pins.order_id
   where o.id = p_order_id and o.rider_id = v_uid and o.status = 'dispatched' and o.collected_at is not null
     for update of pins;
  if not found then perform private.fail('invalid_input', 'Only deliveries you’re carrying can be refused.'); end if;
  select is_prize into v_prize from public.orders where id = p_order_id;
  if v_prize then perform private.fail('invalid_input', 'Won items can’t be refused here. Contact DrawMart.'); end if;
  if p_reason is null or p_reason not in ('refused_wrong', 'refused_damaged') then perform private.fail('invalid_input', 'Pick why it’s being refused.'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then perform private.fail('invalid_input', 'Enter the buyer’s 6-digit PIN.'); end if;
  perform private.check_delivery_photos(array[p_photo]);
  if length(btrim(coalesce(p_note, ''))) > 300 then perform private.fail('invalid_input', 'Keep the note to 300 characters.'); end if;

  if p.locked_until > now() then
    return jsonb_build_object('confirmed', false, 'attemptsLeft', 0, 'lockedUntil', p.locked_until);
  end if;

  if p_pin = p.pin then
    perform private.cancel_order_now(p_order_id, p_reason, p_note);
    update public.orders set refusal_photo = p_photo, return_state = 'returning' where id = p_order_id;
    perform private.penalise_seller(p_order_id);
    return jsonb_build_object('confirmed', true, 'attemptsLeft', 0, 'lockedUntil', null);
  end if;

  v_attempts := case when p.locked_until is not null then 1 else p.attempts + 1 end;
  v_locked := case when v_attempts >= v_max then now() + interval '30 minutes' end;
  update private.order_pins set attempts = v_attempts, locked_until = v_locked where order_id = p_order_id;
  return jsonb_build_object('confirmed', false, 'attemptsLeft', greatest(v_max - v_attempts, 0), 'lockedUntil', v_locked);
end $$;

create function public.complete_return(p_order_id uuid, p_photo text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  perform private.check_delivery_photos(array[p_photo]);
  update public.orders set return_state = 'returned', return_photo = p_photo, returned_at = now()
   where id = p_order_id and rider_id = v_uid and return_state = 'returning';
  if not found then perform private.fail('invalid_input', 'Only items you’re taking back can be returned.'); end if;
end $$;

create function public.lift_suspension(p_merchant_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.merchants set suspended_at = null where id = p_merchant_id and suspended_at is not null;
  if not found then perform private.fail('invalid_input', 'This seller isn’t suspended.'); end if;
end $$;

-- Last 30 days, for admins. A suspended seller shows even with no recent orders.
create or replace function public.merchant_cancel_rates() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('merchantId', m.id, 'merchantName', m.name, 'orders', coalesce(x.orders, 0), 'cancelled', coalesce(x.cancelled, 0), 'failed', coalesce(x.failed, 0), 'suspended', m.suspended_at is not null))
    from public.merchants m
    left join (
      select merchant_id, count(*)::int as orders, count(*) filter (where status = 'cancelled')::int as cancelled,
             count(*) filter (where cancel_reason in ('failed_check', 'refused_wrong', 'refused_damaged'))::int as failed
        from public.orders
       where not is_prize and created_at >= now() - interval '30 days'
       group by merchant_id
    ) x on x.merchant_id = m.id
    where x.merchant_id is not null or m.suspended_at is not null
  ), '[]'::jsonb);
end $$;

revoke execute on function private.check_delivery_photos(text[]), private.penalise_seller(uuid) from public, anon, authenticated;
revoke all on function public.pass_collection(uuid, text[]), public.fail_collection(uuid, text[], text, text[]), public.refuse_delivery(uuid, text, text, text, text), public.complete_return(uuid, text), public.lift_suspension(uuid) from public, anon;
grant execute on function public.pass_collection(uuid, text[]), public.fail_collection(uuid, text[], text, text[]), public.refuse_delivery(uuid, text, text, text, text), public.complete_return(uuid, text), public.lift_suspension(uuid) to authenticated;

-- Same as before: a suspended shop can't list.
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

  -- DrawMart sets the fee from the item's value; whatever the client sends is ignored.
  v_fee_bps := private.platform_fee_bps(v_price);

  insert into public.listings (
    package_size, stock, kind, merchant_id, title, description, category, images, price_kobo, ticket_price_kobo, buyer_ticket_price_kobo,
    ticket_count, fee_mode, fee_bps, unsold_policy, duration_days, status, caution_fee_kobo, caution_fee_status, commitment, closes_at)
  values (
    v_size, v_stock, 'product', v_merchant.id, v_title, btrim(coalesce(p ->> 'description', '')), v_category, v_images, v_price, 0, 0,
    0, 'seller', v_fee_bps, 'refund', 0, 'pending_review', 0, 'none', '', now())
  returning id into v_id;
  return v_id;
end $$;

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
  if v_merchant.suspended_at is not null then perform private.fail('forbidden', 'Your shop is suspended. Contact DrawMart.'); end if;
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

-- Same as before: a suspended shop can't put things back on sale.
create or replace function public.resume_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare l public.listings := private.my_listing_for_update(p_listing_id);
begin
  if exists (select 1 from public.merchants where id = l.merchant_id and suspended_at is not null) then perform private.fail('forbidden', 'Your shop is suspended. Contact DrawMart.'); end if;
  if l.status <> 'paused' then perform private.fail('invalid_input', 'Only paused products can be resumed.'); end if;
  update public.listings set status = case when stock > 0 then 'for_sale' else 'sold' end where id = l.id;
end $$;

-- Same as before: nor can an admin approve for it by accident.
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
  -- A raffle's clock starts when the draw goes live.
  update public.listings
     set reviewed_price_kobo = price_kobo,
         status = case when kind = 'product' then 'for_sale' else 'live' end,
         closes_at = case when kind = 'product' then closes_at else now() + make_interval(days => duration_days) end,
         was_rejected = false
   where id = p_listing_id;
end $$;

-- Same as before: taking an order means going to collect it, except won items, which come from DrawMart.
create or replace function public.take_delivery(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  update public.orders set rider_id = v_uid, rider_assigned_at = now(), collected_at = case when is_prize then now() end
   where id = p_order_id and status = 'dispatched' and rider_id is null;
  if not found then perform private.fail('invalid_input', 'Another rider has taken this delivery.'); end if;
end $$;

-- Same as before, starting the check again for the next rider.
create or replace function public.release_delivery(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  update public.orders set rider_id = null, rider_assigned_at = null, collected_at = null, collection_photos = null
   where id = p_order_id and status = 'dispatched' and rider_id = v_uid;
  if not found then perform private.fail('invalid_input', 'Only deliveries you’re carrying can be handed back.'); end if;
end $$;

-- Same as before: not until it's collected.
create or replace function public.confirm_delivery(p_order_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_max constant int := 5;
  p private.order_pins;
  v_attempts int;
  v_locked timestamptz;
begin
  select pins.* into p
    from private.order_pins pins join public.orders o on o.id = pins.order_id
   where o.id = p_order_id and o.rider_id = v_uid and o.status = 'dispatched' and o.collected_at is not null
     for update of pins;
  if not found then perform private.fail('invalid_input', 'Only deliveries you’re carrying can be confirmed.'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then perform private.fail('invalid_input', 'Enter the buyer’s 6-digit PIN.'); end if;

  if p.locked_until > now() then
    return jsonb_build_object('confirmed', false, 'attemptsLeft', 0, 'lockedUntil', p.locked_until);
  end if;

  if p_pin = p.pin then
    update public.orders set status = 'delivered', delivered_at = now() where id = p_order_id;
    delete from private.order_pins where order_id = p_order_id;
    return jsonb_build_object('confirmed', true, 'attemptsLeft', 0, 'lockedUntil', null);
  end if;

  -- A lock that's run out starts the count again.
  v_attempts := case when p.locked_until is not null then 1 else p.attempts + 1 end;
  v_locked := case when v_attempts >= v_max then now() + interval '30 minutes' end;
  update private.order_pins set attempts = v_attempts, locked_until = v_locked where order_id = p_order_id;
  return jsonb_build_object('confirmed', false, 'attemptsLeft', greatest(v_max - v_attempts, 0), 'lockedUntil', v_locked);
end $$;

-- Same as before: the buyer's details only once the item has passed, and the way back for a refused one.
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
        case when o.handled_by = 'drawmart'
          then jsonb_build_object('name', 'DrawMart escrow', 'area', 'Lagos')
          else jsonb_build_object('name', m.name, 'area', m.area) end as "collectFrom",
        case when pp.id is not null then jsonb_build_object(
          'id', pp.id, 'name', pp.name, 'area', pp.area, 'address', pp.address, 'hours', pp.hours,
          'location', jsonb_build_object('lat', pp.lat, 'lng', pp.lng)) end as "pickupPoint",
        case when o.rider_id = v_uid and o.status = 'dispatched' and o.collected_at is not null then jsonb_build_object(
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
      where (o.status = 'dispatched' and o.rider_id is null)
         or (o.rider_id = v_uid and (o.status in ('dispatched', 'delivered') or o.return_state = 'returning'))
      order by o.delivered_at desc nulls first
      limit 200
    ) x
  );
end $$;

-- Same as before, starting the clock to make it ready.
create or replace function public.seller_confirm_order(p_order_id uuid, p_photo text) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.orders;
begin
  perform private.require_user();
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.handled_by <> 'store' or o.merchant_id is distinct from private.my_merchant_id() then
    perform private.fail('not_found', 'That order doesn’t exist.');
  end if;
  if o.status <> 'paid' or o.confirm_by is null then perform private.fail('invalid_input', 'This order doesn’t need confirming.'); end if;
  if o.confirmed_at is null and o.confirm_by <= now() then perform private.fail('invalid_input', 'The time to confirm has passed, so this order is being cancelled.'); end if;
  if coalesce(p_photo, '') !~ '^(https://|/assets/)' then perform private.fail('invalid_input', 'Add a photo of the item.'); end if;
  update public.orders set confirmed_at = now(), confirm_photo = p_photo, ready_by = coalesce(ready_by, private.add_confirm_time(now(), interval '12 hours')) where id = o.id;
end $$;

-- Same as before, for failed checks and refusals.
create or replace function private.cancel_order_now(p_order_id uuid, p_reason text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  l public.listings;
  p private.order_payments;
  v_stock int;
  v_other uuid;
begin
  -- Same lock order as checkout: the listing, then what hangs off it.
  select * into o from public.orders where id = p_order_id;
  select * into l from public.listings where id = o.listing_id for update;
  select * into o from public.orders where id = p_order_id for update;
  if o.is_prize then perform private.fail('invalid_input', 'Won items can’t be cancelled here. Contact DrawMart.'); end if;
  -- A failed check or a refusal happens once a rider has it; everything else is before that.
  if o.status <> 'paid' and not (o.status = 'dispatched' and p_reason in ('failed_check', 'refused_wrong', 'refused_damaged')) then
    perform private.fail('invalid_input', 'Only orders that aren’t ready for a rider yet can be cancelled.');
  end if;

  update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, cancel_note = nullif(btrim(coalesce(p_note, '')), '') where id = o.id;
  delete from private.order_pins where order_id = o.id;
  delete from public.payouts where order_id = o.id and status = 'waiting';

  select * into p from private.order_payments where order_id = o.id;
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  values (o.user_id, 'order_refund', coalesce(p.cash_kobo, o.price_kobo), coalesce(p.credit_kobo, 0), 'Refund · ' || l.title, l.id);

  -- One fee covers everything from this seller in this checkout. If something's still
  -- coming, the fee moves to it; if this was the last, it comes back too.
  if o.delivery_fee_kobo > 0 then
    select id into v_other from public.orders
     where checkout_id = o.checkout_id and merchant_id = o.merchant_id and id <> o.id and status <> 'cancelled' and not is_prize
     limit 1;
    if v_other is not null then
      update public.orders set delivery_fee_kobo = delivery_fee_kobo + o.delivery_fee_kobo where id = v_other;
      update private.order_payments set fee_cash_kobo = fee_cash_kobo + p.fee_cash_kobo, fee_credit_kobo = fee_credit_kobo + p.fee_credit_kobo where order_id = v_other;
      update public.orders set delivery_fee_kobo = 0 where id = o.id;
    elsif p.fee_cash_kobo + p.fee_credit_kobo > 0 then
      insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
      values (o.user_id, 'order_refund', p.fee_cash_kobo, p.fee_credit_kobo, 'Delivery refund · ' || l.title, l.id);
    end if;
  end if;

  v_stock := case when p_reason = 'out_of_stock' then 0 when p_reason in ('damaged', 'failed_check', 'refused_wrong', 'refused_damaged') then l.stock else l.stock + o.quantity end;
  update public.listings
     set stock = v_stock,
         status = case when p_reason in ('not_confirmed', 'not_sent') and kind = 'product' and status in ('for_sale', 'sold') then 'paused' when status = 'for_sale' and v_stock = 0 then 'sold' when status = 'sold' and v_stock > 0 then 'for_sale' else status end
   where id = l.id;

  insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_cancelled', l.id);
end $$;

-- Same as before, also cancelling orders confirmed but never made ready.
create or replace function private.order_confirm_deadlines() returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    update public.orders set confirm_reminded_at = now()
     where status = 'paid' and confirmed_at is null and confirm_reminded_at is null and confirm_by > now() and confirm_by <= private.add_confirm_time(now(), interval '3 hours')
    returning merchant_id, listing_id
  loop
    perform private.notify_shop(r.merchant_id, 'store_order_confirm_soon', r.listing_id);
  end loop;

  for r in select id, merchant_id, listing_id from public.orders where status = 'paid' and confirmed_at is null and confirm_by <= now() loop
    begin
      perform private.cancel_order_now(r.id, 'not_confirmed', null);
      perform private.notify_shop(r.merchant_id, 'store_order_expired', r.listing_id);
    exception when others then
      raise warning 'order_confirm_deadlines %: %', r.id, sqlerrm;
    end;
  end loop;

  -- Confirmed, but never made ready for a rider.
  for r in select id, merchant_id, listing_id from public.orders where status = 'paid' and ready_by <= now() loop
    begin
      perform private.cancel_order_now(r.id, 'not_sent', null);
      perform private.notify_shop(r.merchant_id, 'store_order_expired', r.listing_id);
    exception when others then
      raise warning 'order_confirm_deadlines %: %', r.id, sqlerrm;
    end;
  end loop;
end $$;

-- Same as before, with failed orders and suspension.
create or replace function private.push_for_notification() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_title text;
  v_batch uuid;
  v_category text;
  v_home text;
begin
  select title, pickup_batch_id, category into v_title, v_batch, v_category from public.listings where id = new.listing_id;
  -- Individual sellers work from /sell in the buyer app.
  select case when role = 'store' then '/store' else '/sell' end into v_home from public.profiles where id = new.user_id;
  case new.kind
    when 'draw_won' then
      perform private.queue_push(new.user_id, 'wins', 'You won a draw', v_title || '. Open DrawMart to arrange it.', '/draws/' || new.listing_id, 'draw-' || new.listing_id);
    when 'draw_lost' then
      perform private.queue_push(new.user_id, 'draw_results', 'Draw result', 'The result for ' || v_title || ' is in.', '/draws/' || new.listing_id, 'draw-' || new.listing_id);
    when 'draw_sold_out' then
      perform private.queue_push(new.user_id, 'draw_results', 'All tickets sold', v_title || ' has sold out. We’ll tell you when the winner is announced.', '/listings/' || new.listing_id, 'draw-' || new.listing_id);
    when 'saved_almost_sold' then
      perform private.queue_push(new.user_id, 'saved_items', 'A draw you saved', '90% of the tickets for ' || v_title || ' have sold.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'saved_closing_soon' then
      perform private.queue_push(new.user_id, 'saved_items', 'A draw you saved', v_title || ' closes within 24 hours.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'saved_relisted' then
      perform private.queue_push(new.user_id, 'saved_items', 'An item you saved', 'The store has listed ' || v_title || ' again as a new draw.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'saved_back_on_sale' then
      perform private.queue_push(new.user_id, 'saved_items', 'An item you saved', v_title || ' is on sale.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'saved_price_drop' then
      perform private.queue_push(new.user_id, 'saved_items', 'An item you saved', v_title || ' now costs less.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'store_new_order' then
      perform private.queue_push(new.user_id, 'store_orders', 'New order', v_title || ' has been bought. Get it ready for a rider.', v_home || '?tab=orders', 'order-' || new.listing_id);
    when 'store_listing_approved' then
      perform private.queue_push(new.user_id, 'store_listings', 'Listing approved', v_title || ' is now live for buyers.', v_home, 'review-' || new.listing_id);
    when 'store_listing_rejected' then
      perform private.queue_push(new.user_id, 'store_listings', 'Listing not approved', 'See why ' || v_title || ' wasn’t approved, and fix it.', v_home || '?fix=' || new.listing_id, 'review-' || new.listing_id);
    when 'order_cancelled' then
      perform private.queue_push(new.user_id, 'orders', 'Order cancelled', v_title || ' was cancelled and you’ve been refunded.', '/tickets?view=orders', 'order-cancelled-' || new.id);
    when 'store_order_confirm_soon' then
      perform private.queue_push(new.user_id, 'store_orders', 'Confirm this order', 'Confirm ' || v_title || ' soon, or it will be cancelled.', v_home || '?tab=orders', 'order-confirm-' || new.id);
    when 'store_order_expired' then
      perform private.queue_push(new.user_id, 'store_orders', 'Order cancelled', v_title || ' wasn’t confirmed or made ready in time. The buyer was refunded and the item is paused.', v_home || '?tab=orders', 'order-expired-' || new.id);
    when 'store_order_failed' then
      perform private.queue_push(new.user_id, 'store_orders', 'An order failed', v_title || ' failed a check or was refused. The buyer was refunded and you’ve been charged.', v_home || '?tab=orders', 'order-failed-' || new.id);
    when 'store_suspended' then
      perform private.queue_push(new.user_id, 'store_orders', 'Your shop is suspended', 'Too many orders have failed. Contact DrawMart.', v_home, 'store-suspended');
    when 'store_price_approved' then
      perform private.queue_push(new.user_id, 'store_listings', 'Price approved', 'The new price for ' || v_title || ' is live.', v_home, 'review-' || new.listing_id);
    when 'store_price_rejected' then
      perform private.queue_push(new.user_id, 'store_listings', 'Price not approved', v_title || ' stays at its current price.', v_home, 'review-' || new.listing_id);
    when 'store_draw_sold_out' then
      perform private.queue_push(new.user_id, 'store_draws', 'All tickets sold', v_title || ' has sold out.', v_home, 'store-draw-' || new.listing_id);
    when 'store_winner_picked' then
      perform private.queue_push(new.user_id, 'store_draws', 'Winner announced', 'The draw for ' || v_title || ' has run.', v_home, 'store-draw-' || new.listing_id);
    when 'store_draw_closing' then
      perform private.queue_push(new.user_id, 'store_draws', 'Draw closing soon', v_title || ' closes within 24 hours and hasn’t sold out.', v_home, 'store-draw-' || new.listing_id);
    when 'store_pickup_tomorrow' then
      perform private.queue_push(new.user_id, 'store_pickups',
        case when v_category = 'Cars' then 'Inspection tomorrow' else 'Pickup tomorrow' end,
        -- A shared pickup's items collapse into one notification, so it can't name just one.
        case when v_batch is not null then 'Have the items in your shared pickup ready.' else 'Have ' || v_title || ' ready.' end,
        v_home, 'pickup-' || coalesce(v_batch, new.listing_id));
    when 'store_payout_sent' then
      perform private.queue_push(new.user_id, 'store_payouts', 'Payout sent', 'We’ve sent a payout to your bank account.', case when v_home = '/store' then '/store/payouts' else '/sell?tab=payouts' end, 'payout-' || new.id);
    when 'store_bank_changed' then
      -- Not a kind anyone can switch off: it's how they find out if it wasn't them.
      perform private.queue_push(new.user_id, 'security', 'Bank account changed', 'Your payout account was changed. If this wasn’t you, contact DrawMart now.', case when v_home = '/store' then '/store/payouts' else '/sell?tab=payouts' end, 'bank-' || new.id);
    -- store_new_message: push_for_message sends this one, since it knows the conversation.
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, refusing to send a negative amount.
create or replace function public.mark_payouts_paid(p_ids uuid[], p_reference text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_reference text := btrim(coalesce(p_reference, ''));
  v_merchants uuid[];
  a public.payout_accounts;
begin
  perform private.require_admin();
  -- Locked, so paying twice from two screens fails on the second.
  perform 1 from public.payouts where id = any(p_ids) order by id for update;
  if coalesce(cardinality(p_ids), 0) = 0
     or (select count(*) from public.payouts where id = any(p_ids) and status = 'due') <> cardinality(p_ids) then
    perform private.fail('invalid_input', 'Only payouts that are due can be marked paid.');
  end if;
  v_merchants := array(select distinct merchant_id from public.payouts where id = any(p_ids));
  if cardinality(v_merchants) <> 1 then perform private.fail('invalid_input', 'Mark one seller’s payouts at a time.'); end if;

  select * into a from public.payout_accounts where merchant_id = v_merchants[1];
  if not found then perform private.fail('invalid_input', 'This seller hasn’t added a bank account yet.'); end if;
  if a.payable_from > now() then perform private.fail('invalid_input', 'This seller changed their bank account recently, so payouts are on hold.'); end if;
  if length(v_reference) < 3 then perform private.fail('invalid_input', 'Enter the transfer’s reference.'); end if;

  -- payouts.ts markPaidError. Charges come off what's due, and only a positive amount can be sent.
  if (select sum(amount_kobo) from public.payouts where id = any(p_ids)) <= 0 then
    perform private.fail('invalid_input', 'This seller’s charges are more than what’s due, so there’s nothing to send yet.');
  end if;

  update public.payouts
     set status = 'paid', paid_at = now(), reference = v_reference, paid_by = v_uid,
         paid_to = a.bank_name || ' •••• ' || right(a.account_number, 4)
   where id = any(p_ids);
  perform private.notify_shop(v_merchants[1], 'store_payout_sent', null);
end $$;
