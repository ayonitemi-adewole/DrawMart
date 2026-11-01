-- Sellers run their products once they're on sale: pause and resume, change the stock,
-- change the price. Rules mirror src/domain/productControls.ts.

-- Paused stays readable, so buyers' orders, carts, saved items and chats about it still
-- work. It's only left out of browse and search, which ask for the statuses they want.
alter table public.listings
  drop constraint listings_status_check,
  add constraint listings_status_check
    check (status in ('pending_review', 'live', 'sold_out', 'drawn', 'refunded', 'for_sale', 'sold', 'rejected', 'withdrawn', 'paused')),
  -- The price an admin last reviewed, so many small changes can't add up to a big one.
  add column reviewed_price_kobo bigint;
update public.listings set reviewed_price_kobo = price_kobo where kind = 'product' and status in ('for_sale', 'sold');

drop policy "read public, own-store or all (admin) listings" on public.listings;
create policy "read public, own-store or all (admin) listings" on public.listings for select
  using (
    status in ('live', 'sold_out', 'drawn', 'refunded', 'for_sale', 'sold', 'paused')
    or merchant_id = (select private.my_merchant_id())
    or (select private.is_admin())
  );

-- A big price change waits here and the product keeps selling at its current price.
-- In its own table because listings are public, and buyers shouldn't see a price before it's agreed.
create table public.price_reviews (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  new_price_kobo bigint not null check (new_price_kobo >= 10000),
  requested_at timestamptz not null default now()
);
alter table public.price_reviews enable row level security;
create policy "own price reviews, or admins" on public.price_reviews for select to authenticated
  using ((select private.is_admin()) or exists (select 1 from public.listings l where l.id = listing_id and l.merchant_id = (select private.my_merchant_id())));
revoke all on public.price_reviews from anon, authenticated;
grant select on public.price_reviews to authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'draw_sold_out', 'draw_won', 'draw_lost',
  'saved_almost_sold', 'saved_closing_soon', 'saved_relisted', 'saved_back_on_sale', 'saved_price_drop',
  'store_new_order', 'store_listing_approved', 'store_listing_rejected', 'store_draw_sold_out',
  'store_winner_picked', 'store_draw_closing', 'store_pickup_tomorrow', 'store_new_message',
  'store_payout_sent', 'store_bank_changed',
  'store_price_approved', 'store_price_rejected'
));

create function public.pause_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare l public.listings := private.my_listing_for_update(p_listing_id);
begin
  if l.kind <> 'product' or l.status <> 'for_sale' then perform private.fail('invalid_input', 'Only products on sale can be paused.'); end if;
  update public.listings set status = 'paused' where id = l.id;
end $$;

create function public.resume_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare l public.listings := private.my_listing_for_update(p_listing_id);
begin
  if l.status <> 'paused' then perform private.fail('invalid_input', 'Only paused products can be resumed.'); end if;
  update public.listings set status = case when stock > 0 then 'for_sale' else 'sold' end where id = l.id;
end $$;

-- productControls.ts stockChangeError, statusAfterStock. Adds or removes rather than sets a
-- number, so a sale at the same moment isn't overwritten.
create function public.change_stock(p_listing_id uuid, p_change int) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings := private.my_listing_for_update(p_listing_id);
  v_stock int;
begin
  if l.kind <> 'product' or l.status not in ('for_sale', 'paused', 'sold') then perform private.fail('invalid_input', 'Only products on sale, paused or sold out can change stock.'); end if;
  if p_change is null or p_change = 0 then perform private.fail('invalid_input', 'Enter how many to add or remove.'); end if;
  v_stock := l.stock + p_change;
  if v_stock < 0 then perform private.fail('invalid_input', 'You can’t remove more than you have in stock.'); end if;
  if v_stock > 10000 then perform private.fail('invalid_input', 'Stock can’t go above 10,000.'); end if;
  update public.listings
     set stock = v_stock,
         status = case when status = 'for_sale' and v_stock = 0 then 'sold' when status = 'sold' and v_stock > 0 then 'for_sale' else status end
   where id = l.id;
end $$;

-- productControls.ts repriceNeedsReview. Returns whether it went to review.
create function public.change_price(p_listing_id uuid, p_price_kobo bigint) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings := private.my_listing_for_update(p_listing_id);
  v_base bigint;
begin
  if l.kind <> 'product' or l.status not in ('for_sale', 'paused', 'sold') then perform private.fail('invalid_input', 'Only products on sale, paused or sold out can change price.'); end if;
  if p_price_kobo is null or p_price_kobo < 10000 then perform private.fail('invalid_input', 'Set a price of at least ₦100.'); end if;
  v_base := coalesce(l.reviewed_price_kobo, l.price_kobo);
  if abs(p_price_kobo - v_base) * 100 > v_base * 20 then
    insert into public.price_reviews (listing_id, new_price_kobo) values (l.id, p_price_kobo)
    on conflict (listing_id) do update set new_price_kobo = excluded.new_price_kobo, requested_at = now();
    return true;
  end if;
  delete from public.price_reviews where listing_id = l.id;
  update public.listings set price_kobo = p_price_kobo, fee_bps = private.platform_fee_bps(p_price_kobo) where id = l.id;
  return false;
end $$;

-- p_new_price is the price the admin was looking at; the seller may have changed it since.
create function public.review_price_change(p_listing_id uuid, p_new_price bigint, p_approve boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.price_reviews;
  l public.listings;
begin
  perform private.require_admin();
  select * into r from public.price_reviews where listing_id = p_listing_id for update;
  if not found then perform private.fail('invalid_input', 'That price change has already been dealt with.'); end if;
  if r.new_price_kobo <> p_new_price then perform private.fail('invalid_input', 'The seller just changed this price. Check it again.'); end if;
  select * into l from public.listings where id = p_listing_id for update;
  delete from public.price_reviews where listing_id = p_listing_id;
  if p_approve then
    update public.listings
       set price_kobo = r.new_price_kobo, reviewed_price_kobo = r.new_price_kobo, fee_bps = private.platform_fee_bps(r.new_price_kobo)
     where id = p_listing_id;
  end if;
  perform private.notify_shop(l.merchant_id, case when p_approve then 'store_price_approved' else 'store_price_rejected' end, p_listing_id);
end $$;

revoke all on function public.pause_listing(uuid), public.resume_listing(uuid), public.change_stock(uuid, int), public.change_price(uuid, bigint), public.review_price_change(uuid, bigint, boolean) from public, anon;
grant execute on function public.pause_listing(uuid), public.resume_listing(uuid), public.change_stock(uuid, int), public.change_price(uuid, bigint), public.review_price_change(uuid, bigint, boolean) to authenticated;

-- Same as before, also checking the total the buyer saw.
create or replace function public.checkout(p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_ids uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'listingIds', '[]'::jsonb))::uuid), '{}');
  v_fulfilment text := p ->> 'fulfilment';
  v_address text := btrim(coalesce(p ->> 'address', ''));
  v_phone text := btrim(coalesce(p ->> 'phone', ''));
  v_point text := p ->> 'pickupPointId';
  v_lat double precision;
  v_lng double precision;
  v_pin_error text;
  v_errors text[] := '{}';
  v_checkout uuid := gen_random_uuid();
  l public.listings;
  v_won boolean;
  v_price bigint;
  v_total bigint := 0;
  v_cash bigint;
  v_credit bigint;
  v_from_credit bigint;
  v_order uuid;
  v_qty int;
  v_orders uuid[] := '{}';
begin
  perform private.require_buyer(v_uid);
  if cardinality(v_ids) = 0 then perform private.fail('invalid_input', 'Your cart is empty.'); end if;
  if v_fulfilment is null or v_fulfilment not in ('delivery', 'pickup') then perform private.fail('invalid_input', 'Choose delivery or pickup.'); end if;

  if v_fulfilment = 'delivery' then
    begin
      v_lat := (p ->> 'lat')::double precision;
      v_lng := (p ->> 'lng')::double precision;
    exception when others then
      v_lat := null;
    end;
    v_pin_error := private.location_error(v_lat, v_lng);
    if length(v_address) < 10 then v_errors := array_append(v_errors, 'Enter the full delivery address, with street and area.'); end if;
    if v_pin_error is not null then v_errors := array_append(v_errors, v_pin_error); end if;
    v_point := null;
  else
    v_address := null;
    if not exists (select 1 from public.pickup_points where id = v_point and active) then v_errors := array_append(v_errors, 'Choose a pickup location.'); end if;
  end if;
  if regexp_replace(v_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  -- Same lock order as buy_tickets: the buyer's wallet, then the listings.
  perform 1 from public.profiles where id = v_uid for update;

  for l in select * from public.listings where id = any (v_ids) order by id for update loop
    v_won := l.status = 'drawn' and private.has_won(v_uid, l.id);
    v_price := case when v_won then 0 when l.status <> 'for_sale' then null when l.kind = 'product' then l.price_kobo else l.fallback_price_kobo end;
    if v_price is null then perform private.fail('not_for_sale', l.title || ' isn’t for sale any more.'); end if;
    if l.category = 'Cars' and cardinality(v_ids) > 1 then perform private.fail('invalid_input', 'Cars are arranged on their own, not with other items.'); end if;
    if l.category = 'Cars' and v_fulfilment = 'pickup' then perform private.fail('invalid_input', 'Cars stay with the dealer, so they can’t be collected from a pickup location.'); end if;
    if v_won and exists (select 1 from public.orders where listing_id = l.id) then perform private.fail('invalid_input', l.title || ' has already been arranged.'); end if;
    v_total := v_total + v_price * private.order_quantity(p, l);
  end loop;
  if (select count(*) from public.listings where id = any (v_ids)) <> cardinality(v_ids) then perform private.fail('not_found', 'One of those items no longer exists.'); end if;

  -- A seller can change a price at any time, so never charge one the buyer hasn't seen. Older apps don't send this.
  if p ->> 'expectedTotalKobo' is not null and (p ->> 'expectedTotalKobo')::bigint <> v_total then
    perform private.fail('invalid_input', 'A price has just changed. Check the new total.');
  end if;

  select coalesce(sum(cash_kobo), 0), coalesce(sum(credit_kobo), 0) into v_cash, v_credit from public.ledger_entries where user_id = v_uid;
  if v_cash + v_credit < v_total then perform private.fail('insufficient_funds'); end if;
  v_credit := greatest(v_credit, 0);

  for l in select * from public.listings where id = any (v_ids) order by id loop
    v_won := l.status = 'drawn';
    v_qty := private.order_quantity(p, l);
    v_price := v_qty * case when v_won then 0 when l.kind = 'product' then l.price_kobo else l.fallback_price_kobo end;
    insert into public.orders (quantity, listing_id, user_id, merchant_id, price_kobo, fee_kobo, delivery_address, delivery_phone, delivery_lat, delivery_lng,
                               fulfilment, pickup_point_id, is_prize, handled_by, checkout_id)
    values (v_qty, l.id, v_uid, l.merchant_id, v_price, round(v_price * l.fee_bps / 10000.0)::bigint, v_address, v_phone, v_lat, v_lng,
            v_fulfilment, v_point, v_won, case when v_won and l.category <> 'Cars' then 'drawmart' else 'store' end, v_checkout)
    returning id into v_order;
    v_orders := array_append(v_orders, v_order);
    if not v_won then
      v_from_credit := least(v_credit, v_price);
      v_credit := v_credit - v_from_credit;
      insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
      values (v_uid, 'order_payment', -(v_price - v_from_credit), -v_from_credit, 'Bought · ' || l.title || case when v_qty > 1 then ' × ' || v_qty else '' end, l.id);
      -- orders.ts takeStock. The row has been locked since the first loop, so two buyers can't both get the last one.
      update public.listings set stock = stock - v_qty, status = case when stock <= v_qty then 'sold' else status end where id = l.id;
    end if;
  end loop;

  delete from public.cart_items where user_id = v_uid and listing_id = any (v_ids);
  return to_jsonb(v_orders);
end $$;

-- Same as before, remembering the price that was reviewed.
create or replace function public.approve_listing(p_listing_id uuid, p_revision int default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
begin
  perform private.require_admin();
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.status <> 'pending_review' then
    perform private.fail('invalid_input', 'Only listings in review can be approved.');
  end if;
  if p_revision is not null and p_revision <> l.revision then
    perform private.fail('invalid_input', 'The store just changed this listing. Check it again.');
  end if;
  -- A raffle's clock starts when the draw goes live.
  update public.listings
     set reviewed_price_kobo = price_kobo,
         status = case when kind = 'product' then 'for_sale' else 'live' end,
         closes_at = case when kind = 'product' then closes_at else now() + make_interval(days => duration_days) end,
         was_rejected = false
   where id = p_listing_id;
end $$;

-- Same as before, with price reviews.
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
    -- store_new_message: push_for_message sends this one, since it knows the conversation.
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, wiping price reviews too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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
