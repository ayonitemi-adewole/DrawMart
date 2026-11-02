-- Where a rider collects from a seller. As private as any other address: only the seller,
-- admins and the rider on the way there see it. Saving it also sets the shop's delivery
-- area, so buyers' fees follow the seller's real location. Rules in src/domain/shopPickup.ts.

create table public.shop_pickups (
  merchant_id uuid primary key references public.merchants (id) on delete cascade,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  contact_phone text not null,
  updated_at timestamptz not null default now()
);
alter table public.shop_pickups enable row level security;
create policy "own pickup details, or admins" on public.shop_pickups for select to authenticated
  using (merchant_id = (select private.my_merchant_id()) or (select private.is_admin()));
revoke all on public.shop_pickups from anon, authenticated;
grant select on public.shop_pickups to authenticated;

create function public.save_shop_pickup(p_address text, p_lat double precision, p_lng double precision, p_phone text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_merchant uuid := private.my_merchant_id();
  v_address text := btrim(coalesce(p_address, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_pin text := private.location_error(p_lat, p_lng);
  v_errors text[] := '{}';
begin
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
revoke all on function public.save_shop_pickup(text, double precision, double precision, text) from public, anon;
grant execute on function public.save_shop_pickup(text, double precision, double precision, text) to authenticated;

-- Same as before: the rider gets the address and number, only while they need them.
create or replace function public.delivery_jobs() returns jsonb
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

-- Same as before: not until a rider could find the seller.
create or replace function public.dispatch_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.orders
     where id = p_order_id and status = 'paid' and handled_by = 'store' and merchant_id = private.my_merchant_id()
       and confirm_by is not null and confirmed_at is null
  ) then
    perform private.fail('invalid_input', 'Confirm it with a photo first.');
  end if;
  -- A rider has to be able to find them.
  if exists (
    select 1 from public.orders o
     where o.id = p_order_id and o.status = 'paid' and o.handled_by = 'store' and o.merchant_id = private.my_merchant_id()
       and not exists (select 1 from public.shop_pickups sp where sp.merchant_id = o.merchant_id)
  ) then
    perform private.fail('invalid_input', 'Add where riders collect from first.');
  end if;
  update public.orders set status = 'dispatched', dispatched_at = now()
   where id = p_order_id and status = 'paid'
     and case handled_by when 'store' then merchant_id = private.my_merchant_id() else private.is_admin() end;
  if not found then perform private.fail('invalid_input', 'Only paid orders you send yourself can be marked as sent.'); end if;
end $$;
