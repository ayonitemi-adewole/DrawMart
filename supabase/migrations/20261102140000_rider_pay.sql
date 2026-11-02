-- Rider earnings and weekly pay (riderPay.ts). Each job earns a set amount from a pay
-- table admins edit beside the delivery prices, never more than the buyer pays for the
-- same trip. Triggers write an earning once per job: a delivery (door, counter, or
-- refused at the door), a return to the seller, a failed attempt. Admins pay finished
-- weeks by hand into an account the bank confirmed, with the same 48-hour change hold
-- as sellers. Pay rates are placeholders: 70% of the delivery price.

create table public.rider_pay_rates (
  area_a text not null references public.delivery_areas (id),
  area_b text not null references public.delivery_areas (id),
  pay_kobo bigint not null check (pay_kobo >= 0),
  primary key (area_a, area_b),
  check (area_a <= area_b)
);
-- riderPay.ts placeholderRiderPay.
insert into public.rider_pay_rates (area_a, area_b, pay_kobo)
select area_a, area_b, floor(price_kobo * 0.7 / 5000)::bigint * 5000 from public.delivery_prices;

create table public.rider_pay_size_extras (
  size text primary key check (size in ('small', 'medium', 'large')),
  extra_kobo bigint not null check (extra_kobo >= 0)
);
insert into public.rider_pay_size_extras (size, extra_kobo)
select size, floor(extra_kobo * 0.7 / 5000)::bigint * 5000 from public.delivery_size_extras;

alter table public.app_settings add column rider_attempt_pay_kobo bigint not null default 50000 check (rider_attempt_pay_kobo between 0 and 300000);

alter table public.rider_pay_rates enable row level security;
alter table public.rider_pay_size_extras enable row level security;
create policy "signed-in accounts read rider pay" on public.rider_pay_rates for select to authenticated using (true);
create policy "signed-in accounts read rider extras" on public.rider_pay_size_extras for select to authenticated using (true);
revoke all on public.rider_pay_rates, public.rider_pay_size_extras from anon, authenticated;
grant select on public.rider_pay_rates, public.rider_pay_size_extras to authenticated;

-- riderPay.ts tripPay.
create function private.rider_pay(p_from text, p_to text, p_size text) returns bigint
language sql stable set search_path = ''
as $$
  select coalesce((select pay_kobo from public.rider_pay_rates where area_a = least(p_from, p_to) and area_b = greatest(p_from, p_to)), 0)
       + coalesce((select extra_kobo from public.rider_pay_size_extras where size = p_size), 0)
$$;

-- riderPay.ts riderPayError: never more than the buyer pays for the same trip.
create function public.set_rider_pay(p_area_a text, p_area_b text, p_pay_kobo bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_price bigint;
begin
  perform private.require_admin();
  select price_kobo into v_price from public.delivery_prices where area_a = least(p_area_a, p_area_b) and area_b = greatest(p_area_a, p_area_b);
  if not found then perform private.fail('not_found', 'That area doesn’t exist.'); end if;
  if p_pay_kobo is null or p_pay_kobo < 0 then perform private.fail('invalid_input', 'Enter an amount.'); end if;
  if p_pay_kobo > v_price then perform private.fail('invalid_input', 'Rider pay can’t be more than the buyer pays.'); end if;
  update public.rider_pay_rates set pay_kobo = p_pay_kobo where area_a = least(p_area_a, p_area_b) and area_b = greatest(p_area_a, p_area_b);
end $$;

create function public.set_rider_size_extra(p_size text, p_extra_kobo bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_extra bigint;
begin
  perform private.require_admin();
  select extra_kobo into v_extra from public.delivery_size_extras where size = p_size;
  if not found then perform private.fail('invalid_input', 'Pick a package size.'); end if;
  if p_extra_kobo is null or p_extra_kobo < 0 then perform private.fail('invalid_input', 'Enter an amount.'); end if;
  if p_extra_kobo > v_extra then perform private.fail('invalid_input', 'Rider pay can’t be more than the buyer pays.'); end if;
  update public.rider_pay_size_extras set extra_kobo = p_extra_kobo where size = p_size;
end $$;

create function public.set_rider_attempt_pay(p_kobo bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_kobo is null or p_kobo not between 0 and 300000 then perform private.fail('invalid_input', 'A failed attempt pays from ₦0 to ₦3,000.'); end if;
  update public.app_settings set rider_attempt_pay_kobo = p_kobo where id;
end $$;

-- Same as before, never below what the rider is paid for that trip.
create or replace function public.set_delivery_price(p_area_a text, p_area_b text, p_price_kobo bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_price_kobo is null or p_price_kobo not between 100000 and 500000 then perform private.fail('invalid_input', 'A delivery price must be from ₦1,000 to ₦5,000.'); end if;
  if p_price_kobo < (select pay_kobo from public.rider_pay_rates where area_a = least(p_area_a, p_area_b) and area_b = greatest(p_area_a, p_area_b)) then
    perform private.fail('invalid_input', 'That’s less than the rider is paid for this trip. Lower the rider pay first.');
  end if;
  update public.delivery_prices set price_kobo = p_price_kobo where area_a = least(p_area_a, p_area_b) and area_b = greatest(p_area_a, p_area_b);
  if not found then perform private.fail('not_found', 'That area doesn’t exist.'); end if;
end $$;

create or replace function public.set_delivery_size_extra(p_size text, p_extra_kobo bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_extra_kobo is null or p_extra_kobo not between 0 and 400000 then perform private.fail('invalid_input', 'An extra must be from ₦0 to ₦4,000.'); end if;
  if p_extra_kobo < (select extra_kobo from public.rider_pay_size_extras where size = p_size) then
    perform private.fail('invalid_input', 'That’s less than the rider is paid for this size. Lower the rider pay first.');
  end if;
  update public.delivery_size_extras set extra_kobo = p_extra_kobo where size = p_size;
  if not found then perform private.fail('invalid_input', 'Pick a package size.'); end if;
end $$;

-- ---------------------------------------------------------------- earnings

create table public.rider_earnings (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles (id),
  kind text not null check (kind in ('delivery', 'return', 'failed_attempt')),
  -- What earned it: the order, the claim, or the attempt. Once each.
  source_id uuid not null,
  order_id uuid references public.orders (id) on delete cascade,
  claim_id uuid references public.order_claims (id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo > 0),
  from_area text,
  to_area text,
  earned_at timestamptz not null default now(),
  paid_at timestamptz,
  reference text,
  paid_to text,
  paid_by uuid,
  unique (source_id, kind)
);
create index rider_earnings_rider_idx on public.rider_earnings (rider_id, earned_at desc);
alter table public.rider_earnings enable row level security;
create policy "own earnings, or admins" on public.rider_earnings for select to authenticated
  using (rider_id = (select auth.uid()) or (select private.is_admin()));
revoke all on public.rider_earnings from anon, authenticated;
grant select on public.rider_earnings to authenticated;

-- Writes one earning at today's rates. Deliberately doesn't catch errors: it's money.
create function private.earn(p_rider uuid, p_kind text, p_source uuid, p_order uuid, p_claim uuid, p_from text, p_to text, p_size text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_from text := coalesce(p_from, p_to);
  v_to text := coalesce(p_to, p_from);
  v_amount bigint;
begin
  if p_rider is null then return; end if;
  v_amount := case when p_kind = 'failed_attempt' then (private.settings()).rider_attempt_pay_kobo else private.rider_pay(v_from, v_to, p_size) end;
  if coalesce(v_amount, 0) <= 0 then return; end if;
  insert into public.rider_earnings (rider_id, kind, source_id, order_id, claim_id, amount_kobo, from_area, to_area)
  values (p_rider, p_kind, p_source, p_order, p_claim, v_amount, case when p_kind <> 'failed_attempt' then v_from end, case when p_kind <> 'failed_attempt' then v_to end)
  on conflict (source_id, kind) do nothing;
end $$;

-- The area an order's buyer is in: their pin, or failing that the written address.
create function private.buyer_area(o public.orders) returns text
language sql stable set search_path = ''
as $$
  select case when o.delivery_lat is not null then private.nearest_area(o.delivery_lat, o.delivery_lng)
              when o.delivery_address is not null then private.area_from_text(o.delivery_address) end
$$;

create function private.earn_for_order() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_seller text;
  v_size text;
  v_point text;
begin
  if new.rider_id is null then return null; end if;
  select delivery_area into v_seller from public.merchants where id = new.merchant_id;
  select private.package_size_of(l.package_size, l.category) into v_size from public.listings l where l.id = new.listing_id;
  select private.nearest_area(lat, lng) into v_point from public.pickup_points where id = new.pickup_point_id;

  -- At the door, or refused there: the trip happened either way.
  if (new.status = 'delivered' and old.status <> 'delivered' and new.counter_at is null)
     or (new.cancel_reason in ('refused_wrong', 'refused_damaged') and old.status <> 'cancelled') then
    perform private.earn(new.rider_id, 'delivery', new.id, new.id, null, v_seller, private.buyer_area(new), v_size);
  end if;
  if new.counter_at is not null and old.counter_at is null then
    perform private.earn(new.rider_id, 'delivery', new.id, new.id, null, v_seller, v_point, v_size);
  end if;
  if new.return_state = 'returned' and old.return_state is distinct from 'returned' then
    perform private.earn(new.rider_id, 'return', new.id, new.id, null, case when new.counter_at is not null then v_point else private.buyer_area(new) end, v_seller, v_size);
  end if;
  return null;
end $$;
create trigger earn_on_order after update of status, counter_at, return_state on public.orders
  for each row execute function private.earn_for_order();

create function private.earn_for_claim() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare o public.orders;
begin
  if new.status = 'returned' and old.status <> 'returned' and new.rider_id is not null then
    select * into o from public.orders where id = new.order_id;
    perform private.earn(new.rider_id, 'return', new.id, o.id, new.id,
      case when new.return_lat is not null then private.nearest_area(new.return_lat, new.return_lng) end,
      (select delivery_area from public.merchants where id = o.merchant_id),
      (select private.package_size_of(l.package_size, l.category) from public.listings l where l.id = o.listing_id));
  end if;
  return null;
end $$;
create trigger earn_on_claim after update of status on public.order_claims
  for each row execute function private.earn_for_claim();

create function private.earn_for_attempt() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.earn(new.rider_id, 'failed_attempt', new.id, new.order_id, null, null, null, null);
  return null;
end $$;
create trigger earn_on_attempt after insert on private.delivery_attempts
  for each row execute function private.earn_for_attempt();

-- Named fields, for the rider's own page and the admins' pay list.
create function private.earning_json(e public.rider_earnings) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'kind', e.kind, 'amountKobo', e.amount_kobo, 'productCode', l.product_code, 'listingTitle', l.title,
    'fromArea', e.from_area, 'toArea', e.to_area, 'earnedAt', e.earned_at, 'paidAt', e.paid_at, 'reference', e.reference, 'paidTo', e.paid_to)
  from public.orders o join public.listings l on l.id = o.listing_id
  where o.id = e.order_id
$$;

create function public.my_earnings() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  return coalesce((select jsonb_agg(private.earning_json(e) order by e.earned_at desc) from public.rider_earnings e where e.rider_id = v_uid), '[]'::jsonb);
end $$;

-- riderPay.ts weekStart: Monday 00:00 in Lagos.
create function private.lagos_week_start() returns timestamptz
language sql stable set search_path = ''
as $$
  select date_trunc('week', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'
$$;

-- Riders with finished weeks unpaid, for admins.
create function public.rider_pay_due() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'riderId', p.id, 'riderName', p.display_name,
      'account', (select jsonb_build_object('bankCode', a.bank_code, 'bankName', a.bank_name, 'accountNumber', a.account_number, 'accountName', a.account_name, 'confirmedAt', a.confirmed_at, 'payableFrom', a.payable_from)
                    from public.rider_payout_accounts a where a.rider_id = p.id),
      'lines', (select jsonb_agg(private.earning_json(e) order by e.earned_at) from public.rider_earnings e
                 where e.rider_id = p.id and e.paid_at is null and e.earned_at < private.lagos_week_start())
    ) order by p.display_name)
    from public.profiles p
    where exists (select 1 from public.rider_earnings e where e.rider_id = p.id and e.paid_at is null and e.earned_at < private.lagos_week_start())
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- bank accounts

create table public.rider_payout_accounts (
  rider_id uuid primary key references public.profiles (id) on delete cascade,
  bank_code text not null,
  bank_name text not null,
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  account_name text not null,
  confirmed_at timestamptz not null default now(),
  payable_from timestamptz not null default now()
);
alter table public.rider_payout_accounts enable row level security;
create policy "own account, or admins" on public.rider_payout_accounts for select to authenticated
  using (rider_id = (select auth.uid()) or (select private.is_admin()));
revoke all on public.rider_payout_accounts from anon, authenticated;
grant select on public.rider_payout_accounts to authenticated;

create table private.rider_payout_account_history (
  rider_id uuid not null,
  bank_code text not null,
  bank_name text not null,
  account_number text not null,
  account_name text not null,
  confirmed_at timestamptz not null,
  replaced_at timestamptz not null default now()
);
revoke all on private.rider_payout_account_history from public, anon, authenticated;

-- A finished week's pay, or several. payouts.ts markPaidError, for riders.
create function public.mark_rider_paid(p_rider uuid, p_reference text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_reference text := btrim(coalesce(p_reference, ''));
  a public.rider_payout_accounts;
begin
  perform private.require_admin();
  -- Locked, so paying twice from two screens fails on the second.
  perform 1 from public.rider_earnings where rider_id = p_rider and paid_at is null order by id for update;
  if not exists (select 1 from public.rider_earnings where rider_id = p_rider and paid_at is null and earned_at < private.lagos_week_start()) then
    perform private.fail('invalid_input', 'This rider has nothing due from finished weeks.');
  end if;
  select * into a from public.rider_payout_accounts where rider_id = p_rider;
  if not found then perform private.fail('invalid_input', 'This rider hasn’t added a bank account yet.'); end if;
  if a.payable_from > now() then perform private.fail('invalid_input', 'This rider changed their bank account recently, so pay is on hold.'); end if;
  if length(v_reference) < 3 then perform private.fail('invalid_input', 'Enter the transfer’s reference.'); end if;

  update public.rider_earnings
     set paid_at = now(), reference = v_reference, paid_by = v_uid, paid_to = a.bank_name || ' •••• ' || right(a.account_number, 4)
   where rider_id = p_rider and paid_at is null and earned_at < private.lagos_week_start();
  insert into public.notifications (user_id, kind) values (p_rider, 'rider_paid');
end $$;

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
  'store_order_failed', 'store_suspended',
  'order_claim_update', 'store_order_claim',
  'store_new_review', 'review_reply',
  'store_approved',
  'store_support_reply',
  'rider_new_job', 'rider_new_return', 'rider_collect_soon', 'rider_job_released', 'rider_pin_unlocked',
  'order_ready_to_collect', 'order_collect_reminder', 'store_order_uncollected',
  'order_delivery_failed', 'store_order_undelivered', 'rider_redelivery_chosen',
  'rider_paid', 'rider_bank_changed'
));

revoke all on function private.rider_pay(text, text, text), private.earn(uuid, text, uuid, uuid, uuid, text, text, text), private.buyer_area(public.orders), private.earning_json(public.rider_earnings), private.lagos_week_start() from public, anon, authenticated;
revoke all on function public.set_rider_pay(text, text, bigint), public.set_rider_size_extra(text, bigint), public.set_rider_attempt_pay(bigint), public.my_earnings(), public.rider_pay_due(), public.mark_rider_paid(uuid, text) from public, anon;
grant execute on function public.set_rider_pay(text, text, bigint), public.set_rider_size_extra(text, bigint), public.set_rider_attempt_pay(bigint), public.my_earnings(), public.rider_pay_due(), public.mark_rider_paid(uuid, text) to authenticated;

-- Same as before, for riders too.
create or replace function public.note_bank_lookup(p_user uuid) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  -- Riders, but not counter staff, who aren't paid through the app.
  if exists (select 1 from public.profiles where id = p_user and role = 'delivery' and pickup_point_id is null) then
    if (select count(*) from private.bank_lookups where user_id = p_user and at > now() - interval '1 hour') >= 10 then return 'too_many'; end if;
    insert into private.bank_lookups (user_id) values (p_user);
    return 'ok';
  end if;
  if exists (select 1 from public.store_members where user_id = p_user and role <> 'owner') then return 'not_owner'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and coalesce(p.merchant_id, p.seller_id) is not null) then return 'not_seller'; end if;
  if (select count(*) from private.bank_lookups where user_id = p_user and at > now() - interval '1 hour') >= 10 then return 'too_many'; end if;
  insert into private.bank_lookups (user_id) values (p_user);
  return 'ok';
end $$;

-- Same as before, with riders' accounts.
create or replace function public.save_payout_account(p_user uuid, p_bank_code text, p_bank_name text, p_account_number text, p_account_name text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_merchant uuid;
  a public.payout_accounts;
  r public.rider_payout_accounts;
begin
  -- A rider's own account, held the same way when it changes.
  if exists (select 1 from public.profiles where id = p_user and role = 'delivery' and pickup_point_id is null) then
    if coalesce(p_account_number, '') !~ '^[0-9]{10}$' then perform private.fail('invalid_input', 'Enter the 10-digit account number.'); end if;
    if btrim(coalesce(p_account_name, '')) = '' or btrim(coalesce(p_bank_name, '')) = '' then perform private.fail('invalid_input', 'That account couldn’t be confirmed.'); end if;
    select * into r from public.rider_payout_accounts where rider_id = p_user for update;
    if not found then
      insert into public.rider_payout_accounts (rider_id, bank_code, bank_name, account_number, account_name)
      values (p_user, p_bank_code, p_bank_name, p_account_number, btrim(p_account_name));
      return;
    end if;
    if r.bank_code = p_bank_code and r.account_number = p_account_number then return; end if;
    insert into private.rider_payout_account_history (rider_id, bank_code, bank_name, account_number, account_name, confirmed_at)
    values (r.rider_id, r.bank_code, r.bank_name, r.account_number, r.account_name, r.confirmed_at);
    update public.rider_payout_accounts
       set bank_code = p_bank_code, bank_name = p_bank_name, account_number = p_account_number, account_name = btrim(p_account_name),
           confirmed_at = now(), payable_from = now() + interval '48 hours'
     where rider_id = p_user;
    insert into public.notifications (user_id, kind) values (p_user, 'rider_bank_changed');
    return;
  end if;
  if exists (select 1 from public.store_members where user_id = p_user and role <> 'owner') then perform private.fail('forbidden', 'Only the store’s owner can change the bank account.'); end if;
  select coalesce(merchant_id, seller_id) into v_merchant from public.profiles where id = p_user;
  if v_merchant is null then perform private.fail('forbidden', 'Only sellers can add a bank account.'); end if;
  if coalesce(p_account_number, '') !~ '^[0-9]{10}$' then perform private.fail('invalid_input', 'Enter the 10-digit account number.'); end if;
  if btrim(coalesce(p_account_name, '')) = '' or btrim(coalesce(p_bank_name, '')) = '' then perform private.fail('invalid_input', 'That account couldn’t be confirmed.'); end if;

  select * into a from public.payout_accounts where merchant_id = v_merchant for update;
  if not found then
    insert into public.payout_accounts (merchant_id, bank_code, bank_name, account_number, account_name)
    values (v_merchant, p_bank_code, p_bank_name, p_account_number, btrim(p_account_name));
    return;
  end if;
  -- The same account again changes nothing.
  if a.bank_code = p_bank_code and a.account_number = p_account_number then return; end if;

  insert into private.payout_account_history (merchant_id, bank_code, bank_name, account_number, account_name, confirmed_at, replaced_by)
  values (a.merchant_id, a.bank_code, a.bank_name, a.account_number, a.account_name, a.confirmed_at, p_user);
  update public.payout_accounts
     set bank_code = p_bank_code, bank_name = p_bank_name, account_number = p_account_number, account_name = btrim(p_account_name),
         confirmed_at = now(), payable_from = now() + interval '48 hours'
   where merchant_id = v_merchant;
  perform private.notify_shop(v_merchant, 'store_bank_changed', null);
end $$;

-- Same as before, with pay.
create or replace function private.push_for_rider_notification() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_what text := coalesce((select category from public.listings where id = new.listing_id), 'An item');
  v_where text := coalesce((select name from public.delivery_areas where id = new.area), 'Lagos');
begin
  case new.kind
    when 'rider_new_job' then
      perform private.queue_push(new.user_id, 'rider_new_jobs', 'New delivery job', v_what || ', to collect in ' || v_where || '.', '/delivery?tab=available', 'rider-new-jobs');
    when 'rider_new_return' then
      perform private.queue_push(new.user_id, 'rider_returns', 'Return to collect', v_what || ', to collect from a buyer in ' || v_where || '.', '/delivery?tab=returns', 'rider-returns');
    when 'rider_collect_soon' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'Collect it soon', 'A job you took goes back to the list in 30 minutes unless you collect it.', '/delivery?tab=mine', 'rider-collect-' || new.listing_id);
    when 'rider_job_released' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'A job went back to the list', 'It wasn’t collected in time, so another rider can take it.', '/delivery?tab=available', 'rider-collect-' || new.listing_id);
    when 'rider_pin_unlocked' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'You can try the PIN again', 'The pause on a delivery’s PIN is over.', '/delivery?tab=mine', 'rider-pin-' || new.listing_id);
    when 'rider_redelivery_chosen' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'Delivery rebooked', 'A buyer you missed chose a new time or a pickup location.', '/delivery?tab=mine', 'rider-rebooked-' || new.listing_id);
    when 'rider_paid' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'Pay sent', 'We’ve sent your pay to your bank account.', '/delivery/earnings', 'rider-paid-' || new.id);
    when 'rider_bank_changed' then
      -- Not a kind anyone can switch off: it's how they find out if it wasn't them.
      perform private.queue_push(new.user_id, 'security', 'Bank account changed', 'Your bank account for pay was changed. If this wasn’t you, contact DrawMart now.', '/delivery/earnings', 'rider-bank-' || new.id);
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_rider_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, wiping riders' pay too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.rider_earnings, public.rider_payout_accounts, private.rider_payout_account_history, private.delivery_attempts, private.job_releases, public.store_activity, public.store_invites, private.owed_checks, private.discount_redemptions, public.discount_listings, public.discounts, public.quick_replies, public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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
