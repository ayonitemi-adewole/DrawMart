-- Delivery ratings and rider performance (deliveryRatings.ts, built 3 Nov 2026). After a
-- delivery to their door, the buyer rates the delivery itself, thumbs up or down with
-- optional reasons for a down, separately from the seller review. Ratings are kept in
-- private, with no client access: buyers read their own through my_delivery_ratings,
-- riders only totals through my_rider_stats (from 5 ratings, none given today, so they
-- can't tell who gave which), and admins see riders to follow up in rider_performance.

create table private.delivery_ratings (
  order_id uuid primary key references public.orders (id) on delete cascade,
  rider_id uuid not null references public.profiles (id),
  user_id uuid not null references public.profiles (id),
  good boolean not null,
  reasons text[] not null default '{}' check (reasons <@ array['late', 'no_call', 'rude', 'careless', 'unsafe'] and (not good or cardinality(reasons) = 0)),
  rated_at timestamptz not null default now()
);
create index delivery_ratings_rider_idx on private.delivery_ratings (rider_id, rated_at);
revoke all on private.delivery_ratings from public, anon, authenticated;

-- deliveryRatings.ts deliveredOnTime. Null when it can't be told.
create function private.delivered_on_time(o public.orders) returns boolean
language sql stable set search_path = ''
as $$
  select case
    when o.redelivery_choice = 'redeliver' and o.redeliver_at is not null then d.done <= o.redeliver_at + interval '2 hours'
    when o.window_end is not null then d.done <= o.window_end
    when o.collected_at is null then null
    else d.done - o.collected_at <= interval '4 hours' end
  from (select coalesce(o.counter_at, o.delivered_at) as done) d
$$;

-- A rider's finished jobs: handed to the buyer or a pickup counter, in the last 30 days.
create function private.rider_done_jobs(p_rider uuid) returns setof public.orders
language sql stable security definer set search_path = ''
as $$
  select * from public.orders o
   where o.rider_id = p_rider and o.return_state is null
     and coalesce(o.counter_at, o.delivered_at) > now() - interval '30 days'
$$;

-- Counted reasons, e.g. {"late": 2}.
create function private.reason_counts(p_reasons text[]) returns jsonb
language sql immutable set search_path = ''
as $$ select coalesce(jsonb_object_agg(x, n), '{}'::jsonb) from (select x, count(*) n from unnest(p_reasons) x group by x) q $$;

revoke all on function private.delivered_on_time(public.orders), private.rider_done_jobs(uuid), private.reason_counts(text[]) from public, anon, authenticated;

-- deliveryRatings.ts canRateDelivery and ratingError. Changeable within the week.
create function public.rate_delivery(p_order_id uuid, p_good boolean, p_reasons text[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_reasons text[] := coalesce(p_reasons, '{}');
  o public.orders;
begin
  perform private.require_buyer(v_uid);
  select x.* into o from public.orders x join public.listings l on l.id = x.listing_id
   where x.id = p_order_id and x.user_id = v_uid and x.status = 'delivered' and x.fulfilment = 'delivery' and l.category <> 'Cars'
     and x.rider_id is not null and x.delivered_at > now() - interval '7 days';
  if not found then perform private.fail('invalid_input', 'You can rate a delivery to your door for 7 days after it arrives.'); end if;
  if p_good is null then perform private.fail('invalid_input', 'Choose thumbs up or down.'); end if;
  if p_good and cardinality(v_reasons) > 0 then perform private.fail('invalid_input', 'Reasons are only for a thumbs down.'); end if;
  if not (v_reasons <@ array['late', 'no_call', 'rude', 'careless', 'unsafe']) or cardinality(v_reasons) <> (select count(distinct x) from unnest(v_reasons) x) then
    perform private.fail('invalid_input', 'Pick from the reasons shown.');
  end if;
  insert into private.delivery_ratings (order_id, rider_id, user_id, good, reasons)
  values (o.id, o.rider_id, v_uid, p_good, v_reasons)
  on conflict (order_id) do update set good = excluded.good, reasons = excluded.reasons, rated_at = now();
end $$;

-- The buyer's own ratings, by order id. Never the rider.
create function public.my_delivery_ratings() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(order_id, jsonb_build_object('good', good, 'reasons', to_jsonb(reasons), 'ratedAt', rated_at)), '{}'::jsonb)
  from private.delivery_ratings where user_id = auth.uid()
$$;

-- deliveryRatings.ts riderStats: totals only, from 5 ratings, none given today.
create function public.my_rider_stats() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  return (
    with j as (select private.delivered_on_time(o) as t from private.rider_done_jobs(v_uid) o),
    r as (
      select good, reasons from private.delivery_ratings
       where rider_id = v_uid and rated_at > now() - interval '30 days'
         and (rated_at at time zone 'Africa/Lagos')::date < (now() at time zone 'Africa/Lagos')::date
    )
    select jsonb_build_object(
      'completed', (select count(*) from j),
      'onTimeShare', (select avg(case when t then 1 else 0 end)::float8 from j where t is not null),
      'ratings', case when (select count(*) from r) >= 5 then jsonb_build_object(
        'up', (select count(*) from r where good),
        'down', (select count(*) from r where not good),
        'reasons', private.reason_counts(array(select unnest(reasons) from r))) end)
  );
end $$;

-- deliveryRatings.ts riderPerformance, for every rider (not counter staff), with their latest thumbs down.
create function public.rider_performance() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(x order by x.name)
    from (
      select
        p.display_name as name,
        private.rider_json(p.id) as rider,
        (select count(*) from private.rider_done_jobs(p.id)) as completed,
        (select avg(case when private.delivered_on_time(o) then 1 else 0 end)::float8 from private.rider_done_jobs(p.id) o where private.delivered_on_time(o) is not null) as "onTimeShare",
        (select count(*) from private.delivery_ratings r where r.rider_id = p.id and r.rated_at > now() - interval '30 days' and r.good) as up,
        (select count(*) from private.delivery_ratings r where r.rider_id = p.id and r.rated_at > now() - interval '30 days' and not r.good) as down,
        private.reason_counts(array(select unnest(r.reasons) from private.delivery_ratings r where r.rider_id = p.id and r.rated_at > now() - interval '30 days')) as reasons,
        coalesce((
          select jsonb_agg(jsonb_build_object('orderId', r.order_id, 'productCode', l.product_code, 'ratedAt', r.rated_at, 'reasons', to_jsonb(r.reasons)) order by r.rated_at desc)
          from (select * from private.delivery_ratings r where r.rider_id = p.id and not r.good and r.rated_at > now() - interval '30 days' order by r.rated_at desc limit 5) r
          join public.orders o on o.id = r.order_id join public.listings l on l.id = o.listing_id
        ), '[]'::jsonb) as "recentDowns"
      from public.profiles p
      where p.role = 'delivery' and p.pickup_point_id is null
    ) x
  ), '[]'::jsonb);
end $$;

revoke all on function public.rate_delivery(uuid, boolean, text[]), public.my_delivery_ratings(), public.my_rider_stats(), public.rider_performance() from public, anon;
grant execute on function public.rate_delivery(uuid, boolean, text[]), public.my_delivery_ratings(), public.my_rider_stats(), public.rider_performance() to authenticated;

-- Same as before, wiping ratings too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate private.delivery_ratings, private.job_assignments, public.rider_applications, public.delivery_messages, public.rider_earnings, public.rider_payout_accounts, private.rider_payout_account_history, private.delivery_attempts, private.job_releases, public.store_activity, public.store_invites, private.owed_checks, private.discount_redemptions, public.discount_listings, public.discounts, public.quick_replies, public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
           public.listing_views, public.tickets, public.draw_results, public.ledger_entries, public.deposits,
           public.pending_limits, public.listing_handovers, private.listing_seeds, public.listings,
           public.store_applications, public.seller_applications, public.saved_pickups, public.notifications, public.cart_items, public.saved_addresses,
           public.saved_listings, public.winner_stories, private.winner_consent_log, private.push_outbox, private.saved_alerts_sent;

  -- Fleets go; riders' trust and fleet with them.
  update public.profiles set fleet_id = null, rider_trusted = false where fleet_id is not null or rider_trusted;
  delete from public.rider_fleets where id is not null;
  update public.app_settings set rider_signups_open = false where id;

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
