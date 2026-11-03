-- Rider job limits (riderLimits.ts). A rider holds at most rider_max_jobs jobs at
-- once, deliveries and returns together, and a job not collected within
-- rider_collect_minutes of being taken goes back to the pool. Once collected
-- there's no limit, since the item is in their hands. Admins tune both here.

alter table public.app_settings
  add column rider_max_jobs int not null default 5 check (rider_max_jobs > 0),
  add column rider_collect_minutes int not null default 120 check (rider_collect_minutes > 0);

-- Returns had no record of when they were taken.
alter table public.order_claims add column rider_assigned_at timestamptz;
update public.order_claims set rider_assigned_at = now() where rider_id is not null and status = 'awaiting_pickup';

-- Why a job went back to the pool, for the dispatch board later. Riders only
-- ever see their own jobs, so nobody but admins reads this.
create table private.job_releases (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete cascade,
  claim_id uuid references public.order_claims (id) on delete cascade,
  rider_id uuid not null references public.profiles (id),
  reason text not null check (reason in ('handed_back', 'not_collected')),
  taken_at timestamptz,
  released_at timestamptz not null default now(),
  check ((order_id is null) <> (claim_id is null))
);
create index job_releases_rider_idx on private.job_releases (rider_id, released_at);
alter table private.job_releases enable row level security;
revoke all on private.job_releases from public, anon, authenticated;

-- Everything a rider is holding: deliveries before and after collecting, refused
-- items on the way back, and returns.
create function private.rider_jobs_held(p_rider uuid) returns int
language sql stable security definer set search_path = ''
as $$
  select (select count(*) from public.orders where rider_id = p_rider and (status = 'dispatched' or return_state = 'returning'))::int
       + (select count(*) from public.order_claims where rider_id = p_rider and status in ('awaiting_pickup', 'returning'))::int
$$;

-- riderLimits.ts takeJobError. Locks the rider's profile so two quick taps can't both get under the limit.
create function private.require_job_room(p_rider uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_max int := (private.settings()).rider_max_jobs;
begin
  perform 1 from public.profiles where id = p_rider for update;
  if private.rider_jobs_held(p_rider) >= v_max then
    perform private.fail('invalid_input', format('You have %s jobs, the most you can hold at once. Deliver or hand one back first.', v_max));
  end if;
end $$;

-- Same as before, within the limit.
create or replace function public.take_delivery(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  perform private.require_job_room(v_uid);
  update public.orders set rider_id = v_uid, rider_assigned_at = now(), collected_at = case when is_prize then now() end
   where id = p_order_id and status = 'dispatched' and rider_id is null;
  if not found then perform private.fail('invalid_input', 'Another rider has taken this delivery.'); end if;
end $$;

-- Same as before, recording it.
create or replace function public.release_delivery(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_taken timestamptz;
begin
  select rider_assigned_at into v_taken from public.orders where id = p_order_id and status = 'dispatched' and rider_id = v_uid for update;
  if not found then perform private.fail('invalid_input', 'Only deliveries you’re carrying can be handed back.'); end if;
  update public.orders set rider_id = null, rider_assigned_at = null, collected_at = null, collection_photos = null where id = p_order_id;
  insert into private.job_releases (order_id, rider_id, reason, taken_at) values (p_order_id, v_uid, 'handed_back', v_taken);
end $$;

-- Same as before, within the limit.
create or replace function public.take_return(p_claim_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  perform private.require_job_room(v_uid);
  update public.order_claims set rider_id = v_uid, rider_assigned_at = now() where id = p_claim_id and status = 'awaiting_pickup' and rider_id is null;
  if not found then perform private.fail('invalid_input', 'Another rider has taken this return.'); end if;
end $$;

-- Same as before, recording it.
create or replace function public.release_return(p_claim_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_taken timestamptz;
begin
  select rider_assigned_at into v_taken from public.order_claims where id = p_claim_id and status = 'awaiting_pickup' and rider_id = v_uid for update;
  if not found then perform private.fail('invalid_input', 'Only returns you haven’t collected can be handed back.'); end if;
  update public.order_claims set rider_id = null, rider_assigned_at = null where id = p_claim_id;
  insert into private.job_releases (claim_id, rider_id, reason, taken_at) values (p_claim_id, v_uid, 'handed_back', v_taken);
end $$;

-- riderLimits.ts collectionOverdue. Run by process_deadlines.
create function private.release_late_jobs() returns void
language plpgsql security definer set search_path = ''
as $$
declare v_cutoff timestamptz := now() - make_interval(mins => (private.settings()).rider_collect_minutes);
begin
  with late as (
    select id, rider_id, rider_assigned_at from public.orders
     where status = 'dispatched' and rider_id is not null and collected_at is null and rider_assigned_at <= v_cutoff
       for update skip locked
  ), freed as (
    update public.orders o set rider_id = null, rider_assigned_at = null, collection_photos = null
      from late where o.id = late.id
    returning late.id, late.rider_id, late.rider_assigned_at
  )
  insert into private.job_releases (order_id, rider_id, reason, taken_at)
  select id, rider_id, 'not_collected', rider_assigned_at from freed;

  with late as (
    select id, rider_id, rider_assigned_at from public.order_claims
     where status = 'awaiting_pickup' and rider_id is not null and rider_assigned_at <= v_cutoff
       for update skip locked
  ), freed as (
    update public.order_claims c set rider_id = null, rider_assigned_at = null
      from late where c.id = late.id
    returning late.id, late.rider_id, late.rider_assigned_at
  )
  insert into private.job_releases (claim_id, rider_id, reason, taken_at)
  select id, rider_id, 'not_collected', rider_assigned_at from freed;
end $$;

-- Same as before, releasing jobs nobody collected.
create or replace function private.process_deadlines() returns int
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

  perform private.run_due_draws();
  perform private.closing_soon_alerts();
  perform private.store_reminders();
  perform private.order_confirm_deadlines();
  perform private.release_sale_payouts();
  perform private.release_late_jobs();

  return n;
end $$;

-- Same as before, with when it must be collected by.
create or replace function public.delivery_jobs() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_mins int := (private.settings()).rider_collect_minutes;
begin
  return (
    select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."deliveredAt" desc nulls first, x."dispatchedAt"), '[]'::jsonb)
    from (
      select
        o.id,
        l.product_code as "productCode",
        l.title as "listingTitle",
        o.quantity,
        o.confirm_photo as "confirmPhoto",
        o.collected_at is not null as collected,
        o.return_state is not distinct from 'returning' as returning,
        l.images[1] as "listingImage",
        l.category,
        o.fulfilment,
        o.status,
        o.dispatched_at as "dispatchedAt",
        o.delivered_at as "deliveredAt",
        o.rider_id is not null as mine,
        case when o.rider_id = v_uid and o.status = 'dispatched' and o.collected_at is null
          then o.rider_assigned_at + make_interval(mins => v_mins) end as "collectBy",
        case when o.handled_by = 'drawmart'
          then jsonb_build_object('name', 'DrawMart escrow', 'area', 'Lagos')
          else jsonb_build_object('name', m.name, 'area', m.area) || case
            -- Only for the rider on the way there, or bringing a refused item back.
            when o.rider_id = v_uid and ((o.status = 'dispatched' and o.collected_at is null) or o.return_state = 'returning') then coalesce((
              select jsonb_build_object('address', sp.address, 'contactPhone', sp.contact_phone, 'location', jsonb_build_object('lat', sp.lat, 'lng', sp.lng))
                from public.shop_pickups sp where sp.merchant_id = m.id
            ), '{}'::jsonb)
            else '{}'::jsonb
          end end as "collectFrom",
        case when pp.id is not null then jsonb_build_object(
          'id', pp.id, 'name', pp.name, 'area', pp.area, 'address', pp.address, 'hours', pp.hours,
          'location', jsonb_build_object('lat', pp.lat, 'lng', pp.lng)) end as "pickupPoint",
        case when o.rider_id = v_uid and o.status = 'dispatched' and o.collected_at is not null then jsonb_build_object(
          'buyerName', b.display_name,
          'address', coalesce(o.delivery_address, ''),
          'location', case when o.delivery_lat is not null then jsonb_build_object('lat', o.delivery_lat, 'lng', o.delivery_lng) end,
          'contactPhone', o.delivery_phone) end as "dropOff",
        case when o.status = 'dispatched' then (select p.locked_until from private.order_pins p where p.order_id = o.id and p.locked_until > now()) end as "pinLockedUntil"
      from public.orders o
      join public.listings l on l.id = o.listing_id
      join public.merchants m on m.id = o.merchant_id
      join public.profiles b on b.id = o.user_id
      left join public.pickup_points pp on pp.id = o.pickup_point_id
      where (o.status = 'dispatched' and o.rider_id is null)
         or (o.rider_id = v_uid and (o.status in ('dispatched', 'delivered') or o.return_state = 'returning'))
      order by o.delivered_at desc nulls first
      limit 200
    ) x
  );
end $$;

-- Same as before, with when it must be collected by.
create or replace function public.return_jobs() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_mins int := (private.settings()).rider_collect_minutes;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'status', c.status, 'mine', c.rider_id is not null,
      'collectBy', case when c.rider_id = v_uid and c.status = 'awaiting_pickup' then c.rider_assigned_at + make_interval(mins => v_mins) end,
      'productCode', l.product_code, 'listingTitle', l.title, 'listingImage', l.images[1], 'quantity', o.quantity, 'category', l.category,
      'returnTo', jsonb_build_object('name', m.name, 'area', m.area) || case when c.rider_id = v_uid and c.status = 'returning' then coalesce((
        select jsonb_build_object('address', sp.address, 'contactPhone', sp.contact_phone, 'location', jsonb_build_object('lat', sp.lat, 'lng', sp.lng)) from public.shop_pickups sp where sp.merchant_id = m.id
      ), '{}'::jsonb) else '{}'::jsonb end,
      'pickupFrom', case when c.rider_id = v_uid and c.status = 'awaiting_pickup' then jsonb_build_object(
        'buyerName', b.display_name, 'address', c.return_address, 'location', jsonb_build_object('lat', c.return_lat, 'lng', c.return_lng), 'contactPhone', c.return_phone) end
    ) order by c.created_at)
    from public.order_claims c
    join public.orders o on o.id = c.order_id join public.listings l on l.id = o.listing_id
    join public.merchants m on m.id = o.merchant_id join public.profiles b on b.id = o.user_id
    where (c.status = 'awaiting_pickup' and c.rider_id is null) or (c.rider_id = v_uid and c.status in ('awaiting_pickup', 'returning'))
  ), '[]'::jsonb);
end $$;

-- Same as before, wiping the record of released jobs too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate private.job_releases, public.store_activity, public.store_invites, private.owed_checks, private.discount_redemptions, public.discount_listings, public.discounts, public.quick_replies, public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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
