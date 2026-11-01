-- What each seller is owed, item by item, and where to send it. domain/payouts.ts.
-- Admins mark payouts paid by hand for now, after sending the transfer themselves.
--
-- Unlike notifications, the triggers here don't catch their own errors: a delivery that
-- can't record what it owes should fail, not lose the money quietly.

-- Bank details are only for the seller and admins. A change is held: see save_payout_account.
create table public.payout_accounts (
  merchant_id uuid primary key references public.merchants (id) on delete cascade,
  bank_code text not null,
  bank_name text not null,
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  account_name text not null,
  confirmed_at timestamptz not null default now(),
  payable_from timestamptz not null default now()
);
alter table public.payout_accounts enable row level security;
create policy "own account, or admins" on public.payout_accounts for select to authenticated
  using (merchant_id = (select private.my_merchant_id()) or (select private.is_admin()));
revoke all on public.payout_accounts from anon, authenticated;
grant select on public.payout_accounts to authenticated;

-- Where money could have gone, for looking into a dispute.
create table private.payout_account_history (
  merchant_id uuid not null,
  bank_code text not null,
  bank_name text not null,
  account_number text not null,
  account_name text not null,
  confirmed_at timestamptz not null,
  replaced_at timestamptz not null default now(),
  replaced_by uuid
);
revoke all on private.payout_account_history from public, anon, authenticated;

create table private.bank_lookups (
  user_id uuid not null references public.profiles (id) on delete cascade,
  at timestamptz not null default now()
);
create index bank_lookups_idx on private.bank_lookups (user_id, at);
revoke all on private.bank_lookups from public, anon, authenticated;

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  kind text not null check (kind in ('sale', 'draw', 'caution_fee')),
  amount_kobo bigint not null check (amount_kobo > 0),
  status text not null default 'waiting' check (status in ('waiting', 'due', 'paid')),
  created_at timestamptz not null default now(),
  due_at timestamptz,
  paid_at timestamptz,
  reference text,
  paid_to text,
  paid_by uuid
);
create unique index payouts_one_per_sale on public.payouts (order_id) where kind = 'sale';
create unique index payouts_one_per_draw_or_fee on public.payouts (listing_id, kind) where kind in ('draw', 'caution_fee');
create index payouts_merchant_idx on public.payouts (merchant_id, created_at desc);
create index payouts_due_idx on public.payouts (status) where status = 'due';
alter table public.payouts enable row level security;
create policy "own payouts, or admins" on public.payouts for select to authenticated
  using (merchant_id = (select private.my_merchant_id()) or (select private.is_admin()));
revoke all on public.payouts from anon, authenticated;
grant select on public.payouts to authenticated;

-- payouts.ts payoutsFor. Safe to run any number of times, and only ever moves a line forward.
create function private.sync_payouts(p_listing uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  o public.orders;
  v_seller_bps numeric;
  v_delivered boolean;
  v_anchor uuid;
begin
  select * into l from public.listings where id = p_listing;
  if not found then return; end if;

  for o in select * from public.orders where listing_id = p_listing and not is_prize loop
    insert into public.payouts (merchant_id, listing_id, order_id, kind, amount_kobo)
    select o.merchant_id, o.listing_id, o.id, 'sale', o.price_kobo - o.fee_kobo
     where o.price_kobo - o.fee_kobo > 0
    on conflict (order_id) where kind = 'sale' do nothing;
    if o.status = 'delivered' then
      update public.payouts set status = 'due', due_at = now() where order_id = o.id and kind = 'sale' and status = 'waiting';
    end if;
  end loop;

  v_delivered := exists (select 1 from public.orders where listing_id = p_listing and is_prize and status = 'delivered');

  if l.kind = 'raffle' and l.status in ('sold_out', 'drawn') then
    -- fees.ts computeListingEconomics
    v_seller_bps := case l.fee_mode when 'seller' then l.fee_bps when 'split' then l.fee_bps / 2.0 else 0 end;
    insert into public.payouts (merchant_id, listing_id, kind, amount_kobo)
    values (l.merchant_id, l.id, 'draw', l.price_kobo - round(l.price_kobo * v_seller_bps / 10000.0)::bigint)
    on conflict (listing_id, kind) where kind in ('draw', 'caution_fee') do nothing;
    if v_delivered then
      update public.payouts set status = 'due', due_at = now() where listing_id = l.id and kind = 'draw' and status = 'waiting';
    end if;
  end if;

  if l.caution_fee_status = 'refunded' and l.caution_fee_kobo > 0 then
    -- A shared pickup has one fee: its line sits on one of its items, due once all are delivered.
    if l.pickup_batch_id is not null then
      select id into v_anchor from public.listings where pickup_batch_id = l.pickup_batch_id order by id limit 1;
      v_delivered := not exists (
        select 1 from public.listings m
         where m.pickup_batch_id = l.pickup_batch_id
           and not exists (select 1 from public.orders o2 where o2.listing_id = m.id and o2.is_prize and o2.status = 'delivered')
      );
    else
      v_anchor := l.id;
    end if;
    insert into public.payouts (merchant_id, listing_id, kind, amount_kobo)
    values (l.merchant_id, v_anchor, 'caution_fee', l.caution_fee_kobo)
    on conflict (listing_id, kind) where kind in ('draw', 'caution_fee') do nothing;
    if v_delivered or l.status = 'withdrawn' then
      update public.payouts set status = 'due', due_at = now() where listing_id = v_anchor and kind = 'caution_fee' and status = 'waiting';
    end if;
  end if;
end $$;

create function private.payouts_on_listing() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.sync_payouts(new.id);
  return null;
end $$;

create trigger payouts_on_listing after insert or update of status, caution_fee_status on public.listings
  for each row execute function private.payouts_on_listing();

create function private.payouts_on_order() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.sync_payouts(new.listing_id);
  return null;
end $$;

create trigger payouts_on_order after insert or update of status on public.orders
  for each row execute function private.payouts_on_order();

-- Everything earned so far. Already-delivered items start as due.
do $$
declare r record;
begin
  for r in select id from public.listings where status in ('sold_out', 'drawn', 'withdrawn', 'sold', 'for_sale') loop
    perform private.sync_payouts(r.id);
  end loop;
end $$;

-- Called by the bank-account Edge Function before it asks Flutterwave. The lookup says
-- whose name is on any account, so it's for sellers only, and 10 an hour.
create function public.note_bank_lookup(p_user uuid) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = p_user and coalesce(p.merchant_id, p.seller_id) is not null) then return 'not_seller'; end if;
  if (select count(*) from private.bank_lookups where user_id = p_user and at > now() - interval '1 hour') >= 10 then return 'too_many'; end if;
  insert into private.bank_lookups (user_id) values (p_user);
  return 'ok';
end $$;

-- Only the bank-account Edge Function calls this, with the name Flutterwave gave it.
-- A new account can be paid at once; a changed one is held for 48 hours and the seller
-- is told, whatever their switches say, so a stolen session can't quietly redirect money.
create function public.save_payout_account(p_user uuid, p_bank_code text, p_bank_name text, p_account_number text, p_account_name text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_merchant uuid;
  a public.payout_accounts;
begin
  select coalesce(merchant_id, seller_id) into v_merchant from public.profiles where id = p_user;
  if v_merchant is null then perform private.fail('forbidden', 'Only sellers can add a bank account.'); end if;
  if coalesce(p_account_number, '') !~ '^[0-9]{10}$' then perform private.fail('invalid_input', 'Enter the 10-digit account number.'); end if;
  if btrim(coalesce(p_account_name, '')) = '' or btrim(coalesce(p_bank_name, '')) = '' then perform private.fail('invalid_input', 'That account couldn’t be confirmed.'); end if;

  select * into a from public.payout_accounts where merchant_id = v_merchant for update;
  if not found then
    insert into public.payout_accounts (merchant_id, bank_code, bank_name, account_number, account_name)
    values (v_merchant, p_bank_code, p_bank_name, p_account_number, btrim(p_account_name));
    return;
  end if;
  -- The same account again changes nothing.
  if a.bank_code = p_bank_code and a.account_number = p_account_number then return; end if;

  insert into private.payout_account_history (merchant_id, bank_code, bank_name, account_number, account_name, confirmed_at, replaced_by)
  values (a.merchant_id, a.bank_code, a.bank_name, a.account_number, a.account_name, a.confirmed_at, p_user);
  update public.payout_accounts
     set bank_code = p_bank_code, bank_name = p_bank_name, account_number = p_account_number, account_name = btrim(p_account_name),
         confirmed_at = now(), payable_from = now() + interval '48 hours'
   where merchant_id = v_merchant;
  perform private.notify_shop(v_merchant, 'store_bank_changed', null);
end $$;

-- After an admin has sent the transfer. One seller at a time, so one reference covers it.
create function public.mark_payouts_paid(p_ids uuid[], p_reference text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_reference text := btrim(coalesce(p_reference, ''));
  v_merchants uuid[];
  a public.payout_accounts;
begin
  perform private.require_admin();
  -- Locked, so paying twice from two screens fails on the second.
  perform 1 from public.payouts where id = any(p_ids) order by id for update;
  if coalesce(cardinality(p_ids), 0) = 0
     or (select count(*) from public.payouts where id = any(p_ids) and status = 'due') <> cardinality(p_ids) then
    perform private.fail('invalid_input', 'Only payouts that are due can be marked paid.');
  end if;
  v_merchants := array(select distinct merchant_id from public.payouts where id = any(p_ids));
  if cardinality(v_merchants) <> 1 then perform private.fail('invalid_input', 'Mark one seller’s payouts at a time.'); end if;

  select * into a from public.payout_accounts where merchant_id = v_merchants[1];
  if not found then perform private.fail('invalid_input', 'This seller hasn’t added a bank account yet.'); end if;
  if a.payable_from > now() then perform private.fail('invalid_input', 'This seller changed their bank account recently, so payouts are on hold.'); end if;
  if length(v_reference) < 3 then perform private.fail('invalid_input', 'Enter the transfer’s reference.'); end if;

  update public.payouts
     set status = 'paid', paid_at = now(), reference = v_reference, paid_by = v_uid,
         paid_to = a.bank_name || ' •••• ' || right(a.account_number, 4)
   where id = any(p_ids);
  perform private.notify_shop(v_merchants[1], 'store_payout_sent', null);
end $$;

-- Notifications about the shop as a whole have no listing.
alter table public.notifications alter column listing_id drop not null;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'draw_sold_out', 'draw_won', 'draw_lost',
  'saved_almost_sold', 'saved_closing_soon', 'saved_relisted', 'saved_back_on_sale', 'saved_price_drop',
  'store_new_order', 'store_listing_approved', 'store_listing_rejected', 'store_draw_sold_out',
  'store_winner_picked', 'store_draw_closing', 'store_pickup_tomorrow', 'store_new_message',
  'store_payout_sent', 'store_bank_changed'
));
alter table public.push_preferences add column store_payouts boolean not null default true;

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
    when 'storePayouts' then update public.push_preferences set store_payouts = p_enabled where user_id = v_uid;
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
  if found and not (case p_category when 'wins' then p.wins when 'draw_results' then p.draw_results when 'orders' then p.orders when 'messages' then p.messages when 'store_orders' then p.store_orders when 'store_listings' then p.store_listings when 'store_draws' then p.store_draws when 'store_pickups' then p.store_pickups when 'store_payouts' then p.store_payouts when 'saved_items' then p.saved_items end) then
    return;
  end if;
  insert into private.push_outbox (user_id, title, body, url, tag) values (p_user, p_title, p_body, p_url, p_tag);
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
    when 'store_payout_sent' then
      perform private.queue_push(new.user_id, 'store_payouts', 'Payout sent', 'We’ve sent a payout to your bank account.', case when v_home = '/store' then '/store/payouts' else '/sell?tab=payouts' end, 'payout-' || new.id);
    when 'store_bank_changed' then
      -- Not a kind anyone can switch off: it's how they find out if it wasn't them.
      perform private.queue_push(new.user_id, 'security', 'Bank account changed', 'Your payout account was changed. If this wasn’t you, contact DrawMart now.', case when v_home = '/store' then '/store/payouts' else '/sell?tab=payouts' end, 'bank-' || new.id);
    -- store_new_message: push_for_message sends this one, since it knows the conversation.
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, with payouts and bank details wiped too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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

revoke execute on function
  private.sync_payouts(uuid),
  private.payouts_on_listing(),
  private.payouts_on_order()
from public, anon, authenticated;

revoke all on function
  public.note_bank_lookup(uuid),
  public.save_payout_account(uuid, text, text, text, text),
  public.mark_payouts_paid(uuid[], text)
from public, anon, authenticated;
grant execute on function public.note_bank_lookup(uuid), public.save_payout_account(uuid, text, text, text, text) to service_role;
grant execute on function public.mark_payouts_paid(uuid[], text) to authenticated;
