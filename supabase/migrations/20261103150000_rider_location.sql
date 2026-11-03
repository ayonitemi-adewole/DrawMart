-- Live rider location for the buyer (riderLocation.ts, built 3 Nov 2026). A rider who
-- opts in shares their phone's position every 30 seconds while carrying something to a
-- buyer's door (private.delivery_chat_open). Only the latest point is kept, one per
-- rider, never a route, and it's deleted as soon as they're carrying nothing, or stop
-- sharing. The buyer of an order on that leg sees it while it's under 5 minutes old.

alter table public.profiles add column rider_shares_location boolean not null default false;

create table private.rider_positions (
  rider_id uuid primary key references public.profiles (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  updated_at timestamptz not null default now()
);
revoke all on private.rider_positions from public, anon, authenticated;

-- Whether this rider is carrying anything to a buyer's door right now.
create function private.carrying_to_buyer(p_rider uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.orders o where o.rider_id = p_rider and private.delivery_chat_open(o)) $$;

revoke all on function private.carrying_to_buyer(uuid) from public, anon, authenticated;

create function public.my_location_sharing() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select rider_shares_location from public.profiles where id = private.require_delivery()), false) $$;

-- The rider's choice, kept for later trips. Turning it off forgets where they were.
create function public.set_location_sharing(p_on boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  update public.profiles set rider_shares_location = coalesce(p_on, false) where id = v_uid;
  if not coalesce(p_on, false) then delete from private.rider_positions where rider_id = v_uid; end if;
end $$;

-- riderLocation.ts. Only kept while they've opted in and are on the last leg; false tells the phone to stop.
create function public.share_location(p_lat double precision, p_lng double precision) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then perform private.fail('invalid_input', 'That location doesn’t look right.'); end if;
  if not (select rider_shares_location from public.profiles where id = v_uid) or not private.carrying_to_buyer(v_uid) then
    delete from private.rider_positions where rider_id = v_uid;
    return false;
  end if;
  insert into private.rider_positions (rider_id, lat, lng, updated_at) values (v_uid, p_lat, p_lng, now())
  on conflict (rider_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
  return true;
end $$;

-- For the buyer of this order only, on the last leg, while the point is fresh.
create function public.rider_location(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('location', jsonb_build_object('lat', p.lat, 'lng', p.lng), 'updatedAt', p.updated_at)
    from public.orders o
    join private.rider_positions p on p.rider_id = o.rider_id
   where o.id = p_order_id and o.user_id = auth.uid() and private.delivery_chat_open(o)
     and p.updated_at > now() - interval '5 minutes'
$$;

-- Never kept once the leg is over: delivered, handed back, refused, at a counter, or moved to another rider.
create function private.forget_rider_position() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.rider_id is not null and private.delivery_chat_open(old)
     and (new.rider_id is distinct from old.rider_id or not private.delivery_chat_open(new))
     and not private.carrying_to_buyer(old.rider_id) then
    delete from private.rider_positions where rider_id = old.rider_id;
  end if;
  return null;
exception when others then
  raise warning 'forget_rider_position: %', sqlerrm;
  return null;
end $$;
create trigger forget_rider_position after update on public.orders
  for each row execute function private.forget_rider_position();

revoke all on function public.my_location_sharing(), public.set_location_sharing(boolean), public.share_location(double precision, double precision), public.rider_location(uuid) from public, anon;
grant execute on function public.my_location_sharing(), public.set_location_sharing(boolean), public.share_location(double precision, double precision), public.rider_location(uuid) to authenticated;
