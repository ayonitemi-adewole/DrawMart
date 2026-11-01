-- A seller's time to confirm an order stops overnight: it only counts from 9am to 10pm,
-- Lagos time. Rules mirror src/domain/orderConfirm.ts.

-- orderConfirm.ts addConfirmTime.
create function private.add_confirm_time(p_from timestamptz, p_amount interval) returns timestamptz
language plpgsql stable set search_path = ''
as $$
declare
  v_left interval := p_amount;
  v_local timestamp := p_from at time zone 'Africa/Lagos';
  v_open timestamp;
  v_close timestamp;
begin
  loop
    v_open := v_local::date + time '09:00';
    v_close := v_local::date + time '22:00';
    if v_local < v_open then v_local := v_open; end if;
    if v_local >= v_close then
      v_local := v_local::date + 1 + time '09:00';
      continue;
    end if;
    if v_close - v_local >= v_left then
      return (v_local + v_left) at time zone 'Africa/Lagos';
    end if;
    v_left := v_left - (v_close - v_local);
    v_local := v_local::date + 1 + time '09:00';
  end loop;
end $$;
revoke execute on function private.add_confirm_time(timestamptz, interval) from public, anon, authenticated;

-- Same as before, on the new clock.
create or replace function private.set_confirm_by() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not new.is_prize and new.handled_by = 'store' then new.confirm_by := private.add_confirm_time(now(), interval '12 hours'); end if;
  return new;
end $$;

-- Same as before: "3 hours left" is on the new clock too.
create or replace function private.order_confirm_deadlines() returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    update public.orders set confirm_reminded_at = now()
     where status = 'paid' and confirmed_at is null and confirm_reminded_at is null and confirm_by > now() and confirm_by <= private.add_confirm_time(now(), interval '3 hours')
    returning merchant_id, listing_id
  loop
    perform private.notify_shop(r.merchant_id, 'store_order_confirm_soon', r.listing_id);
  end loop;

  for r in select id, merchant_id, listing_id from public.orders where status = 'paid' and confirmed_at is null and confirm_by <= now() loop
    begin
      perform private.cancel_order_now(r.id, 'not_confirmed', null);
      perform private.notify_shop(r.merchant_id, 'store_order_expired', r.listing_id);
    exception when others then
      raise warning 'order_confirm_deadlines %: %', r.id, sqlerrm;
    end;
  end loop;
end $$;

-- Orders already waiting get the same pause, so no seller loses out from when this arrived.
update public.orders set confirm_by = private.add_confirm_time(created_at, interval '12 hours')
 where status = 'paid' and confirmed_at is null and confirm_by is not null;
