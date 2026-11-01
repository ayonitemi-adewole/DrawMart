-- A product can have several in stock, so one listing can have many orders. Each order
-- takes one, and it's sold out at zero. Draws stay one item each: a draw that ended unsold
-- sells its one item at a fixed price, and a won item doesn't touch stock.
-- Rules mirror src/domain/orders.ts.

alter table public.listings add column stock int not null default 1 check (stock >= 0);
update public.listings set stock = 0 where status = 'sold';
alter table public.listings add constraint listings_on_sale_has_stock check (status <> 'for_sale' or stock > 0);

-- One listing, many orders. A won item can still only be arranged once.
alter table public.orders drop constraint orders_listing_id_key;
create index orders_listing_idx on public.orders (listing_id);
create unique index orders_one_prize_per_listing on public.orders (listing_id) where is_prize;

-- orders.ts stockError. Null means it isn't a usable number; a missing one gets the default.
create function private.parse_stock(p jsonb, p_default int) returns int
language sql immutable set search_path = ''
as $$
  select case
    when p ->> 'stock' is null then p_default
    when p ->> 'stock' ~ '^[0-9]{1,5}$' and (p ->> 'stock')::int between 1 and 10000 then (p ->> 'stock')::int
  end
$$;
revoke execute on function private.parse_stock(jsonb, int) from public, anon, authenticated;

-- Same as before, taking one from stock rather than selling the whole listing.
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
      -- orders.ts takeStock. The row has been locked since the first loop, so two buyers can't both get the last one.
      update public.listings set stock = stock - 1, status = case when stock <= 1 then 'sold' else status end where id = l.id;
    end if;
  end loop;

  delete from public.cart_items where user_id = v_uid and listing_id = any (v_ids);
  return to_jsonb(v_orders);
end $$;

-- Same as before: having bought one doesn't stop a buyer buying another. A prize still only goes once.
create or replace function public.add_to_cart(p_listing_id uuid) returns void
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
  insert into public.cart_items (user_id, listing_id) values (v_uid, l.id) on conflict do nothing;
end $$;

-- Same as before, with the quantity.
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
begin
  select m.* into v_merchant from public.merchants m where m.id = private.my_merchant_id();
  if not found then perform private.fail('forbidden', 'Get verified as a seller, or sign in with a store account, to list products.'); end if;
  if not v_merchant.verified then perform private.fail('forbidden', 'Your store hasn’t been verified yet.'); end if;

  if v_title = '' then v_errors := array_append(v_errors, 'Give the item a name.'); end if;
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
    stock, kind, merchant_id, title, description, category, images, price_kobo, ticket_price_kobo, buyer_ticket_price_kobo,
    ticket_count, fee_mode, fee_bps, unsold_policy, duration_days, status, caution_fee_kobo, caution_fee_status, commitment, closes_at)
  values (
    v_stock, 'product', v_merchant.id, v_title, btrim(coalesce(p ->> 'description', '')), v_category, v_images, v_price, 0, 0,
    0, 'seller', v_fee_bps, 'refund', 0, 'pending_review', 0, 'none', '', now())
  returning id into v_id;
  return v_id;
end $$;

-- Same as before, with the quantity. Without one, an older app leaves it alone.
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
begin
  if v_category is null or v_category not in ('Phones', 'Electronics', 'Home', 'Cars', 'Fashion') then v_errors := array_append(v_errors, 'Pick a category.'); end if;
  if cardinality(v_images) > 4 or exists (select 1 from unnest(v_images) u where u !~ '^(https://|/assets/)') then
    v_errors := array_append(v_errors, 'Upload up to 4 photos.');
  end if;
  if v_title = '' then v_errors := array_append(v_errors, 'Give the item a name.'); end if;


  if l.kind = 'product' then
    if v_price is null or v_price < 10000 then v_errors := array_append(v_errors, 'Set a price of at least ₦100.'); end if;
    if v_stock is null then v_errors := array_append(v_errors, 'Enter how many you have, from 1 to 10,000.'); end if;
    if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

    update public.listings
       set title = v_title, description = v_description, category = v_category, images = v_images, price_kobo = v_price, stock = v_stock,
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

-- Only kept for older app versions. Goes through checkout, so it can't sell a whole listing's stock.
create or replace function public.buy_now(p_listing_id uuid, p_address text, p_phone text, p_lat double precision, p_lng double precision) returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  return (public.checkout(jsonb_build_object(
    'listingIds', jsonb_build_array(p_listing_id), 'fulfilment', 'delivery',
    'address', p_address, 'phone', p_phone, 'lat', p_lat, 'lng', p_lng
  )) ->> 0)::uuid;
end $$;
