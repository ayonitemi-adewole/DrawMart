-- Safety and incident reports (incidents.ts, built 3 Nov 2026). During a job a rider
-- reports an accident, a theft, a threat or the package damaged on the way with one tap;
-- a note, a photo and where they are can follow. Admins get a push at once and see it at
-- the top of the dispatch board. The job is paused (orders / order_claims.paused_at), so
-- no deadline moves it, and the order is marked: a refusal after an incident doesn't
-- charge the seller. An admin closes it: carry on, or refund the buyer in full (cancel
-- reason `incident`), with the seller still paid if the rider had collected it.

alter table public.orders drop constraint orders_cancel_reason_check;
alter table public.orders add constraint orders_cancel_reason_check check (cancel_reason in ('out_of_stock', 'damaged', 'cant_send', 'other', 'not_confirmed', 'not_sent', 'failed_check', 'refused_wrong', 'refused_damaged', 'not_collected', 'not_delivered', 'incident'));

alter table public.orders add column paused_at timestamptz;
alter table public.order_claims add column paused_at timestamptz;

create table private.incidents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete cascade,
  claim_id uuid references public.order_claims (id) on delete cascade,
  rider_id uuid not null references public.profiles (id),
  type text not null check (type in ('accident', 'theft', 'threat', 'damaged')),
  note text check (char_length(note) <= 500),
  photo text check (photo ~ '^(https://|/assets/)'),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  outcome text check (outcome in ('carry_on', 'refund')),
  resolution_note text,
  check ((order_id is null) <> (claim_id is null)),
  check ((resolved_at is null) = (outcome is null))
);
create index incidents_open_idx on private.incidents (created_at) where resolved_at is null;
create unique index incidents_one_open_order on private.incidents (order_id) where resolved_at is null;
create unique index incidents_one_open_claim on private.incidents (claim_id) where resolved_at is null;
revoke all on private.incidents from public, anon, authenticated;

-- One tap: the job's kind and id, what happened, and where if the phone could tell.
-- A second tap on the same job returns the open report rather than making another.
create function public.report_incident(p_kind text, p_id uuid, p_type text, p_lat double precision, p_lng double precision) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_id uuid;
  v_label text;
  a record;
begin
  if p_type is null or p_type not in ('accident', 'theft', 'threat', 'damaged') then perform private.fail('invalid_input', 'Choose what happened.'); end if;
  if p_kind = 'delivery' then
    perform 1 from public.orders where id = p_id and rider_id = v_uid and ((status = 'dispatched' and counter_at is null) or return_state = 'returning') for update;
    if not found then perform private.fail('invalid_input', 'You can only report a problem on a job you have.'); end if;
    select id into v_id from private.incidents where order_id = p_id and resolved_at is null;
    if v_id is not null then return v_id; end if;
    insert into private.incidents (order_id, rider_id, type, lat, lng) values (p_id, v_uid, p_type, p_lat, p_lng) returning id into v_id;
    update public.orders set paused_at = now() where id = p_id;
  elsif p_kind = 'return' then
    perform 1 from public.order_claims where id = p_id and rider_id = v_uid and status in ('awaiting_pickup', 'returning') for update;
    if not found then perform private.fail('invalid_input', 'You can only report a problem on a job you have.'); end if;
    select id into v_id from private.incidents where claim_id = p_id and resolved_at is null;
    if v_id is not null then return v_id; end if;
    insert into private.incidents (claim_id, rider_id, type, lat, lng) values (p_id, v_uid, p_type, p_lat, p_lng) returning id into v_id;
    update public.order_claims set paused_at = now() where id = p_id;
  else
    perform private.fail('invalid_input', 'That isn’t a kind of job.');
  end if;

  -- Every admin, now. Not one they can switch off; no names, places or items on the lock screen.
  v_label := case p_type when 'accident' then 'Accident' when 'theft' then 'Theft' when 'threat' then 'Threat' else 'Package damaged' end;
  begin
    for a in select id from public.profiles where role = 'admin' loop
      perform private.queue_push(a.id, 'security', 'Rider incident: ' || v_label, 'A rider reported a problem on a job. Open the dispatch board.', '/admin/dispatch', 'incident-' || v_id);
    end loop;
  exception when others then
    raise warning 'report_incident push: %', sqlerrm;
  end;
  return v_id;
end $$;

-- What can follow the tap: a note, a photo, and where they are.
create function public.add_incident_details(p_id uuid, p_note text, p_photo text, p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  if char_length(btrim(coalesce(p_note, ''))) > 500 then perform private.fail('invalid_input', 'Keep it to 500 characters.'); end if;
  if p_photo is not null and p_photo !~ '^(https://|/assets/)' then perform private.fail('invalid_input', 'That photo didn’t upload. Try again.'); end if;
  update private.incidents
     set note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note),
         photo = coalesce(p_photo, photo),
         lat = coalesce(p_lat, lat), lng = coalesce(p_lng, lng)
   where id = p_id and rider_id = v_uid and resolved_at is null;
  if not found then perform private.fail('invalid_input', 'That report has been closed. Call DrawMart if you need help.'); end if;
end $$;

-- incidents.ts resolveIncidentError. Carry on, or refund the buyer in full.
create function public.resolve_incident(p_id uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  i private.incidents;
  o public.orders;
begin
  perform private.require_admin();
  select * into i from private.incidents where id = p_id and resolved_at is null for update;
  if not found then perform private.fail('not_found', 'That incident is already closed.'); end if;
  if p_outcome is null or p_outcome not in ('carry_on', 'refund') then perform private.fail('invalid_input', 'Choose what happens next.'); end if;

  if p_outcome = 'refund' then
    if i.claim_id is not null then perform private.fail('invalid_input', 'A buyer’s return has been refunded already. Choose carry on, and sort anything else out by phone.'); end if;
    select * into o from public.orders where id = i.order_id;
    if o.is_prize then perform private.fail('invalid_input', 'Won items can’t be refunded here. Choose carry on, and contact the winner.'); end if;
    if o.status <> 'dispatched' then perform private.fail('invalid_input', 'Only orders on their way to the buyer can be refunded here.'); end if;
    perform private.cancel_order_now(o.id, 'incident', p_note);
    -- incidents.ts sellerStillPaid: it left the seller as it should.
    if o.collected_at is not null and o.price_kobo - o.fee_kobo > 0 then
      insert into public.payouts (merchant_id, listing_id, order_id, kind, amount_kobo, status, due_at)
      values (o.merchant_id, o.listing_id, o.id, 'sale', o.price_kobo - o.fee_kobo, 'due', now())
      on conflict (order_id) where kind = 'sale' do nothing;
    end if;
  end if;

  update private.incidents set resolved_at = now(), resolved_by = auth.uid(), outcome = p_outcome, resolution_note = nullif(btrim(coalesce(p_note, '')), '') where id = i.id;
  -- Not yet collected: the rider gets a fresh collection window, for the whole trip, so the deadline doesn't take it at once.
  select * into o from public.orders where id = i.order_id;
  if o.status = 'dispatched' and o.rider_id is not null and o.collected_at is null then
    update public.orders set rider_assigned_at = now()
     where rider_id = o.rider_id and rider_assigned_at = o.rider_assigned_at and status = 'dispatched' and collected_at is null;
  end if;
  update public.orders set paused_at = null where id = i.order_id;
  update public.order_claims set paused_at = null, rider_assigned_at = case when status = 'awaiting_pickup' then now() else rider_assigned_at end where id = i.claim_id;
end $$;

-- Open reports, oldest first, for the top of the dispatch board.
create function public.open_incidents() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id,
      'kind', case when i.claim_id is null then 'delivery' else 'return' end,
      'orderId', o.id,
      'type', i.type,
      'createdAt', i.created_at,
      'note', i.note,
      'photo', i.photo,
      'location', case when i.lat is not null and i.lng is not null then jsonb_build_object('lat', i.lat, 'lng', i.lng) end,
      'productCode', l.product_code,
      'listingTitle', l.title,
      'isPrize', o.is_prize,
      'orderStatus', o.status,
      'collected', o.collected_at is not null,
      'rider', private.rider_json(i.rider_id)
    ) order by i.created_at)
    from private.incidents i
    left join public.order_claims c on c.id = i.claim_id
    join public.orders o on o.id = coalesce(i.order_id, c.order_id)
    join public.listings l on l.id = o.listing_id
    where i.resolved_at is null
  ), '[]'::jsonb);
end $$;

-- The rider's own open reports, by job id (order or claim).
create function public.my_open_incidents() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  return coalesce((
    select jsonb_object_agg(coalesce(order_id, claim_id), jsonb_build_object('id', id, 'type', type, 'createdAt', created_at))
    from private.incidents where rider_id = v_uid and resolved_at is null
  ), '{}'::jsonb);
end $$;

revoke all on function public.report_incident(text, uuid, text, double precision, double precision), public.add_incident_details(uuid, text, text, double precision, double precision),
  public.resolve_incident(uuid, text, text), public.open_incidents(), public.my_open_incidents() from public, anon;
grant execute on function public.report_incident(text, uuid, text, double precision, double precision), public.add_incident_details(uuid, text, text, double precision, double precision),
  public.resolve_incident(uuid, text, text), public.open_incidents(), public.my_open_incidents() to authenticated;

-- Same as before, with `incident`: refunded in full, delivery too, and not back in stock.
create or replace function private.cancel_order_now(p_order_id uuid, p_reason text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  l public.listings;
  p private.order_payments;
  v_stock int;
  v_other uuid;
begin
  -- Same lock order as checkout: the listing, then what hangs off it.
  select * into o from public.orders where id = p_order_id;
  select * into l from public.listings where id = o.listing_id for update;
  select * into o from public.orders where id = p_order_id for update;
  if o.is_prize then perform private.fail('invalid_input', 'Won items can’t be cancelled here. Contact DrawMart.'); end if;
  -- A failed check or a refusal happens once a rider has it; everything else is before that.
  if o.status <> 'paid' and not (o.status = 'dispatched' and p_reason in ('failed_check', 'refused_wrong', 'refused_damaged', 'not_collected', 'not_delivered', 'incident')) then
    perform private.fail('invalid_input', 'Only orders that aren’t ready for a rider yet can be cancelled.');
  end if;

  update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, cancel_note = nullif(btrim(coalesce(p_note, '')), '') where id = o.id;
  delete from private.order_pins where order_id = o.id;
  delete from public.payouts where order_id = o.id and status = 'waiting';

  select * into p from private.order_payments where order_id = o.id;
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  values (o.user_id, 'order_refund', coalesce(p.cash_kobo, o.price_kobo), coalesce(p.credit_kobo, 0), 'Refund · ' || l.title, l.id);

  -- One fee covers everything from this seller in this checkout. If something's still
  -- coming, the fee moves to it; if this was the last, it comes back too.
  -- Not collected: the trip happened, so the fee isn't refunded.
  if o.delivery_fee_kobo > 0 and p_reason not in ('not_collected', 'not_delivered') then
    select id into v_other from public.orders
     where checkout_id = o.checkout_id and merchant_id = o.merchant_id and id <> o.id and status <> 'cancelled' and not is_prize
     limit 1;
    if v_other is not null then
      update public.orders set delivery_fee_kobo = delivery_fee_kobo + o.delivery_fee_kobo where id = v_other;
      update private.order_payments set fee_cash_kobo = fee_cash_kobo + p.fee_cash_kobo, fee_credit_kobo = fee_credit_kobo + p.fee_credit_kobo where order_id = v_other;
      update public.orders set delivery_fee_kobo = 0 where id = o.id;
    elsif p.fee_cash_kobo + p.fee_credit_kobo > 0 then
      insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
      values (o.user_id, 'order_refund', p.fee_cash_kobo, p.fee_credit_kobo, 'Delivery refund · ' || l.title, l.id);
    end if;
  end if;

  v_stock := case when p_reason = 'out_of_stock' then 0 when p_reason in ('damaged', 'failed_check', 'refused_wrong', 'refused_damaged', 'not_collected', 'not_delivered', 'incident') then l.stock else l.stock + o.quantity end;
  update public.listings
     set stock = v_stock,
         status = case when p_reason in ('not_confirmed', 'not_sent') and kind = 'product' and status in ('for_sale', 'sold') then 'paused' when status = 'for_sale' and v_stock = 0 then 'sold' when status = 'sold' and v_stock > 0 then 'for_sale' else status end
   where id = l.id;

  insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_cancelled', l.id);
end $$;

-- Same as before: something on the way isn't the seller's cancellation.
create or replace function public.merchant_cancel_rates() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('merchantId', m.id, 'merchantName', m.name, 'orders', coalesce(x.orders, 0), 'cancelled', coalesce(x.cancelled, 0), 'failed', coalesce(x.failed, 0), 'suspended', m.suspended_at is not null))
    from public.merchants m
    left join (
      select merchant_id, count(*)::int as orders, count(*) filter (where status = 'cancelled' and coalesce(cancel_reason, '') not in ('not_collected', 'not_delivered', 'incident'))::int as cancelled,
             count(*) filter (where cancel_reason in ('failed_check', 'refused_wrong', 'refused_damaged'))::int as failed
        from public.orders
       where not is_prize and created_at >= now() - interval '30 days'
       group by merchant_id
    ) x on x.merchant_id = m.id
    where x.merchant_id is not null or m.suspended_at is not null
  ), '[]'::jsonb);
end $$;

-- Same as before, not charging the seller for what happened after collection.
create or replace function private.penalise_seller(p_order uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  -- incidents.ts: something happened after the rider collected it, so it isn't the seller's to pay for.
  if o.collected_at is not null and exists (select 1 from private.incidents i where i.order_id = o.id and i.created_at >= o.collected_at) then
    update public.orders set failure_excused = true where id = o.id;
    insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
    values (o.user_id, 'store_credit', 0, 50000, 'Sorry about your order', o.listing_id);
    return;
  end if;
  insert into public.payouts (merchant_id, listing_id, order_id, kind, amount_kobo, status, due_at)
  values (o.merchant_id, o.listing_id, o.id, 'charge', -250000, 'due', now());
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  values (o.user_id, 'store_credit', 0, 50000, 'Sorry about your order', o.listing_id);
  perform private.notify_shop(o.merchant_id, 'store_order_failed', o.listing_id);

  if (select count(*) from public.orders x
       where x.merchant_id = o.merchant_id and not x.failure_excused
         and ((x.cancel_reason in ('failed_check', 'refused_wrong', 'refused_damaged') and x.cancelled_at >= now() - interval '30 days')
              or exists (select 1 from public.order_claims c where c.order_id = x.id and c.kind = 'fault' and c.picked_up_at >= now() - interval '30 days'))) >= 3
     and exists (select 1 from public.merchants where id = o.merchant_id and suspended_at is null) then
    update public.merchants set suspended_at = now() where id = o.merchant_id;
    update public.listings set status = 'paused' where merchant_id = o.merchant_id and kind = 'product' and status = 'for_sale';
    perform private.notify_shop(o.merchant_id, 'store_suspended', null);
  end if;
end $$;

-- Same as before, leaving paused jobs alone.
create or replace function private.release_late_jobs() returns void
language plpgsql security definer set search_path = ''
as $$
declare v_cutoff timestamptz := now() - make_interval(mins => (private.settings()).rider_collect_minutes);
begin
  with late as (
    select id, rider_id, rider_assigned_at from public.orders
     where status = 'dispatched' and rider_id is not null and collected_at is null and rider_assigned_at <= v_cutoff and paused_at is null
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
     where status = 'awaiting_pickup' and rider_id is not null and rider_assigned_at <= v_cutoff and paused_at is null
       for update skip locked
  ), freed as (
    update public.order_claims c set rider_id = null, rider_assigned_at = null
      from late where c.id = late.id
    returning late.id, late.rider_id, late.rider_assigned_at
  )
  insert into private.job_releases (claim_id, rider_id, reason, taken_at)
  select id, rider_id, 'not_collected', rider_assigned_at from freed;
end $$;

-- Same as before, leaving paused jobs alone.
create or replace function private.redelivery_deadlines() returns void
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  for v_id in
    select id from public.orders
     where status = 'dispatched' and failed_attempts = 1 and redelivery_choice is null and last_failed_at <= now() - interval '24 hours' and paused_at is null
       for update skip locked
  loop
    perform private.return_undelivered(v_id);
  end loop;
end $$;

-- Same as before, wiping incidents too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate private.incidents, private.delivery_ratings, private.job_assignments, public.rider_applications, public.delivery_messages, public.rider_earnings, public.rider_payout_accounts, private.rider_payout_account_history, private.delivery_attempts, private.job_releases, public.store_activity, public.store_invites, private.owed_checks, private.discount_redemptions, public.discount_listings, public.discounts, public.quick_replies, public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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
