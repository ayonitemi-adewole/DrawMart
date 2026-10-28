-- DrawMart core schema.
--
-- Mirrors the rules in src/domain (fees.ts, listing.ts, rules.ts, draw.ts).
-- If you change a rule there, change it here too; supabase/tests/db.test.ts
-- checks the two agree.
--
-- Security model
--   * Clients can only READ tables, through row-level security (RLS) policies.
--   * Every write goes through a SECURITY DEFINER function in `public`
--     (callable over the API as an RPC) that checks the rules first.
--   * Draw seeds live in the `private` schema, which the API never exposes.
--     They are copied into draw_results only when the draw runs.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- ------------------------------------------------------------------ settings

-- One row of platform-wide settings. Edit it in the Table Editor.
create table public.app_settings (
  id boolean primary key default true check (id),
  -- true: no real money. Enables test top-ups and the admin demo controls.
  test_mode boolean not null default true,
  licensed_states text[] not null default array['Lagos'],
  max_tickets_per_user int not null default 20,
  consolation_credit_bps int not null default 2000,
  default_weekly_limit_kobo bigint not null default 5000000,
  limit_increase_delay interval not null default interval '24 hours',
  extension_days int not null default 7,
  -- Test money given to each new account while test_mode is on.
  welcome_credit_kobo bigint not null default 2500000
);
insert into public.app_settings default values;

-- Caution fee a store pays per listing, by category (src/domain/listing.ts).
create table public.caution_fees (
  category text primary key,
  amount_kobo bigint not null check (amount_kobo >= 0)
);
insert into public.caution_fees (category, amount_kobo) values
  ('Phones', 250000), ('Fashion', 250000), ('Electronics', 750000), ('Home', 1000000), ('Cars', 2500000);

-- -------------------------------------------------------------------- tables

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text not null,
  cac_number text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'You',
  -- State of residence. Comes from KYC in production; null until known.
  state text,
  weekly_limit_kobo bigint not null check (weekly_limit_kobo > 0),
  age_verified boolean not null default false,
  role text not null default 'buyer' check (role in ('buyer', 'admin')),
  -- Set when this account manages a store.
  merchant_id uuid references public.merchants (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id),
  title text not null check (length(btrim(title)) > 0),
  description text not null default '',
  category text not null check (category in ('Phones', 'Electronics', 'Home', 'Cars', 'Fashion')),
  images text[] not null default '{}',
  price_kobo bigint not null check (price_kobo > 0),
  ticket_price_kobo bigint not null check (ticket_price_kobo > 0),
  buyer_ticket_price_kobo bigint not null check (buyer_ticket_price_kobo > 0),
  ticket_count int not null check (ticket_count between 1 and 10000),
  tickets_sold int not null default 0,
  fee_mode text not null check (fee_mode in ('seller', 'buyer', 'split')),
  fee_bps int not null,
  unsold_policy text not null check (unsold_policy in ('refund', 'extend_once', 'convert_to_sale')),
  fallback_price_kobo bigint check (fallback_price_kobo > 0),
  duration_days int not null,
  extended boolean not null default false,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'live', 'drawn', 'refunded', 'for_sale', 'rejected')),
  caution_fee_kobo bigint not null,
  caution_fee_status text not null default 'held' check (caution_fee_status in ('held', 'refunded', 'kept')),
  -- SHA-256 of the secret seed, published before any ticket is sold.
  commitment text not null,
  created_at timestamptz not null default now(),
  closes_at timestamptz not null,
  check (tickets_sold between 0 and ticket_count)
);
create index listings_status_idx on public.listings (status);
create index listings_merchant_idx on public.listings (merchant_id);

-- Pickup / inspection booking. Private to the listing's store and admins.
create table public.listing_handovers (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  method text not null check (method in ('pickup', 'inspection')),
  address text not null,
  contact_phone text not null,
  date date not null,
  slot text not null check (slot in ('morning', 'afternoon'))
);

create table private.listing_seeds (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  seed text not null
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  -- null for demo "other buyers" tickets.
  user_id uuid references public.profiles (id) on delete set null,
  number int not null,
  purchase_ref text not null,
  purchased_at timestamptz not null default now(),
  unique (listing_id, number)
);
create index tickets_user_idx on public.tickets (user_id, listing_id);

-- Append-only wallet ledger. Balances are always derived from it.
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('topup', 'ticket_purchase', 'refund', 'store_credit', 'adjustment')),
  cash_kobo bigint not null default 0,
  credit_kobo bigint not null default 0,
  memo text not null,
  listing_id uuid references public.listings (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ledger_user_idx on public.ledger_entries (user_id, created_at desc);
create index ledger_listing_idx on public.ledger_entries (listing_id, kind);

create table public.draw_results (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  commitment text not null,
  seed text not null,
  closing_ref text not null,
  winning_number int not null,
  winner_user_id uuid references public.profiles (id) on delete set null,
  drawn_at timestamptz not null default now()
);

create table public.pending_limits (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo > 0),
  effective_at timestamptz not null
);

-- ------------------------------------------------------------------ helpers

create function private.settings() returns public.app_settings
language sql stable security definer set search_path = ''
as $$ select * from public.app_settings where id $$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) $$;

create function private.my_merchant_id() returns uuid
language sql stable security definer set search_path = ''
as $$ select merchant_id from public.profiles where id = auth.uid() $$;

-- Raises an error the app maps to ApiError: `code` becomes the error code,
-- `detail` the message shown to the user.
create function private.fail(code text, detail text default null) returns void
language plpgsql
as $$ begin raise exception using errcode = 'P0001', message = code, detail = coalesce(detail, ''); end $$;

create function private.require_user() returns uuid
language plpgsql stable
as $$
begin
  if auth.uid() is null then perform private.fail('forbidden', 'Sign in first.'); end if;
  return auth.uid();
end $$;

create function private.require_admin() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then perform private.fail('forbidden', 'Admins only.'); end if;
end $$;

-- Applies a raised weekly limit once its waiting period is over.
create function private.apply_pending_limit(p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_amount bigint;
begin
  delete from public.pending_limits where user_id = p_user and effective_at <= now() returning amount_kobo into v_amount;
  if v_amount is not null then
    update public.profiles set weekly_limit_kobo = v_amount where id = p_user;
  end if;
end $$;

-- Ticket spend in the last 7 days, net of refunds (rules.ts spentInLastWeek).
create function private.spent_last_week(p_user uuid) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(-sum(cash_kobo + credit_kobo), 0)::bigint
  from public.ledger_entries
  where user_id = p_user and kind in ('ticket_purchase', 'refund') and created_at >= now() - interval '7 days'
$$;

-- Winner = SHA-256(seed ":" ref) read as one big number, mod ticket_count, + 1 (draw.ts).
create function private.winning_number(p_seed text, p_ref text, p_ticket_count int) returns int
language plpgsql immutable
as $$
declare
  h bytea := sha256(convert_to(p_seed || ':' || p_ref, 'UTF8'));
  acc bigint := 0;
begin
  for i in 0..31 loop
    acc := (acc * 256 + get_byte(h, i)) % p_ticket_count;
  end loop;
  return acc + 1;
end $$;

create function private.new_ref() returns text
language sql volatile
as $$ select 'P-' || upper(encode(extensions.gen_random_bytes(3), 'hex')) $$;

-- --------------------------------------------------------------- draw engine

create function private.run_draw(p_listing_id uuid, p_ref text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  s public.app_settings := private.settings();
  v_seed text;
  v_number int;
  v_winner uuid;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if l.tickets_sold <> l.ticket_count then raise exception 'run_draw: listing % is not sold out', p_listing_id; end if;
  select seed into v_seed from private.listing_seeds where listing_id = p_listing_id;

  v_number := private.winning_number(v_seed, p_ref, l.ticket_count);
  select user_id into v_winner from public.tickets where listing_id = p_listing_id and number = v_number;

  update public.listings
     set status = 'drawn',
         caution_fee_status = case when caution_fee_status = 'held' then 'refunded' else caution_fee_status end
   where id = p_listing_id;

  insert into public.draw_results (listing_id, commitment, seed, closing_ref, winning_number, winner_user_id)
  values (p_listing_id, l.commitment, v_seed, p_ref, v_number, v_winner);

  -- Consolation store credit for every losing buyer (rules.ts consolationCredit).
  insert into public.ledger_entries (user_id, kind, credit_kobo, memo, listing_id)
  select t.user_id, 'store_credit',
         round(count(*) * l.buyer_ticket_price_kobo * s.consolation_credit_bps / 10000.0)::bigint,
         'Store credit · ' || l.title, p_listing_id
    from public.tickets t
   where t.listing_id = p_listing_id and t.user_id is not null and t.user_id is distinct from v_winner
   group by t.user_id
  having round(count(*) * l.buyer_ticket_price_kobo * s.consolation_credit_bps / 10000.0) > 0;
end $$;

-- Pays every buyer back into the buckets (cash / credit) the money came from.
create function private.refund_buyers(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  select e.user_id, 'refund', -sum(e.cash_kobo), -sum(e.credit_kobo),
         'Refund · ' || l.title || ' didn’t sell out', p_listing_id
    from public.ledger_entries e
    join public.listings l on l.id = e.listing_id
   where e.listing_id = p_listing_id and e.kind = 'ticket_purchase'
   group by e.user_id, l.title;
end $$;

-- Closes live listings whose deadline has passed. Runs every minute (pg_cron).
create function private.process_deadlines() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  s public.app_settings := private.settings();
  n int := 0;
begin
  for l in
    select * from public.listings where status = 'live' and closes_at <= now() for update skip locked
  loop
    n := n + 1;
    if l.unsold_policy = 'extend_once' and not l.extended then
      update public.listings set extended = true, closes_at = now() + make_interval(days => s.extension_days) where id = l.id;
      continue;
    end if;
    perform private.refund_buyers(l.id);
    update public.listings
       set status = case when l.unsold_policy = 'convert_to_sale' and l.fallback_price_kobo is not null then 'for_sale' else 'refunded' end,
           caution_fee_status = case when caution_fee_status = 'held' then 'kept' else caution_fee_status end
     where id = l.id;
  end loop;

  -- Also apply any raised weekly limits that are now due.
  with due as (delete from public.pending_limits where effective_at <= now() returning user_id, amount_kobo)
  update public.profiles p set weekly_limit_kobo = due.amount_kobo from due where p.id = due.user_id;

  return n;
end $$;

-- ------------------------------------------------------ buyer RPCs (public)

create function public.buy_tickets(p_listing_id uuid, p_quantity int) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  s public.app_settings := private.settings();
  p public.profiles;
  l public.listings;
  v_held int;
  v_cost bigint;
  v_cash bigint;
  v_credit bigint;
  v_from_credit bigint;
  v_ref text := private.new_ref();
  v_numbers int[];
  v_drawn boolean := false;
begin
  perform private.apply_pending_limit(v_uid);
  -- Locking the profile serialises one person's purchases (wallet checks);
  -- locking the listing serialises ticket numbering.
  select * into p from public.profiles where id = v_uid for update;
  if not found then perform private.fail('forbidden', 'Your profile is missing.'); end if;
  select * into l from public.listings where id = p_listing_id for update;
  if not found then perform private.fail('not_found', 'That listing doesn’t exist.'); end if;

  -- Same order as checkPurchase in src/domain/rules.ts.
  if p.state is null or not (p.state = any (s.licensed_states)) then perform private.fail('state_not_licensed'); end if;
  if not p.age_verified then perform private.fail('age_not_verified'); end if;
  if l.status <> 'live' or l.closes_at <= now() then perform private.fail('not_live'); end if;
  if p_quantity is null or p_quantity < 1 then perform private.fail('invalid_quantity'); end if;
  if l.ticket_count - l.tickets_sold <= 0 then perform private.fail('sold_out'); end if;
  if p_quantity > l.ticket_count - l.tickets_sold then perform private.fail('not_enough_tickets_left'); end if;
  select count(*) into v_held from public.tickets where listing_id = l.id and user_id = v_uid;
  if v_held + p_quantity > s.max_tickets_per_user then perform private.fail('per_user_limit'); end if;
  v_cost := p_quantity * l.buyer_ticket_price_kobo;
  if private.spent_last_week(v_uid) + v_cost > p.weekly_limit_kobo then perform private.fail('weekly_limit'); end if;
  select coalesce(sum(cash_kobo), 0), coalesce(sum(credit_kobo), 0) into v_cash, v_credit from public.ledger_entries where user_id = v_uid;
  if v_cash + v_credit < v_cost then perform private.fail('insufficient_funds'); end if;

  -- Store credit is spent before cash.
  v_from_credit := least(greatest(v_credit, 0), v_cost);
  v_numbers := array(select l.tickets_sold + g from generate_series(1, p_quantity) g);

  insert into public.tickets (listing_id, user_id, number, purchase_ref)
  select l.id, v_uid, n, v_ref from unnest(v_numbers) n;
  update public.listings set tickets_sold = tickets_sold + p_quantity where id = l.id;
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  values (v_uid, 'ticket_purchase', -(v_cost - v_from_credit), -v_from_credit,
          p_quantity || case when p_quantity = 1 then ' ticket · ' else ' tickets · ' end || l.title, l.id);

  if l.tickets_sold + p_quantity = l.ticket_count then
    perform private.run_draw(l.id, v_ref);
    v_drawn := true;
  end if;

  return jsonb_build_object('purchaseId', v_ref, 'numbers', to_jsonb(v_numbers), 'costKobo', v_cost, 'drawn', v_drawn);
end $$;

-- Balance and weekly spend, summed in the database (API reads are capped at
-- 1,000 rows, so the app can't add up the whole ledger itself).
create function public.wallet_summary() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform private.apply_pending_limit(v_uid);
  return (
    select jsonb_build_object(
      'cashKobo', coalesce(sum(cash_kobo), 0),
      'creditKobo', coalesce(sum(credit_kobo), 0),
      'spentThisWeekKobo', private.spent_last_week(v_uid),
      'weeklyLimitKobo', (select weekly_limit_kobo from public.profiles where id = v_uid))
    from public.ledger_entries where user_id = v_uid);
end $$;

-- Test money only. Real top-ups will come from the payment provider's webhook.
create function public.top_up(p_amount_kobo bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  if not (private.settings()).test_mode then perform private.fail('forbidden', 'Top-ups go through the payment provider.'); end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 then perform private.fail('invalid_input', 'Enter an amount to add.'); end if;
  insert into public.ledger_entries (user_id, kind, cash_kobo, memo) values (v_uid, 'topup', p_amount_kobo, 'Wallet top-up (test money)');
end $$;

-- Lowering a limit is instant; raising it waits app_settings.limit_increase_delay.
create function public.set_weekly_limit(p_amount_kobo bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_current bigint;
begin
  if p_amount_kobo is null or p_amount_kobo <= 0 then perform private.fail('invalid_input', 'Enter a limit.'); end if;
  perform private.apply_pending_limit(v_uid);
  select weekly_limit_kobo into v_current from public.profiles where id = v_uid for update;
  if p_amount_kobo <= v_current then
    update public.profiles set weekly_limit_kobo = p_amount_kobo where id = v_uid;
    delete from public.pending_limits where user_id = v_uid;
  else
    insert into public.pending_limits (user_id, amount_kobo, effective_at)
    values (v_uid, p_amount_kobo, now() + (private.settings()).limit_increase_delay)
    on conflict (user_id) do update set amount_kobo = excluded.amount_kobo, effective_at = excluded.effective_at;
  end if;
end $$;

-- Name can always change. State only in test mode: in production it comes from KYC.
create function public.update_profile(p_display_name text default null, p_state text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  if p_state is not null and not (private.settings()).test_mode then
    perform private.fail('forbidden', 'Your state of residence comes from identity verification.');
  end if;
  update public.profiles
     set display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
         state = coalesce(p_state, state)
   where id = v_uid;
end $$;

-- --------------------------------------------------- merchant RPCs (public)

-- Validates like src/domain/fees.ts + listing.ts, prices the listing, and
-- generates the secret seed. Returns the new listing id.
create function public.create_listing(p jsonb) returns uuid
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
  v_fee_bps int := (p ->> 'feeBps')::int;
  v_duration int := (p ->> 'durationDays')::int;
  v_unsold text := p ->> 'unsoldPolicy';
  v_fallback bigint := nullif(p ->> 'fallbackPriceKobo', '')::bigint;
  v_images text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'images', '[]'::jsonb))), '{}');
  h jsonb := coalesce(p -> 'handover', '{}'::jsonb);
  v_address text := btrim(coalesce(h ->> 'address', ''));
  v_phone text := coalesce(h ->> 'contactPhone', '');
  v_date date;
  v_slot text := h ->> 'slot';
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

  -- fees.ts validateListingEconomics
  if v_title = '' then v_errors := array_append(v_errors, 'Give the item a name.'); end if;
  if v_price is null or v_price <= 0 then v_errors := array_append(v_errors, 'Enter your price.'); end if;
  if v_ticket is null or v_ticket < 10000 then v_errors := array_append(v_errors, 'Tickets must cost at least ₦100.'); end if;
  if v_price > 0 and v_ticket > v_price then v_errors := array_append(v_errors, 'A ticket can’t cost more than the item.'); end if;
  if v_price > 0 and v_ticket > 0 and (v_price + v_ticket - 1) / v_ticket > 10000 then
    v_errors := array_append(v_errors, 'That would need more than 10,000 tickets. Raise the ticket price.');
  end if;
  if v_fee_bps is null or v_fee_bps not between 1000 and 3000 then v_errors := array_append(v_errors, 'Platform fee must be between 10% and 30%.'); end if;
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

  insert into public.listing_handovers (listing_id, method, address, contact_phone, date, slot)
  values (v_id, case when v_category = 'Cars' then 'inspection' else 'pickup' end, v_address, v_phone, v_date, v_slot);
  insert into private.listing_seeds (listing_id, seed) values (v_id, v_seed);
  return v_id;
end $$;

-- ------------------------------------------------------ admin RPCs (public)

create function public.approve_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  -- The clock starts when the draw goes live.
  update public.listings set status = 'live', closes_at = now() + make_interval(days => duration_days)
   where id = p_listing_id and status = 'pending_review';
  if not found then perform private.fail('invalid_input', 'Only listings in review can be approved.'); end if;
end $$;

create function public.reject_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.listings set status = 'rejected', caution_fee_status = 'kept'
   where id = p_listing_id and status = 'pending_review';
  if not found then perform private.fail('invalid_input', 'Only listings in review can be rejected.'); end if;
end $$;

-- Demo controls: admins only, and only while app_settings.test_mode is on.
create function private.require_demo() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (private.settings()).test_mode then perform private.fail('forbidden', 'Demo controls are off outside test mode.'); end if;
  perform private.require_admin();
end $$;

create function public.demo_sell_out(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  v_ref text := private.new_ref();
begin
  perform private.require_demo();
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.status <> 'live' then perform private.fail('not_live'); end if;
  insert into public.tickets (listing_id, user_id, number, purchase_ref)
  select l.id, null, n, v_ref from generate_series(l.tickets_sold + 1, l.ticket_count) n;
  update public.listings set tickets_sold = ticket_count where id = l.id;
  perform private.run_draw(l.id, v_ref);
end $$;

create function public.demo_expire(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_demo();
  update public.listings set closes_at = now() - interval '1 second' where id = p_listing_id and status = 'live';
  if not found then perform private.fail('not_live'); end if;
  perform private.process_deadlines();
end $$;

-- -------------------------------------------------------------- new users

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  insert into public.profiles (id, display_name, state, age_verified, weekly_limit_kobo)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'You'),
    -- Test mode: assume a verified Lagos adult so the app is usable. Production: KYC fills these in.
    case when s.test_mode then 'Lagos' end,
    s.test_mode,
    s.default_weekly_limit_kobo);
  if s.test_mode and s.welcome_credit_kobo > 0 then
    insert into public.ledger_entries (user_id, kind, cash_kobo, memo)
    values (new.id, 'topup', s.welcome_credit_kobo, 'Welcome top-up (test money)');
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

-- ------------------------------------------------------- row-level security

alter table public.app_settings enable row level security;
alter table public.caution_fees enable row level security;
alter table public.merchants enable row level security;
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.listing_handovers enable row level security;
alter table public.tickets enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.draw_results enable row level security;
alter table public.pending_limits enable row level security;
alter table private.listing_seeds enable row level security;

-- Read-only policies. There are deliberately no insert/update/delete policies:
-- all writes go through the functions above.
create policy "settings are public" on public.app_settings for select using (true);
create policy "caution fees are public" on public.caution_fees for select using (true);
create policy "stores are public" on public.merchants for select using (true);
create policy "draw results are public" on public.draw_results for select using (true);

create policy "read own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_admin());

create policy "read public, own-store or all (admin) listings" on public.listings for select
  using (
    status in ('live', 'drawn', 'refunded', 'for_sale')
    or merchant_id = (select private.my_merchant_id())
    or (select private.is_admin())
  );

create policy "store and admins read handovers" on public.listing_handovers for select to authenticated
  using (
    (select private.is_admin())
    or exists (select 1 from public.listings l where l.id = listing_id and l.merchant_id = (select private.my_merchant_id()))
  );

create policy "read own tickets" on public.tickets for select to authenticated using (user_id = (select auth.uid()));
create policy "read own ledger" on public.ledger_entries for select to authenticated using (user_id = (select auth.uid()));
create policy "read own pending limit" on public.pending_limits for select to authenticated using (user_id = (select auth.uid()));

-- Clients get read access only (policies above still decide which rows).
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;

-- Functions: Postgres lets everyone execute functions by default. Lock that
-- down, then open only the RPCs the app calls, to signed-in users.
revoke all on all tables in schema private from public, anon, authenticated;
revoke execute on all functions in schema private from public;
revoke execute on all functions in schema public from public, anon, authenticated;
grant usage on schema private to anon, authenticated; -- for helpers used inside RLS policies
grant execute on function private.is_admin(), private.my_merchant_id() to anon, authenticated;
grant execute on function
  public.wallet_summary(),
  public.buy_tickets(uuid, int),
  public.top_up(bigint),
  public.set_weekly_limit(bigint),
  public.update_profile(text, text),
  public.create_listing(jsonb),
  public.approve_listing(uuid),
  public.reject_listing(uuid),
  public.demo_sell_out(uuid),
  public.demo_expire(uuid)
to authenticated;

-- ------------------------------------------------------ storage for photos

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('listing-photos', 'listing-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    -- Stores upload into a folder named after their merchant id.
    execute $p$
      create policy "stores upload listing photos" on storage.objects for insert to authenticated
      with check (
        bucket_id = 'listing-photos'
        and (storage.foldername(name))[1] = (select private.my_merchant_id())::text
      )
    $p$;
  end if;
end $$;

-- ------------------------------------------------- scheduled deadline check

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
      perform cron.schedule('drawmart-process-deadlines', '* * * * *', 'select private.process_deadlines()');
    exception when others then
      -- Don't fail the migration; docs/supabase-setup.md shows how to enable Cron by hand.
      raise notice 'pg_cron not set up (%). Enable Cron in the dashboard, then run the cron.schedule line from this migration.', sqlerrm;
    end;
  end if;
end $$;
