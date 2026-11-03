-- Rider notifications, in the delivery app and as push (riderAlerts.ts). New jobs
-- and returns go to riders whose areas include where it's collected, who have room
-- for it, at most 4 an hour. A rider's own jobs get a reminder before they go back
-- to the pool, word when one has, and when a paused PIN can be tried again.
-- A lock screen only shows the item type and the area: never an address, a name or a PIN.

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
  'rider_new_job', 'rider_new_return', 'rider_collect_soon', 'rider_job_released', 'rider_pin_unlocked'
));
-- Where a rider's job is collected. An area, never an address.
alter table public.notifications add column area text references public.delivery_areas (id);

alter table public.push_preferences
  add column rider_new_jobs boolean not null default true,
  add column rider_returns boolean not null default true,
  add column rider_jobs boolean not null default true;

-- The areas a rider wants new jobs from. None means all of Lagos.
create table public.rider_areas (
  rider_id uuid not null references public.profiles (id) on delete cascade,
  area text not null references public.delivery_areas (id),
  primary key (rider_id, area)
);
alter table public.rider_areas enable row level security;
create policy "own rider areas" on public.rider_areas for select to authenticated using (rider_id = (select auth.uid()));
revoke all on public.rider_areas from anon, authenticated;
grant select on public.rider_areas to authenticated;

-- riderAlerts.ts riderAreasError.
create function public.set_rider_areas(p_areas text[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  if exists (select 1 from unnest(coalesce(p_areas, '{}')) a where not exists (select 1 from public.delivery_areas d where d.id = a)) then
    perform private.fail('invalid_input', 'That isn’t one of our delivery areas.');
  end if;
  if cardinality(coalesce(p_areas, '{}')) <> (select count(distinct a) from unnest(coalesce(p_areas, '{}')) a) then
    perform private.fail('invalid_input', 'Each area only once.');
  end if;
  delete from public.rider_areas where rider_id = v_uid;
  insert into public.rider_areas (rider_id, area) select v_uid, a from unnest(coalesce(p_areas, '{}')) a;
end $$;
revoke all on function public.set_rider_areas(text[]) from public, anon;
grant execute on function public.set_rider_areas(text[]) to authenticated;

-- Everyone who gets notifications: buyers, stores and now riders.
create function private.require_inbox_account(p_uid uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = p_uid and role in ('buyer', 'store', 'delivery')) then
    perform private.fail('forbidden', 'Only buyer, store and delivery accounts have this setting.');
  end if;
end $$;

-- Same as before, open to riders.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform private.require_inbox_account(v_uid);
  if length(coalesce(p_endpoint, '')) > 1000
     or coalesce(p_endpoint, '') !~ '^https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]*\.?push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[!-~]+$'
     or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{80,100}$'
     or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{16,44}$' then
    perform private.fail('invalid_input', 'This device’s notification details don’t look right.');
  end if;
  -- A shared phone: the device now belongs to whoever just turned this on.
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, v_uid, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

-- Same as before, with the rider kinds.
create or replace function public.set_push_preference(p_category text, p_enabled boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform private.require_inbox_account(v_uid);
  insert into public.push_preferences (user_id) values (v_uid) on conflict (user_id) do nothing;
  case p_category
    when 'wins' then update public.push_preferences set wins = p_enabled where user_id = v_uid;
    when 'drawResults' then update public.push_preferences set draw_results = p_enabled where user_id = v_uid;
    when 'orders' then update public.push_preferences set orders = p_enabled where user_id = v_uid;
    when 'messages' then update public.push_preferences set messages = p_enabled where user_id = v_uid;
    when 'savedItems' then update public.push_preferences set saved_items = p_enabled where user_id = v_uid;
    when 'drawReveal' then update public.push_preferences set draw_reveal = p_enabled where user_id = v_uid;
    when 'storeOrders' then update public.push_preferences set store_orders = p_enabled where user_id = v_uid;
    when 'storeListings' then update public.push_preferences set store_listings = p_enabled where user_id = v_uid;
    when 'storeDraws' then update public.push_preferences set store_draws = p_enabled where user_id = v_uid;
    when 'storePickups' then update public.push_preferences set store_pickups = p_enabled where user_id = v_uid;
    when 'storePayouts' then update public.push_preferences set store_payouts = p_enabled where user_id = v_uid;
    when 'riderNewJobs' then update public.push_preferences set rider_new_jobs = p_enabled where user_id = v_uid;
    when 'riderReturns' then update public.push_preferences set rider_returns = p_enabled where user_id = v_uid;
    when 'riderJobs' then update public.push_preferences set rider_jobs = p_enabled where user_id = v_uid;
    else perform private.fail('invalid_input', 'That isn’t a kind of notification.');
  end case;
end $$;

-- Same as before, with the rider kinds.
create or replace function private.queue_push(p_user uuid, p_category text, p_title text, p_body text, p_url text, p_tag text) returns void
language plpgsql security definer set search_path = ''
as $$
declare p public.push_preferences;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = p_user) then return; end if;
  select * into p from public.push_preferences where user_id = p_user;
  if found and not (case p_category when 'wins' then p.wins when 'draw_results' then p.draw_results when 'orders' then p.orders when 'messages' then p.messages when 'store_orders' then p.store_orders when 'store_listings' then p.store_listings when 'store_draws' then p.store_draws when 'store_pickups' then p.store_pickups when 'store_payouts' then p.store_payouts when 'saved_items' then p.saved_items
      when 'rider_new_jobs' then p.rider_new_jobs when 'rider_returns' then p.rider_returns when 'rider_jobs' then p.rider_jobs end) then
    return;
  end if;
  insert into private.push_outbox (user_id, title, body, url, tag) values (p_user, p_title, p_body, p_url, p_tag);
end $$;

-- riderAlerts.ts riderJobAlertAllowed. Never fails whatever made the job.
create function private.alert_riders(p_kind text, p_listing uuid, p_area text, p_except uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_max int := (private.settings()).rider_max_jobs;
begin
  insert into public.notifications (user_id, kind, listing_id, area)
  select r.id, p_kind, p_listing, p_area
    from public.profiles r
    left join public.push_preferences pp on pp.user_id = r.id
   where r.role = 'delivery'
     and r.id is distinct from p_except
     and coalesce(case p_kind when 'rider_new_job' then pp.rider_new_jobs else pp.rider_returns end, true)
     and (p_area is null
          or not exists (select 1 from public.rider_areas ra where ra.rider_id = r.id)
          or exists (select 1 from public.rider_areas ra where ra.rider_id = r.id and ra.area = p_area))
     and private.rider_jobs_held(r.id) < v_max
     and (select count(*) from public.notifications n
           where n.user_id = r.id and n.kind in ('rider_new_job', 'rider_new_return') and n.created_at > now() - interval '1 hour') < 4;
exception when others then
  raise warning 'alert_riders: %', sqlerrm;
end $$;

-- deliveryFees.ts nearestArea.
create function private.nearest_area(p_lat double precision, p_lng double precision) returns text
language sql stable set search_path = ''
as $$
  select a.id from public.delivery_areas a
   order by power(a.lat - p_lat, 2) + power((a.lng - p_lng) * cos(radians(6.5)), 2), a.sort
   limit 1
$$;

-- An order reaches the pool: made ready, or handed back. Not to the rider who just let it go.
create function private.alert_riders_for_order() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'dispatched' and new.rider_id is null and (old.status <> 'dispatched' or old.rider_id is not null) then
    perform private.alert_riders('rider_new_job', new.listing_id,
      case when new.handled_by = 'drawmart' then null else (select delivery_area from public.merchants where id = new.merchant_id) end,
      old.rider_id);
  end if;
  return null;
exception when others then
  raise warning 'alert_riders_for_order: %', sqlerrm;
  return null;
end $$;
create trigger alert_riders_on_order after update of status, rider_id on public.orders
  for each row execute function private.alert_riders_for_order();

-- A return reaches the pool. It's collected from the buyer, so the area is theirs.
create function private.alert_riders_for_claim() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'awaiting_pickup' and new.rider_id is null
     and (tg_op = 'INSERT' or old.status <> 'awaiting_pickup' or old.rider_id is not null) then
    perform private.alert_riders('rider_new_return', (select listing_id from public.orders where id = new.order_id),
      case when new.return_lat is not null then private.nearest_area(new.return_lat, new.return_lng) end,
      case when tg_op = 'UPDATE' then old.rider_id end);
  end if;
  return null;
exception when others then
  raise warning 'alert_riders_for_claim: %', sqlerrm;
  return null;
end $$;
create trigger alert_riders_on_claim after insert or update of status, rider_id on public.order_claims
  for each row execute function private.alert_riders_for_claim();

-- A rider whose job timed out hears about it.
create function private.notify_job_released() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.reason = 'not_collected' then
    insert into public.notifications (user_id, kind, listing_id)
    values (new.rider_id, 'rider_job_released',
      coalesce((select listing_id from public.orders where id = new.order_id),
               (select o.listing_id from public.order_claims c join public.orders o on o.id = c.order_id where c.id = new.claim_id)));
  end if;
  return null;
exception when others then
  raise warning 'notify_job_released: %', sqlerrm;
  return null;
end $$;
create trigger notify_on_job_release after insert on private.job_releases
  for each row execute function private.notify_job_released();

-- riderLimits.ts collectSoon, and PINs whose pause is over. Once each, run by process_deadlines.
create function private.rider_reminders() returns void
language plpgsql security definer set search_path = ''
as $$
declare v_soon interval := make_interval(mins => greatest((private.settings()).rider_collect_minutes - 30, 0));
begin
  insert into public.notifications (user_id, kind, listing_id)
  select distinct o.rider_id, 'rider_collect_soon', o.listing_id from public.orders o
   where o.status = 'dispatched' and o.rider_id is not null and o.collected_at is null and o.rider_assigned_at + v_soon <= now()
     and not exists (select 1 from public.notifications n where n.user_id = o.rider_id and n.kind = 'rider_collect_soon' and n.listing_id = o.listing_id and n.created_at >= o.rider_assigned_at);

  insert into public.notifications (user_id, kind, listing_id)
  select distinct c.rider_id, 'rider_collect_soon', o.listing_id from public.order_claims c join public.orders o on o.id = c.order_id
   where c.status = 'awaiting_pickup' and c.rider_id is not null and c.rider_assigned_at + v_soon <= now()
     and not exists (select 1 from public.notifications n where n.user_id = c.rider_id and n.kind = 'rider_collect_soon' and n.listing_id = o.listing_id and n.created_at >= c.rider_assigned_at);

  insert into public.notifications (user_id, kind, listing_id)
  select distinct o.rider_id, 'rider_pin_unlocked', o.listing_id from public.orders o join private.order_pins p on p.order_id = o.id
   where o.status = 'dispatched' and o.rider_id is not null and p.locked_until <= now() and p.locked_until > now() - interval '1 hour'
     and not exists (select 1 from public.notifications n where n.user_id = o.rider_id and n.kind = 'rider_pin_unlocked' and n.listing_id = o.listing_id and n.created_at >= p.locked_until);
exception when others then
  raise warning 'rider_reminders: %', sqlerrm;
end $$;

-- Lock screens get the item type and the area, nothing else.
create function private.push_for_rider_notification() returns trigger
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
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_rider_notification: %', sqlerrm;
  return null;
end $$;
create trigger push_on_rider_notification after insert on public.notifications
  for each row when (new.kind like 'rider\_%') execute function private.push_for_rider_notification();

revoke all on function private.require_inbox_account(uuid), private.alert_riders(text, uuid, text, uuid), private.nearest_area(double precision, double precision), private.rider_reminders() from public, anon, authenticated;

-- Same as before, with rider reminders.
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
  perform private.rider_reminders();
  perform private.release_late_jobs();

  return n;
end $$;
