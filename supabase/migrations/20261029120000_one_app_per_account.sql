-- Buyer, store and admin are separate apps, and every account belongs to
-- exactly one of them (profiles.role). Sign-ups are always buyers; an admin
-- turns an account into a store or an admin account (docs/supabase-setup.md).
--
-- Only buyer accounts hold tickets or put money in a wallet.

-- Existing store links become store accounts; admins can't also run a store.
alter table public.profiles drop constraint profiles_role_check;
update public.profiles set merchant_id = null where role = 'admin';
update public.profiles set role = 'store' where merchant_id is not null;
alter table public.profiles
  add constraint profiles_role_check check (role in ('buyer', 'store', 'admin')),
  add constraint profiles_store_has_merchant check ((role = 'store') = (merchant_id is not null));

create function private.require_buyer(p_user uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce((select role from public.profiles where id = p_user), 'buyer') <> 'buyer' then
    perform private.fail('forbidden', 'Only buyer accounts can do this. Sign in with a buyer account.');
  end if;
end $$;

-- Guards on the rows themselves, so every path (buy_tickets, start_deposit, …)
-- is covered. Demo filler tickets have no user and pass.
create function private.buyers_only() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id is not null then perform private.require_buyer(new.user_id); end if;
  return new;
end $$;

create trigger tickets_buyers_only before insert on public.tickets
for each row execute function private.buyers_only();
create trigger deposits_buyers_only before insert on public.deposits
for each row execute function private.buyers_only();

create or replace function public.top_up(p_amount_kobo bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  if not (private.settings()).test_mode then perform private.fail('forbidden', 'Top-ups go through the payment provider.'); end if;
  perform private.require_buyer(v_uid);
  perform private.check_top_up(p_amount_kobo);
  insert into public.ledger_entries (user_id, kind, cash_kobo, memo) values (v_uid, 'topup', p_amount_kobo, 'Wallet top-up (test money)');
end $$;

revoke execute on function private.require_buyer(uuid), private.buyers_only() from public, anon, authenticated;
