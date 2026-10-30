-- The winner is no longer announced when the last ticket sells (src/domain/draw.ts).
-- Selling out closes sales and tells everyone who took part. The draw then runs
-- on the listing's deadline, or 7 days after the last ticket if that's sooner.
--
-- Still provably fair: the commitment was published before sales, and the
-- closing reference is fixed at sell-out but kept here until the seed is
-- revealed with the result, so the outcome can't change during the wait.

alter table public.listings
  add column sold_out_at timestamptz,
  add column draw_at timestamptz,
  drop constraint listings_status_check,
  add constraint listings_status_check
    check (status in ('pending_review', 'live', 'sold_out', 'drawn', 'refunded', 'for_sale', 'sold', 'rejected'));

alter table private.listing_seeds add column closing_ref text;

drop policy "read public, own-store or all (admin) listings" on public.listings;
create policy "read public, own-store or all (admin) listings" on public.listings for select
  using (
    status in ('live', 'sold_out', 'drawn', 'refunded', 'for_sale', 'sold')
    or merchant_id = (select private.my_merchant_id())
    or (select private.is_admin())
  );

-- In-app notifications. Wording lives in the app, so only the facts are stored.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('draw_sold_out', 'draw_won', 'draw_lost')),
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
create policy "own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

create function public.mark_notifications_read() returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  update public.notifications set read_at = now() where user_id = v_uid and read_at is null;
end $$;

-- The last ticket has sold. draw.ts announcementDate. Returns when the draw runs.
create function private.close_ticket_sales(p_listing_id uuid, p_ref text) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare v_draw_at timestamptz;
begin
  update public.listings
     set status = 'sold_out', sold_out_at = now(), draw_at = least(closes_at, now() + interval '7 days')
   where id = p_listing_id
  returning draw_at into v_draw_at;
  update private.listing_seeds set closing_ref = p_ref where listing_id = p_listing_id;
  insert into public.notifications (user_id, kind, listing_id)
  select distinct t.user_id, 'draw_sold_out', p_listing_id
    from public.tickets t
   where t.listing_id = p_listing_id and t.user_id is not null;
  return v_draw_at;
end $$;

create function private.run_due_draws() returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    select l.id, s.closing_ref
      from public.listings l join private.listing_seeds s on s.listing_id = l.id
     where l.status = 'sold_out' and l.draw_at <= now()
     for update of l skip locked
  loop
    perform private.run_draw(r.id, r.closing_ref);
  end loop;
end $$;

create or replace function private.run_draw(p_listing_id uuid, p_ref text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  s public.app_settings := private.settings();
  v_seed text;
  v_number int;
  v_winner uuid;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if l.tickets_sold <> l.ticket_count then raise exception 'run_draw: listing % is not sold out', p_listing_id; end if;
  select seed into v_seed from private.listing_seeds where listing_id = p_listing_id;

  v_number := private.winning_number(v_seed, p_ref, l.ticket_count);
  select user_id into v_winner from public.tickets where listing_id = p_listing_id and number = v_number;

  update public.listings
     set status = 'drawn',
         caution_fee_status = case when caution_fee_status = 'held' then 'refunded' else caution_fee_status end
   where id = p_listing_id;

  insert into public.draw_results (listing_id, commitment, seed, closing_ref, winning_number, winner_user_id)
  values (p_listing_id, l.commitment, v_seed, p_ref, v_number, v_winner);

  -- Consolation store credit for every losing buyer (rules.ts consolationCredit).
  insert into public.ledger_entries (user_id, kind, credit_kobo, memo, listing_id)
  select t.user_id, 'store_credit',
         round(count(*) * l.buyer_ticket_price_kobo * s.consolation_credit_bps / 10000.0)::bigint,
         'Store credit · ' || l.title, p_listing_id
    from public.tickets t
   where t.listing_id = p_listing_id and t.user_id is not null and t.user_id is distinct from v_winner
   group by t.user_id
  having round(count(*) * l.buyer_ticket_price_kobo * s.consolation_credit_bps / 10000.0) > 0;

  -- Tell everyone who took part how it went.
  insert into public.notifications (user_id, kind, listing_id)
  select distinct t.user_id, case when t.user_id = v_winner then 'draw_won' else 'draw_lost' end, l.id
    from public.tickets t
   where t.listing_id = l.id and t.user_id is not null;
end $$;

create or replace function private.process_deadlines() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  s public.app_settings := private.settings();
  n int := 0;
begin
  for l in
    select * from public.listings where status = 'live' and closes_at <= now() for update skip locked
  loop
    n := n + 1;
    if l.unsold_policy = 'extend_once' and not l.extended then
      update public.listings set extended = true, closes_at = now() + make_interval(days => s.extension_days) where id = l.id;
      continue;
    end if;
    perform private.refund_buyers(l.id);
    update public.listings
       set status = case when l.unsold_policy = 'convert_to_sale' and l.fallback_price_kobo is not null then 'for_sale' else 'refunded' end,
           caution_fee_status = case when caution_fee_status = 'held' then 'kept' else caution_fee_status end
     where id = l.id;
  end loop;

  -- Also apply any raised weekly limits that are now due.
  with due as (delete from public.pending_limits where effective_at <= now() returning user_id, amount_kobo)
  update public.profiles p set weekly_limit_kobo = due.amount_kobo from due where p.id = due.user_id;

  perform private.run_due_draws();

  return n;
end $$;

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
  select l.id, null, n, v_ref from generate_series(l.tickets_sold + 1, l.ticket_count) n;
  update public.listings set tickets_sold = ticket_count where id = l.id;
  perform private.close_ticket_sales(l.id, v_ref);
end $$;

-- Demo control: announce a sold-out draw's winner now instead of waiting.
create function public.demo_run_draw(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_demo();
  update public.listings set draw_at = now() where id = p_listing_id and status = 'sold_out';
  if not found then perform private.fail('invalid_input', 'Only sold-out draws can be announced.'); end if;
  perform private.run_due_draws();
end $$;

create or replace function public.record_listing_view(p_listing_id uuid, p_visitor text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  v_visitor text;
begin
  select * into l from public.listings where id = p_listing_id;
  if not found or l.status not in ('live', 'sold_out', 'drawn', 'refunded', 'for_sale', 'sold') then return; end if;
  if l.merchant_id = private.my_merchant_id() then return; end if; -- the seller looking at their own item
  if auth.uid() is not null then
    v_visitor := 'u:' || auth.uid()::text;
  elsif p_visitor ~ '^[A-Za-z0-9-]{8,64}$' then
    v_visitor := 'v:' || p_visitor;
  else
    return;
  end if;
  insert into public.listing_views (listing_id, visitor) values (l.id, v_visitor) on conflict do nothing;
end $$;

create or replace function public.merchant_metrics(p_days int) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_merchant uuid := private.my_merchant_id();
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_from date;
begin
  if v_merchant is null then perform private.fail('forbidden', 'Only sellers have insights.'); end if;
  if p_days not in (7, 30) then perform private.fail('invalid_input', 'Pick 7 or 30 days.'); end if;
  v_from := v_today - (p_days - 1);

  return jsonb_build_object(
    'listings', coalesce((
      select jsonb_agg(x order by x."views" desc, x."createdAt" desc)
      from (
        select
          l.id as "listingId", l.title, l.images[1] as image, l.category, l.kind, l.status, l.created_at as "createdAt",
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
          select count(*)::int as units, count(distinct od.user_id)::int as buyers, coalesce(sum(od.price_kobo), 0)::bigint as sales
            from public.orders od
           where od.listing_id = l.id and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
        ) o on true
        where l.merchant_id = v_merchant and l.status <> 'rejected'
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
           where od.merchant_id = v_merchant and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
           group by 1
        ) u
        group by day
      ) d
    ), '[]'::jsonb)
  );
end $$;

create or replace function private.listing_stats(p_listing_id uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'views', (select count(*) from public.listing_views v where v.listing_id = l.id and v.day between p_from and p_to),
    'visitors', (select count(distinct v.visitor) from public.listing_views v where v.listing_id = l.id and v.day between p_from and p_to),
    'chats', (select count(*) from public.conversations c where c.listing_id = l.id and (c.created_at at time zone 'Africa/Lagos')::date between p_from and p_to),
    'units', coalesce(t.units, 0) + o.units,
    'buyers', coalesce(t.buyers, 0) + o.buyers,
    'salesKobo', coalesce(t.sales, 0) + o.sales)
  from public.listings l
  left join lateral (
    select count(*)::int as units, count(distinct coalesce(tk.user_id::text, tk.purchase_ref))::int as buyers, (count(*) * l.buyer_ticket_price_kobo)::bigint as sales
      from public.tickets tk
     where tk.listing_id = l.id and l.status in ('live', 'sold_out', 'drawn')
       and (tk.purchased_at at time zone 'Africa/Lagos')::date between p_from and p_to
  ) t on l.kind = 'raffle'
  left join lateral (
    select count(*)::int as units, count(distinct od.user_id)::int as buyers, coalesce(sum(od.price_kobo), 0)::bigint as sales
      from public.orders od
     where od.listing_id = l.id and (od.created_at at time zone 'Africa/Lagos')::date between p_from and p_to
  ) o on true
  where l.id = p_listing_id
$$;

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
           public.seller_applications, public.saved_pickups, public.notifications;

  -- Individual sellers go back to being plain buyers; their shops go.
  update public.profiles set seller_id = null where seller_id is not null;
  delete from public.merchants where kind = 'individual';

  -- Back to how a new account starts.
  update public.profiles set state = 'Lagos', age_verified = true, weekly_limit_kobo = s.default_weekly_limit_kobo where role = 'buyer';
  update public.app_settings set boosts_forced_on = false, boost_min_active_buyers = 1000, boost_max_active = 12 where id;

  -- The starting balance for every buyer. Test accounts created below get theirs from the sign-up trigger.
  insert into public.ledger_entries (user_id, kind, cash_kobo, memo)
  select id, 'topup', s.welcome_credit_kobo, 'Welcome top-up (test money)' from public.profiles where role = 'buyer' and s.welcome_credit_kobo > 0;

  perform private.seed_demo_data();
  perform private.seed_test_accounts();
end $$;

revoke execute on function
  public.mark_notifications_read(), public.demo_run_draw(uuid),
  private.close_ticket_sales(uuid, text), private.run_due_draws()
from public, anon, authenticated;
grant execute on function public.mark_notifications_read(), public.demo_run_draw(uuid) to authenticated;
