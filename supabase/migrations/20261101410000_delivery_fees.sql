-- Buyers pay for delivery at checkout: one fee per seller, by where it's coming from,
-- where it's going and the package size. Prices are placeholders admins can edit.
-- Rules mirror src/domain/deliveryFees.ts.

create table public.delivery_areas (
  id text primary key,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  keywords text[] not null,
  sort int not null
);
insert into public.delivery_areas (id, name, lat, lng, keywords, sort) values
  ('ikeja', 'Ikeja and Maryland', 6.59, 3.35, array['ikeja', 'maryland', 'ogba', 'ojota', 'gbagada', 'magodo', 'ketu', 'anthony'], 0),
  ('yaba', 'Yaba and Surulere', 6.5, 3.37, array['yaba', 'surulere', 'mushin', 'ebute', 'oshodi', 'isolo'], 1),
  ('vi', 'Victoria Island and Ikoyi', 6.43, 3.43, array['victoria', 'ikoyi', 'oniru'], 2),
  ('island', 'Lagos Island', 6.455, 3.39, array['island', 'marina', 'obalende'], 3),
  ('lekki', 'Lekki and Ajah', 6.45, 3.54, array['lekki', 'ajah', 'chevron', 'sangotedo', 'ikate'], 4),
  ('ikorodu', 'Ikorodu', 6.62, 3.51, array['ikorodu'], 5),
  ('agege', 'Agege and Alimosho', 6.62, 3.3, array['agege', 'alimosho', 'iyana', 'egbeda', 'ikotun', 'iju'], 6),
  ('apapa', 'Apapa and Festac', 6.46, 3.3, array['apapa', 'festac', 'amuwo', 'satellite', 'ojo', 'ajegunle'], 7),
  ('badagry', 'Badagry', 6.42, 2.89, array['badagry'], 8),
  ('epe', 'Epe', 6.58, 3.98, array['epe'], 9);

-- One row per pair of areas, either way round. This is the price for a small package.
create table public.delivery_prices (
  area_a text not null references public.delivery_areas (id),
  area_b text not null references public.delivery_areas (id),
  price_kobo bigint not null check (price_kobo between 100000 and 500000),
  primary key (area_a, area_b),
  check (area_a <= area_b)
);
-- deliveryFees.ts placeholderPriceKobo.
insert into public.delivery_prices (area_a, area_b, price_kobo)
select a.id, b.id,
       least(350000, 100000 + floor(sqrt(power((a.lat - b.lat) * 111.32, 2) + power((a.lng - b.lng) * cos(radians(6.5)) * 111.32, 2)) * 0.6 + 0.5)::bigint * 10000)
  from public.delivery_areas a join public.delivery_areas b on a.id <= b.id;

create table public.delivery_size_extras (
  size text primary key check (size in ('small', 'medium', 'large')),
  extra_kobo bigint not null check (extra_kobo between 0 and 400000)
);
insert into public.delivery_size_extras (size, extra_kobo) values ('small', 0), ('medium', 50000), ('large', 150000);

alter table public.delivery_areas enable row level security;
alter table public.delivery_prices enable row level security;
alter table public.delivery_size_extras enable row level security;
create policy "anyone reads delivery areas" on public.delivery_areas for select using (true);
create policy "anyone reads delivery prices" on public.delivery_prices for select using (true);
create policy "anyone reads delivery extras" on public.delivery_size_extras for select using (true);
revoke all on public.delivery_areas, public.delivery_prices, public.delivery_size_extras from anon, authenticated;
grant select on public.delivery_areas, public.delivery_prices, public.delivery_size_extras to anon, authenticated;

-- Where a seller's items leave from. An area, not an address, so it's fine on public merchants.
alter table public.merchants add column delivery_area text references public.delivery_areas (id);

-- deliveryFees.ts areaFromText.
create function private.area_from_text(p_text text) returns text
language sql stable set search_path = ''
as $$
  select coalesce((
    select a.id from public.delivery_areas a
     where exists (select 1 from unnest(a.keywords) k where lower(coalesce(p_text, '')) like '%' || k || '%')
     order by a.sort limit 1
  ), 'ikeja')
$$;

create function private.merchant_delivery_area() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.delivery_area is null then new.delivery_area := private.area_from_text(new.area); end if;
  return new;
end $$;
create trigger merchants_delivery_area before insert on public.merchants
  for each row execute function private.merchant_delivery_area();
update public.merchants set delivery_area = private.area_from_text(area);
alter table public.merchants alter column delivery_area set not null;

-- Null means the usual size for its category (deliveryFees.ts packageSizeOf).
alter table public.listings add column package_size text check (package_size in ('small', 'medium', 'large'));

create function private.package_size_of(p_size text, p_category text) returns text
language sql immutable set search_path = ''
as $$
  select coalesce(p_size, case p_category when 'Phones' then 'small' when 'Fashion' then 'small' when 'Electronics' then 'medium' else 'large' end)
$$;

-- deliveryFees.ts deliveryFeeKobo.
create function private.delivery_fee(p_from text, p_lat double precision, p_lng double precision, p_size text) returns bigint
language sql stable set search_path = ''
as $$
  select least(500000, coalesce((
    select pr.price_kobo from public.delivery_prices pr
     where pr.area_a = least(p_from, t.id) and pr.area_b = greatest(p_from, t.id)
  ), 500000) + coalesce((select e.extra_kobo from public.delivery_size_extras e where e.size = p_size), 0))
  from (
    select a.id from public.delivery_areas a
     order by power(a.lat - p_lat, 2) + power((a.lng - p_lng) * cos(radians(6.5)), 2), a.sort
     limit 1
  ) t
$$;

revoke execute on function private.area_from_text(text), private.merchant_delivery_area(), private.package_size_of(text, text), private.delivery_fee(text, double precision, double precision, text) from public, anon, authenticated;

alter table public.orders add column delivery_fee_kobo bigint not null default 0 check (delivery_fee_kobo >= 0);
alter table private.order_payments
  add column fee_cash_kobo bigint not null default 0 check (fee_cash_kobo >= 0),
  add column fee_credit_kobo bigint not null default 0 check (fee_credit_kobo >= 0);

alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check
  check (kind in ('topup', 'ticket_purchase', 'refund', 'store_credit', 'order_payment', 'order_refund', 'delivery_fee', 'adjustment'));

create function public.set_delivery_price(p_area_a text, p_area_b text, p_price_kobo bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_price_kobo is null or p_price_kobo not between 100000 and 500000 then perform private.fail('invalid_input', 'A delivery price must be from ₦1,000 to ₦5,000.'); end if;
  update public.delivery_prices set price_kobo = p_price_kobo where area_a = least(p_area_a, p_area_b) and area_b = greatest(p_area_a, p_area_b);
  if not found then perform private.fail('not_found', 'That area doesn’t exist.'); end if;
end $$;

create function public.set_delivery_size_extra(p_size text, p_extra_kobo bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_extra_kobo is null or p_extra_kobo not between 0 and 400000 then perform private.fail('invalid_input', 'An extra must be from ₦0 to ₦4,000.'); end if;
  update public.delivery_size_extras set extra_kobo = p_extra_kobo where size = p_size;
  if not found then perform private.fail('invalid_input', 'Pick a package size.'); end if;
end $$;

create function public.set_shop_delivery_area(p_area text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_merchant uuid := private.my_merchant_id();
begin
  perform private.require_user();
  if v_merchant is null then perform private.fail('forbidden', 'This account isn’t linked to a shop.'); end if;
  if not exists (select 1 from public.delivery_areas where id = p_area) then perform private.fail('invalid_input', 'Pick an area.'); end if;
  update public.merchants set delivery_area = p_area where id = v_merchant;
end $$;

revoke all on function public.set_delivery_price(text, text, bigint), public.set_delivery_size_extra(text, bigint), public.set_shop_delivery_area(text) from public, anon;
grant execute on function public.set_delivery_price(text, text, bigint), public.set_delivery_size_extra(text, bigint), public.set_shop_delivery_area(text) to authenticated;

-- Same as before, adding the delivery fee.
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
  v_fees jsonb;
  v_fee bigint;
  v_fee_credit bigint;
  v_to_lat double precision;
  v_to_lng double precision;
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

  -- deliveryFees.ts checkoutDeliveryFees: one fee per seller, for their largest package. Cars and won items don't pay.
  if v_fulfilment = 'pickup' then
    select lat, lng into v_to_lat, v_to_lng from public.pickup_points where id = v_point;
  else
    v_to_lat := v_lat;
    v_to_lng := v_lng;
  end if;
  select coalesce(jsonb_object_agg(x.id, private.delivery_fee(x.delivery_area, v_to_lat, v_to_lng, (array['small', 'medium', 'large'])[x.size_rank])), '{}'::jsonb) into v_fees
    from (
      select m.id, m.delivery_area, max(array_position(array['small', 'medium', 'large'], private.package_size_of(s.package_size, s.category))) as size_rank
        from public.listings s join public.merchants m on m.id = s.merchant_id
       where s.id = any (v_ids) and s.status = 'for_sale' and s.category <> 'Cars'
       group by m.id, m.delivery_area
    ) x;
  v_total := v_total + coalesce((select sum(value::bigint) from jsonb_each_text(v_fees)), 0);

  -- A seller can change a price at any time, so never charge one the buyer hasn't seen. Older apps don't send this.
  if p ->> 'expectedTotalKobo' is not null and (p ->> 'expectedTotalKobo')::bigint <> v_total then
    perform private.fail('invalid_input', 'A price has just changed. Check the new total.');
  end if;

  select coalesce(sum(cash_kobo), 0), coalesce(sum(credit_kobo), 0) into v_cash, v_credit from public.ledger_entries where user_id = v_uid;
  if v_cash + v_credit < v_total then perform private.fail('insufficient_funds'); end if;
  v_credit := greatest(v_credit, 0);

  for l in select * from public.listings where id = any (v_ids) order by id loop
    v_won := l.status = 'drawn';
    v_qty := private.order_quantity(p, l);
    v_price := v_qty * case when v_won then 0 when l.kind = 'product' then l.price_kobo else l.fallback_price_kobo end;
    v_fee := case when v_won then 0 else coalesce((v_fees ->> l.merchant_id::text)::bigint, 0) end;
    v_fees := v_fees - l.merchant_id::text;
    insert into public.orders (delivery_fee_kobo, quantity, listing_id, user_id, merchant_id, price_kobo, fee_kobo, delivery_address, delivery_phone, delivery_lat, delivery_lng,
                               fulfilment, pickup_point_id, is_prize, handled_by, checkout_id)
    values (v_fee, v_qty, l.id, v_uid, l.merchant_id, v_price, round(v_price * l.fee_bps / 10000.0)::bigint, v_address, v_phone, v_lat, v_lng,
            v_fulfilment, v_point, v_won, case when v_won and l.category <> 'Cars' then 'drawmart' else 'store' end, v_checkout)
    returning id into v_order;
    v_orders := array_append(v_orders, v_order);
    if not v_won then
      v_from_credit := least(v_credit, v_price);
      v_credit := v_credit - v_from_credit;
      insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
      values (v_uid, 'order_payment', -(v_price - v_from_credit), -v_from_credit, 'Bought · ' || l.title || case when v_qty > 1 then ' × ' || v_qty else '' end, l.id);
      v_fee_credit := least(v_credit, v_fee);
      v_credit := v_credit - v_fee_credit;
      if v_fee > 0 then
        insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
        values (v_uid, 'delivery_fee', -(v_fee - v_fee_credit), -v_fee_credit, 'Delivery · ' || l.title, l.id);
      end if;
      insert into private.order_payments (order_id, cash_kobo, credit_kobo, fee_cash_kobo, fee_credit_kobo)
      values (v_order, v_price - v_from_credit, v_from_credit, v_fee - v_fee_credit, v_fee_credit);
      -- orders.ts takeStock. The row has been locked since the first loop, so two buyers can't both get the last one.
      update public.listings set stock = stock - v_qty, status = case when stock <= v_qty then 'sold' else status end where id = l.id;
    end if;
  end loop;

  delete from public.cart_items where user_id = v_uid and listing_id = any (v_ids);
  return to_jsonb(v_orders);
end $$;

-- Same as before, dealing with the delivery fee too.
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
  if o.status <> 'paid' then perform private.fail('invalid_input', 'Only orders that aren’t ready for a rider yet can be cancelled.'); end if;

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

  v_stock := case p_reason when 'out_of_stock' then 0 when 'damaged' then l.stock else l.stock + o.quantity end;
  update public.listings
     set stock = v_stock,
         status = case when status = 'for_sale' and v_stock = 0 then 'sold' when status = 'sold' and v_stock > 0 then 'for_sale' else status end
   where id = l.id;

  insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_cancelled', l.id);
end $$;

-- Same as before, with a package size.
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

-- Same as before, with a package size.
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
