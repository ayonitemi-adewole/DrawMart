-- Who's bringing an order, and a chat about it (deliveryChat.ts). Once a rider has
-- collected a delivery, the buyer sees their first name and photo and can message them
-- until it's delivered or goes back. Only the buyer and the rider carrying it can read
-- it; the shop never does. No phone numbers either way, and never the message on a
-- lock screen. Separate from conversations, which the shop reads and which are per product.

alter table public.profiles add column rider_photo text check (rider_photo ~ '^(https://|/assets/)');

create table public.delivery_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  -- The rider carrying it at the time: someone who takes over starts afresh.
  rider_id uuid not null references public.profiles (id),
  sender text not null check (sender in ('buyer', 'rider')),
  body text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index delivery_messages_order_idx on public.delivery_messages (order_id, rider_id, created_at);
-- Only through the functions below.
alter table public.delivery_messages enable row level security;
revoke all on public.delivery_messages from anon, authenticated;

-- Open from collection until it's delivered, handed in at a counter, or goes back.
create function private.delivery_chat_open(o public.orders) returns boolean
language sql stable set search_path = ''
as $$
  select o.status = 'dispatched' and o.fulfilment = 'delivery' and o.rider_id is not null and o.collected_at is not null and o.counter_at is null
$$;

-- deliveryChat.ts firstName.
create function private.first_name(p_name text) returns text
language sql immutable set search_path = ''
as $$
  select coalesce(nullif(split_part(btrim(coalesce(p_name, '')), ' ', 1), ''), 'Your rider')
$$;

create function public.my_rider_profile() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  return (select jsonb_build_object('firstName', private.first_name(display_name), 'photo', rider_photo) from public.profiles where id = v_uid);
end $$;

create function public.set_rider_photo(p_photo text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  if coalesce(p_photo, '') !~ '^(https://|/assets/)' then perform private.fail('invalid_input', 'Take a photo of yourself.'); end if;
  update public.profiles set rider_photo = p_photo where id = v_uid;
end $$;

-- {orderId: {firstName, photo}} for the buyer's orders a rider is bringing now. Never their phone.
create function public.my_order_riders() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(o.id, jsonb_build_object('firstName', private.first_name(r.display_name), 'photo', r.rider_photo)), '{}'::jsonb)
    from public.orders o join public.profiles r on r.id = o.rider_id
   where o.user_id = auth.uid() and private.delivery_chat_open(o)
$$;

-- The buyer's or the rider's view. Nothing once it's closed.
create function public.delivery_chat(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  o public.orders;
  v_me text;
begin
  select * into o from public.orders where id = p_order_id;
  v_me := case when found and o.user_id = v_uid then 'buyer' when found and o.rider_id = v_uid then 'rider' end;
  if v_me is null then perform private.fail('not_found', 'That order doesn’t exist.'); end if;
  if not private.delivery_chat_open(o) then return jsonb_build_object('open', false, 'me', v_me, 'rider', null, 'messages', '[]'::jsonb); end if;
  return jsonb_build_object(
    'open', true,
    'me', v_me,
    'rider', (select jsonb_build_object('firstName', private.first_name(display_name), 'photo', rider_photo) from public.profiles where id = o.rider_id),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'createdAt', m.created_at) order by m.created_at)
        from public.delivery_messages m where m.order_id = o.id and m.rider_id = o.rider_id
    ), '[]'::jsonb)
  );
end $$;

-- deliveryChat.ts deliveryMessageError, and messages.ts MAX_MESSAGES_PER_MINUTE.
create function public.send_delivery_message(p_order_id uuid, p_body text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  o public.orders;
  v_me text;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select * into o from public.orders where id = p_order_id for update;
  v_me := case when found and o.user_id = v_uid then 'buyer' when found and o.rider_id = v_uid then 'rider' end;
  if v_me is null then perform private.fail('not_found', 'That order doesn’t exist.'); end if;
  if not private.delivery_chat_open(o) then perform private.fail('invalid_input', 'This chat has closed.'); end if;
  if v_body = '' then perform private.fail('invalid_input', 'Write a message first.'); end if;
  if length(v_body) > 1000 then perform private.fail('invalid_input', 'Keep it under 1,000 characters.'); end if;
  if regexp_replace(v_body, '(\d)[\s.-]+(?=\d)', '\1', 'g') ~ '(\+?234|(^|[^0-9])0)[789][01][0-9]{8}([^0-9]|$)' then
    perform private.fail('invalid_input', 'Keep phone numbers out of this chat. The rider can already call you if they need to.');
  end if;
  if (select count(*) from public.delivery_messages where order_id = o.id and sender = v_me and created_at > now() - interval '1 minute') >= 20 then
    perform private.fail('invalid_input', 'You’re sending messages too quickly. Wait a moment.');
  end if;
  insert into public.delivery_messages (order_id, rider_id, sender, body) values (o.id, o.rider_id, v_me, v_body);
end $$;

-- Says who it's from, never what it says: this shows on a lock screen.
create function private.push_for_delivery_message() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare o public.orders;
begin
  select * into o from public.orders where id = new.order_id;
  if new.sender = 'rider' then
    perform private.queue_push(o.user_id, 'messages', 'Your rider sent a message', 'About your order on its way.', '/tickets?view=orders', 'delivery-chat-' || o.id);
  else
    perform private.queue_push(new.rider_id, 'rider_jobs', 'The buyer sent a message', 'About a delivery you’re carrying.', '/delivery/' || o.id, 'delivery-chat-' || o.id);
  end if;
  return null;
exception when others then
  raise warning 'push_for_delivery_message: %', sqlerrm;
  return null;
end $$;
create trigger push_on_delivery_message after insert on public.delivery_messages
  for each row execute function private.push_for_delivery_message();

revoke all on function private.delivery_chat_open(public.orders), private.first_name(text) from public, anon, authenticated;
revoke all on function public.my_rider_profile(), public.set_rider_photo(text), public.my_order_riders(), public.delivery_chat(uuid), public.send_delivery_message(uuid, text) from public, anon;
grant execute on function public.my_rider_profile(), public.set_rider_photo(text), public.my_order_riders(), public.delivery_chat(uuid), public.send_delivery_message(uuid, text) to authenticated;

-- Same as before, wiping delivery chats too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.delivery_messages, public.rider_earnings, public.rider_payout_accounts, private.rider_payout_account_history, private.delivery_attempts, private.job_releases, public.store_activity, public.store_invites, private.owed_checks, private.discount_redemptions, public.discount_listings, public.discounts, public.quick_replies, public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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
