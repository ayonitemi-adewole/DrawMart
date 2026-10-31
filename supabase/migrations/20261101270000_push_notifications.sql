-- Phone notifications. Triggers add what's worth telling someone to a private queue;
-- a job calls the send-push Edge Function every minute to send it. Queuing is
-- separate from sending, so a push service being down can never affect a purchase
-- or a draw. See docs/supabase-setup.md for the keys it needs. domain/push.ts.

-- Which devices to send to. No client reads this: it needs nothing back, and these
-- addresses and keys are what a message to that device is sent with.
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- What a buyer wants to hear about. No row means everything on.
create table public.push_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  wins boolean not null default true,
  draw_results boolean not null default true,
  orders boolean not null default true,
  messages boolean not null default true
);
alter table public.push_preferences enable row level security;
create policy "own push preferences" on public.push_preferences for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_preferences from anon, authenticated;
grant select on public.push_preferences to authenticated;

create table private.push_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  url text not null,
  tag text not null,
  attempts int not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index push_outbox_pending_idx on private.push_outbox (created_at) where sent_at is null;
revoke all on private.push_outbox from public, anon, authenticated;

-- push.ts pushSubscriptionValid. The sender posts to whatever address is stored, so
-- only the browsers' own push services are allowed.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform private.require_buyer(v_uid);
  if length(coalesce(p_endpoint, '')) > 1000
     or coalesce(p_endpoint, '') !~ '^https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]*\.?push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[!-~]+$'
     or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{80,100}$'
     or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{16,44}$' then
    perform private.fail('invalid_input', 'This device’s notification details don’t look right.');
  end if;
  -- A shared phone: the device now belongs to whoever just turned this on.
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, v_uid, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

-- Only your own: someone else's device address gets them nothing.
create function public.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = v_uid;
end $$;

create function public.set_push_preference(p_category text, p_enabled boolean) returns void
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
    else perform private.fail('invalid_input', 'That isn’t a kind of notification.');
  end case;
end $$;

-- Queues nothing for someone with no device, or who's turned this kind off.
create function private.queue_push(p_user uuid, p_category text, p_title text, p_body text, p_url text, p_tag text) returns void
language plpgsql security definer set search_path = ''
as $$
declare p public.push_preferences;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = p_user) then return; end if;
  select * into p from public.push_preferences where user_id = p_user;
  if found and not (case p_category when 'wins' then p.wins when 'draw_results' then p.draw_results when 'orders' then p.orders when 'messages' then p.messages end) then
    return;
  end if;
  insert into private.push_outbox (user_id, title, body, url, tag) values (p_user, p_title, p_body, p_url, p_tag);
end $$;

-- These all catch their own errors. A notification is never worth failing a draw,
-- an order or a message over.
create function private.push_for_notification() returns trigger
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
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

create trigger push_on_notification after insert on public.notifications
  for each row execute function private.push_for_notification();

-- Never the delivery PIN: it only ever goes to the buyer in the app, and this shows on a lock screen.
create function private.push_for_order() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_title text;
begin
  select title into v_title from public.listings where id = new.listing_id;
  if new.status = 'dispatched' then
    perform private.queue_push(new.user_id, 'orders', 'Your order is on its way',
      v_title || case when new.fulfilment = 'pickup' then ' is being sent to the pickup location.' else ' is being sent. Have your delivery PIN ready.' end,
      '/tickets?view=orders', 'order-' || new.id);
  elsif new.status = 'delivered' then
    perform private.queue_push(new.user_id, 'orders', 'Order delivered', v_title || ' has been delivered.', '/tickets?view=orders', 'order-' || new.id);
  end if;
  return null;
exception when others then
  raise warning 'push_for_order: %', sqlerrm;
  return null;
end $$;

create trigger push_on_order after update of status on public.orders
  for each row when (old.status is distinct from new.status) execute function private.push_for_order();

-- Says who it's about, never what it says: this shows on a lock screen.
create function private.push_for_message() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  c public.conversations;
  v_title text;
  v_to uuid;
begin
  select * into c from public.conversations where id = new.conversation_id;
  select title into v_title from public.listings where id = c.listing_id;
  if new.sender = 'seller' then
    perform private.queue_push(c.buyer_id, 'messages', 'New message', 'About ' || v_title, '/messages/' || c.id, 'chat-' || c.id);
  else
    -- Individual sellers use the buyer app. Stores have their own, which doesn't do this yet.
    for v_to in select id from public.profiles where seller_id = c.merchant_id loop
      perform private.queue_push(v_to, 'messages', 'New message', 'About ' || v_title, '/messages/' || c.id, 'chat-' || c.id);
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'push_for_message: %', sqlerrm;
  return null;
end $$;

create trigger push_on_message after insert on public.messages
  for each row execute function private.push_for_message();

-- The sender's side. Service role only.
create function public.claim_push_batch(p_limit int) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_rows jsonb;
begin
  -- Sent ones aren't needed for long, and news from over a day ago isn't news.
  delete from private.push_outbox where (sent_at is not null and sent_at < now() - interval '7 days') or (sent_at is null and created_at < now() - interval '1 day');
  with due as (
    select o.id from private.push_outbox o
     where o.sent_at is null and o.attempts < 3 and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes')
     order by o.created_at
     limit p_limit
     for update skip locked
  ), claimed as (
    update private.push_outbox o set attempts = o.attempts + 1, claimed_at = now()
      from due where o.id = due.id
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'title', c.title, 'body', c.body, 'url', c.url, 'tag', c.tag,
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from public.push_subscriptions s where s.user_id = c.user_id), '[]'::jsonb)
  )), '[]'::jsonb) into v_rows from claimed c;
  return v_rows;
end $$;

-- Dropped subscriptions go now, so nothing's ever sent to them again.
create function public.finish_push(p_id uuid, p_done boolean, p_dead_endpoints text[]) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.push_subscriptions where endpoint = any (p_dead_endpoints);
  if p_done then update private.push_outbox set sent_at = now() where id = p_id; end if;
end $$;

-- What the minute job runs. Quiet until the Vault secrets exist, and when there's nothing to send.
create function private.send_pending_push() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from private.push_outbox where sent_at is null and attempts < 3) then return; end if;
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then return; end if;
  execute $sql$ select (select decrypted_secret from vault.decrypted_secrets where name = 'drawmart_push_url'),
                       (select decrypted_secret from vault.decrypted_secrets where name = 'drawmart_push_secret') $sql$ into v_url, v_secret;
  if v_url is null or v_secret is null then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := ''{}''::jsonb, timeout_milliseconds := 30000)'
    using v_url, jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret);
end $$;

revoke execute on function
  public.save_push_subscription(text, text, text), public.delete_push_subscription(text), public.set_push_preference(text, boolean),
  private.queue_push(uuid, text, text, text, text, text), private.push_for_notification(), private.push_for_order(), private.push_for_message(),
  public.claim_push_batch(int), public.finish_push(uuid, boolean, text[]), private.send_pending_push()
from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text), public.set_push_preference(text, boolean) to authenticated;
grant execute on function public.claim_push_batch(int), public.finish_push(uuid, boolean, text[]) to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') and exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_net;
      perform cron.schedule('drawmart-send-push', '* * * * *', 'select private.send_pending_push()');
    exception when others then
      -- Don't fail the migration; docs/supabase-setup.md shows how to do this by hand.
      raise notice 'Push job not set up (%). Enable pg_net and Cron in the dashboard, then run the cron.schedule line from this migration.', sqlerrm;
    end;
  end if;
end $$;

-- Same as before, with the queue emptied too. Devices stay signed up: a reset doesn't change whose phone is whose.
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
           public.saved_listings, public.winner_stories, private.winner_consent_log, private.push_outbox;

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
