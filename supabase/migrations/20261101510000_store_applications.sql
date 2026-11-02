-- Self-serve store sign-up. A CAC-registered business applies from a new account
-- (/sell/business); an admin checks the certificate and the director's ID, and approval
-- turns that account into the store's (profiles.role = 'store'). Only buyers hold money
-- or tickets, so the account must be one that hasn't bought or sold. Documents go in the
-- private seller-ids bucket, readable only by the applicant and admins.
-- Rules mirror src/domain/storeApplications.ts.

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
  'store_approved'
));

create table public.store_applications (
  id uuid primary key default gen_random_uuid(),
  -- One per account; a rejected business edits and resubmits it.
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  business_name text not null,
  cac_number text not null,
  director_name text not null,
  phone text not null,
  address text not null,
  area text not null,
  -- Paths in the private seller-ids bucket: <user id>/<file>.
  certificate_path text not null,
  director_id_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  merchant_id uuid references public.merchants (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index store_applications_status_idx on public.store_applications (status, updated_at);

alter table public.store_applications enable row level security;
create policy "own application, or admins" on public.store_applications for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
revoke all on public.store_applications from anon, authenticated;
grant select on public.store_applications to authenticated;

-- storeApplications.ts normalizeCac.
create function private.normalize_cac(p text) returns text
language sql immutable set search_path = ''
as $$
  select case when m is null then null else upper(m[1]) || ' ' || m[2] end
  from (select regexp_match(btrim(coalesce(p, '')), '^(RC|BN|IT)[[:space:]-]*([0-9]{4,8})$', 'i') m) x
$$;

-- storeApplications.ts storeAccountBlocker. Null when the account can become a store's.
create function private.store_account_blocker(p_user uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when coalesce((select role from public.profiles where id = p_user), '') <> 'buyer' then 'Only a new account can become a store account.'
    when (select seller_id from public.profiles where id = p_user) is not null
      or exists (select 1 from public.seller_applications where user_id = p_user and status <> 'rejected')
      then 'This account sells as an individual. Sign up with a new account for your business.'
    when exists (select 1 from public.tickets where user_id = p_user)
      or exists (select 1 from public.orders where user_id = p_user)
      or exists (select 1 from public.deposits where user_id = p_user)
      then 'This account has already bought on DrawMart. Sign up with a new account for your business.'
  end
$$;

-- storeApplications.ts validateStoreApplication
create function public.submit_store_application(p jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_errors text[] := '{}';
  v_name text := btrim(coalesce(p ->> 'businessName', ''));
  v_cac text := private.normalize_cac(p ->> 'cacNumber');
  v_director text := btrim(coalesce(p ->> 'directorName', ''));
  v_phone text := btrim(coalesce(p ->> 'phone', ''));
  v_address text := btrim(coalesce(p ->> 'address', ''));
  v_area text := btrim(coalesce(p ->> 'area', ''));
  v_certificate text := coalesce(p ->> 'certificatePhoto', '');
  v_director_id text := coalesce(p ->> 'directorIdPhoto', '');
  v_blocker text := private.store_account_blocker(v_uid);
  v_existing public.store_applications;
  v_id uuid;
begin
  if v_blocker is not null then perform private.fail('invalid_input', v_blocker); end if;
  select * into v_existing from public.store_applications where user_id = v_uid for update;
  if v_existing.status = 'pending' then perform private.fail('invalid_input', 'Your application is already being reviewed.'); end if;
  if v_existing.status = 'approved' then perform private.fail('invalid_input', 'Your store is already approved.'); end if;

  if length(v_name) < 2 then v_errors := array_append(v_errors, 'Enter your business name, as on your CAC certificate.'); end if;
  if v_cac is null then v_errors := array_append(v_errors, 'Enter your CAC number, e.g. RC 1234567 or BN 1234567.'); end if;
  if (select count(*) from regexp_split_to_table(v_director, '\s+') w where length(w) > 1) < 2 then
    v_errors := array_append(v_errors, 'Enter the director’s full name, as on their ID.');
  end if;
  if regexp_replace(v_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  if length(v_address) < 10 then v_errors := array_append(v_errors, 'Enter the business address, with street and area.'); end if;
  if length(v_area) < 2 then v_errors := array_append(v_errors, 'Enter your area in Lagos, e.g. Ikeja.'); end if;
  -- The documents must be this account's own uploads.
  if v_certificate not like v_uid::text || '/%' then v_errors := array_append(v_errors, 'Add a photo of your CAC certificate.'); end if;
  if v_director_id not like v_uid::text || '/%' then v_errors := array_append(v_errors, 'Add a photo of the director’s ID.'); end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;
  if exists (select 1 from public.merchants where cac_number = v_cac) then
    perform private.fail('invalid_input', 'A store with this CAC number is already on DrawMart. Contact us if it’s yours.');
  end if;

  insert into public.store_applications (user_id, business_name, cac_number, director_name, phone, address, area, certificate_path, director_id_path)
  values (v_uid, v_name, v_cac, v_director, v_phone, v_address, v_area, v_certificate, v_director_id)
  on conflict (user_id) do update
    set business_name = excluded.business_name, cac_number = excluded.cac_number, director_name = excluded.director_name, phone = excluded.phone,
        address = excluded.address, area = excluded.area, certificate_path = excluded.certificate_path, director_id_path = excluded.director_id_path,
        status = 'pending', review_note = null, reviewed_at = null, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- Creates the store and turns the applicant's account into its account.
create function public.approve_store_application(p_application_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.store_applications;
  v_merchant uuid;
begin
  perform private.require_admin();
  select * into a from public.store_applications where id = p_application_id and status = 'pending' for update;
  if not found then perform private.fail('invalid_input', 'Only applications waiting for review can be approved.'); end if;
  if private.store_account_blocker(a.user_id) is not null then
    perform private.fail('invalid_input', 'This account has bought or sold on DrawMart since applying, so it can’t become a store. Ask them to apply from a new account.');
  end if;
  if exists (select 1 from public.merchants where cac_number = a.cac_number) then
    perform private.fail('invalid_input', 'A store with this CAC number is already on DrawMart.');
  end if;

  insert into public.merchants (kind, name, area, cac_number, verified) values ('store', a.business_name, a.area, a.cac_number, true)
  returning id into v_merchant;
  update public.profiles set role = 'store', merchant_id = v_merchant where id = a.user_id and role = 'buyer';
  -- Buyer-only things it had.
  delete from public.cart_items where user_id = a.user_id;
  delete from public.saved_listings where user_id = a.user_id;
  update public.store_applications set status = 'approved', merchant_id = v_merchant, reviewed_at = now() where id = a.id;
  insert into public.notifications (user_id, kind, listing_id) values (a.user_id, 'store_approved', null);
end $$;

create function public.reject_store_application(p_application_id uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if length(btrim(coalesce(p_note, ''))) < 5 then perform private.fail('invalid_input', 'Tell the applicant what to fix.'); end if;
  update public.store_applications set status = 'rejected', review_note = btrim(p_note), reviewed_at = now()
   where id = p_application_id and status = 'pending';
  if not found then perform private.fail('invalid_input', 'Only applications waiting for review can be rejected.'); end if;
end $$;

revoke all on function private.normalize_cac(text), private.store_account_blocker(uuid) from public, anon, authenticated;
revoke all on function public.submit_store_application(jsonb), public.approve_store_application(uuid), public.reject_store_application(uuid, text) from public, anon;
grant execute on function public.submit_store_application(jsonb), public.approve_store_application(uuid), public.reject_store_application(uuid, text) to authenticated;

-- Same as before, with the store approval.
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
    -- store_new_message: push_for_message sends this one, since it knows the conversation.
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, wiping store applications too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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
