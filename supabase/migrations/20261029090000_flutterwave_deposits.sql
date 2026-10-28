-- Wallet top-ups through Flutterwave (card, bank transfer, USSD).
--
-- Flow
--   1. The app calls start_deposit(amount), which records a pending deposit
--      with a fresh tx_ref.
--   2. The buyer pays in Flutterwave's checkout, using that tx_ref.
--   3. The confirm-deposit Edge Function asks Flutterwave (with the secret key,
--      never the browser's word) whether the tx_ref was paid, then calls
--      complete_deposit. The flutterwave-webhook function does the same when
--      Flutterwave reports a payment later, e.g. a slow bank transfer.
--   complete_deposit credits the wallet once per deposit, whichever path
--   gets there first.

-- Size of one top-up (rules.ts RULES.minTopUpKobo / maxTopUpKobo).
alter table public.app_settings
  add column min_top_up_kobo bigint not null default 10000,
  add column max_top_up_kobo bigint not null default 50000000;

create table public.deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  tx_ref text not null unique,
  amount_kobo bigint not null check (amount_kobo > 0),
  -- cancelled: the buyer closed the checkout without paying. A payment that
  -- still arrives for it (a late bank transfer) is credited as normal.
  status text not null default 'pending' check (status in ('pending', 'successful', 'failed', 'cancelled')),
  provider text not null default 'flutterwave',
  -- Flutterwave's transaction id, for support and reconciliation.
  provider_ref text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index deposits_user_idx on public.deposits (user_id, created_at desc);

alter table public.deposits enable row level security;
create policy "read own deposits" on public.deposits for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.deposits from anon, authenticated;
grant select on public.deposits to authenticated;

-- rules.ts topUpError
create function private.check_top_up(p_amount_kobo bigint) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  if p_amount_kobo is null or p_amount_kobo <= 0 then perform private.fail('invalid_input', 'Enter an amount to add.'); end if;
  if p_amount_kobo < s.min_top_up_kobo then
    perform private.fail('invalid_input', format('The smallest top-up is ₦%s.', to_char(s.min_top_up_kobo / 100, 'FM999,999,999,999')));
  end if;
  if p_amount_kobo > s.max_top_up_kobo then
    perform private.fail('invalid_input', format('The largest single top-up is ₦%s.', to_char(s.max_top_up_kobo / 100, 'FM999,999,999,999')));
  end if;
end $$;

-- Test money top-ups now follow the same size limits.
create or replace function public.top_up(p_amount_kobo bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  if not (private.settings()).test_mode then perform private.fail('forbidden', 'Top-ups go through the payment provider.'); end if;
  perform private.check_top_up(p_amount_kobo);
  insert into public.ledger_entries (user_id, kind, cash_kobo, memo) values (v_uid, 'topup', p_amount_kobo, 'Wallet top-up (test money)');
end $$;

-- Step 1. Returns what the checkout needs.
create function public.start_deposit(p_amount_kobo bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_ref text := 'DM-' || upper(replace(gen_random_uuid()::text, '-', ''));
  v_email text;
begin
  perform private.check_top_up(p_amount_kobo);
  if (select count(*) from public.deposits where user_id = v_uid and status = 'pending' and created_at > now() - interval '1 hour') >= 10 then
    perform private.fail('invalid_input', 'Too many unfinished top-ups. Try again in a little while.');
  end if;
  select email into v_email from auth.users where id = v_uid;
  if coalesce(v_email, '') = '' then perform private.fail('invalid_input', 'Your account needs an email address to pay.'); end if;

  insert into public.deposits (user_id, tx_ref, amount_kobo) values (v_uid, v_ref, p_amount_kobo);
  return jsonb_build_object(
    'txRef', v_ref,
    'amountKobo', p_amount_kobo,
    'email', v_email,
    'name', (select display_name from public.profiles where id = v_uid));
end $$;

-- The buyer closed the checkout without paying.
create function public.cancel_deposit(p_tx_ref text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  update public.deposits set status = 'cancelled', completed_at = now()
   where tx_ref = p_tx_ref and user_id = v_uid and status = 'pending';
end $$;

-- Step 3. Only the Edge Functions (service role) may call this, with what
-- Flutterwave's verify API said about the tx_ref. Returns the deposit status.
create function public.complete_deposit(p_tx_ref text, p_status text, p_amount_kobo bigint, p_currency text, p_provider_ref text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare d public.deposits;
begin
  select * into d from public.deposits where tx_ref = p_tx_ref for update;
  if not found then perform private.fail('not_found', 'No such deposit.'); end if;
  if d.status = 'successful' then return 'successful'; end if; -- already credited

  if p_status = 'successful' then
    -- Paid less, or in another currency: don't credit. An admin settles it with Flutterwave.
    if p_currency is distinct from 'NGN' or p_amount_kobo is null or p_amount_kobo < d.amount_kobo then
      update public.deposits set status = 'failed', provider_ref = p_provider_ref, completed_at = now() where id = d.id;
      return 'failed';
    end if;
    insert into public.ledger_entries (user_id, kind, cash_kobo, memo)
    values (d.user_id, 'topup', d.amount_kobo,
            case when (private.settings()).test_mode then 'Wallet top-up (Flutterwave test)' else 'Wallet top-up' end);
    update public.deposits set status = 'successful', provider_ref = p_provider_ref, completed_at = now() where id = d.id;
    return 'successful';
  end if;

  if p_status = 'failed' and d.status = 'pending' then
    update public.deposits set status = 'failed', provider_ref = p_provider_ref, completed_at = now() where id = d.id;
    return 'failed';
  end if;
  return d.status;
end $$;

revoke execute on function
  private.check_top_up(bigint),
  public.start_deposit(bigint),
  public.cancel_deposit(text),
  public.complete_deposit(text, text, bigint, text, text)
from public, anon, authenticated;
grant execute on function public.start_deposit(bigint), public.cancel_deposit(text) to authenticated;
grant execute on function public.complete_deposit(text, text, bigint, text, text) to service_role;
