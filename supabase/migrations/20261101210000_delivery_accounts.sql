-- Delivery accounts (/delivery): riders, drivers and pickup-counter staff. Only
-- they can mark an order delivered, and only with a 6-digit PIN the buyer gives
-- them, so nobody can claim a delivery that didn't happen. domain/delivery.ts.
--
-- An order that's ready goes in a shared pool. A rider takes it, and only then
-- sees the buyer's name, address, pin and phone.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('buyer', 'store', 'admin', 'delivery'));

alter table public.orders
  add column rider_id uuid references public.profiles (id),
  add column rider_assigned_at timestamptz;
create index orders_rider_idx on public.orders (rider_id, status) where rider_id is not null;

-- In private so no table read can reach it: only the buyer gets a PIN, through
-- my_delivery_pins. Gone once used.
create table private.order_pins (
  order_id uuid primary key references public.orders (id) on delete cascade,
  pin text not null check (pin ~ '^[0-9]{6}$'),
  attempts int not null default 0,
  locked_until timestamptz
);
alter table private.order_pins enable row level security;
revoke all on private.order_pins from public, anon, authenticated;

create function private.new_delivery_pin() returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare v_bytes bytea := extensions.gen_random_bytes(4);
begin
  return lpad(((get_byte(v_bytes, 0)::bigint * 16777216 + get_byte(v_bytes, 1) * 65536 + get_byte(v_bytes, 2) * 256 + get_byte(v_bytes, 3)) % 1000000)::text, 6, '0');
end $$;

-- A trigger, so every way of creating an order gets one (checkout, the older buy_now).
create function private.assign_delivery_pin() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.order_pins (order_id, pin) values (new.id, private.new_delivery_pin());
  return new;
end $$;

create trigger orders_delivery_pin after insert on public.orders
  for each row execute function private.assign_delivery_pin();

-- Orders already on their way need one too.
insert into private.order_pins (order_id, pin)
select id, private.new_delivery_pin() from public.orders where status <> 'delivered';

create function private.require_delivery() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  if coalesce((select role from public.profiles where id = v_uid), '') <> 'delivery' then
    perform private.fail('forbidden', 'Only delivery accounts can do this.');
  end if;
  return v_uid;
end $$;

-- {orderId: pin} for the buyer's own orders that haven't arrived yet.
create function public.my_delivery_pins() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(o.id, p.pin), '{}'::jsonb)
    from public.orders o join private.order_pins p on p.order_id = o.id
   where o.user_id = auth.uid() and o.status <> 'delivered'
$$;

-- The pool, this rider's deliveries, and what they've finished. Named fields
-- only: no buyer details until it's theirs, and none once it's done.
create function public.delivery_jobs() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  return (
    select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."deliveredAt" desc nulls first, x."dispatchedAt"), '[]'::jsonb)
    from (
      select
        o.id,
        l.product_code as "productCode",
        l.title as "listingTitle",
        l.images[1] as "listingImage",
        l.category,
        o.fulfilment,
        o.status,
        o.dispatched_at as "dispatchedAt",
        o.delivered_at as "deliveredAt",
        o.rider_id is not null as mine,
        case when o.handled_by = 'drawmart'
          then jsonb_build_object('name', 'DrawMart escrow', 'area', 'Lagos')
          else jsonb_build_object('name', m.name, 'area', m.area) end as "collectFrom",
        case when pp.id is not null then jsonb_build_object(
          'id', pp.id, 'name', pp.name, 'area', pp.area, 'address', pp.address, 'hours', pp.hours,
          'location', jsonb_build_object('lat', pp.lat, 'lng', pp.lng)) end as "pickupPoint",
        case when o.rider_id = v_uid and o.status = 'dispatched' then jsonb_build_object(
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
      where (o.status = 'dispatched' and o.rider_id is null) or o.rider_id = v_uid
      order by o.delivered_at desc nulls first
      limit 200
    ) x
  );
end $$;

create function public.take_delivery(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  update public.orders set rider_id = v_uid, rider_assigned_at = now()
   where id = p_order_id and status = 'dispatched' and rider_id is null;
  if not found then perform private.fail('invalid_input', 'Another rider has taken this delivery.'); end if;
end $$;

-- Back in the pool, for when a rider can't make it.
create function public.release_delivery(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  update public.orders set rider_id = null, rider_assigned_at = null
   where id = p_order_id and status = 'dispatched' and rider_id = v_uid;
  if not found then perform private.fail('invalid_input', 'Only deliveries you’re carrying can be handed back.'); end if;
end $$;

-- delivery.ts checkPin. A wrong PIN returns rather than raises, because raising
-- would undo the count of wrong attempts.
create function public.confirm_delivery(p_order_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  v_max constant int := 5;
  p private.order_pins;
  v_attempts int;
  v_locked timestamptz;
begin
  select pins.* into p
    from private.order_pins pins join public.orders o on o.id = pins.order_id
   where o.id = p_order_id and o.rider_id = v_uid and o.status = 'dispatched'
     for update of pins;
  if not found then perform private.fail('invalid_input', 'Only deliveries you’re carrying can be confirmed.'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then perform private.fail('invalid_input', 'Enter the buyer’s 6-digit PIN.'); end if;

  if p.locked_until > now() then
    return jsonb_build_object('confirmed', false, 'attemptsLeft', 0, 'lockedUntil', p.locked_until);
  end if;

  if p_pin = p.pin then
    update public.orders set status = 'delivered', delivered_at = now() where id = p_order_id;
    delete from private.order_pins where order_id = p_order_id;
    return jsonb_build_object('confirmed', true, 'attemptsLeft', 0, 'lockedUntil', null);
  end if;

  -- A lock that's run out starts the count again.
  v_attempts := case when p.locked_until is not null then 1 else p.attempts + 1 end;
  v_locked := case when v_attempts >= v_max then now() + interval '30 minutes' end;
  update private.order_pins set attempts = v_attempts, locked_until = v_locked where order_id = p_order_id;
  return jsonb_build_object('confirmed', false, 'attemptsLeft', greatest(v_max - v_attempts, 0), 'lockedUntil', v_locked);
end $$;

-- Buyers don't confirm any more, whichever version of the app asks.
create or replace function public.confirm_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.fail('forbidden', 'Deliveries are confirmed by the rider, with the PIN on your order.');
end $$;

revoke execute on function
  private.new_delivery_pin(), private.assign_delivery_pin(), private.require_delivery(),
  public.my_delivery_pins(), public.delivery_jobs(), public.take_delivery(uuid), public.release_delivery(uuid), public.confirm_delivery(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.my_delivery_pins(), public.delivery_jobs(), public.take_delivery(uuid), public.release_delivery(uuid), public.confirm_delivery(uuid, text)
to authenticated;

-- A test rider, and resets that include the PINs.
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
    ('a0000000-0000-4000-8000-00000000000d'::uuid, 'rider@drawmart.test', 'Bayo Rider', 'delivery', null::uuid);

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
           public.seller_applications, public.saved_pickups, public.notifications, public.cart_items, public.saved_addresses;

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
