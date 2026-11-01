-- Early access: a new draw opens to regular buyers an hour before everyone else.
-- A regular has at least 3 completed orders or draws in the last 90 days. It counts
-- purchases completed, never tickets bought, so it doesn't reward heavy play.
-- domain/rules.ts.
alter table public.listings add column opens_at timestamptz;
alter table public.app_settings add column early_access_minutes int not null default 60 check (early_access_minutes >= 0);

-- Set once, when a draw goes live. Null means open to everyone, which covers every
-- listing from before this and every product.
create function private.set_opens_at() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_minutes int := (private.settings()).early_access_minutes;
begin
  if old.status = 'pending_review' and new.status = 'live' and new.kind = 'raffle' and v_minutes > 0 then
    new.opens_at := now() + make_interval(mins => v_minutes);
  end if;
  return new;
end $$;

create trigger set_opens_at before update of status on public.listings
  for each row execute function private.set_opens_at();

-- rules.ts completedPurchases. Each counts once however many tickets it took. A won
-- prize's order isn't counted on top of its draw.
create function private.completed_purchases(p_user uuid) returns int
language sql stable security definer set search_path = ''
as $$
  select (
    (select count(*) from public.orders o
      where o.user_id = p_user and o.status = 'delivered' and not o.is_prize and o.delivered_at >= now() - interval '90 days')
    +
    (select count(*) from public.draw_results r
      where r.drawn_at >= now() - interval '90 days'
        and exists (select 1 from public.tickets t where t.listing_id = r.listing_id and t.user_id = p_user))
  )::int
$$;

-- The buyer's own standing, and nobody else's.
create function public.my_regular_status() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_count int := private.completed_purchases(private.require_user());
begin
  return jsonb_build_object('completed', v_count, 'isRegular', v_count >= 3);
end $$;

-- Same as before, with the early access check, in the same order as checkPurchase.
create or replace function public.buy_tickets(p_listing_id uuid, p_quantity int) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  s public.app_settings := private.settings();
  p public.profiles;
  l public.listings;
  v_held int;
  v_cost bigint;
  v_cash bigint;
  v_credit bigint;
  v_from_credit bigint;
  v_ref text := private.new_ref();
  v_numbers int[];
  v_draw_at timestamptz;
begin
  perform private.apply_pending_limit(v_uid);
  -- Locking the profile serialises one person's purchases (wallet checks);
  -- locking the listing serialises ticket numbering.
  select * into p from public.profiles where id = v_uid for update;
  if not found then perform private.fail('forbidden', 'Your profile is missing.'); end if;
  select * into l from public.listings where id = p_listing_id for update;
  if not found then perform private.fail('not_found', 'That listing doesn’t exist.'); end if;

  -- Same order as checkPurchase in src/domain/rules.ts.
  if p.state is null or not (p.state = any (s.licensed_states)) then perform private.fail('state_not_licensed'); end if;
  if not p.age_verified then perform private.fail('age_not_verified'); end if;
  if l.status <> 'live' or l.closes_at <= now() then perform private.fail('not_live'); end if;
  if l.opens_at > now() and private.completed_purchases(v_uid) < 3 then perform private.fail('early_access'); end if;
  if p_quantity is null or p_quantity < 1 then perform private.fail('invalid_quantity'); end if;
  if l.ticket_count - l.tickets_sold <= 0 then perform private.fail('sold_out'); end if;
  if p_quantity > l.ticket_count - l.tickets_sold then perform private.fail('not_enough_tickets_left'); end if;
  select count(*) into v_held from public.tickets where listing_id = l.id and user_id = v_uid;
  if v_held + p_quantity > s.max_tickets_per_user then perform private.fail('per_user_limit'); end if;
  v_cost := p_quantity * l.buyer_ticket_price_kobo;
  if private.spent_last_week(v_uid) + v_cost > p.weekly_limit_kobo then perform private.fail('weekly_limit'); end if;
  select coalesce(sum(cash_kobo), 0), coalesce(sum(credit_kobo), 0) into v_cash, v_credit from public.ledger_entries where user_id = v_uid;
  if v_cash + v_credit < v_cost then perform private.fail('insufficient_funds'); end if;

  -- Store credit is spent before cash.
  v_from_credit := least(greatest(v_credit, 0), v_cost);
  v_numbers := array(select l.tickets_sold + g from generate_series(1, p_quantity) g);

  insert into public.tickets (listing_id, user_id, number, purchase_ref)
  select l.id, v_uid, n, v_ref from unnest(v_numbers) n;
  update public.listings set tickets_sold = tickets_sold + p_quantity where id = l.id;
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  values (v_uid, 'ticket_purchase', -(v_cost - v_from_credit), -v_from_credit,
          p_quantity || case when p_quantity = 1 then ' ticket · ' else ' tickets · ' end || l.title, l.id);

  if l.tickets_sold + p_quantity = l.ticket_count then
    v_draw_at := private.close_ticket_sales(l.id, v_ref);
  end if;

  return jsonb_build_object('purchaseId', v_ref, 'numbers', to_jsonb(v_numbers), 'costKobo', v_cost, 'soldOut', v_draw_at is not null, 'drawAt', v_draw_at);
end $$;

-- Test mode: so testers don't have to wait an hour after approving a draw.
create function public.demo_open_now(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_demo();
  update public.listings set opens_at = null where id = p_listing_id;
end $$;

revoke execute on function private.set_opens_at(), private.completed_purchases(uuid), public.my_regular_status(), public.demo_open_now(uuid) from public, anon, authenticated;
grant execute on function public.my_regular_status(), public.demo_open_now(uuid) to authenticated;
