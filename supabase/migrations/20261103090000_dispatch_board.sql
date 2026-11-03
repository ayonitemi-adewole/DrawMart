-- The admin dispatch board (dispatch.ts). Every active delivery and return by stage,
-- with jobs flagged as stuck once they've waited in the pool dispatch_waiting_hours,
-- or been carried dispatch_carrying_hours without arriving. Admins can give a waiting
-- job to a rider, within that rider's limits, or take back one that hasn't been
-- collected. Never a collected one: the item is in the rider's hands.

alter table public.app_settings
  add column dispatch_waiting_hours int not null default 3 check (dispatch_waiting_hours > 0),
  add column dispatch_carrying_hours int not null default 6 check (dispatch_carrying_hours > 0);

-- Admins taking a job back are recorded with the other releases, saying who did it.
alter table private.job_releases drop constraint job_releases_reason_check;
alter table private.job_releases add constraint job_releases_reason_check check (reason in ('handed_back', 'not_collected', 'taken_back'));
alter table private.job_releases add column released_by uuid references public.profiles (id);

-- Who gave which job to which rider. Admins only, like job_releases.
create table private.job_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete cascade,
  claim_id uuid references public.order_claims (id) on delete cascade,
  rider_id uuid not null references public.profiles (id),
  assigned_by uuid not null references public.profiles (id),
  assigned_at timestamptz not null default now(),
  check ((order_id is null) <> (claim_id is null))
);
create index job_assignments_rider_idx on private.job_assignments (rider_id, assigned_at);
alter table private.job_assignments enable row level security;
revoke all on private.job_assignments from public, anon, authenticated;

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
  'rider_paid', 'rider_bank_changed',
  'rider_approved',
  'rider_job_assigned', 'rider_job_taken_back'
));

-- dispatch.ts dispatchStuck.
create function private.dispatch_stuck(p_stage text, p_since timestamptz) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  return coalesce(p_since + make_interval(hours => case p_stage
    when 'waiting' then s.dispatch_waiting_hours
    when 'carrying' then s.dispatch_carrying_hours
    when 'returning' then s.dispatch_carrying_hours
  end) <= now(), false);
end $$;

-- A rider's name and a number to call them on, for admins.
create function private.rider_json(p_rider uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'name', p.display_name, 'phone', coalesce(p.phone,
    (select a.phone from public.rider_applications a where a.user_id = p.id and a.status = 'approved' order by a.reviewed_at desc limit 1)))
  from public.profiles p where p.id = p_rider
$$;

-- Every active job, for admins. Areas only: admins read the full order elsewhere if they need it.
create function public.dispatch_board() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  return jsonb_build_object(
    'waitingHours', s.dispatch_waiting_hours,
    'carryingHours', s.dispatch_carrying_hours,
    'maxJobs', s.rider_max_jobs,
    'jobs', coalesce((
      select jsonb_agg(to_jsonb(j) order by j.stuck desc, j.since nulls last)
      from (
        select
          'delivery' as kind, o.id, o.id as "orderId", st.stage, st.since, private.dispatch_stuck(st.stage, st.since) as stuck,
          l.product_code as "productCode", l.title as "listingTitle", l.images[1] as "listingImage",
          case when o.handled_by = 'drawmart' then 'DrawMart escrow' else m.name end as "shopName",
          case when o.return_state = 'returning' then case when o.counter_at is not null then private.point_area(o.pickup_point_id) else private.buyer_area(o) end
               when o.handled_by = 'drawmart' then null
               else m.delivery_area end as "fromArea",
          case when o.return_state = 'returning' then m.delivery_area
               when o.fulfilment = 'pickup' then private.point_area(o.pickup_point_id)
               else private.buyer_area(o) end as "toArea",
          o.is_prize as "isPrize", o.fulfilment, pp.name as "pickupPointName",
          o.failed_attempts as "failedAttempts",
          o.status = 'dispatched' and o.failed_attempts = 1 and o.redelivery_choice is null as "awaitingBuyer",
          case when o.redelivery_choice = 'redeliver' then o.redeliver_at end as "redeliverAt",
          case when o.rider_id is not null then private.rider_json(o.rider_id) end as rider
        from public.orders o
        join public.listings l on l.id = o.listing_id
        join public.merchants m on m.id = o.merchant_id
        left join public.pickup_points pp on pp.id = o.pickup_point_id
        -- dispatch.ts orderStage.
        cross join lateral (
          select
            case when o.return_state = 'returning' then
                   case when o.counter_at is not null and o.counter_out_at is null then case when o.rider_id is null then 'waiting' else 'taken' end else 'returning' end
                 when o.counter_at is not null then 'at_counter'
                 when o.rider_id is null then 'waiting'
                 when o.collected_at is null then 'taken'
                 when o.failed_attempts > 0 then 'failed'
                 else 'carrying' end as stage,
            case when o.return_state = 'returning' then
                   case when o.counter_at is not null and o.counter_out_at is null then case when o.rider_id is null then o.cancelled_at else o.rider_assigned_at end
                        else coalesce(o.counter_out_at, o.cancelled_at) end
                 when o.counter_at is not null then o.counter_at
                 when o.rider_id is null then o.dispatched_at
                 when o.collected_at is null then o.rider_assigned_at
                 when o.failed_attempts > 0 then o.last_failed_at
                 else o.collected_at end as since
        ) st
        where o.status = 'dispatched' or o.return_state = 'returning'

        union all

        select
          'return', c.id, c.order_id, st.stage, st.since, private.dispatch_stuck(st.stage, st.since),
          l.product_code, l.title, l.images[1], m.name,
          private.nearest_area(c.return_lat, c.return_lng), m.delivery_area,
          o.is_prize, o.fulfilment, null, 0, false, null,
          case when c.rider_id is not null then private.rider_json(c.rider_id) end
        from public.order_claims c
        join public.orders o on o.id = c.order_id
        join public.listings l on l.id = o.listing_id
        join public.merchants m on m.id = o.merchant_id
        -- dispatch.ts claimStage.
        cross join lateral (
          select
            case when c.status = 'returning' then 'returning' when c.rider_id is null then 'waiting' else 'taken' end as stage,
            case when c.status = 'returning' then c.picked_up_at when c.rider_id is null then coalesce(c.reviewed_at, c.created_at) else c.rider_assigned_at end as since
        ) st
        where c.status in ('awaiting_pickup', 'returning')
      ) j
    ), '[]'::jsonb)
  );
end $$;

-- dispatch.ts canAssign. A waiting job to a rider, within the limits they'd have taking it themselves.
create function public.assign_job(p_kind text, p_id uuid, p_rider uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_max int := (private.settings()).rider_max_jobs;
  v_limit text;
  v_listing uuid;
begin
  perform private.require_admin();
  -- Locked, like require_job_room, so this and the rider's own tap can't both get under the limit.
  perform 1 from public.profiles where id = p_rider and role = 'delivery' and pickup_point_id is null for update;
  if not found then perform private.fail('not_found', 'That rider doesn’t exist.'); end if;
  if private.rider_jobs_held(p_rider) >= v_max then
    perform private.fail('invalid_input', format('This rider has %s jobs, the most they can hold. Choose another, or take one back from them first.', v_max));
  end if;

  if p_kind = 'delivery' then
    v_limit := (select private.new_rider_limit(p_rider, price_kobo, is_prize) from public.orders where id = p_id);
    if v_limit is not null then perform private.fail('invalid_input', 'This rider is new. ' || v_limit); end if;
    update public.orders set rider_id = p_rider, rider_assigned_at = now(), collected_at = case when is_prize then now() else collected_at end
     where id = p_id and rider_id is null
       and ((status = 'dispatched' and counter_at is null)
            or (return_state = 'returning' and counter_at is not null and counter_out_at is null))
     returning listing_id into v_listing;
    if not found then perform private.fail('invalid_input', 'Only jobs waiting in the pool can be assigned. A rider may have just taken it.'); end if;
    insert into private.job_assignments (order_id, rider_id, assigned_by) values (p_id, p_rider, auth.uid());
  elsif p_kind = 'return' then
    v_limit := (select private.new_rider_limit(p_rider, o.price_kobo, o.is_prize) from public.order_claims c join public.orders o on o.id = c.order_id where c.id = p_id);
    if v_limit is not null then perform private.fail('invalid_input', 'This rider is new. ' || v_limit); end if;
    update public.order_claims set rider_id = p_rider, rider_assigned_at = now()
     where id = p_id and status = 'awaiting_pickup' and rider_id is null;
    if not found then perform private.fail('invalid_input', 'Only returns waiting in the pool can be assigned. A rider may have just taken it.'); end if;
    v_listing := (select o.listing_id from public.order_claims c join public.orders o on o.id = c.order_id where c.id = p_id);
    insert into private.job_assignments (claim_id, rider_id, assigned_by) values (p_id, p_rider, auth.uid());
  else
    perform private.fail('invalid_input', 'That isn’t a kind of job.');
  end if;

  insert into public.notifications (user_id, kind, listing_id) values (p_rider, 'rider_job_assigned', v_listing);
end $$;

-- dispatch.ts canTakeBack. Back in the pool, which tells the other riders.
create function public.unassign_job(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  c public.order_claims;
begin
  perform private.require_admin();
  if p_kind = 'delivery' then
    select * into o from public.orders where id = p_id and rider_id is not null for update;
    if not found or not ((o.status = 'dispatched' and o.counter_at is null and o.collected_at is null)
                         or (o.return_state = 'returning' and o.counter_at is not null and o.counter_out_at is null)) then
      perform private.fail('invalid_input', 'Only jobs the rider hasn’t collected yet can be taken back.');
    end if;
    update public.orders set rider_id = null, rider_assigned_at = null, collection_photos = null where id = o.id;
    insert into private.job_releases (order_id, rider_id, reason, taken_at, released_by) values (o.id, o.rider_id, 'taken_back', o.rider_assigned_at, auth.uid());
    insert into public.notifications (user_id, kind, listing_id) values (o.rider_id, 'rider_job_taken_back', o.listing_id);
  elsif p_kind = 'return' then
    select * into c from public.order_claims where id = p_id and rider_id is not null and status = 'awaiting_pickup' for update;
    if not found then perform private.fail('invalid_input', 'Only returns the rider hasn’t collected yet can be taken back.'); end if;
    update public.order_claims set rider_id = null, rider_assigned_at = null where id = c.id;
    insert into private.job_releases (claim_id, rider_id, reason, taken_at, released_by) values (c.id, c.rider_id, 'taken_back', c.rider_assigned_at, auth.uid());
    insert into public.notifications (user_id, kind, listing_id) values (c.rider_id, 'rider_job_taken_back', (select listing_id from public.orders where id = c.order_id));
  else
    perform private.fail('invalid_input', 'That isn’t a kind of job.');
  end if;
end $$;

revoke all on function private.dispatch_stuck(text, timestamptz), private.rider_json(uuid) from public, anon, authenticated;
revoke all on function public.dispatch_board(), public.assign_job(text, uuid, uuid), public.unassign_job(text, uuid) from public, anon;
grant execute on function public.dispatch_board(), public.assign_job(text, uuid, uuid), public.unassign_job(text, uuid) to authenticated;

-- Same as before, with jobs admins give or take back.
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
    when 'rider_approved' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'You’re approved to ride', 'Open DrawMart to add your photo and bank account.', '/delivery', 'rider-approved');
    when 'rider_job_assigned' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'A job for you', v_what || ': DrawMart gave you this job. Collect it within the time shown.', '/delivery?tab=mine', 'rider-assigned-' || new.listing_id);
    when 'rider_job_taken_back' then
      perform private.queue_push(new.user_id, 'rider_jobs', 'A job was taken back', 'DrawMart moved a job you hadn’t collected. You don’t need to collect it.', '/delivery?tab=mine', 'rider-assigned-' || new.listing_id);
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_rider_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, wiping assignments too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate private.job_assignments, public.rider_applications, public.delivery_messages, public.rider_earnings, public.rider_payout_accounts, private.rider_payout_account_history, private.delivery_attempts, private.job_releases, public.store_activity, public.store_invites, private.owed_checks, private.discount_redemptions, public.discount_listings, public.discounts, public.quick_replies, public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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
