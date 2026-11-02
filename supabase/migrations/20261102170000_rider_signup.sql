-- Rider sign-up and checks (riderApplications.ts). Behind a switch admins keep off until
-- DrawMart is ready. An applicant passes the training quiz, then sends their ID, a selfie
-- holding it, their vehicle and a guarantor; documents go in the private seller-ids
-- bucket, for the applicant and admins only. Approval turns that account into a delivery
-- account, so it must be one that hasn't bought or sold. New riders can't take valuable
-- jobs or won items until they've done enough deliveries, unless they or their fleet are
-- trusted. Fleets are admin-managed groups of riders, e.g. a partner's.

alter table public.app_settings
  add column rider_signups_open boolean not null default false,
  add column new_rider_jobs int not null default 20 check (new_rider_jobs >= 0),
  add column new_rider_max_kobo bigint not null default 5000000 check (new_rider_max_kobo >= 0);

create table public.rider_fleets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  contact_phone text not null,
  -- Its riders skip the new-rider limits: the fleet vouches for them.
  trusted boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.rider_fleets enable row level security;
create policy "admins read fleets" on public.rider_fleets for select to authenticated using ((select private.is_admin()));
revoke all on public.rider_fleets from anon, authenticated;
grant select on public.rider_fleets to authenticated;

alter table public.profiles
  add column fleet_id uuid references public.rider_fleets (id) on delete set null,
  add column rider_trusted boolean not null default false;

create table public.rider_applications (
  id uuid primary key default gen_random_uuid(),
  -- One per account; a rejected applicant fixes it and sends it again.
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  full_name text not null,
  nin text not null check (nin ~ '^[0-9]{11}$'),
  phone text not null,
  address text not null,
  area text not null references public.delivery_areas (id),
  vehicle text not null check (vehicle in ('motorcycle', 'bicycle', 'car', 'van')),
  plate text,
  guarantor_name text not null,
  guarantor_phone text not null,
  guarantor_relationship text not null,
  -- Paths in the private seller-ids bucket: <user id>/<file>.
  id_photo_path text not null,
  selfie_path text not null,
  training_version int not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index rider_applications_status_idx on public.rider_applications (status, updated_at);
alter table public.rider_applications enable row level security;
create policy "own application, or admins" on public.rider_applications for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
revoke all on public.rider_applications from anon, authenticated;
grant select on public.rider_applications to authenticated;

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
  'rider_approved'
));

-- riderApplications.ts RIDER_QUIZ answers, for RIDER_TRAINING_VERSION 1.
create function private.rider_quiz_key() returns int[]
language sql immutable set search_path = ''
as $$ select array[1, 1, 0, 2, 1, 1] $$;

-- riderApplications.ts riderAccountBlocker. Null when the account can become a rider's.
create function private.rider_account_blocker(p_user uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when coalesce((select role from public.profiles where id = p_user), '') <> 'buyer' then 'Only a new account can become a rider’s account.'
    when (select seller_id from public.profiles where id = p_user) is not null
      or exists (select 1 from public.seller_applications where user_id = p_user and status <> 'rejected')
      or exists (select 1 from public.store_applications where user_id = p_user and status <> 'rejected')
      then 'This account sells on DrawMart. Sign up with a new account to ride.'
    when exists (select 1 from public.tickets where user_id = p_user)
      or exists (select 1 from public.orders where user_id = p_user)
      or exists (select 1 from public.deposits where user_id = p_user)
      then 'This account has already bought on DrawMart. Sign up with a new account to ride.'
  end
$$;

-- Same as before: an account applying to ride can't become a store too.
create or replace function private.store_account_blocker(p_user uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when coalesce((select role from public.profiles where id = p_user), '') <> 'buyer' then 'Only a new account can become a store account.'
    when (select seller_id from public.profiles where id = p_user) is not null
      or exists (select 1 from public.seller_applications where user_id = p_user and status <> 'rejected')
      then 'This account sells as an individual. Sign up with a new account for your business.'
    when exists (select 1 from public.rider_applications where user_id = p_user and status <> 'rejected')
      then 'This account has applied to ride. Sign up with a new account for your business.'
    when exists (select 1 from public.tickets where user_id = p_user)
      or exists (select 1 from public.orders where user_id = p_user)
      or exists (select 1 from public.deposits where user_id = p_user)
      then 'This account has already bought on DrawMart. Sign up with a new account for your business.'
  end
$$;

-- riderApplications.ts validateRiderApplication.
create function public.submit_rider_application(p jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_errors text[] := '{}';
  v_name text := btrim(coalesce(p ->> 'fullName', ''));
  v_nin text := btrim(coalesce(p ->> 'nin', ''));
  v_phone text := btrim(coalesce(p ->> 'phone', ''));
  v_address text := btrim(coalesce(p ->> 'address', ''));
  v_area text := coalesce(p ->> 'area', '');
  v_vehicle text := coalesce(p ->> 'vehicle', '');
  v_plate text := upper(regexp_replace(coalesce(p ->> 'plate', ''), '[\s-]', '', 'g'));
  v_g_name text := btrim(coalesce(p ->> 'guarantorName', ''));
  v_g_phone text := btrim(coalesce(p ->> 'guarantorPhone', ''));
  v_g_rel text := btrim(coalesce(p ->> 'guarantorRelationship', ''));
  v_id_photo text := coalesce(p ->> 'idPhoto', '');
  v_selfie text := coalesce(p ->> 'selfiePhoto', '');
  v_answers int[] := coalesce((select array_agg(x::int order by n) from jsonb_array_elements_text(coalesce(p -> 'quizAnswers', '[]'::jsonb)) with ordinality t(x, n)), '{}');
  v_blocker text := private.rider_account_blocker(v_uid);
  v_existing public.rider_applications;
  v_id uuid;
begin
  if not (private.settings()).rider_signups_open then perform private.fail('invalid_input', 'Rider sign-up isn’t open yet.'); end if;
  if v_blocker is not null then perform private.fail('invalid_input', v_blocker); end if;
  select * into v_existing from public.rider_applications where user_id = v_uid for update;
  if v_existing.status = 'pending' then perform private.fail('invalid_input', 'Your application is already being reviewed.'); end if;
  if v_existing.status = 'approved' then perform private.fail('invalid_input', 'You’re already approved.'); end if;

  if (select count(*) from regexp_split_to_table(v_name, '\s+') w where length(w) > 1) < 2 then v_errors := array_append(v_errors, 'Enter your full name, as on your ID.'); end if;
  if v_nin !~ '^[0-9]{11}$' then v_errors := array_append(v_errors, 'Enter your 11-digit NIN.'); end if;
  if regexp_replace(v_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567.'); end if;
  if length(v_address) < 10 then v_errors := array_append(v_errors, 'Enter your home address, with street and area.'); end if;
  if not exists (select 1 from public.delivery_areas where id = v_area) then v_errors := array_append(v_errors, 'Pick the area you’ll mostly work in.'); end if;
  if v_vehicle not in ('motorcycle', 'bicycle', 'car', 'van') then v_errors := array_append(v_errors, 'Pick your vehicle.');
  elsif v_vehicle <> 'bicycle' and v_plate !~ '^[A-Z0-9]{5,10}$' then v_errors := array_append(v_errors, 'Enter your plate number.'); end if;
  if (select count(*) from regexp_split_to_table(v_g_name, '\s+') w where length(w) > 1) < 2 then v_errors := array_append(v_errors, 'Enter your guarantor’s full name.'); end if;
  if regexp_replace(v_g_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then v_errors := array_append(v_errors, 'Enter your guarantor’s Nigerian mobile number.');
  elsif right(regexp_replace(v_g_phone, '\D', '', 'g'), 10) = right(regexp_replace(v_phone, '\D', '', 'g'), 10) then v_errors := array_append(v_errors, 'Your guarantor needs their own phone number.'); end if;
  if length(v_g_rel) < 3 then v_errors := array_append(v_errors, 'Say how you know your guarantor.'); end if;
  -- The documents must be this account's own uploads.
  if v_id_photo not like v_uid::text || '/%' then v_errors := array_append(v_errors, 'Add a photo of your ID.'); end if;
  if v_selfie not like v_uid::text || '/%' then v_errors := array_append(v_errors, 'Add a selfie holding your ID.'); end if;
  if v_answers is distinct from private.rider_quiz_key() then v_errors := array_append(v_errors, 'Finish the training and pass the quiz first.'); end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  insert into public.rider_applications (user_id, full_name, nin, phone, address, area, vehicle, plate, guarantor_name, guarantor_phone, guarantor_relationship, id_photo_path, selfie_path, training_version)
  values (v_uid, v_name, v_nin, v_phone, v_address, v_area, v_vehicle, nullif(case when v_vehicle = 'bicycle' then '' else v_plate end, ''), v_g_name, v_g_phone, v_g_rel, v_id_photo, v_selfie, 1)
  on conflict (user_id) do update
    set full_name = excluded.full_name, nin = excluded.nin, phone = excluded.phone, address = excluded.address, area = excluded.area,
        vehicle = excluded.vehicle, plate = excluded.plate, guarantor_name = excluded.guarantor_name, guarantor_phone = excluded.guarantor_phone,
        guarantor_relationship = excluded.guarantor_relationship, id_photo_path = excluded.id_photo_path, selfie_path = excluded.selfie_path,
        training_version = excluded.training_version, status = 'pending', review_note = null, reviewed_at = null, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- Turns the applicant's account into a delivery account.
create function public.approve_rider_application(p_application_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.rider_applications;
begin
  perform private.require_admin();
  select * into a from public.rider_applications where id = p_application_id and status = 'pending' for update;
  if not found then perform private.fail('invalid_input', 'Only applications waiting for review can be approved.'); end if;
  if private.rider_account_blocker(a.user_id) is not null then
    perform private.fail('invalid_input', 'This account has bought or sold on DrawMart since applying, so it can’t become a rider’s. Ask them to apply from a new account.');
  end if;
  update public.profiles set role = 'delivery', display_name = a.full_name where id = a.user_id and role = 'buyer';
  -- Buyer-only things it had.
  delete from public.cart_items where user_id = a.user_id;
  delete from public.saved_listings where user_id = a.user_id;
  update public.rider_applications set status = 'approved', reviewed_at = now() where id = a.id;
  insert into public.notifications (user_id, kind) values (a.user_id, 'rider_approved');
end $$;

create function public.reject_rider_application(p_application_id uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if length(btrim(coalesce(p_note, ''))) < 5 then perform private.fail('invalid_input', 'Tell the applicant what to fix.'); end if;
  update public.rider_applications set status = 'rejected', review_note = btrim(p_note), reviewed_at = now()
   where id = p_application_id and status = 'pending';
  if not found then perform private.fail('invalid_input', 'Only applications waiting for review can be rejected.'); end if;
end $$;

create function public.set_rider_signups_open(p_open boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.app_settings set rider_signups_open = coalesce(p_open, false) where id;
end $$;

-- ---------------------------------------------------------------- fleets and trust

create function public.create_rider_fleet(p_name text, p_phone text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  perform private.require_admin();
  if length(btrim(coalesce(p_name, ''))) < 2 then perform private.fail('invalid_input', 'Enter the fleet’s name.'); end if;
  if regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then perform private.fail('invalid_input', 'Enter a Nigerian mobile number, e.g. 0803 123 4567.'); end if;
  insert into public.rider_fleets (name, contact_phone) values (btrim(p_name), btrim(p_phone)) returning id into v_id;
  return v_id;
end $$;

create function public.set_fleet_trusted(p_fleet uuid, p_trusted boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.rider_fleets set trusted = coalesce(p_trusted, false) where id = p_fleet;
  if not found then perform private.fail('not_found', 'That fleet doesn’t exist.'); end if;
end $$;

-- Riders only, never counter staff.
create function public.set_rider_fleet(p_rider uuid, p_fleet uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_fleet is not null and not exists (select 1 from public.rider_fleets where id = p_fleet) then perform private.fail('not_found', 'That fleet doesn’t exist.'); end if;
  update public.profiles set fleet_id = p_fleet where id = p_rider and role = 'delivery' and pickup_point_id is null;
  if not found then perform private.fail('not_found', 'That rider doesn’t exist.'); end if;
end $$;

create function public.set_rider_trusted(p_rider uuid, p_trusted boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.profiles set rider_trusted = coalesce(p_trusted, false) where id = p_rider and role = 'delivery' and pickup_point_id is null;
  if not found then perform private.fail('not_found', 'That rider doesn’t exist.'); end if;
end $$;

-- Deliveries a rider has finished: at the door or handed in at a counter.
create function private.rider_completed(p_rider uuid) returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.orders where rider_id = p_rider and (status = 'delivered' or counter_at is not null)
$$;

create function private.rider_trusted(p_rider uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(p.rider_trusted or f.trusted, false) from public.profiles p left join public.rider_fleets f on f.id = p.fleet_id where p.id = p_rider
$$;

-- riderApplications.ts newRiderLimitError. Null when the rider can take it.
create function private.new_rider_limit(p_rider uuid, p_order_kobo bigint, p_prize boolean) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  if private.rider_trusted(p_rider) or private.rider_completed(p_rider) >= s.new_rider_jobs then return null; end if;
  if p_prize then return format('Won items open up after %s completed deliveries.', s.new_rider_jobs); end if;
  if p_order_kobo > s.new_rider_max_kobo then return format('Jobs worth this much open up after %s completed deliveries.', s.new_rider_jobs); end if;
  return null;
end $$;

-- Every rider, for admins.
create function public.admin_riders() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.display_name, 'photo', p.rider_photo, 'fleetId', p.fleet_id, 'trusted', p.rider_trusted,
      'completed', private.rider_completed(p.id), 'holding', private.rider_jobs_held(p.id), 'joinedAt', p.created_at
    ) order by p.display_name)
    from public.profiles p where p.role = 'delivery' and p.pickup_point_id is null
  ), '[]'::jsonb);
end $$;

-- A rider's own standing, for the pool.
create function public.my_rider_level() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  s public.app_settings := private.settings();
begin
  return jsonb_build_object('completed', private.rider_completed(v_uid), 'trusted', private.rider_trusted(v_uid), 'jobsToUnlock', s.new_rider_jobs, 'maxKobo', s.new_rider_max_kobo);
end $$;

revoke all on function private.rider_quiz_key(), private.rider_account_blocker(uuid), private.rider_completed(uuid), private.rider_trusted(uuid), private.new_rider_limit(uuid, bigint, boolean) from public, anon, authenticated;
revoke all on function public.submit_rider_application(jsonb), public.approve_rider_application(uuid), public.reject_rider_application(uuid, text), public.set_rider_signups_open(boolean),
  public.create_rider_fleet(text, text), public.set_fleet_trusted(uuid, boolean), public.set_rider_fleet(uuid, uuid), public.set_rider_trusted(uuid, boolean), public.admin_riders(), public.my_rider_level() from public, anon;
grant execute on function public.submit_rider_application(jsonb), public.approve_rider_application(uuid), public.reject_rider_application(uuid, text), public.set_rider_signups_open(boolean),
  public.create_rider_fleet(text, text), public.set_fleet_trusted(uuid, boolean), public.set_rider_fleet(uuid, uuid), public.set_rider_trusted(uuid, boolean), public.admin_riders(), public.my_rider_level() to authenticated;

-- Same as before, keeping new riders to smaller jobs.
create or replace function public.take_delivery(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_limit text;
begin
  if (select pickup_point_id from public.profiles where id = v_uid) is not null then
    perform private.fail('forbidden', 'Counter staff don’t take deliveries.');
  end if;
  perform private.require_job_room(v_uid);
  -- riderApplications.ts newRiderLimitError.
  v_limit := (select private.new_rider_limit(v_uid, price_kobo, is_prize) from public.orders where id = p_order_id);
  if v_limit is not null then perform private.fail('invalid_input', v_limit); end if;
  update public.orders set rider_id = v_uid, rider_assigned_at = now(), collected_at = case when is_prize then now() else collected_at end
   where id = p_order_id and rider_id is null
     and ((status = 'dispatched' and counter_at is null)
          or (return_state = 'returning' and counter_at is not null and counter_out_at is null));
  if not found then perform private.fail('invalid_input', 'Another rider has taken this delivery.'); end if;
end $$;

-- Same as before, keeping new riders to smaller jobs.
create or replace function public.take_return(p_claim_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_limit text;
begin
  perform private.require_job_room(v_uid);
  v_limit := (select private.new_rider_limit(v_uid, o.price_kobo, o.is_prize) from public.order_claims c join public.orders o on o.id = c.order_id where c.id = p_claim_id);
  if v_limit is not null then perform private.fail('invalid_input', v_limit); end if;
  update public.order_claims set rider_id = v_uid, rider_assigned_at = now() where id = p_claim_id and status = 'awaiting_pickup' and rider_id is null;
  if not found then perform private.fail('invalid_input', 'Another rider has taken this return.'); end if;
end $$;

-- Same as before, saying which jobs a new rider can't take yet.
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
        a."fromArea",
        a."toArea",
        a.size,
        private.rider_pay(coalesce(a."fromArea", a."toArea"), coalesce(a."toArea", a."fromArea"), a.size) as "payKobo",
        case when o.return_state = 'returning' then coalesce(o.cancelled_at, o.dispatched_at) else o.dispatched_at end as "postedAt",
        o.rider_id is null and private.new_rider_limit(v_uid, o.price_kobo, o.is_prize) is not null as locked,
        case when o.status in ('dispatched', 'delivered') then o.counter_at end as "atCounterAt",
        o.return_state = 'returning' and o.counter_at is not null and o.counter_out_at is null as "waitingAtCounter",
        o.arrived_at as "arrivedAt",
        o.failed_attempts as "failedAttempts",
        o.status = 'dispatched' and o.failed_attempts = 1 and o.redelivery_choice is null as "awaitingBuyer",
        case when o.redelivery_choice = 'redeliver' then o.redeliver_at end as "redeliverAt",
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
        case when o.rider_id = v_uid and o.status = 'dispatched' and o.collected_at is not null and o.counter_at is null then jsonb_build_object(
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
      -- Going back to the seller: from the counter or the buyer. Otherwise from the seller (or DrawMart's escrow, unknown).
      cross join lateral (
        select
          case when o.return_state = 'returning' then case when o.counter_at is not null then private.point_area(o.pickup_point_id) else private.buyer_area(o) end
               when o.handled_by = 'drawmart' then null
               else m.delivery_area end as "fromArea",
          case when o.return_state = 'returning' then m.delivery_area
               when o.fulfilment = 'pickup' then private.point_area(o.pickup_point_id)
               else private.buyer_area(o) end as "toArea",
          private.package_size_of(l.package_size, l.category) as size
      ) a
      where (o.status = 'dispatched' and o.rider_id is null and o.counter_at is null)
         or (o.return_state = 'returning' and o.rider_id is null and o.counter_at is not null and o.counter_out_at is null)
         or (o.rider_id = v_uid and (o.status in ('dispatched', 'delivered') or o.return_state = 'returning'))
      order by o.delivered_at desc nulls first
      limit 200
    ) x
  );
end $$;

-- Same as before, saying which returns a new rider can't take yet.
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
      'fromArea', private.nearest_area(c.return_lat, c.return_lng),
      'toArea', m.delivery_area,
      'size', private.package_size_of(l.package_size, l.category),
      'payKobo', private.rider_pay(private.nearest_area(c.return_lat, c.return_lng), m.delivery_area, private.package_size_of(l.package_size, l.category)),
      'postedAt', coalesce(c.reviewed_at, c.created_at),
      'locked', c.rider_id is null and private.new_rider_limit(v_uid, o.price_kobo, o.is_prize) is not null,
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

-- Same as before, with approval.
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
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_rider_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, wiping rider applications and fleets too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.rider_applications, public.delivery_messages, public.rider_earnings, public.rider_payout_accounts, private.rider_payout_account_history, private.delivery_attempts, private.job_releases, public.store_activity, public.store_invites, private.owed_checks, private.discount_redemptions, public.discount_listings, public.discounts, public.quick_replies, public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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

-- Same as before, with the demo rider trusted.
create or replace function private.seed_test_accounts() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not (private.settings()).test_mode then
    raise notice 'Test accounts skipped: test mode is off.';
    return;
  end if;

  drop table if exists pg_temp.test_accounts;
  create temporary table test_accounts (id uuid, email text, name text, role text, merchant_id uuid) on commit drop;
  insert into test_accounts values
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'buyer@drawmart.test', 'Ada Okafor', 'buyer', null::uuid),
    ('a0000000-0000-4000-8000-000000000004'::uuid, 'chidi@drawmart.test', 'Chidi Eze', 'buyer', null::uuid),
    ('a0000000-0000-4000-8000-000000000005'::uuid, 'ngozi@drawmart.test', 'Ngozi Bello', 'buyer', null::uuid),
    ('a0000000-0000-4000-8000-000000000006'::uuid, 'emeka@drawmart.test', 'Emeka Nwosu', 'buyer', null::uuid),
    ('a0000000-0000-4000-8000-000000000007'::uuid, 'funke@drawmart.test', 'Funke Ade', 'buyer', null::uuid),
    ('a0000000-0000-4000-8000-000000000008'::uuid, 'seller@drawmart.test', 'Tolu Adebayo', 'buyer', null::uuid),
    ('a0000000-0000-4000-8000-000000000002'::uuid, 'store@drawmart.test', 'Ikeja Partner Store', 'store', '11111111-1111-4111-8111-000000000001'::uuid),
    ('a0000000-0000-4000-8000-000000000009'::uuid, 'lekki@drawmart.test', 'Lekki Partner Store', 'store', '11111111-1111-4111-8111-000000000002'::uuid),
    ('a0000000-0000-4000-8000-00000000000a'::uuid, 'surulere@drawmart.test', 'Surulere Partner Store', 'store', '11111111-1111-4111-8111-000000000003'::uuid),
    ('a0000000-0000-4000-8000-00000000000b'::uuid, 'yaba@drawmart.test', 'Yaba Partner Store', 'store', '11111111-1111-4111-8111-000000000004'::uuid),
    ('a0000000-0000-4000-8000-00000000000c'::uuid, 'vi@drawmart.test', 'Victoria Island Partner Dealer', 'store', '11111111-1111-4111-8111-000000000005'::uuid),
    ('a0000000-0000-4000-8000-00000000000d'::uuid, 'rider@drawmart.test', 'Bayo Rider', 'delivery', null::uuid),
    ('a0000000-0000-4000-8000-00000000000e'::uuid, 'counter@drawmart.test', 'Kemi Counter', 'delivery', null::uuid);

  -- New accounts get a buyer profile and the starting balance from the sign-up trigger.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', a.id, 'authenticated', 'authenticated', a.email,
         extensions.crypt('drawmart-demo', extensions.gen_salt('bf')), now(),
         '{"provider": "email", "providers": ["email"]}', jsonb_build_object('display_name', a.name), now(), now(),
         '', '', '', ''
    from test_accounts a
   where not exists (select 1 from auth.users u where u.id = a.id or lower(u.email) = a.email);

  -- Email sign-in needs a matching identity row.
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
    from auth.users u join test_accounts a on lower(u.email) = a.email
   where not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

  -- Matched by email, so accounts made before keep working.
  update public.profiles p
     set role = a.role, merchant_id = a.merchant_id, display_name = a.name
    from auth.users u join test_accounts a on lower(u.email) = a.email
   where p.id = u.id;

  -- The demo rider has a track record, so demos can carry anything.
  update public.profiles p set rider_trusted = true
    from auth.users u
   where p.id = u.id and lower(u.email) = 'rider@drawmart.test';

  update public.profiles p set pickup_point_id = 'ikeja'
    from auth.users u
   where p.id = u.id and lower(u.email) = 'counter@drawmart.test';

  update public.profiles p set seller_id = '11111111-1111-4111-8111-000000000006'
    from auth.users u
   where p.id = u.id and lower(u.email) = 'seller@drawmart.test';

  insert into public.seller_applications (user_id, shop_name, legal_name, nin, phone, address, area, id_photo_path, selfie_path, status, reviewed_at)
  select u.id, 'Tolu’s Gadgets', 'Toluwani Adebayo', '12345678901', '0803 123 4567', '12 Herbert Macaulay Way, Yaba', 'Yaba',
         u.id::text || '/seed-id.jpg', u.id::text || '/seed-selfie.jpg', 'approved', now()
    from auth.users u
   where lower(u.email) = 'seller@drawmart.test'
  on conflict (user_id) do update set status = 'approved', review_note = null, reviewed_at = now();
end $$;
