-- A store can save draw items and come back later to add more or book the
-- pickup (src/domain/listing.ts). One saved pickup per store, holding items
-- only: no listing exists and no fee is paid until it's sent for review.
--
-- It lasts app_settings.saved_pickup_days from the first save. Changing it
-- doesn't extend that; afterwards it's gone and the next save starts afresh.

alter table public.app_settings add column saved_pickup_days int not null default 7 check (saved_pickup_days > 0);

create table public.saved_pickups (
  merchant_id uuid primary key references public.merchants (id) on delete cascade,
  items jsonb not null,
  saved_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.saved_pickups enable row level security;
create policy "own store, until it expires" on public.saved_pickups for select to authenticated
  using (merchant_id = (select private.my_merchant_id()) and expires_at > now());
revoke all on public.saved_pickups from anon, authenticated;
grant select on public.saved_pickups to authenticated;

-- Replaces the store's saved items; an empty list removes them. Items are only
-- fully checked when sent for review, by create_listing.
create function public.save_pickup_items(p_items jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_merchant uuid;
begin
  select merchant_id into v_merchant from public.profiles where id = v_uid;
  if v_merchant is null then perform private.fail('forbidden', 'Only store accounts can save draw items.'); end if;
  if jsonb_typeof(p_items) is distinct from 'array' then perform private.fail('invalid_input', 'Those items couldn’t be saved.'); end if;

  if jsonb_array_length(p_items) = 0 then
    delete from public.saved_pickups where merchant_id = v_merchant;
    return;
  end if;
  if jsonb_array_length(p_items) > 10 then perform private.fail('invalid_input', 'One pickup can take at most 10 items.'); end if;
  if exists (select 1 from jsonb_array_elements(p_items) i where i ->> 'category' = 'Cars') then
    perform private.fail('invalid_input', 'Cars are inspected where they are, so they can’t be saved to a pickup. List them on their own.');
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i, jsonb_array_elements_text(coalesce(i -> 'images', '[]'::jsonb)) u where u !~ '^(https://|/assets/)') then
    perform private.fail('invalid_input', 'Upload the photos before saving.');
  end if;

  insert into public.saved_pickups (merchant_id, items, expires_at)
  values (v_merchant, p_items, now() + make_interval(days => (private.settings()).saved_pickup_days))
  on conflict (merchant_id) do update
    set items = excluded.items,
        -- An expired one starts afresh; a live one keeps its deadline.
        saved_at = case when public.saved_pickups.expires_at > now() then public.saved_pickups.saved_at else excluded.saved_at end,
        expires_at = case when public.saved_pickups.expires_at > now() then public.saved_pickups.expires_at else excluded.expires_at end;
end $$;

create function private.delete_expired_saved_pickups() returns void
language sql security definer set search_path = ''
as $$ delete from public.saved_pickups where expires_at <= now() $$;

create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.messages, public.conversations, public.merchant_contacts, public.orders, public.boosts,
           public.listing_views, public.tickets, public.draw_results, public.ledger_entries, public.deposits,
           public.pending_limits, public.listing_handovers, private.listing_seeds, public.listings,
           public.seller_applications, public.saved_pickups;

  -- Individual sellers go back to being plain buyers; their shops go.
  update public.profiles set seller_id = null where seller_id is not null;
  delete from public.merchants where kind = 'individual';

  -- Back to how a new account starts.
  update public.profiles set state = 'Lagos', age_verified = true, weekly_limit_kobo = s.default_weekly_limit_kobo where role = 'buyer';
  update public.app_settings set boosts_forced_on = false, boost_min_active_buyers = 1000, boost_max_active = 12 where id;

  -- The starting balance for every buyer. Test accounts created below get theirs from the sign-up trigger.
  insert into public.ledger_entries (user_id, kind, cash_kobo, memo)
  select id, 'topup', s.welcome_credit_kobo, 'Welcome top-up (test money)' from public.profiles where role = 'buyer' and s.welcome_credit_kobo > 0;

  perform private.seed_demo_data();
  perform private.seed_test_accounts();
end $$;

revoke execute on function public.save_pickup_items(jsonb), private.delete_expired_saved_pickups() from public, anon, authenticated;
grant execute on function public.save_pickup_items(jsonb) to authenticated;

-- Hourly clean-up. Expired ones are already hidden, so this is only housekeeping.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drawmart-expired-saved-pickups', '7 * * * *', 'select private.delete_expired_saved_pickups()');
  end if;
end $$;
