-- Saved items: a buyer's own list of draws and products. Only that buyer can read
-- it: not stores, and not admins. domain/saved.ts.
create table public.saved_listings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
alter table public.saved_listings enable row level security;
create policy "own saved listings" on public.saved_listings for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.saved_listings from anon, authenticated;
grant select on public.saved_listings to authenticated;

-- saved.ts canSaveListing. A listing buyers can't see looks the same as one that doesn't exist.
create function public.save_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  perform private.require_buyer(v_uid);
  if not exists (
    select 1 from public.listings
     where id = p_listing_id and status in ('live', 'sold_out', 'drawn', 'refunded', 'for_sale', 'sold')
  ) then
    perform private.fail('not_found', 'That item doesn’t exist.');
  end if;
  insert into public.saved_listings (user_id, listing_id) values (v_uid, p_listing_id) on conflict do nothing;
end $$;

create function public.unsave_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  delete from public.saved_listings where user_id = v_uid and listing_id = p_listing_id;
end $$;

revoke execute on function public.save_listing(uuid), public.unsave_listing(uuid) from public, anon, authenticated;
grant execute on function public.save_listing(uuid), public.unsave_listing(uuid) to authenticated;

-- Same as before, with saved_listings emptied too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
           public.listing_views, public.tickets, public.draw_results, public.ledger_entries, public.deposits,
           public.pending_limits, public.listing_handovers, private.listing_seeds, public.listings,
           public.seller_applications, public.saved_pickups, public.notifications, public.cart_items, public.saved_addresses,
           public.saved_listings;

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
