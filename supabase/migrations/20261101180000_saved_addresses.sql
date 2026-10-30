-- The buyer's account: a contact phone, and saved delivery addresses to pick
-- from at checkout (src/domain/addresses.ts). An address is as private as an
-- order's: only its owner reads it. Orders keep their own copy, so editing or
-- deleting a saved address never changes an order already placed.

alter table public.profiles add column phone text;

create table public.saved_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  phone text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index saved_addresses_user_idx on public.saved_addresses (user_id, created_at);
-- At most one default per buyer.
create unique index saved_addresses_one_default on public.saved_addresses (user_id) where is_default;

alter table public.saved_addresses enable row level security;
create policy "own addresses" on public.saved_addresses for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.saved_addresses from anon, authenticated;
grant select on public.saved_addresses to authenticated;

create function private.phone_is_valid(p_phone text) returns boolean
language sql immutable
as $$ select regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g') ~ '^(\+?234|0)[789][01][0-9]{8}$' $$;

-- Null or empty clears it.
create function public.set_contact_phone(p_phone text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if v_phone is not null and not private.phone_is_valid(v_phone) then
    perform private.fail('invalid_input', 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  update public.profiles set phone = v_phone where id = v_uid;
end $$;

-- addresses.ts validateSavedAddress. Adds, or updates with p.id. The first one
-- saved is the default. Returns the address id.
create function public.save_address(p jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_label text := btrim(coalesce(p ->> 'label', ''));
  v_address text := btrim(coalesce(p ->> 'address', ''));
  v_phone text := btrim(coalesce(p ->> 'phone', ''));
  v_lat double precision;
  v_lng double precision;
  v_pin_error text;
  v_errors text[] := '{}';
  v_make_default boolean := coalesce((p ->> 'makeDefault')::boolean, false);
begin
  perform private.require_buyer(v_uid);
  -- Serialises this buyer's changes, so the limit and the one default hold.
  perform 1 from public.profiles where id = v_uid for update;
  begin
    v_lat := (p ->> 'lat')::double precision;
    v_lng := (p ->> 'lng')::double precision;
  exception when others then
    v_lat := null;
  end;
  v_pin_error := private.location_error(v_lat, v_lng);

  if v_label = '' or length(v_label) > 40 then v_errors := array_append(v_errors, 'Give it a short name, like Home or Work.'); end if;
  if length(v_address) < 10 then v_errors := array_append(v_errors, 'Enter the full address, with street and area.'); end if;
  if v_pin_error is not null then v_errors := array_append(v_errors, v_pin_error); end if;
  if not private.phone_is_valid(v_phone) then v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567.'); end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  if v_id is null then
    if (select count(*) from public.saved_addresses where user_id = v_uid) >= 10 then
      perform private.fail('invalid_input', 'You can save up to 10 addresses. Remove one to add another.');
    end if;
    v_make_default := v_make_default or not exists (select 1 from public.saved_addresses where user_id = v_uid);
    if v_make_default then update public.saved_addresses set is_default = false where user_id = v_uid and is_default; end if;
    insert into public.saved_addresses (user_id, label, address, lat, lng, phone, is_default)
    values (v_uid, v_label, v_address, v_lat, v_lng, v_phone, v_make_default)
    returning id into v_id;
  else
    if not exists (select 1 from public.saved_addresses where id = v_id and user_id = v_uid) then
      perform private.fail('not_found', 'That address doesn’t exist.');
    end if;
    if v_make_default then update public.saved_addresses set is_default = false where user_id = v_uid and is_default and id <> v_id; end if;
    update public.saved_addresses
       set label = v_label, address = v_address, lat = v_lat, lng = v_lng, phone = v_phone, is_default = is_default or v_make_default
     where id = v_id;
  end if;
  return v_id;
end $$;

create function public.set_default_address(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform 1 from public.profiles where id = v_uid for update;
  if not exists (select 1 from public.saved_addresses where id = p_id and user_id = v_uid) then
    perform private.fail('not_found', 'That address doesn’t exist.');
  end if;
  update public.saved_addresses set is_default = false where user_id = v_uid and is_default and id <> p_id;
  update public.saved_addresses set is_default = true where id = p_id;
end $$;

-- Removing the default hands it to the oldest one left.
create function public.delete_address(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_was_default boolean;
begin
  perform 1 from public.profiles where id = v_uid for update;
  delete from public.saved_addresses where id = p_id and user_id = v_uid returning is_default into v_was_default;
  if v_was_default then
    update public.saved_addresses set is_default = true
     where id = (select id from public.saved_addresses where user_id = v_uid order by created_at, id limit 1);
  end if;
end $$;

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

revoke execute on function
  private.phone_is_valid(text), public.set_contact_phone(text), public.save_address(jsonb),
  public.set_default_address(uuid), public.delete_address(uuid)
from public, anon, authenticated;
grant execute on function
  public.set_contact_phone(text), public.save_address(jsonb), public.set_default_address(uuid), public.delete_address(uuid)
to authenticated;
