-- Store-funded discounts on regular products: a sale everyone gets, or a code the store
-- shares. Never on draws or tickets. The order is charged at the discounted price, so the
-- store pays for it and DrawMart's fee is worked out on what the buyer paid. One discount
-- per item: whichever saves the most. Rules mirror src/domain/discounts.ts.

create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  kind text not null check (kind in ('sale', 'code')),
  percent_off int check (percent_off between 1 and 90),
  amount_off_kobo bigint check (amount_off_kobo >= 10000),
  -- Upper case; unique across DrawMart, so a code means one thing.
  code text unique check (code ~ '^[A-Z0-9]{4,16}$'),
  max_uses int check (max_uses between 1 and 10000),
  uses int not null default 0,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check ((percent_off is null) <> (amount_off_kobo is null)),
  check ((kind = 'code') = (code is not null)),
  check (kind = 'code' or max_uses is null),
  check (ends_at > starts_at)
);
create index discounts_merchant_idx on public.discounts (merchant_id, created_at desc);

create table public.discount_listings (
  discount_id uuid not null references public.discounts (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  primary key (discount_id, listing_id)
);
create index discount_listings_listing_idx on public.discount_listings (listing_id);

-- One use of a code per buyer.
create table private.discount_redemptions (
  discount_id uuid not null references public.discounts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (discount_id, user_id)
);
alter table private.discount_redemptions enable row level security;
revoke all on private.discount_redemptions from public, anon, authenticated;

alter table public.orders
  add column discount_kobo bigint not null default 0 check (discount_kobo >= 0),
  add column discount_id uuid references public.discounts (id);

-- Only the shop reads its own; buyers get a sale through listing_sale and a code through check_discount_code.
alter table public.discounts enable row level security;
alter table public.discount_listings enable row level security;
create policy "the shop reads its discounts" on public.discounts for select to authenticated
  using (merchant_id = (select private.my_merchant_id()));
create policy "the shop reads its discounts' products" on public.discount_listings for select to authenticated
  using (exists (select 1 from public.discounts d where d.id = discount_id and d.merchant_id = (select private.my_merchant_id())));
revoke all on public.discounts, public.discount_listings from anon, authenticated;
grant select on public.discounts, public.discount_listings to authenticated;

-- discounts.ts discountActive.
create function private.discount_active(d public.discounts) returns boolean
language sql stable set search_path = ''
as $$ select d.ended_at is null and d.starts_at <= now() and now() < d.ends_at and (d.max_uses is null or d.uses < d.max_uses) $$;

-- discounts.ts discountedUnitKobo.
create function private.discounted_unit(p_unit bigint, d public.discounts) returns bigint
language sql immutable set search_path = ''
as $$ select least(p_unit, greatest(p_unit - coalesce(floor(p_unit * d.percent_off / 100.0)::bigint, d.amount_off_kobo), 10000)) $$;

-- discounts.ts bestPrice: what one costs now, with any running sale and, if given, a code.
create function private.unit_price(l public.listings, p_code uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('unitKobo', x.u, 'discountId', x.id)
       from (select d.id, private.discounted_unit(l.price_kobo, d) u, d.created_at
               from public.discounts d join public.discount_listings dl on dl.discount_id = d.id
              where dl.listing_id = l.id and l.kind = 'product' and private.discount_active(d) and (d.kind = 'sale' or d.id = p_code)) x
      where x.u < l.price_kobo
      order by x.u, x.created_at
      limit 1),
    jsonb_build_object('unitKobo', l.price_kobo, 'discountId', null))
$$;

-- On every listing a buyer sees (LISTING_SELECT, as `sale:listing_sale`): the running sale, if any.
create function public.listing_sale(l public.listings) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('priceKobo', x.u, 'percentOff', x.percent_off, 'amountOffKobo', x.amount_off_kobo, 'endsAt', x.ends_at)
    from (select private.discounted_unit(l.price_kobo, d) u, d.percent_off, d.amount_off_kobo, d.ends_at, d.created_at
            from public.discounts d join public.discount_listings dl on dl.discount_id = d.id
           where dl.listing_id = l.id and l.kind = 'product' and d.kind = 'sale' and private.discount_active(d)) x
   where x.u < l.price_kobo
   order by x.u, x.created_at
   limit 1
$$;

-- A code a buyer can use now, or a reason they can't.
create function private.usable_code(p_code text, p_user uuid) returns public.discounts
language plpgsql stable security definer set search_path = ''
as $$
declare d public.discounts;
begin
  select * into d from public.discounts where code = upper(btrim(coalesce(p_code, ''))) and kind = 'code';
  if not found or d.starts_at > now() then perform private.fail('invalid_input', 'That code isn’t valid.'); end if;
  if d.ended_at is not null or d.ends_at <= now() then perform private.fail('invalid_input', 'That code has ended.'); end if;
  if d.max_uses is not null and d.uses >= d.max_uses then perform private.fail('invalid_input', 'That code has been used up.'); end if;
  if exists (select 1 from private.discount_redemptions where discount_id = d.id and user_id = p_user) then perform private.fail('invalid_input', 'You’ve already used that code.'); end if;
  return d;
end $$;

-- What each of these items would cost with the code (or a better sale). Changes nothing.
create function public.check_discount_code(p_code text, p_listing_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  d public.discounts := private.usable_code(p_code, v_uid);
  v_prices jsonb;
begin
  select jsonb_object_agg(l.id, (private.unit_price(l, d.id) ->> 'unitKobo')::bigint) into v_prices
    from public.listings l
   where l.id = any (coalesce(p_listing_ids, '{}')) and l.kind = 'product' and l.status = 'for_sale'
     and exists (select 1 from public.discount_listings dl where dl.discount_id = d.id and dl.listing_id = l.id);
  if v_prices is null then perform private.fail('invalid_input', 'That code isn’t for anything you’re buying.'); end if;
  return jsonb_build_object('code', d.code, 'prices', v_prices);
end $$;

-- discounts.ts discountErrors.
create function public.create_discount(p jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_shop uuid := private.my_merchant_id();
  v_kind text := p ->> 'kind';
  v_percent int := (p ->> 'percentOff')::int;
  v_amount bigint := (p ->> 'amountOffKobo')::bigint;
  v_code text := case when p ->> 'kind' = 'code' then upper(btrim(coalesce(p ->> 'code', ''))) end;
  v_max int := (p ->> 'maxUses')::int;
  v_starts timestamptz := (p ->> 'startsAt')::timestamptz;
  v_ends timestamptz := (p ->> 'endsAt')::timestamptz;
  v_ids uuid[] := coalesce(array(select distinct jsonb_array_elements_text(coalesce(p -> 'listingIds', '[]'::jsonb))::uuid), '{}');
  v_errors text[] := '{}';
  v_id uuid;
begin
  perform private.require_user();
  if v_shop is null then perform private.fail('forbidden', 'Only sellers can run discounts.'); end if;
  perform 1 from public.merchants where id = v_shop for update; -- one at a time, so the count holds
  if v_kind is null or v_kind not in ('sale', 'code') then v_errors := array_append(v_errors, 'Choose a sale or a code.'); end if;
  if (v_percent is null) = (v_amount is null) then v_errors := array_append(v_errors, 'Choose a percentage or an amount off.'); end if;
  if v_percent is not null and v_percent not between 1 and 90 then v_errors := array_append(v_errors, 'Take 1% to 90% off.'); end if;
  if v_amount is not null and v_amount < 10000 then v_errors := array_append(v_errors, 'Take at least ₦100 off.'); end if;
  if cardinality(v_ids) = 0 then v_errors := array_append(v_errors, 'Choose at least one product.'); end if;
  if exists (select 1 from unnest(v_ids) i where not exists (
      select 1 from public.listings l where l.id = i and l.merchant_id = v_shop and l.kind = 'product' and l.status in ('for_sale', 'paused', 'pending_review'))) then
    v_errors := array_append(v_errors, 'Discounts are only for your own products, never draws.');
  end if;
  if v_amount is not null and exists (select 1 from public.listings where id = any (v_ids) and v_amount > price_kobo - 10000) then
    v_errors := array_append(v_errors, 'That’s more than one of the products costs. Leave at least ₦100.');
  end if;
  if v_starts is null or v_ends is null or v_ends <= v_starts then v_errors := array_append(v_errors, 'The end has to be after the start.');
  elsif v_ends - v_starts > make_interval(days => case when v_kind = 'code' then 90 else 31 end) then
    v_errors := array_append(v_errors, case when v_kind = 'code' then 'A code can run for up to 90 days.' else 'A sale can run for up to 31 days.' end);
  elsif v_ends <= now() then v_errors := array_append(v_errors, 'The end has to be in the future.');
  end if;
  if v_kind = 'code' then
    if v_code !~ '^[A-Z0-9]{4,16}$' then v_errors := array_append(v_errors, 'Use 4 to 16 letters and numbers for the code, e.g. SAVE10.');
    elsif exists (select 1 from public.discounts where code = v_code) then v_errors := array_append(v_errors, 'That code is taken. Try another.');
    end if;
    if v_max is not null and v_max not between 1 and 10000 then v_errors := array_append(v_errors, 'Allow 1 to 10,000 uses, or leave it unlimited.'); end if;
  else
    v_max := null;
  end if;
  if (select count(*) from public.discounts where merchant_id = v_shop and ended_at is null and ends_at > now()) >= 20 then
    v_errors := array_append(v_errors, 'You can have up to 20 discounts running or waiting to start. End one first.');
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  insert into public.discounts (merchant_id, kind, percent_off, amount_off_kobo, code, max_uses, starts_at, ends_at)
  values (v_shop, v_kind, v_percent, v_amount, v_code, v_max, v_starts, v_ends)
  returning id into v_id;
  insert into public.discount_listings (discount_id, listing_id) select v_id, unnest(v_ids);
  return v_id;
end $$;

-- Stops it now. Orders already placed keep their price.
create function public.end_discount(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_user();
  update public.discounts set ended_at = now() where id = p_id and merchant_id = private.my_merchant_id() and ended_at is null;
  if not found then perform private.fail('not_found', 'That discount doesn’t exist or has already ended.'); end if;
end $$;

revoke all on function private.discount_active(public.discounts), private.discounted_unit(bigint, public.discounts), private.unit_price(public.listings, uuid), private.usable_code(text, uuid)
  from public, anon, authenticated;
revoke all on function public.check_discount_code(text, uuid[]), public.create_discount(jsonb), public.end_discount(uuid) from public, anon;
grant execute on function public.check_discount_code(text, uuid[]), public.create_discount(jsonb), public.end_discount(uuid) to authenticated;
grant execute on function public.listing_sale(public.listings) to anon, authenticated;

-- Same as before, with discounts.
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
  v_code public.discounts;
  v_code_text text := upper(btrim(coalesce(p ->> 'code', '')));
  v_unit jsonb;
  v_code_used boolean := false;
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

  -- A discount code, checked like check_discount_code. Its use is counted at the end.
  if v_code_text <> '' then
    v_code := private.usable_code(v_code_text, v_uid);
  end if;

  -- Same lock order as buy_tickets: the buyer's wallet, then the listings.
  perform 1 from public.profiles where id = v_uid for update;

  for l in select * from public.listings where id = any (v_ids) order by id for update loop
    v_won := l.status = 'drawn' and private.has_won(v_uid, l.id);
    v_price := case when v_won then 0 when l.status <> 'for_sale' then null when l.kind = 'product' then (private.unit_price(l, v_code.id) ->> 'unitKobo')::bigint else l.fallback_price_kobo end;
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
    v_unit := case when not v_won and l.kind = 'product' then private.unit_price(l, v_code.id) end;
    v_price := v_qty * case when v_won then 0 when l.kind = 'product' then (v_unit ->> 'unitKobo')::bigint else l.fallback_price_kobo end;
    if v_code.id is not null and (v_unit ->> 'discountId')::uuid = v_code.id then v_code_used := true; end if;
    v_fee := case when v_won then 0 else coalesce((v_fees ->> l.merchant_id::text)::bigint, 0) end;
    v_fees := v_fees - l.merchant_id::text;
    insert into public.orders (discount_kobo, discount_id, delivery_fee_kobo, quantity, listing_id, user_id, merchant_id, price_kobo, fee_kobo, delivery_address, delivery_phone, delivery_lat, delivery_lng,
                               fulfilment, pickup_point_id, is_prize, handled_by, checkout_id)
    values (coalesce(v_qty * (l.price_kobo - (v_unit ->> 'unitKobo')::bigint), 0), (v_unit ->> 'discountId')::uuid, v_fee, v_qty, l.id, v_uid, l.merchant_id, v_price, round(v_price * l.fee_bps / 10000.0)::bigint, v_address, v_phone, v_lat, v_lng,
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

  -- Counted only now, on the locked row, so a code can't go past its limit.
  if v_code.id is not null then
    if not v_code_used then perform private.fail('invalid_input', 'That code isn’t for anything you’re buying.'); end if;
    update public.discounts set uses = uses + 1 where id = v_code.id and (max_uses is null or uses < max_uses);
    if not found then perform private.fail('invalid_input', 'That code has just been used up.'); end if;
    insert into private.discount_redemptions (discount_id, user_id) values (v_code.id, v_uid) on conflict do nothing;
    if not found then perform private.fail('invalid_input', 'You’ve already used that code.'); end if;
  end if;

  delete from public.cart_items where user_id = v_uid and listing_id = any (v_ids);
  return to_jsonb(v_orders);
end $$;

-- Same as before, wiping discounts too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate private.discount_redemptions, public.discount_listings, public.discounts, public.quick_replies, public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
           public.listing_views, public.tickets, public.draw_results, public.ledger_entries, public.deposits,
           public.pending_limits, public.listing_handovers, private.listing_seeds, public.listings,
           public.store_applications, public.seller_applications, public.saved_pickups, public.notifications, public.cart_items, public.saved_addresses,
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
