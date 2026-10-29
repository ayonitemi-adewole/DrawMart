-- Paid promotion ("boosts", src/domain/boosts.ts).
--
-- A seller (store or individual) pays through Flutterwave to show a listing
-- first, marked Sponsored, for a fixed package of days. Boosts unlock once
-- enough buyers have been active in the last 30 days, or when an admin
-- switches them on early. A limited number run at once, app-wide.
--
-- Flow, like wallet deposits: start_boost records a pending boost with a
-- BST- tx_ref; the seller pays in Flutterwave's checkout; the confirm-deposit
-- Edge Function (or the webhook) verifies the payment with Flutterwave and
-- calls complete_boost, which starts the boost once.

alter table public.app_settings
  add column boost_min_active_buyers int not null default 1000 check (boost_min_active_buyers >= 0),
  add column boosts_forced_on boolean not null default false,
  add column boost_max_active int not null default 12 check (boost_max_active > 0);

-- Public, so buyers' lists can put sponsored items first.
alter table public.listings add column boosted_until timestamptz;
create index listings_boosted_idx on public.listings (boosted_until) where boosted_until is not null;

-- Edit prices in the Table Editor; keep DEFAULT_BOOST_PACKAGES in step for the mock.
create table public.boost_packages (
  id text primary key,
  days int not null check (days between 1 and 60),
  price_kobo bigint not null check (price_kobo > 0),
  active boolean not null default true
);
insert into public.boost_packages (id, days, price_kobo) values ('3d', 3, 250000), ('7d', 7, 500000), ('14d', 14, 900000);

create table public.boosts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  merchant_id uuid not null references public.merchants (id),
  -- Who paid, for the receipt email and support.
  user_id uuid not null references public.profiles (id),
  package_id text not null references public.boost_packages (id),
  days int not null,
  price_kobo bigint not null,
  tx_ref text not null unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  provider_ref text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create index boosts_merchant_idx on public.boosts (merchant_id, created_at desc);
create index boosts_running_idx on public.boosts (ends_at) where status = 'paid';

alter table public.boost_packages enable row level security;
alter table public.boosts enable row level security;
create policy "packages are public" on public.boost_packages for select using (true);
create policy "own shop's boosts, or admins" on public.boosts for select to authenticated
  using (merchant_id = (select private.my_merchant_id()) or (select private.is_admin()));
revoke all on public.boost_packages, public.boosts from anon, authenticated;
grant select on public.boost_packages to anon, authenticated;
grant select on public.boosts to authenticated;

-- ---------------------------------------------------------- unlock rule

-- Buyers who bought a ticket or an item, or paid in a top-up, in the last 30 days.
create function private.active_buyers() returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from (
    select user_id from public.ledger_entries
     where kind in ('ticket_purchase', 'order_payment') and created_at > now() - interval '30 days'
    union
    select user_id from public.deposits
     where status = 'successful' and completed_at > now() - interval '30 days'
  ) u
$$;

create function private.running_boosts() returns int
language sql stable security definer set search_path = ''
as $$ select count(*)::int from public.boosts where status = 'paid' and ends_at > now() $$;

-- What the boost screens need. The buyer count is only for admins.
create function public.boost_status() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.app_settings := private.settings();
  v_active int := private.active_buyers();
begin
  return jsonb_build_object(
    'unlocked', s.boosts_forced_on or v_active >= s.boost_min_active_buyers,
    'slotsLeft', greatest(0, s.boost_max_active - private.running_boosts()),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'days', days, 'priceKobo', price_kobo) order by days)
                            from public.boost_packages where active), '[]'::jsonb),
    'admin', case when private.is_admin() then jsonb_build_object(
      'activeBuyers', v_active, 'minActiveBuyers', s.boost_min_active_buyers,
      'forcedOn', s.boosts_forced_on, 'maxActive', s.boost_max_active) end);
end $$;

create function public.set_boost_settings(p_min_active_buyers int, p_forced_on boolean, p_max_active int) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_min_active_buyers is null or p_min_active_buyers < 0 then perform private.fail('invalid_input', 'Enter how many active buyers unlock boosts.'); end if;
  if p_max_active is null or p_max_active < 1 then perform private.fail('invalid_input', 'Allow at least one boost at a time.'); end if;
  update public.app_settings set boost_min_active_buyers = p_min_active_buyers, boosts_forced_on = coalesce(p_forced_on, false), boost_max_active = p_max_active;
end $$;

-- ---------------------------------------------------------------- RPCs

-- boosts.ts canBoost, boostsUnlocked. Returns what the checkout needs.
create function public.start_boost(p_listing_id uuid, p_package_id text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_shop uuid := private.my_merchant_id();
  s public.app_settings := private.settings();
  l public.listings;
  pk public.boost_packages;
  v_ref text := 'BST-' || upper(replace(gen_random_uuid()::text, '-', ''));
  v_email text;
begin
  if v_shop is null then perform private.fail('forbidden', 'Only sellers can boost listings.'); end if;
  if not (s.boosts_forced_on or private.active_buyers() >= s.boost_min_active_buyers) then
    perform private.fail('forbidden', 'Boosts open once DrawMart has enough active buyers.');
  end if;
  select * into l from public.listings where id = p_listing_id and merchant_id = v_shop;
  if not found then perform private.fail('not_found', 'That listing isn’t yours.'); end if;
  if not ((l.kind = 'raffle' and l.status = 'live') or l.status = 'for_sale') then
    perform private.fail('invalid_input', 'Only live draws and items on sale can be boosted.');
  end if;
  select * into pk from public.boost_packages where id = p_package_id and active;
  if not found then perform private.fail('invalid_input', 'Pick a boost package.'); end if;
  if private.running_boosts() >= s.boost_max_active then
    perform private.fail('invalid_input', 'All boost slots are taken right now. Try again in a day or two.');
  end if;
  if (select count(*) from public.boosts where merchant_id = v_shop and status = 'pending' and created_at > now() - interval '1 hour') >= 5 then
    perform private.fail('invalid_input', 'Too many unfinished boost payments. Try again in a little while.');
  end if;
  select email into v_email from auth.users where id = v_uid;
  if coalesce(v_email, '') = '' then perform private.fail('invalid_input', 'Your account needs an email address to pay.'); end if;

  insert into public.boosts (listing_id, merchant_id, user_id, package_id, days, price_kobo, tx_ref)
  values (l.id, v_shop, v_uid, pk.id, pk.days, pk.price_kobo, v_ref);
  return jsonb_build_object('txRef', v_ref, 'amountKobo', pk.price_kobo, 'email', v_email,
                            'name', (select name from public.merchants where id = v_shop));
end $$;

-- Starts a paid boost: now, or straight after one still running (boosts.ts boostEndsAt).
create function private.activate_boost(p_boost_id uuid, p_provider_ref text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  b public.boosts;
  v_from timestamptz;
begin
  select * into b from public.boosts where id = p_boost_id for update;
  select greatest(now(), coalesce(boosted_until, now())) into v_from from public.listings where id = b.listing_id for update;
  update public.boosts set status = 'paid', provider_ref = p_provider_ref, starts_at = v_from, ends_at = v_from + make_interval(days => b.days)
   where id = b.id;
  update public.listings set boosted_until = v_from + make_interval(days => b.days) where id = b.listing_id;
end $$;

-- Only the Edge Functions (service role) call this, with what Flutterwave's verify API said.
create function public.complete_boost(p_tx_ref text, p_status text, p_amount_kobo bigint, p_currency text, p_provider_ref text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare b public.boosts;
begin
  select * into b from public.boosts where tx_ref = p_tx_ref for update;
  if not found then perform private.fail('not_found', 'No such boost.'); end if;
  if b.status = 'paid' then return 'successful'; end if; -- already started

  if p_status = 'successful' then
    if p_currency is distinct from 'NGN' or p_amount_kobo is null or p_amount_kobo < b.price_kobo then
      update public.boosts set status = 'failed', provider_ref = p_provider_ref where id = b.id;
      return 'failed';
    end if;
    perform private.activate_boost(b.id, p_provider_ref);
    return 'successful';
  end if;
  if p_status = 'failed' and b.status = 'pending' then
    update public.boosts set status = 'failed', provider_ref = p_provider_ref where id = b.id;
    return 'failed';
  end if;
  return case b.status when 'pending' then 'pending' else b.status end;
end $$;

-- The seller closed the checkout. A payment that still arrives is honoured.
create function public.cancel_boost(p_tx_ref text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.boosts set status = 'cancelled'
   where tx_ref = p_tx_ref and status = 'pending' and merchant_id = private.my_merchant_id();
end $$;

-- Test mode without Flutterwave keys: pay for a boost with pretend money.
create function public.test_pay_boost(p_tx_ref text) returns void
language plpgsql security definer set search_path = ''
as $$
declare b public.boosts;
begin
  if not (private.settings()).test_mode then perform private.fail('forbidden', 'Boosts are paid through Flutterwave.'); end if;
  select * into b from public.boosts where tx_ref = p_tx_ref and merchant_id = private.my_merchant_id() and status in ('pending', 'cancelled') for update;
  if not found then perform private.fail('not_found', 'No such boost.'); end if;
  perform private.activate_boost(b.id, 'TEST');
end $$;

revoke execute on function
  private.active_buyers(), private.running_boosts(), private.activate_boost(uuid, text),
  public.boost_status(), public.set_boost_settings(int, boolean, int), public.start_boost(uuid, text),
  public.complete_boost(text, text, bigint, text, text), public.cancel_boost(text), public.test_pay_boost(text)
from public, anon, authenticated;
grant execute on function
  public.boost_status(), public.set_boost_settings(int, boolean, int), public.start_boost(uuid, text),
  public.cancel_boost(text), public.test_pay_boost(text)
to authenticated;
grant execute on function public.complete_boost(text, text, bigint, text, text) to service_role;
