-- Random ticket numbers (draw.ts pickTicketNumbers, decided 3 Nov 2026). A purchase gets
-- numbers picked at random from those still free, instead of the next ones in line, so
-- the first buyer doesn't get ticket 1. The draw itself is unchanged: the winning number
-- still comes from the seed and the closing ref, and every number from 1 to ticket_count
-- is sold exactly once before it runs. Callers hold the listing's row lock, so two
-- purchases can't pick the same number (and tickets has unique (listing_id, number)).

create function private.pick_ticket_numbers(p_listing_id uuid, p_ticket_count int, p_quantity int) returns int[]
language sql volatile set search_path = ''
as $$
  -- gen_random_uuid() is the strong random source; the order it gives is a fair shuffle.
  select coalesce(array_agg(n order by n), '{}'::int[])
  from (
    select g as n
    from generate_series(1, p_ticket_count) g
    where not exists (select 1 from public.tickets t where t.listing_id = p_listing_id and t.number = g)
    order by gen_random_uuid()
    limit p_quantity
  ) picked;
$$;
revoke execute on function private.pick_ticket_numbers(uuid, int, int) from public, anon, authenticated;

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
  v_numbers := private.pick_ticket_numbers(l.id, l.ticket_count, p_quantity);

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

create or replace function public.demo_sell_out(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  v_ref text := private.new_ref();
begin
  perform private.require_demo();
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.status <> 'live' then perform private.fail('not_live'); end if;
  insert into public.tickets (listing_id, user_id, number, purchase_ref)
  select l.id, null, n, v_ref from unnest(private.pick_ticket_numbers(l.id, l.ticket_count, l.ticket_count - l.tickets_sold)) n;
  update public.listings set tickets_sold = ticket_count where id = l.id;
  perform private.close_ticket_sales(l.id, v_ref);
end $$;
