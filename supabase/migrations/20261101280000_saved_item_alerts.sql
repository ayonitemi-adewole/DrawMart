-- Alerts about items a buyer has saved. domain/savedAlerts.ts.
--
-- They can nudge someone to buy, so they're rationed: once per item per kind, three
-- a day per buyer, none about draws once a weekly limit leaves no room for a ticket,
-- and one switch turns them off, both in the app and on a device.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'draw_sold_out', 'draw_won', 'draw_lost',
  'saved_almost_sold', 'saved_closing_soon', 'saved_relisted', 'saved_back_on_sale', 'saved_price_drop'
));

alter table public.push_preferences add column saved_items boolean not null default true;

-- What's already been sent, per saved listing. The notification may point at a new
-- listing (a relist), so this is what stops a second alert about the same saved item.
create table private.saved_alerts_sent (
  user_id uuid not null references public.profiles (id) on delete cascade,
  saved_listing_id uuid not null,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, saved_listing_id, kind)
);
create index saved_alerts_sent_user_idx on private.saved_alerts_sent (user_id, sent_at);
revoke all on private.saved_alerts_sent from public, anon, authenticated;

-- savedAlerts.ts savedAlertAllowed. Sends it, or quietly doesn't.
create function private.alert_saved(p_user uuid, p_saved uuid, p_target uuid, p_kind text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.listings;
  p public.profiles;
begin
  if coalesce((select saved_items from public.push_preferences where user_id = p_user), true) is false then return; end if;
  if exists (select 1 from private.saved_alerts_sent where user_id = p_user and saved_listing_id = p_saved and kind = p_kind) then return; end if;
  if (select count(*) from private.saved_alerts_sent where user_id = p_user
        and (sent_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date) >= 3 then
    return;
  end if;

  select * into t from public.listings where id = p_target;
  select * into p from public.profiles where id = p_user;
  -- Nobody needs telling about their own listing.
  if t.merchant_id = p.seller_id then return; end if;
  if p_kind in ('saved_almost_sold', 'saved_closing_soon', 'saved_relisted')
     and p.weekly_limit_kobo - private.spent_last_week(p_user) < t.buyer_ticket_price_kobo then
    return;
  end if;

  insert into private.saved_alerts_sent (user_id, saved_listing_id, kind) values (p_user, p_saved, p_kind);
  insert into public.notifications (user_id, kind, listing_id) values (p_user, p_kind, p_target);
end $$;

-- Catches its own errors: an alert is never worth failing a ticket sale or an approval over.
create function private.saved_alerts_on_listing() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_was bigint;
  v_now bigint;
begin
  -- savedAlerts.ts isRelistOf, relistAlertKind. A new listing has just become visible.
  if new.status in ('live', 'for_sale') and (tg_op = 'INSERT' or old.status = 'pending_review') then
    for r in
      select s.user_id, s.listing_id
        from public.saved_listings s join public.listings l on l.id = s.listing_id
       where l.merchant_id = new.merchant_id and l.id <> new.id and l.status in ('drawn', 'refunded', 'sold')
         and lower(regexp_replace(btrim(l.title), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(new.title), '\s+', ' ', 'g'))
    loop
      perform private.alert_saved(r.user_id, r.listing_id, new.id, case when new.status = 'for_sale' then 'saved_back_on_sale' else 'saved_relisted' end);
    end loop;
  end if;

  if tg_op = 'UPDATE' then
    -- savedAlerts.ts crossedAlmostSold.
    if new.status = 'live' and new.ticket_count > 0 and new.tickets_sold < new.ticket_count
       and old.tickets_sold * 100 < 90 * new.ticket_count and new.tickets_sold * 100 >= 90 * new.ticket_count then
      for r in select user_id from public.saved_listings where listing_id = new.id loop
        perform private.alert_saved(r.user_id, new.id, new.id, 'saved_almost_sold');
      end loop;
    end if;

    -- Back on sale: a draw that ended unsold, or a sold item returned to sale.
    if new.status = 'for_sale' and old.status in ('live', 'sold', 'refunded', 'drawn') then
      for r in select user_id from public.saved_listings where listing_id = new.id loop
        perform private.alert_saved(r.user_id, new.id, new.id, 'saved_back_on_sale');
      end loop;
    end if;

    -- orders.ts salePriceKobo, savedAlerts.ts priceDropped.
    if new.status = 'for_sale' and old.status = 'for_sale' then
      v_was := case when old.kind = 'product' then old.price_kobo else old.fallback_price_kobo end;
      v_now := case when new.kind = 'product' then new.price_kobo else new.fallback_price_kobo end;
      if v_now < v_was then
        for r in select user_id from public.saved_listings where listing_id = new.id loop
          perform private.alert_saved(r.user_id, new.id, new.id, 'saved_price_drop');
        end loop;
      end if;
    end if;
  end if;
  return null;
exception when others then
  raise warning 'saved_alerts_on_listing: %', sqlerrm;
  return null;
end $$;

create trigger saved_alerts_on_listing after insert or update of status, tickets_sold, price_kobo, fallback_price_kobo on public.listings
  for each row execute function private.saved_alerts_on_listing();

-- savedAlerts.ts isClosingSoon. Someone over today's limit gets another try on the next run.
create function private.closing_soon_alerts() returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    select s.user_id, l.id
      from public.saved_listings s join public.listings l on l.id = s.listing_id
     where l.status = 'live' and l.closes_at > now() and l.closes_at <= now() + interval '24 hours'
       and not exists (select 1 from private.saved_alerts_sent a where a.user_id = s.user_id and a.saved_listing_id = l.id and a.kind = 'saved_closing_soon')
  loop
    perform private.alert_saved(r.user_id, r.id, r.id, 'saved_closing_soon');
  end loop;
exception when others then
  raise warning 'closing_soon_alerts: %', sqlerrm;
end $$;

-- Same as before, plus closing-soon alerts.
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
  perform private.closing_soon_alerts();

  return n;
end $$;

-- Same as before, with saved items added.
create or replace function public.set_push_preference(p_category text, p_enabled boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform private.require_buyer(v_uid);
  insert into public.push_preferences (user_id) values (v_uid) on conflict (user_id) do nothing;
  case p_category
    when 'wins' then update public.push_preferences set wins = p_enabled where user_id = v_uid;
    when 'drawResults' then update public.push_preferences set draw_results = p_enabled where user_id = v_uid;
    when 'orders' then update public.push_preferences set orders = p_enabled where user_id = v_uid;
    when 'messages' then update public.push_preferences set messages = p_enabled where user_id = v_uid;
    when 'savedItems' then update public.push_preferences set saved_items = p_enabled where user_id = v_uid;
    else perform private.fail('invalid_input', 'That isn’t a kind of notification.');
  end case;
end $$;

create or replace function private.queue_push(p_user uuid, p_category text, p_title text, p_body text, p_url text, p_tag text) returns void
language plpgsql security definer set search_path = ''
as $$
declare p public.push_preferences;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = p_user) then return; end if;
  select * into p from public.push_preferences where user_id = p_user;
  if found and not (case p_category when 'wins' then p.wins when 'draw_results' then p.draw_results when 'orders' then p.orders when 'messages' then p.messages when 'saved_items' then p.saved_items end) then
    return;
  end if;
  insert into private.push_outbox (user_id, title, body, url, tag) values (p_user, p_title, p_body, p_url, p_tag);
end $$;

-- Plain facts: no countdowns and no "hurry".
create or replace function private.push_for_notification() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_title text;
begin
  select title into v_title from public.listings where id = new.listing_id;
  case new.kind
    when 'draw_won' then
      perform private.queue_push(new.user_id, 'wins', 'You won a draw', v_title || '. Open DrawMart to arrange it.', '/draws/' || new.listing_id, 'draw-' || new.listing_id);
    when 'draw_lost' then
      perform private.queue_push(new.user_id, 'draw_results', 'Draw result', 'The result for ' || v_title || ' is in.', '/draws/' || new.listing_id, 'draw-' || new.listing_id);
    when 'draw_sold_out' then
      perform private.queue_push(new.user_id, 'draw_results', 'All tickets sold', v_title || ' has sold out. We’ll tell you when the winner is announced.', '/listings/' || new.listing_id, 'draw-' || new.listing_id);
    when 'saved_almost_sold' then
      perform private.queue_push(new.user_id, 'saved_items', 'A draw you saved', '90% of the tickets for ' || v_title || ' have sold.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'saved_closing_soon' then
      perform private.queue_push(new.user_id, 'saved_items', 'A draw you saved', v_title || ' closes within 24 hours.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'saved_relisted' then
      perform private.queue_push(new.user_id, 'saved_items', 'An item you saved', 'The store has listed ' || v_title || ' again as a new draw.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'saved_back_on_sale' then
      perform private.queue_push(new.user_id, 'saved_items', 'An item you saved', v_title || ' is on sale.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    when 'saved_price_drop' then
      perform private.queue_push(new.user_id, 'saved_items', 'An item you saved', v_title || ' now costs less.', '/listings/' || new.listing_id, 'saved-' || new.listing_id);
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

revoke execute on function private.alert_saved(uuid, uuid, uuid, text), private.saved_alerts_on_listing(), private.closing_soon_alerts() from public, anon, authenticated;

-- Same as before, with the sent list emptied too.
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
           public.seller_applications, public.saved_pickups, public.notifications, public.cart_items, public.saved_addresses,
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
