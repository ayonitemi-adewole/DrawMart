-- Winners wall. A winner can choose to show their first name and area next to what
-- they won, once an admin approves it, and can withdraw at any time. domain/winnerStories.ts.
--
-- No client can read this table. It ties a user to a win, which draw_results keeps
-- hidden, so everything goes through functions that return named fields and no user id.
create table public.winner_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  first_name text,
  area text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  consent_version int not null,
  consent_at timestamptz not null default now(),
  reviewed_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, listing_id),
  -- Withdrawing removes the name and area, not just their visibility.
  constraint winner_stories_details check (case status when 'withdrawn' then first_name is null and area is null else first_name is not null and area is not null end)
);
alter table public.winner_stories enable row level security;
revoke all on public.winner_stories from anon, authenticated;

-- What was agreed to and when, with no name or area, kept after a withdrawal.
create table private.winner_consent_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null,
  event text not null check (event in ('given', 'withdrawn')),
  consent_version int not null,
  at timestamptz not null default now()
);
revoke all on private.winner_consent_log from public, anon, authenticated;

-- winnerStories.ts winnerStoryError
create function private.winner_story_error(p_first_name text, p_area text, p_consent boolean) returns text
language sql immutable set search_path = ''
as $$
  select case
    when coalesce(trim(p_first_name), '') !~ '^[[:alpha:]''’-]{2,30}$' then 'Enter just your first name: one word, with no numbers.'
    when coalesce(p_area, '') not in ('Agege', 'Ajah', 'Alimosho', 'Apapa', 'Badagry', 'Epe', 'Festac', 'Gbagada', 'Ikeja', 'Ikorodu', 'Ikoyi', 'Ilupeju', 'Isolo', 'Ketu',
      'Lagos Island', 'Lekki', 'Magodo', 'Maryland', 'Mushin', 'Ogba', 'Ojo', 'Ojodu', 'Oshodi', 'Surulere', 'Victoria Island', 'Yaba') then 'Choose your area from the list.'
    when not coalesce(p_consent, false) then 'Tick the box to agree, or leave this out. Your prize isn’t affected.'
  end
$$;

-- Sharing again, after an edit or a withdrawal, goes back for review and off the wall until then.
create function public.share_winner_story(p_listing_id uuid, p_first_name text, p_area text, p_consent boolean, p_consent_version int) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_error text := private.winner_story_error(p_first_name, p_area, p_consent);
begin
  perform private.require_buyer(v_uid);
  if v_error is not null then perform private.fail('invalid_input', v_error); end if;
  if not private.has_won(v_uid, p_listing_id) then perform private.fail('forbidden', 'Only the winner of a draw can share it.'); end if;
  insert into public.winner_stories (user_id, listing_id, first_name, area, status, consent_version)
  values (v_uid, p_listing_id, trim(p_first_name), p_area, 'pending', p_consent_version)
  on conflict (user_id, listing_id) do update
    set first_name = excluded.first_name, area = excluded.area, status = 'pending', consent_version = excluded.consent_version,
        consent_at = now(), reviewed_at = null, withdrawn_at = null;
  insert into private.winner_consent_log (user_id, listing_id, event, consent_version) values (v_uid, p_listing_id, 'given', p_consent_version);
end $$;

create function public.withdraw_winner_story(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_version int;
begin
  update public.winner_stories set status = 'withdrawn', first_name = null, area = null, withdrawn_at = now()
   where user_id = v_uid and listing_id = p_listing_id and status <> 'withdrawn'
   returning consent_version into v_version;
  if found then
    insert into private.winner_consent_log (user_id, listing_id, event, consent_version) values (v_uid, p_listing_id, 'withdrawn', v_version);
  end if;
end $$;

create function public.my_winner_stories() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'listingId', s.listing_id, 'listingTitle', l.title, 'firstName', s.first_name, 'area', s.area, 'status', s.status, 'consentAt', s.consent_at
  ) order by s.created_at desc), '[]'::jsonb)
  from public.winner_stories s join public.listings l on l.id = s.listing_id
  where s.user_id = auth.uid() and s.status <> 'withdrawn'
$$;

-- Public. First name and area are the only personal details that ever leave this table.
create function public.winners_wall() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(w order by w."drawnAt" desc), '[]'::jsonb) from (
    select s.id, s.first_name as "firstName", s.area, s.listing_id as "listingId", l.product_code as "productCode", l.title as "listingTitle",
           l.images[1] as "listingImage", l.category, r.winning_number as "winningNumber", l.ticket_count as "ticketCount", r.drawn_at as "drawnAt"
      from public.winner_stories s
      join public.listings l on l.id = s.listing_id
      join public.draw_results r on r.listing_id = s.listing_id
     where s.status = 'approved'
     order by r.drawn_at desc
     limit 60
  ) w
$$;

create function public.pending_winner_stories() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'firstName', s.first_name, 'area', s.area, 'listingId', s.listing_id, 'productCode', l.product_code, 'listingTitle', l.title, 'consentAt', s.consent_at
    ) order by s.consent_at), '[]'::jsonb)
    from public.winner_stories s join public.listings l on l.id = s.listing_id
    where s.status = 'pending'
  );
end $$;

create function public.review_winner_story(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.winner_stories set status = case when p_approve then 'approved' else 'rejected' end, reviewed_at = now()
   where id = p_id and status = 'pending';
  if not found then perform private.fail('invalid_input', 'That story is no longer waiting for review. The winner may have withdrawn it.'); end if;
end $$;

revoke execute on function
  private.winner_story_error(text, text, boolean),
  public.share_winner_story(uuid, text, text, boolean, int), public.withdraw_winner_story(uuid), public.my_winner_stories(),
  public.winners_wall(), public.pending_winner_stories(), public.review_winner_story(uuid, boolean)
from public, anon, authenticated;
grant execute on function
  public.share_winner_story(uuid, text, text, boolean, int), public.withdraw_winner_story(uuid), public.my_winner_stories(),
  public.pending_winner_stories(), public.review_winner_story(uuid, boolean)
to authenticated;
grant execute on function public.winners_wall() to anon, authenticated;

-- Same as before, with the two new tables emptied too.
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
           public.saved_listings, public.winner_stories, private.winner_consent_log;

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
