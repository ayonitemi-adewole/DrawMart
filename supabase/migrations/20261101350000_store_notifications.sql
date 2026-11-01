-- Stores hear about their own business: in the app and, if they turn it on, on their
-- devices with the app closed. Individual sellers get the same in the buyer app.
-- domain/storeNotifications.ts and domain/push.ts. No "payout sent" yet: payouts don't
-- exist until store feature 4, which adds that kind.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'draw_sold_out', 'draw_won', 'draw_lost',
  'saved_almost_sold', 'saved_closing_soon', 'saved_relisted', 'saved_back_on_sale', 'saved_price_drop',
  'store_new_order', 'store_listing_approved', 'store_listing_rejected', 'store_draw_sold_out',
  'store_winner_picked', 'store_draw_closing', 'store_pickup_tomorrow', 'store_new_message'
));

alter table public.push_preferences
  add column store_orders boolean not null default true,
  add column store_listings boolean not null default true,
  add column store_draws boolean not null default true,
  add column store_pickups boolean not null default true;

-- Riders and admins don't get these.
create function private.require_buyer_or_store(p_uid uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = p_uid and role in ('buyer', 'store')) then
    perform private.fail('forbidden', 'Only buyer and store accounts have this setting.');
  end if;
end $$;

-- Same as before, open to stores too.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform private.require_buyer_or_store(v_uid);
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

-- Same as before, with the store kinds added.
create or replace function public.set_push_preference(p_category text, p_enabled boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform private.require_buyer_or_store(v_uid);
  insert into public.push_preferences (user_id) values (v_uid) on conflict (user_id) do nothing;
  case p_category
    when 'wins' then update public.push_preferences set wins = p_enabled where user_id = v_uid;
    when 'drawResults' then update public.push_preferences set draw_results = p_enabled where user_id = v_uid;
    when 'orders' then update public.push_preferences set orders = p_enabled where user_id = v_uid;
    when 'messages' then update public.push_preferences set messages = p_enabled where user_id = v_uid;
    when 'savedItems' then update public.push_preferences set saved_items = p_enabled where user_id = v_uid;
    when 'drawReveal' then update public.push_preferences set draw_reveal = p_enabled where user_id = v_uid;
    when 'storeOrders' then update public.push_preferences set store_orders = p_enabled where user_id = v_uid;
    when 'storeListings' then update public.push_preferences set store_listings = p_enabled where user_id = v_uid;
    when 'storeDraws' then update public.push_preferences set store_draws = p_enabled where user_id = v_uid;
    when 'storePickups' then update public.push_preferences set store_pickups = p_enabled where user_id = v_uid;
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
  if found and not (case p_category when 'wins' then p.wins when 'draw_results' then p.draw_results when 'orders' then p.orders when 'messages' then p.messages when 'store_orders' then p.store_orders when 'store_listings' then p.store_listings when 'store_draws' then p.store_draws when 'store_pickups' then p.store_pickups when 'saved_items' then p.saved_items end) then
    return;
  end if;
  insert into private.push_outbox (user_id, title, body, url, tag) values (p_user, p_title, p_body, p_url, p_tag);
end $$;

-- Tells everyone who runs this shop. Never fails whatever triggered it.
create function private.notify_shop(p_merchant uuid, p_kind text, p_listing uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, listing_id)
  select id, p_kind, p_listing from public.profiles where merchant_id = p_merchant or seller_id = p_merchant;
exception when others then
  raise warning 'notify_shop: %', sqlerrm;
end $$;

create or replace function private.push_for_notification() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_title text;
  v_batch uuid;
  v_category text;
  v_home text;
begin
  select title, pickup_batch_id, category into v_title, v_batch, v_category from public.listings where id = new.listing_id;
  -- Individual sellers work from /sell in the buyer app.
  select case when role = 'store' then '/store' else '/sell' end into v_home from public.profiles where id = new.user_id;
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
    when 'store_new_order' then
      perform private.queue_push(new.user_id, 'store_orders', 'New order', v_title || ' has been bought. Get it ready for a rider.', v_home || '?tab=orders', 'order-' || new.listing_id);
    when 'store_listing_approved' then
      perform private.queue_push(new.user_id, 'store_listings', 'Listing approved', v_title || ' is now live for buyers.', v_home, 'review-' || new.listing_id);
    when 'store_listing_rejected' then
      perform private.queue_push(new.user_id, 'store_listings', 'Listing not approved', 'See why ' || v_title || ' wasn’t approved, and fix it.', v_home || '?fix=' || new.listing_id, 'review-' || new.listing_id);
    when 'store_draw_sold_out' then
      perform private.queue_push(new.user_id, 'store_draws', 'All tickets sold', v_title || ' has sold out.', v_home, 'store-draw-' || new.listing_id);
    when 'store_winner_picked' then
      perform private.queue_push(new.user_id, 'store_draws', 'Winner announced', 'The draw for ' || v_title || ' has run.', v_home, 'store-draw-' || new.listing_id);
    when 'store_draw_closing' then
      perform private.queue_push(new.user_id, 'store_draws', 'Draw closing soon', v_title || ' closes within 24 hours and hasn’t sold out.', v_home, 'store-draw-' || new.listing_id);
    when 'store_pickup_tomorrow' then
      perform private.queue_push(new.user_id, 'store_pickups',
        case when v_category = 'Cars' then 'Inspection tomorrow' else 'Pickup tomorrow' end,
        -- A shared pickup's items collapse into one notification, so it can't name just one.
        case when v_batch is not null then 'Have the items in your shared pickup ready.' else 'Have ' || v_title || ' ready.' end,
        v_home, 'pickup-' || coalesce(v_batch, new.listing_id));
    -- store_new_message: push_for_message sends this one, since it knows the conversation.
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

create function private.store_notices_on_listing() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.status = 'pending_review' and new.status in ('live', 'for_sale') then
    perform private.notify_shop(new.merchant_id, 'store_listing_approved', new.id);
  elsif old.status = 'pending_review' and new.status = 'rejected' then
    perform private.notify_shop(new.merchant_id, 'store_listing_rejected', new.id);
  elsif new.status = 'sold_out' then
    perform private.notify_shop(new.merchant_id, 'store_draw_sold_out', new.id);
  elsif new.status = 'drawn' then
    perform private.notify_shop(new.merchant_id, 'store_winner_picked', new.id);
  end if;
  return null;
exception when others then
  raise warning 'store_notices_on_listing: %', sqlerrm;
  return null;
end $$;

create trigger store_notices_on_listing after update of status on public.listings
  for each row when (old.status is distinct from new.status)
  execute function private.store_notices_on_listing();

-- Won items DrawMart delivers itself aren't the store's to see, so it isn't told.
create function private.store_notices_on_order() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.notify_shop(new.merchant_id, 'store_new_order', new.listing_id);
  return null;
exception when others then
  raise warning 'store_notices_on_order: %', sqlerrm;
  return null;
end $$;

create trigger store_notices_on_order after insert on public.orders
  for each row when (new.handled_by = 'store')
  execute function private.store_notices_on_order();

-- Same as before, now reaching stores too. The push is about, never quoting, the message.
-- Only one unread notification per listing, however many messages arrive.
create or replace function private.push_for_message() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  c public.conversations;
  v_title text;
  r record;
begin
  select * into c from public.conversations where id = new.conversation_id;
  select title into v_title from public.listings where id = c.listing_id;
  if new.sender = 'seller' then
    perform private.queue_push(c.buyer_id, 'messages', 'New message', 'About ' || v_title, '/messages/' || c.id, 'chat-' || c.id);
  else
    for r in select id, role from public.profiles where seller_id = c.merchant_id or merchant_id = c.merchant_id loop
      perform private.queue_push(r.id, 'messages', 'New message', 'About ' || v_title,
        case when r.role = 'store' then '/store/messages/' else '/messages/' end || c.id, 'chat-' || c.id);
      if not exists (select 1 from public.notifications n where n.user_id = r.id and n.kind = 'store_new_message' and n.listing_id = c.listing_id and n.read_at is null) then
        insert into public.notifications (user_id, kind, listing_id) values (r.id, 'store_new_message', c.listing_id);
      end if;
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'push_for_message: %', sqlerrm;
  return null;
end $$;

-- storeNotifications.ts pickupReminderDue, closingReminderSent. Runs with the deadlines.
create function private.store_reminders() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_now timestamp := now() at time zone 'Africa/Lagos';
begin
  if extract(hour from v_now) >= 8 then
    for r in
      select l.id, l.merchant_id
        from public.listings l join public.listing_handovers h on h.listing_id = l.id
       where l.status = 'pending_review' and h.date = v_now::date + 1
         and not exists (select 1 from public.notifications n where n.listing_id = l.id and n.kind = 'store_pickup_tomorrow' and n.created_at > now() - interval '24 hours')
    loop
      perform private.notify_shop(r.merchant_id, 'store_pickup_tomorrow', r.id);
    end loop;
  end if;

  for r in
    select l.id, l.merchant_id
      from public.listings l
     where l.status = 'live' and l.kind = 'raffle' and l.closes_at > now() and l.closes_at <= now() + interval '24 hours'
       and not exists (select 1 from public.notifications n where n.listing_id = l.id and n.kind = 'store_draw_closing' and n.created_at >= l.closes_at - interval '24 hours')
  loop
    perform private.notify_shop(r.merchant_id, 'store_draw_closing', r.id);
  end loop;
exception when others then
  raise warning 'store_reminders: %', sqlerrm;
end $$;

-- Same as before, plus store reminders.
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
  perform private.store_reminders();

  return n;
end $$;

revoke execute on function
  private.require_buyer_or_store(uuid),
  private.notify_shop(uuid, text, uuid),
  private.store_notices_on_listing(),
  private.store_notices_on_order(),
  private.store_reminders()
from public, anon, authenticated;
