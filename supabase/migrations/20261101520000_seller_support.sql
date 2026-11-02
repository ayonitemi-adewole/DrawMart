-- Seller support: a store or individual seller writes to DrawMart's team from Help
-- (/store/help, /sell/help) and admins answer from /admin/support. One chat per shop.
-- Kept apart from buyer-seller conversations, which are all about a listing and a buyer.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'draw_sold_out', 'draw_won', 'draw_lost',
  'saved_almost_sold', 'saved_closing_soon', 'saved_relisted', 'saved_back_on_sale', 'saved_price_drop',
  'store_new_order', 'store_listing_approved', 'store_listing_rejected', 'store_draw_sold_out',
  'store_winner_picked', 'store_draw_closing', 'store_pickup_tomorrow', 'store_new_message',
  'store_payout_sent', 'store_bank_changed',
  'store_price_approved', 'store_price_rejected',
  'order_cancelled',
  'store_order_confirm_soon', 'store_order_expired',
  'store_order_failed', 'store_suspended',
  'order_claim_update', 'store_order_claim',
  'store_new_review', 'review_reply',
  'store_approved',
  'store_support_reply'
));

create table public.support_threads (
  merchant_id uuid primary key references public.merchants (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  shop_read_at timestamptz not null default now(),
  staff_read_at timestamptz not null default 'epoch',
  -- Set by an admin once it's answered; a new message from the shop clears it.
  resolved_at timestamptz
);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.support_threads (merchant_id) on delete cascade,
  sender text not null check (sender in ('shop', 'drawmart')),
  sender_user_id uuid not null references public.profiles (id),
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index support_messages_thread_idx on public.support_messages (merchant_id, created_at);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
create policy "the shop and admins read support chats" on public.support_threads for select to authenticated
  using (merchant_id = (select private.my_merchant_id()) or (select private.is_admin()));
create policy "the shop and admins read support messages" on public.support_messages for select to authenticated
  using (merchant_id = (select private.my_merchant_id()) or (select private.is_admin()));
revoke all on public.support_threads, public.support_messages from anon, authenticated;
-- Not which admin answered.
grant select (merchant_id, created_at, last_message_at, shop_read_at, staff_read_at, resolved_at) on public.support_threads to authenticated;
grant select (id, merchant_id, sender, body, created_at) on public.support_messages to authenticated;

-- messages.ts messageError and MAX_MESSAGES_PER_MINUTE.
create function private.check_support_body(p_body text) returns text
language plpgsql immutable set search_path = ''
as $$
declare v_body text := btrim(coalesce(p_body, ''));
begin
  if v_body = '' then perform private.fail('invalid_input', 'Write a message first.'); end if;
  if length(v_body) > 1000 then perform private.fail('invalid_input', 'Keep it under 1,000 characters.'); end if;
  return v_body;
end $$;

create function public.send_support_message(p_body text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_shop uuid := private.my_merchant_id();
  v_body text := private.check_support_body(p_body);
  v_id uuid;
begin
  if v_shop is null then perform private.fail('forbidden', 'Only sellers can write to DrawMart here.'); end if;
  if (select count(*) from public.support_messages where merchant_id = v_shop and sender = 'shop' and created_at > now() - interval '1 minute') >= 20 then
    perform private.fail('invalid_input', 'You’re sending messages very fast. Wait a moment.');
  end if;
  insert into public.support_threads (merchant_id) values (v_shop) on conflict (merchant_id) do nothing;
  insert into public.support_messages (merchant_id, sender, sender_user_id, body) values (v_shop, 'shop', v_uid, v_body) returning id into v_id;
  update public.support_threads set last_message_at = now(), shop_read_at = now(), resolved_at = null where merchant_id = v_shop;
  return v_id;
end $$;

create function public.reply_support(p_merchant uuid, p_body text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_body text;
  v_id uuid;
begin
  perform private.require_admin();
  v_body := private.check_support_body(p_body);
  if not exists (select 1 from public.support_threads where merchant_id = p_merchant) then perform private.fail('not_found', 'That chat doesn’t exist.'); end if;
  insert into public.support_messages (merchant_id, sender, sender_user_id, body) values (p_merchant, 'drawmart', auth.uid(), v_body) returning id into v_id;
  update public.support_threads set last_message_at = now(), staff_read_at = now() where merchant_id = p_merchant;
  perform private.notify_shop(p_merchant, 'store_support_reply', null);
  return v_id;
end $$;

-- Without a shop: the shop read its own chat. With one: an admin read that shop's.
create function public.mark_support_read(p_merchant uuid default null) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_user();
  if p_merchant is null then
    update public.support_threads set shop_read_at = now() where merchant_id = private.my_merchant_id();
  else
    perform private.require_admin();
    update public.support_threads set staff_read_at = now() where merchant_id = p_merchant;
  end if;
end $$;

create function public.set_support_resolved(p_merchant uuid, p_resolved boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.support_threads set resolved_at = case when p_resolved then now() end where merchant_id = p_merchant;
  if not found then perform private.fail('not_found', 'That chat doesn’t exist.'); end if;
end $$;

-- Unanswered first, then the latest.
create function public.support_inbox() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb - 'sort_unread' order by x.sort_unread desc, x."lastMessageAt" desc)
    from (
      select t.merchant_id "merchantId", m.name "merchantName", m.kind, t.last_message_at "lastMessageAt", t.resolved_at is not null resolved,
             last.body "lastMessage", last.sender "lastSender",
             (select count(*) from public.support_messages s where s.merchant_id = t.merchant_id and s.sender = 'shop' and s.created_at > t.staff_read_at)::int unread,
             (select count(*) from public.support_messages s where s.merchant_id = t.merchant_id and s.sender = 'shop' and s.created_at > t.staff_read_at) > 0 sort_unread
      from public.support_threads t
      join public.merchants m on m.id = t.merchant_id
      cross join lateral (select left(body, 140) body, sender from public.support_messages s where s.merchant_id = t.merchant_id order by created_at desc limit 1) last
    ) x
  ), '[]'::jsonb);
end $$;

revoke all on function private.check_support_body(text) from public, anon, authenticated;
revoke all on function public.send_support_message(text), public.reply_support(uuid, text), public.mark_support_read(uuid), public.set_support_resolved(uuid, boolean), public.support_inbox() from public, anon;
grant execute on function public.send_support_message(text), public.reply_support(uuid, text), public.mark_support_read(uuid), public.set_support_resolved(uuid, boolean), public.support_inbox() to authenticated;

-- Same as before, with DrawMart's replies.
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
    when 'order_cancelled' then
      perform private.queue_push(new.user_id, 'orders', 'Order cancelled', v_title || ' was cancelled and you’ve been refunded.', '/tickets?view=orders', 'order-cancelled-' || new.id);
    when 'store_order_confirm_soon' then
      perform private.queue_push(new.user_id, 'store_orders', 'Confirm this order', 'Confirm ' || v_title || ' soon, or it will be cancelled.', v_home || '?tab=orders', 'order-confirm-' || new.id);
    when 'store_order_expired' then
      perform private.queue_push(new.user_id, 'store_orders', 'Order cancelled', v_title || ' wasn’t confirmed or made ready in time. The buyer was refunded and the item is paused.', v_home || '?tab=orders', 'order-expired-' || new.id);
    when 'store_order_failed' then
      perform private.queue_push(new.user_id, 'store_orders', 'An order failed', v_title || ' failed a check or was refused. The buyer was refunded and you’ve been charged.', v_home || '?tab=orders', 'order-failed-' || new.id);
    when 'store_suspended' then
      perform private.queue_push(new.user_id, 'store_orders', 'Your shop is suspended', 'Too many orders have failed. Contact DrawMart.', v_home, 'store-suspended');
    when 'order_claim_update' then
      perform private.queue_push(new.user_id, 'orders', 'Your return or claim', 'There’s an update on ' || v_title || '.', '/tickets?view=orders', 'claim-' || new.listing_id);
    when 'store_order_claim' then
      perform private.queue_push(new.user_id, 'store_orders', 'A return or claim', 'There’s an update on ' || v_title || '.', v_home || '?tab=orders', 'store-claim-' || new.listing_id);
    when 'store_price_approved' then
      perform private.queue_push(new.user_id, 'store_listings', 'Price approved', 'The new price for ' || v_title || ' is live.', v_home, 'review-' || new.listing_id);
    when 'store_price_rejected' then
      perform private.queue_push(new.user_id, 'store_listings', 'Price not approved', v_title || ' stays at its current price.', v_home, 'review-' || new.listing_id);
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
    when 'store_payout_sent' then
      perform private.queue_push(new.user_id, 'store_payouts', 'Payout sent', 'We’ve sent a payout to your bank account.', case when v_home = '/store' then '/store/payouts' else '/sell?tab=payouts' end, 'payout-' || new.id);
    when 'store_bank_changed' then
      -- Not a kind anyone can switch off: it's how they find out if it wasn't them.
      perform private.queue_push(new.user_id, 'security', 'Bank account changed', 'Your payout account was changed. If this wasn’t you, contact DrawMart now.', case when v_home = '/store' then '/store/payouts' else '/sell?tab=payouts' end, 'bank-' || new.id);
    when 'store_new_review' then
      perform private.queue_push(new.user_id, 'store_orders', 'New review', 'A buyer reviewed ' || v_title || '.', case when v_home = '/store' then '/store/reviews' else '/sell?tab=reviews' end, 'review-new-' || new.id);
    when 'review_reply' then
      perform private.queue_push(new.user_id, 'orders', 'The seller replied', 'The seller replied to your review of ' || v_title || '.', '/tickets?view=orders', 'review-reply-' || new.listing_id);
    when 'store_approved' then
      perform private.queue_push(new.user_id, 'store_listings', 'Your store is approved', 'Open DrawMart to set it up.', '/store', 'store-approved');
    when 'store_support_reply' then
      -- Never the message itself on a lock screen.
      perform private.queue_push(new.user_id, 'messages', 'DrawMart replied', 'Open DrawMart to read it.', case when v_home = '/store' then '/store/help' else '/sell/help' end, 'support');
    -- store_new_message: push_for_message sends this one, since it knows the conversation.
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, wiping support chats too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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
