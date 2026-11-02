-- Store teams: an owner invites staff by email with a role. Owner: everything. Manager:
-- everything but the bank account and the team. Orders only: confirm and send orders, and
-- messages. The invitee signs up with that email and accepts; their account becomes a store
-- account, so it must be one that hasn't bought or sold (private.store_account_blocker).
-- Individual sellers have no team. Rules mirror src/domain/team.ts.

create table public.store_members (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'orders')),
  created_at timestamptz not null default now()
);
create index store_members_merchant_idx on public.store_members (merchant_id);
alter table public.store_members enable row level security;
revoke all on public.store_members from anon, authenticated;

create table public.store_invites (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role text not null check (role in ('owner', 'manager', 'orders')),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);
create unique index store_invites_pending_idx on public.store_invites (merchant_id, email) where accepted_at is null and revoked_at is null;
alter table public.store_invites enable row level security;
revoke all on public.store_invites from anon, authenticated;

-- Who did what, for the owner.
create table public.store_activity (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  listing_id uuid references public.listings (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index store_activity_merchant_idx on public.store_activity (merchant_id, created_at desc);
alter table public.store_activity enable row level security;
revoke all on public.store_activity from anon, authenticated;

-- Every store account is on its store's team; existing ones, and any made by hand or by
-- approving a store application, as its owner. An accepted invite adds its row first, with its role.
create function private.sync_store_member() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.role = 'store' and new.merchant_id is not null then
    insert into public.store_members (user_id, merchant_id, role) values (new.id, new.merchant_id, 'owner')
    on conflict (user_id) do update set merchant_id = excluded.merchant_id where public.store_members.merchant_id <> excluded.merchant_id;
  else
    delete from public.store_members where user_id = new.id;
  end if;
  return null;
end $$;
create trigger profiles_store_member after insert or update of role, merchant_id on public.profiles
  for each row execute function private.sync_store_member();
insert into public.store_members (user_id, merchant_id, role)
select id, merchant_id, 'owner' from public.profiles where role = 'store' and merchant_id is not null
on conflict do nothing;

-- team.ts canDo. Null: not on a store's team, so other checks apply (individual sellers, buyers, admins).
create function private.shop_role() returns text
language sql stable security definer set search_path = ''
as $$ select role from public.store_members where user_id = auth.uid() $$;

create function private.shop_allows(p_perm text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case coalesce(private.shop_role(), 'owner')
    when 'owner' then true
    when 'manager' then p_perm in ('orders', 'shop')
    else p_perm = 'orders'
  end
$$;

create function private.require_shop_permission(p_perm text) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.shop_allows(p_perm) then
    perform private.fail('forbidden', case when p_perm in ('bank', 'team') then 'Only the store’s owner can do this.' else 'Your role in this store doesn’t include this. Ask the owner.' end);
  end if;
end $$;

-- For the app: what this account can do in its shop. Individual sellers own theirs.
create function public.my_store_role() returns text
language sql stable security definer set search_path = ''
as $$ select coalesce(private.shop_role(), case when private.my_merchant_id() is not null then 'owner' end) $$;

-- Payouts: owners and managers. The bank account: owners.
drop policy "own payouts, or admins" on public.payouts;
create policy "own payouts, or admins" on public.payouts for select to authenticated
  using ((merchant_id = (select private.my_merchant_id()) and (select private.shop_allows('shop'))) or (select private.is_admin()));
drop policy "own account, or admins" on public.payout_accounts;
create policy "own account, or admins" on public.payout_accounts for select to authenticated
  using ((merchant_id = (select private.my_merchant_id()) and (select private.shop_allows('bank'))) or (select private.is_admin()));

-- ------------------------------------------------------------------ the team

create function public.store_team() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_shop uuid := private.my_merchant_id();
begin
  perform private.require_user();
  if v_shop is null or not exists (select 1 from public.merchants where id = v_shop and kind = 'store') then perform private.fail('forbidden', 'Teams are for stores.'); end if;
  perform private.require_shop_permission('team');
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('userId', s.user_id, 'name', p.display_name, 'email', u.email, 'role', s.role, 'you', s.user_id = auth.uid(), 'since', s.created_at) order by s.created_at)
        from public.store_members s join public.profiles p on p.id = s.user_id left join auth.users u on u.id = s.user_id
       where s.merchant_id = v_shop), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'createdAt', i.created_at) order by i.created_at)
        from public.store_invites i where i.merchant_id = v_shop and i.accepted_at is null and i.revoked_at is null), '[]'::jsonb));
end $$;

create function public.invite_store_member(p_email text, p_role text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_shop uuid := private.my_merchant_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  perform private.require_user();
  if v_shop is null or not exists (select 1 from public.merchants where id = v_shop and kind = 'store') then perform private.fail('forbidden', 'Teams are for stores.'); end if;
  perform private.require_shop_permission('team');
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then perform private.fail('invalid_input', 'Enter their email address.'); end if;
  if p_role is null or p_role not in ('owner', 'manager', 'orders') then perform private.fail('invalid_input', 'Choose a role.'); end if;
  perform 1 from public.merchants where id = v_shop for update; -- one at a time, so the count holds
  if exists (select 1 from public.store_members s join auth.users u on u.id = s.user_id where s.merchant_id = v_shop and lower(u.email) = v_email) then
    perform private.fail('invalid_input', 'They’re already on your team.');
  end if;
  update public.store_invites set role = p_role where merchant_id = v_shop and email = v_email and accepted_at is null and revoked_at is null returning id into v_id;
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.store_members where merchant_id = v_shop)
     + (select count(*) from public.store_invites where merchant_id = v_shop and accepted_at is null and revoked_at is null) >= 20 then
    perform private.fail('invalid_input', 'A store can have up to 20 people, counting invites.');
  end if;
  insert into public.store_invites (merchant_id, email, role, invited_by) values (v_shop, v_email, p_role, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.revoke_store_invite(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_user();
  perform private.require_shop_permission('team');
  update public.store_invites set revoked_at = now() where id = p_id and merchant_id = private.my_merchant_id() and accepted_at is null and revoked_at is null;
  if not found then perform private.fail('not_found', 'That invite doesn’t exist.'); end if;
end $$;

-- team.ts lastOwnerError: a store always keeps an owner.
create function private.check_keeps_owner(p_shop uuid, p_user uuid, p_new_role text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.store_members where user_id = p_user and merchant_id = p_shop and role = 'owner')
     and p_new_role is distinct from 'owner'
     and (select count(*) from public.store_members where merchant_id = p_shop and role = 'owner') = 1 then
    perform private.fail('invalid_input', 'Your store needs at least one owner. Make someone else an owner first.');
  end if;
end $$;

create function public.set_store_member_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_shop uuid := private.my_merchant_id();
begin
  perform private.require_user();
  perform private.require_shop_permission('team');
  if p_role is null or p_role not in ('owner', 'manager', 'orders') then perform private.fail('invalid_input', 'Choose a role.'); end if;
  perform 1 from public.merchants where id = v_shop for update;
  if not exists (select 1 from public.store_members where user_id = p_user and merchant_id = v_shop) then perform private.fail('not_found', 'They’re not on your team.'); end if;
  perform private.check_keeps_owner(v_shop, p_user, p_role);
  update public.store_members set role = p_role where user_id = p_user;
end $$;

-- Their account goes back to being a plain buyer account.
create function public.remove_store_member(p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_shop uuid := private.my_merchant_id();
begin
  perform private.require_user();
  perform private.require_shop_permission('team');
  perform 1 from public.merchants where id = v_shop for update;
  if not exists (select 1 from public.store_members where user_id = p_user and merchant_id = v_shop) then perform private.fail('not_found', 'They’re not on your team.'); end if;
  perform private.check_keeps_owner(v_shop, p_user, null);
  update public.profiles set role = 'buyer', merchant_id = null where id = p_user;
end $$;

-- ---------------------------------------------------------- joining a team

create function public.my_store_invites() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'storeName', m.name, 'role', i.role, 'createdAt', i.created_at) order by i.created_at), '[]'::jsonb)
    from public.store_invites i join public.merchants m on m.id = i.merchant_id
   where i.email = (select lower(email) from auth.users where id = auth.uid()) and i.accepted_at is null and i.revoked_at is null
$$;

create function public.accept_store_invite(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  i public.store_invites;
  v_blocker text;
begin
  select * into i from public.store_invites where id = p_id and accepted_at is null and revoked_at is null for update;
  if not found or i.email is distinct from (select lower(email) from auth.users where id = v_uid) then perform private.fail('not_found', 'That invite doesn’t exist, or it’s for another email address.'); end if;
  v_blocker := private.store_account_blocker(v_uid);
  if v_blocker is not null then perform private.fail('invalid_input', v_blocker); end if;
  insert into public.store_members (user_id, merchant_id, role) values (v_uid, i.merchant_id, i.role);
  update public.profiles set role = 'store', merchant_id = i.merchant_id where id = v_uid;
  delete from public.cart_items where user_id = v_uid;
  delete from public.saved_listings where user_id = v_uid;
  update public.store_invites set accepted_at = now() where id = i.id;
end $$;

-- ------------------------------------------------------------ the activity log

create function private.log_store_activity(p_merchant uuid, p_action text, p_listing uuid, p_order uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  -- Only what the store's own people do: not buyers, riders, admins or deadlines.
  if exists (select 1 from public.store_members where user_id = auth.uid() and merchant_id = p_merchant) then
    insert into public.store_activity (merchant_id, user_id, action, listing_id, order_id) values (p_merchant, auth.uid(), p_action, p_listing, p_order);
  end if;
end $$;

create function private.listing_activity() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_action text;
begin
  if tg_op = 'INSERT' then v_action := 'listed';
  elsif new.status = 'withdrawn' and old.status <> 'withdrawn' then v_action := 'withdrew';
  elsif new.status = 'paused' and old.status <> 'paused' then v_action := 'paused';
  elsif old.status = 'paused' and new.status = 'for_sale' then v_action := 'resumed';
  elsif new.revision > old.revision then v_action := 'edited';
  elsif new.price_kobo <> old.price_kobo then v_action := 'repriced';
  elsif new.stock <> old.stock then v_action := 'restocked';
  end if;
  if v_action is not null then perform private.log_store_activity(new.merchant_id, v_action, new.id, null); end if;
  return null;
exception when others then
  raise warning 'listing_activity: %', sqlerrm;
  return null;
end $$;
create trigger listings_activity after insert or update on public.listings for each row execute function private.listing_activity();

create function private.order_activity() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_action text;
begin
  if new.confirmed_at is not null and old.confirmed_at is null then v_action := 'confirmed';
  elsif new.status = 'dispatched' and old.status <> 'dispatched' then v_action := 'dispatched';
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then v_action := 'cancelled';
  end if;
  if v_action is not null then perform private.log_store_activity(new.merchant_id, v_action, new.listing_id, new.id); end if;
  return null;
exception when others then
  raise warning 'order_activity: %', sqlerrm;
  return null;
end $$;
create trigger orders_activity after update on public.orders for each row execute function private.order_activity();

create function public.store_activity_log() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_user();
  perform private.require_shop_permission('team');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'at', a.created_at, 'who', coalesce(p.display_name, 'Someone who has left'), 'action', a.action,
                                        'listingTitle', l.title, 'productCode', l.product_code) order by a.created_at desc)
      from (select * from public.store_activity where merchant_id = private.my_merchant_id() order by created_at desc limit 100) a
      left join public.profiles p on p.id = a.user_id
      left join public.listings l on l.id = a.listing_id
  ), '[]'::jsonb);
end $$;

revoke all on function private.sync_store_member(), private.shop_role(), private.shop_allows(text), private.require_shop_permission(text), private.check_keeps_owner(uuid, uuid, text),
  private.log_store_activity(uuid, text, uuid, uuid), private.listing_activity(), private.order_activity() from public, anon, authenticated;
-- Used inside the payouts policies.
grant execute on function private.shop_allows(text), private.shop_role() to authenticated;
revoke all on function public.my_store_role(), public.store_team(), public.invite_store_member(text, text), public.revoke_store_invite(uuid), public.set_store_member_role(uuid, text),
  public.remove_store_member(uuid), public.my_store_invites(), public.accept_store_invite(uuid), public.store_activity_log() from public, anon;
grant execute on function public.my_store_role(), public.store_team(), public.invite_store_member(text, text), public.revoke_store_invite(uuid), public.set_store_member_role(uuid, text),
  public.remove_store_member(uuid), public.my_store_invites(), public.accept_store_invite(uuid), public.store_activity_log() to authenticated;

-- ------------------------------------------------- the role checks in store functions

-- Same as before (20261101340000_listing_actions.sql), for owners and managers.
create or replace function private.my_listing_for_update(p_listing_id uuid) returns public.listings
language plpgsql security definer set search_path = ''
as $$
declare
  v_merchant public.merchants;
  l public.listings;
begin
  perform private.require_shop_permission('shop');
  perform private.require_user();
  select m.* into v_merchant from public.merchants m where m.id = private.my_merchant_id();
  if not found then perform private.fail('forbidden', 'This account isn’t linked to a store.'); end if;
  if not v_merchant.verified then perform private.fail('forbidden', 'Your store hasn’t been verified yet.'); end if;
  select * into l from public.listings where id = p_listing_id and merchant_id = v_merchant.id for update;
  if not found then perform private.fail('not_found', 'That listing doesn’t exist.'); end if;
  return l;
end $$;

-- Same as before (20261101450000_delivery_checks.sql), for owners and managers.
create or replace function public.create_listing(p jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_merchant public.merchants;
  v_errors text[] := '{}';
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_category text := p ->> 'category';
  v_price bigint := (p ->> 'priceKobo')::bigint;
  v_ticket bigint := (p ->> 'ticketPriceKobo')::bigint;
  v_fee_mode text := p ->> 'feeMode';
  v_fee_bps int;
  v_duration int := (p ->> 'durationDays')::int;
  v_unsold text := p ->> 'unsoldPolicy';
  v_fallback bigint := nullif(p ->> 'fallbackPriceKobo', '')::bigint;
  v_images text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'images', '[]'::jsonb))), '{}');
  h jsonb := coalesce(p -> 'handover', '{}'::jsonb);
  v_address text := btrim(coalesce(h ->> 'address', ''));
  v_phone text := coalesce(h ->> 'contactPhone', '');
  v_date date;
  v_slot text := h ->> 'slot';
  v_lat double precision;
  v_lng double precision;
  v_pin_error text;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_ticket_count int;
  v_buyer_bps numeric;
  v_buyer_ticket bigint;
  v_seed text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
begin
  perform private.require_shop_permission('shop');
  select m.* into v_merchant from public.merchants m join public.profiles pr on pr.merchant_id = m.id where pr.id = v_uid;
  if not found then perform private.fail('forbidden', 'This account isn’t linked to a store.'); end if;
  if v_merchant.suspended_at is not null then perform private.fail('forbidden', 'Your shop is suspended. Contact DrawMart.'); end if;
  if not v_merchant.verified then perform private.fail('forbidden', 'Your store hasn’t been verified yet.'); end if;

  begin v_date := (h ->> 'date')::date; exception when others then v_date := null; end;
  begin
    v_lat := (h -> 'location' ->> 'lat')::double precision;
    v_lng := (h -> 'location' ->> 'lng')::double precision;
  exception when others then
    v_lat := null;
  end;
  v_pin_error := private.location_error(v_lat, v_lng);

  -- fees.ts validateListingEconomics
  if v_title = '' then v_errors := array_append(v_errors, 'Give the item a name.'); end if;
  if v_price is null or v_price <= 0 then v_errors := array_append(v_errors, 'Enter your price.'); end if;
  if v_ticket is null or v_ticket < 10000 then v_errors := array_append(v_errors, 'Tickets must cost at least ₦100.'); end if;
  if v_price > 0 and v_ticket > v_price then v_errors := array_append(v_errors, 'A ticket can’t cost more than the item.'); end if;
  if v_price > 0 and v_ticket > 0 and (v_price + v_ticket - 1) / v_ticket > 10000 then
    v_errors := array_append(v_errors, 'That would need more than 10,000 tickets. Raise the ticket price.');
  end if;
  if v_fee_mode is null or v_fee_mode not in ('seller', 'buyer', 'split') then v_errors := array_append(v_errors, 'Pick who pays the fee.'); end if;
  if v_category is null or v_category not in ('Phones', 'Electronics', 'Home', 'Cars', 'Fashion') then v_errors := array_append(v_errors, 'Pick a category.'); end if;
  -- listing.ts validateListingTerms
  if v_duration is null or v_duration not between 3 and 60 then v_errors := array_append(v_errors, 'Pick a deadline between 3 and 60 days.'); end if;
  if v_unsold is null or v_unsold not in ('refund', 'extend_once', 'convert_to_sale') then v_errors := array_append(v_errors, 'Pick what happens if it doesn’t sell out.'); end if;
  if v_unsold = 'convert_to_sale' and not coalesce(v_fallback > 0, false) then
    v_errors := array_append(v_errors, 'Enter the price you’ll sell it for if the draw doesn’t sell out.');
  end if;
  -- listing.ts validateHandover
  if length(v_address) < 10 then v_errors := array_append(v_errors, 'Enter the full address, with street and area.'); end if;
  if v_pin_error is not null then v_errors := array_append(v_errors, v_pin_error); end if;
  if regexp_replace(v_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  if v_date is null or v_date < v_today + 1 or v_date > v_today + 14 then
    v_errors := array_append(v_errors, 'Pick a date between tomorrow and 14 days from now.');
  end if;
  if v_slot is null or v_slot not in ('morning', 'afternoon') then v_errors := array_append(v_errors, 'Pick a time slot.'); end if;
  if cardinality(v_images) > 4 or exists (select 1 from unnest(v_images) u where u !~ '^(https://|/assets/)') then
    v_errors := array_append(v_errors, 'Upload up to 4 photos.');
  end if;

  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  -- DrawMart sets the fee from the item's value; whatever the client sends is ignored.
  v_fee_bps := private.platform_fee_bps(v_price);

  -- fees.ts computeListingEconomics
  v_ticket_count := (v_price + v_ticket - 1) / v_ticket;
  v_buyer_bps := case v_fee_mode when 'buyer' then v_fee_bps when 'split' then v_fee_bps / 2.0 else 0 end;
  v_buyer_ticket := v_ticket + round(v_ticket * v_buyer_bps / 10000.0)::bigint;

  insert into public.listings (
    merchant_id, title, description, category, images, price_kobo, ticket_price_kobo, buyer_ticket_price_kobo,
    ticket_count, fee_mode, fee_bps, unsold_policy, fallback_price_kobo, duration_days, status,
    caution_fee_kobo, commitment, closes_at)
  values (
    v_merchant.id, v_title, btrim(coalesce(p ->> 'description', '')), v_category, v_images, v_price, v_ticket, v_buyer_ticket,
    v_ticket_count, v_fee_mode, v_fee_bps, v_unsold, case when v_unsold = 'convert_to_sale' then v_fallback end, v_duration, 'pending_review',
    (select amount_kobo from public.caution_fees where category = v_category),
    encode(sha256(convert_to(v_seed, 'UTF8')), 'hex'),
    now() + make_interval(days => v_duration))
  returning id into v_id;

  insert into public.listing_handovers (listing_id, method, address, contact_phone, date, slot, lat, lng)
  values (v_id, case when v_category = 'Cars' then 'inspection' else 'pickup' end, v_address, v_phone, v_date, v_slot, v_lat, v_lng);
  insert into private.listing_seeds (listing_id, seed) values (v_id, v_seed);
  return v_id;
end $$;

-- Same as before (20261031210000_saved_pickups.sql), for owners and managers.
create or replace function public.save_pickup_items(p_items jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_merchant uuid;
begin
  perform private.require_shop_permission('shop');
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

-- Same as before (20261101480000_listing_checks.sql), for owners and managers.
create or replace function public.create_product(p jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_merchant public.merchants;
  v_errors text[] := '{}';
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_category text := p ->> 'category';
  v_price bigint := (p ->> 'priceKobo')::bigint;
  v_fee_bps int;
  v_images text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'images', '[]'::jsonb))), '{}');
  v_id uuid;
  v_stock int := private.parse_stock(p, 1);
  v_size text := p ->> 'packageSize';
begin
  perform private.require_shop_permission('shop');
  select m.* into v_merchant from public.merchants m where m.id = private.my_merchant_id();
  if not found then perform private.fail('forbidden', 'Get verified as a seller, or sign in with a store account, to list products.'); end if;
  if v_merchant.suspended_at is not null then perform private.fail('forbidden', 'Your shop is suspended. Contact DrawMart.'); end if;
  if not v_merchant.verified then perform private.fail('forbidden', 'Your store hasn’t been verified yet.'); end if;

  if v_title = '' then v_errors := array_append(v_errors, 'Give the item a name.'); end if;
  if v_size is not null and v_size not in ('small', 'medium', 'large') then v_errors := array_append(v_errors, 'Pick a package size.'); end if;
  if v_stock is null then v_errors := array_append(v_errors, 'Enter how many you have, from 1 to 10,000.'); end if;
  if v_price is null or v_price < 10000 then v_errors := array_append(v_errors, 'Set a price of at least ₦100.'); end if;
  if v_category is null or v_category not in ('Phones', 'Electronics', 'Home', 'Cars', 'Fashion') then v_errors := array_append(v_errors, 'Pick a category.'); end if;
  if cardinality(v_images) > 4 or exists (select 1 from unnest(v_images) u where u !~ '^(https://|/assets/)') then
    v_errors := array_append(v_errors, 'Upload up to 4 photos.');
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  -- listingChecks.ts: proof the seller has it, and new sellers' limits.
  perform private.check_listing_proof(v_merchant, v_category, v_price, p -> 'check');
  perform private.check_new_seller_limits(v_merchant.id, v_price, 1);

  -- DrawMart sets the fee from the item's value; whatever the client sends is ignored.
  v_fee_bps := private.platform_fee_bps(v_price);

  insert into public.listings (
    package_size, stock, kind, merchant_id, title, description, category, images, price_kobo, ticket_price_kobo, buyer_ticket_price_kobo,
    ticket_count, fee_mode, fee_bps, unsold_policy, duration_days, status, caution_fee_kobo, caution_fee_status, commitment, closes_at)
  values (
    v_size, v_stock, 'product', v_merchant.id, v_title, btrim(coalesce(p ->> 'description', '')), v_category, v_images, v_price, 0, 0,
    0, 'seller', v_fee_bps, 'refund', 0, 'pending_review', 0, 'none', '', now())
  returning id into v_id;
  perform private.record_listing_proof(v_id, v_merchant.id, p -> 'check');
  return v_id;
end $$;

-- Same as before (20261101560000_bulk_upload.sql), for owners and managers.
create or replace function public.create_products_bulk(p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m public.merchants;
  v_items jsonb := coalesce(p -> 'items', '[]'::jsonb);
  v_n int := jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb));
  v_spot int := (private.settings()).spot_check_percent;
  v_picked int[] := '{}';
  v_titles text[] := '{}';
  v_errors text[] := '{}';
  v_detail text;
  v_created int := 0;
begin
  perform private.require_shop_permission('shop');
  perform private.require_user();
  select * into m from public.merchants where id = private.my_merchant_id() for update;
  if not found or m.kind <> 'store' then perform private.fail('forbidden', 'Bulk upload is for stores. Add your items one at a time.'); end if;
  if v_n = 0 then perform private.fail('invalid_input', 'Add at least one product.'); end if;
  if v_n > 100 then perform private.fail('invalid_input', 'Upload up to 100 products at a time.'); end if;
  if private.video_required(m) then
    perform private.fail('invalid_input', 'Your next listing needs a short video. Add it with the form, then upload the rest.');
  end if;

  -- Decided here, so the store can't tell in advance which rows will be picked.
  for i in 0 .. v_n - 1 loop
    if random() * 100 < v_spot then
      v_picked := array_append(v_picked, i);
      v_titles := array_append(v_titles, btrim(coalesce(v_items -> i ->> 'title', '')));
    end if;
  end loop;

  -- The same checks as one at a time. Collect every row's problems, then undo everything if there are any.
  for i in 0 .. v_n - 1 loop
    continue when i = any (v_picked);
    begin
      perform public.create_product(v_items -> i);
      v_created := v_created + 1;
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      v_errors := array_append(v_errors, 'Row ' || (i + 2) || ': ' || coalesce(nullif(v_detail, ''), sqlerrm));
    end;
  end loop;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  if cardinality(v_picked) > 0 then
    insert into private.owed_checks (merchant_id, owed) values (m.id, cardinality(v_picked))
    on conflict (merchant_id) do update set owed = private.owed_checks.owed + excluded.owed;
  end if;
  return jsonb_build_object('created', v_created, 'checkTitles', to_jsonb(v_titles));
end $$;

-- Same as before (20261101480000_listing_checks.sql), for owners and managers.
create or replace function public.listing_check_plan() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m public.merchants;
  t private.listing_check_tickets;
  s public.app_settings := private.settings();
  v_alphabet constant text := 'ACDEFHJKMNPRTUVWXY3479';
  v_code text := '';
  v_done int;
begin
  perform private.require_shop_permission('shop');
  perform private.require_user();
  select * into m from public.merchants where id = private.my_merchant_id();
  if not found then perform private.fail('forbidden', 'This account isn’t linked to a shop.'); end if;
  select * into t from private.listing_check_tickets where merchant_id = m.id;
  if not found or t.issued_at < now() - interval '24 hours' then
    for i in 1..4 loop v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1); end loop;
    insert into private.listing_check_tickets (merchant_id, code, video_required) values (m.id, v_code, random() * 100 < s.spot_check_percent)
    on conflict (merchant_id) do update set code = excluded.code, video_required = excluded.video_required, issued_at = now()
    returning * into t;
  end if;
  select count(*) into v_done from public.orders where merchant_id = m.id and status = 'delivered' and refunded_at is null and not is_prize;
  return jsonb_build_object(
    'code', t.code,
    'videoRequired', private.video_required(m),
    'individual', m.kind = 'individual',
    'newSeller', case when m.kind = 'individual' and v_done < 3 then jsonb_build_object(
      'deliveries', v_done,
      'live', (select count(*) from public.listings where merchant_id = m.id and status in ('pending_review', 'for_sale', 'paused'))
    ) end
  );
end $$;

-- Same as before (20261101550000_discounts.sql), for owners and managers.
create or replace function public.create_discount(p jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_shop uuid := private.my_merchant_id();
  v_kind text := p ->> 'kind';
  v_percent int := (p ->> 'percentOff')::int;
  v_amount bigint := (p ->> 'amountOffKobo')::bigint;
  v_code text := case when p ->> 'kind' = 'code' then upper(btrim(coalesce(p ->> 'code', ''))) end;
  v_max int := (p ->> 'maxUses')::int;
  v_starts timestamptz := (p ->> 'startsAt')::timestamptz;
  v_ends timestamptz := (p ->> 'endsAt')::timestamptz;
  v_ids uuid[] := coalesce(array(select distinct jsonb_array_elements_text(coalesce(p -> 'listingIds', '[]'::jsonb))::uuid), '{}');
  v_errors text[] := '{}';
  v_id uuid;
begin
  perform private.require_shop_permission('shop');
  perform private.require_user();
  if v_shop is null then perform private.fail('forbidden', 'Only sellers can run discounts.'); end if;
  perform 1 from public.merchants where id = v_shop for update; -- one at a time, so the count holds
  if v_kind is null or v_kind not in ('sale', 'code') then v_errors := array_append(v_errors, 'Choose a sale or a code.'); end if;
  if (v_percent is null) = (v_amount is null) then v_errors := array_append(v_errors, 'Choose a percentage or an amount off.'); end if;
  if v_percent is not null and v_percent not between 1 and 90 then v_errors := array_append(v_errors, 'Take 1% to 90% off.'); end if;
  if v_amount is not null and v_amount < 10000 then v_errors := array_append(v_errors, 'Take at least ₦100 off.'); end if;
  if cardinality(v_ids) = 0 then v_errors := array_append(v_errors, 'Choose at least one product.'); end if;
  if exists (select 1 from unnest(v_ids) i where not exists (
      select 1 from public.listings l where l.id = i and l.merchant_id = v_shop and l.kind = 'product' and l.status in ('for_sale', 'paused', 'pending_review'))) then
    v_errors := array_append(v_errors, 'Discounts are only for your own products, never draws.');
  end if;
  if v_amount is not null and exists (select 1 from public.listings where id = any (v_ids) and v_amount > price_kobo - 10000) then
    v_errors := array_append(v_errors, 'That’s more than one of the products costs. Leave at least ₦100.');
  end if;
  if v_starts is null or v_ends is null or v_ends <= v_starts then v_errors := array_append(v_errors, 'The end has to be after the start.');
  elsif v_ends - v_starts > make_interval(days => case when v_kind = 'code' then 90 else 31 end) then
    v_errors := array_append(v_errors, case when v_kind = 'code' then 'A code can run for up to 90 days.' else 'A sale can run for up to 31 days.' end);
  elsif v_ends <= now() then v_errors := array_append(v_errors, 'The end has to be in the future.');
  end if;
  if v_kind = 'code' then
    if v_code !~ '^[A-Z0-9]{4,16}$' then v_errors := array_append(v_errors, 'Use 4 to 16 letters and numbers for the code, e.g. SAVE10.');
    elsif exists (select 1 from public.discounts where code = v_code) then v_errors := array_append(v_errors, 'That code is taken. Try another.');
    end if;
    if v_max is not null and v_max not between 1 and 10000 then v_errors := array_append(v_errors, 'Allow 1 to 10,000 uses, or leave it unlimited.'); end if;
  else
    v_max := null;
  end if;
  if (select count(*) from public.discounts where merchant_id = v_shop and ended_at is null and ends_at > now()) >= 20 then
    v_errors := array_append(v_errors, 'You can have up to 20 discounts running or waiting to start. End one first.');
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  insert into public.discounts (merchant_id, kind, percent_off, amount_off_kobo, code, max_uses, starts_at, ends_at)
  values (v_shop, v_kind, v_percent, v_amount, v_code, v_max, v_starts, v_ends)
  returning id into v_id;
  insert into public.discount_listings (discount_id, listing_id) select v_id, unnest(v_ids);
  return v_id;
end $$;

-- Same as before (20261101550000_discounts.sql), for owners and managers.
create or replace function public.end_discount(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_shop_permission('shop');
  perform private.require_user();
  update public.discounts set ended_at = now() where id = p_id and merchant_id = private.my_merchant_id() and ended_at is null;
  if not found then perform private.fail('not_found', 'That discount doesn’t exist or has already ended.'); end if;
end $$;

-- Same as before (20261030120000_boosts.sql), for owners and managers.
create or replace function public.start_boost(p_listing_id uuid, p_package_id text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_shop uuid := private.my_merchant_id();
  s public.app_settings := private.settings();
  l public.listings;
  pk public.boost_packages;
  v_ref text := 'BST-' || upper(replace(gen_random_uuid()::text, '-', ''));
  v_email text;
begin
  perform private.require_shop_permission('shop');
  if v_shop is null then perform private.fail('forbidden', 'Only sellers can boost listings.'); end if;
  if not (s.boosts_forced_on or private.active_buyers() >= s.boost_min_active_buyers) then
    perform private.fail('forbidden', 'Boosts open once DrawMart has enough active buyers.');
  end if;
  select * into l from public.listings where id = p_listing_id and merchant_id = v_shop;
  if not found then perform private.fail('not_found', 'That listing isn’t yours.'); end if;
  if not ((l.kind = 'raffle' and l.status = 'live') or l.status = 'for_sale') then
    perform private.fail('invalid_input', 'Only live draws and items on sale can be boosted.');
  end if;
  select * into pk from public.boost_packages where id = p_package_id and active;
  if not found then perform private.fail('invalid_input', 'Pick a boost package.'); end if;
  if private.running_boosts() >= s.boost_max_active then
    perform private.fail('invalid_input', 'All boost slots are taken right now. Try again in a day or two.');
  end if;
  if (select count(*) from public.boosts where merchant_id = v_shop and status = 'pending' and created_at > now() - interval '1 hour') >= 5 then
    perform private.fail('invalid_input', 'Too many unfinished boost payments. Try again in a little while.');
  end if;
  select email into v_email from auth.users where id = v_uid;
  if coalesce(v_email, '') = '' then perform private.fail('invalid_input', 'Your account needs an email address to pay.'); end if;

  insert into public.boosts (listing_id, merchant_id, user_id, package_id, days, price_kobo, tx_ref)
  values (l.id, v_shop, v_uid, pk.id, pk.days, pk.price_kobo, v_ref);
  return jsonb_build_object('txRef', v_ref, 'amountKobo', pk.price_kobo, 'email', v_email,
                            'name', (select name from public.merchants where id = v_shop));
end $$;

-- Same as before (20261030120000_boosts.sql), for owners and managers.
create or replace function public.cancel_boost(p_tx_ref text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_shop_permission('shop');
  update public.boosts set status = 'cancelled'
   where tx_ref = p_tx_ref and status = 'pending' and merchant_id = private.my_merchant_id();
end $$;

-- Same as before (20261030120000_boosts.sql), for owners and managers.
create or replace function public.test_pay_boost(p_tx_ref text) returns void
language plpgsql security definer set search_path = ''
as $$
declare b public.boosts;
begin
  perform private.require_shop_permission('shop');
  if not (private.settings()).test_mode then perform private.fail('forbidden', 'Boosts are paid through Flutterwave.'); end if;
  select * into b from public.boosts where tx_ref = p_tx_ref and merchant_id = private.my_merchant_id() and status in ('pending', 'cancelled') for update;
  if not found then perform private.fail('not_found', 'No such boost.'); end if;
  perform private.activate_boost(b.id, 'TEST');
end $$;

-- Same as before (20261030140000_boost_insights.sql), for owners and managers.
create or replace function public.boost_insights(p_boost_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  b public.boosts;
  v_from date;
  v_to date;
  v_days int;
begin
  perform private.require_shop_permission('shop');
  select * into b from public.boosts where id = p_boost_id and (merchant_id = private.my_merchant_id() or private.is_admin());
  if not found then perform private.fail('not_found', 'That boost doesn’t exist.'); end if;
  if b.status <> 'paid' then perform private.fail('invalid_input', 'Results show once the boost has started.'); end if;

  v_from := (b.starts_at at time zone 'Africa/Lagos')::date;
  v_to := (least(b.ends_at, now()) at time zone 'Africa/Lagos')::date;
  v_days := greatest(1, v_to - v_from + 1);

  return jsonb_build_object(
    'window', jsonb_build_object('from', v_from, 'to', v_to, 'days', v_days, 'beforeFrom', v_from - v_days, 'beforeTo', v_from - 1),
    'during', private.listing_stats(b.listing_id, v_from, v_to),
    'before', private.listing_stats(b.listing_id, v_from - v_days, v_from - 1),
    'daily', (
      select jsonb_agg(jsonb_build_object(
               'date', d::date,
               'views', (private.listing_stats(b.listing_id, d::date, d::date) ->> 'views')::int,
               'salesKobo', (private.listing_stats(b.listing_id, d::date, d::date) ->> 'salesKobo')::bigint)
             order by d)
        from generate_series(v_from - v_days, v_to, interval '1 day') d));
end $$;

-- Same as before (20261101490000_shop_profiles.sql), for owners and managers.
create or replace function public.update_shop_profile(p jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.merchants;
  v_errors text[] := '{}';
  v_about text := nullif(btrim(coalesce(p ->> 'about', '')), '');
  v_hours text := nullif(btrim(coalesce(p ->> 'openingHours', '')), '');
  v_note text := nullif(btrim(coalesce(p ->> 'shopNote', '')), '');
  v_phone text := nullif(btrim(coalesce(p ->> 'publicPhone', '')), '');
  v_logo text := nullif(p ->> 'logoUrl', '');
  v_cover text := nullif(p ->> 'coverUrl', '');
  v_show_cac boolean := coalesce((p ->> 'showCac')::boolean, false);
begin
  perform private.require_shop_permission('shop');
  perform private.require_user();
  select * into m from public.merchants where id = private.my_merchant_id() for update;
  if not found then perform private.fail('forbidden', 'This account isn’t linked to a shop.'); end if;
  if length(coalesce(v_about, '')) > 300 then v_errors := array_append(v_errors, 'Keep the description to 300 characters.'); end if;
  if length(coalesce(v_hours, '')) > 80 then v_errors := array_append(v_errors, 'Keep opening hours to 80 characters.'); end if;
  if length(coalesce(v_note, '')) > 300 then v_errors := array_append(v_errors, 'Keep your note to buyers to 300 characters.'); end if;
  if v_phone is not null and regexp_replace(v_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567, or leave it blank.');
  end if;
  if coalesce(v_logo, 'https://') !~ '^(https://|/assets/)' or coalesce(v_cover, 'https://') !~ '^(https://|/assets/)' then
    v_errors := array_append(v_errors, 'Upload the logo and cover again.');
  end if;
  if v_show_cac and m.kind = 'individual' then v_errors := array_append(v_errors, 'Only registered stores have a CAC number to show.'); end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  update public.merchants
     set about = v_about, opening_hours = v_hours, shop_note = v_note, public_phone = v_phone, logo_url = v_logo, cover_url = v_cover, show_cac = v_show_cac
   where id = m.id;
end $$;

-- Same as before (20261101460000_shop_pickups.sql), for owners and managers.
create or replace function public.save_shop_pickup(p_address text, p_lat double precision, p_lng double precision, p_phone text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_merchant uuid := private.my_merchant_id();
  v_address text := btrim(coalesce(p_address, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_pin text := private.location_error(p_lat, p_lng);
  v_errors text[] := '{}';
begin
  perform private.require_shop_permission('shop');
  perform private.require_user();
  if v_merchant is null then perform private.fail('forbidden', 'This account isn’t linked to a shop.'); end if;
  if length(v_address) < 10 then v_errors := array_append(v_errors, 'Enter the full address, with street and area.'); end if;
  if v_pin is not null then v_errors := array_append(v_errors, v_pin); end if;
  if regexp_replace(v_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  insert into public.shop_pickups (merchant_id, address, lat, lng, contact_phone) values (v_merchant, v_address, p_lat, p_lng, v_phone)
  on conflict (merchant_id) do update set address = excluded.address, lat = excluded.lat, lng = excluded.lng, contact_phone = excluded.contact_phone, updated_at = now();
  -- deliveryFees.ts nearestArea.
  update public.merchants set delivery_area = (
    select a.id from public.delivery_areas a
     order by power(a.lat - p_lat, 2) + power((a.lng - p_lng) * cos(radians(6.5)), 2), a.sort limit 1
  ) where id = v_merchant;
end $$;

-- Same as before (20261101410000_delivery_fees.sql), for owners and managers.
create or replace function public.set_shop_delivery_area(p_area text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_merchant uuid := private.my_merchant_id();
begin
  perform private.require_shop_permission('shop');
  perform private.require_user();
  if v_merchant is null then perform private.fail('forbidden', 'This account isn’t linked to a shop.'); end if;
  if not exists (select 1 from public.delivery_areas where id = p_area) then perform private.fail('invalid_input', 'Pick an area.'); end if;
  update public.merchants set delivery_area = p_area where id = v_merchant;
end $$;

-- Same as before (20261101500000_reviews.sql), for owners and managers.
create or replace function public.reply_to_review(p_review_id uuid, p_reply text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.reviews;
  v_reply text := btrim(coalesce(p_reply, ''));
begin
  perform private.require_shop_permission('shop');
  perform private.require_user();
  select * into r from public.reviews where id = p_review_id and merchant_id = private.my_merchant_id() for update;
  if not found then perform private.fail('not_found', 'That review doesn’t exist.'); end if;
  if r.reply is not null then perform private.fail('invalid_input', 'You’ve already replied to this review.'); end if;
  if r.hidden_at is not null then perform private.fail('invalid_input', 'DrawMart has hidden this review.'); end if;
  if v_reply = '' then perform private.fail('invalid_input', 'Write a reply.'); end if;
  if length(v_reply) > 500 then perform private.fail('invalid_input', 'Keep it to 500 characters.'); end if;
  update public.reviews set reply = v_reply, replied_at = now() where id = r.id;
  insert into public.notifications (user_id, kind, listing_id) values (r.user_id, 'review_reply', r.listing_id);
end $$;

-- Same as before (20261101470000_claims_and_returns.sql), for owners and managers.
create or replace function public.contest_failure(p_order_id uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.require_shop_permission('shop');
  perform private.require_user();
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.merchant_id is distinct from private.my_merchant_id() then perform private.fail('not_found', 'That order doesn’t exist.'); end if;
  if o.cancel_reason is null or o.cancel_reason not in ('failed_check', 'refused_wrong', 'refused_damaged') or o.cancelled_at <= now() - interval '7 days' then
    perform private.fail('invalid_input', 'You can contest a failed check or a refusal for 7 days.');
  end if;
  if exists (select 1 from public.order_claims where order_id = o.id) then perform private.fail('invalid_input', 'You’ve already contested this.'); end if;
  if length(v_note) < 10 or length(v_note) > 500 then perform private.fail('invalid_input', 'Say what happened, in 10 to 500 characters.'); end if;
  insert into public.order_claims (order_id, kind, status, description) values (o.id, 'contest', 'open', v_note);
end $$;

-- Same as before (20261101400000_cancel_orders.sql), for owners and managers.
create or replace function public.cancel_order(p_order_id uuid, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.require_shop_permission('shop');
  perform private.require_user();
  select * into o from public.orders where id = p_order_id;
  if not found or o.handled_by <> 'store' or o.merchant_id is distinct from private.my_merchant_id() then
    perform private.fail('not_found', 'That order doesn’t exist.');
  end if;
  if p_reason is null or p_reason not in ('out_of_stock', 'damaged', 'cant_send', 'other') then perform private.fail('invalid_input', 'Pick a reason.'); end if;
  if length(v_note) > 300 then perform private.fail('invalid_input', 'Keep the note to 300 characters.'); end if;
  if p_reason = 'other' and length(v_note) < 5 then perform private.fail('invalid_input', 'Say why, so the buyer understands.'); end if;
  perform private.cancel_order_now(p_order_id, p_reason, v_note);
end $$;

-- Same as before (20261101470000_claims_and_returns.sql), for owners and managers.
create or replace function public.merchant_metrics(p_days int) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_merchant uuid := private.my_merchant_id();
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_from date;
begin
  perform private.require_shop_permission('shop');
  if v_merchant is null then perform private.fail('forbidden', 'Only sellers have insights.'); end if;
  if p_days not in (7, 30) then perform private.fail('invalid_input', 'Pick 7 or 30 days.'); end if;
  v_from := v_today - (p_days - 1);

  return jsonb_build_object(
    'listings', coalesce((
      select jsonb_agg(x order by x."views" desc, x."createdAt" desc)
      from (
        select
          l.id as "listingId", l.product_code as "productCode", l.title, l.images[1] as image, l.category, l.kind, l.status, l.created_at as "createdAt",
          (select count(*) from public.listing_views v where v.listing_id = l.id and v.day >= v_from)::int as views,
          (select count(distinct v.visitor) from public.listing_views v where v.listing_id = l.id and v.day >= v_from)::int as visitors,
          (select count(*) from public.conversations c where c.listing_id = l.id and (c.created_at at time zone 'Africa/Lagos')::date >= v_from)::int as chats,
          -- A raffle that ended unsold can still sell at a fixed price, so add both.
          coalesce(t.units, 0) + o.units as units,
          coalesce(t.buyers, 0) + o.buyers as buyers,
          coalesce(t.sales, 0) + o.sales as "salesKobo"
        from public.listings l
        left join lateral (
          select count(*)::int as units,
                 count(distinct coalesce(tk.user_id::text, tk.purchase_ref))::int as buyers,
                 (count(*) * l.buyer_ticket_price_kobo)::bigint as sales
            from public.tickets tk
           where tk.listing_id = l.id and l.kind = 'raffle' and l.status in ('live', 'sold_out', 'drawn')
             and (tk.purchased_at at time zone 'Africa/Lagos')::date >= v_from
        ) t on l.kind = 'raffle'
        left join lateral (
          select coalesce(sum(od.quantity), 0)::int as units, count(distinct od.user_id)::int as buyers, coalesce(sum(od.price_kobo), 0)::bigint as sales
            from public.orders od
           where od.listing_id = l.id and not od.is_prize and od.status <> 'cancelled' and od.refunded_at is null and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
        ) o on true
        where l.merchant_id = v_merchant and l.status not in ('rejected', 'withdrawn')
      ) x
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'views', d.views, 'salesKobo', d.sales) order by d.day)
      from (
        select day, sum(views)::int as views, sum(sales)::bigint as sales
        from (
          select v.day, count(*) as views, 0::bigint as sales
            from public.listing_views v join public.listings l on l.id = v.listing_id
           where l.merchant_id = v_merchant and v.day >= v_from
           group by v.day
          union all
          select (tk.purchased_at at time zone 'Africa/Lagos')::date, 0, sum(l.buyer_ticket_price_kobo)
            from public.tickets tk join public.listings l on l.id = tk.listing_id
           where l.merchant_id = v_merchant and l.kind = 'raffle' and l.status in ('live', 'sold_out', 'drawn')
             and (tk.purchased_at at time zone 'Africa/Lagos')::date >= v_from
           group by 1
          union all
          select (od.created_at at time zone 'Africa/Lagos')::date, 0, sum(od.price_kobo)
            from public.orders od
           where od.merchant_id = v_merchant and od.status <> 'cancelled' and od.refunded_at is null and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
           group by 1
        ) u
        group by day
      ) d
    ), '[]'::jsonb)
  );
end $$;

-- Same as before (20261029220000_messages.sql), for owners and managers.
create or replace function public.set_call_phone(p_phone text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_merchant uuid := private.my_merchant_id();
begin
  perform private.require_shop_permission('shop');
  if v_merchant is null then perform private.fail('forbidden', 'Only sellers can share a call number.'); end if;
  if p_phone is null or btrim(p_phone) = '' then
    delete from public.merchant_contacts where merchant_id = v_merchant;
    return;
  end if;
  if regexp_replace(p_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    perform private.fail('invalid_input', 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  insert into public.merchant_contacts (merchant_id, call_phone) values (v_merchant, btrim(p_phone))
  on conflict (merchant_id) do update set call_phone = excluded.call_phone;
end $$;

-- Same as before: only an owner can change the bank account.
create or replace function public.save_payout_account(p_user uuid, p_bank_code text, p_bank_name text, p_account_number text, p_account_name text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_merchant uuid;
  a public.payout_accounts;
begin
  if exists (select 1 from public.store_members where user_id = p_user and role <> 'owner') then perform private.fail('forbidden', 'Only the store’s owner can change the bank account.'); end if;
  select coalesce(merchant_id, seller_id) into v_merchant from public.profiles where id = p_user;
  if v_merchant is null then perform private.fail('forbidden', 'Only sellers can add a bank account.'); end if;
  if coalesce(p_account_number, '') !~ '^[0-9]{10}$' then perform private.fail('invalid_input', 'Enter the 10-digit account number.'); end if;
  if btrim(coalesce(p_account_name, '')) = '' or btrim(coalesce(p_bank_name, '')) = '' then perform private.fail('invalid_input', 'That account couldn’t be confirmed.'); end if;

  select * into a from public.payout_accounts where merchant_id = v_merchant for update;
  if not found then
    insert into public.payout_accounts (merchant_id, bank_code, bank_name, account_number, account_name)
    values (v_merchant, p_bank_code, p_bank_name, p_account_number, btrim(p_account_name));
    return;
  end if;
  -- The same account again changes nothing.
  if a.bank_code = p_bank_code and a.account_number = p_account_number then return; end if;

  insert into private.payout_account_history (merchant_id, bank_code, bank_name, account_number, account_name, confirmed_at, replaced_by)
  values (a.merchant_id, a.bank_code, a.bank_name, a.account_number, a.account_name, a.confirmed_at, p_user);
  update public.payout_accounts
     set bank_code = p_bank_code, bank_name = p_bank_name, account_number = p_account_number, account_name = btrim(p_account_name),
         confirmed_at = now(), payable_from = now() + interval '48 hours'
   where merchant_id = v_merchant;
  perform private.notify_shop(v_merchant, 'store_bank_changed', null);
end $$;

create or replace function public.note_bank_lookup(p_user uuid) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.store_members where user_id = p_user and role <> 'owner') then return 'not_owner'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and coalesce(p.merchant_id, p.seller_id) is not null) then return 'not_seller'; end if;
  if (select count(*) from private.bank_lookups where user_id = p_user and at > now() - interval '1 hour') >= 10 then return 'too_many'; end if;
  insert into private.bank_lookups (user_id) values (p_user);
  return 'ok';
end $$;

-- Same as before, wiping invites and the activity log too. Teams stay: they come with the accounts.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.store_activity, public.store_invites, private.owed_checks, private.discount_redemptions, public.discount_listings, public.discounts, public.quick_replies, public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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
