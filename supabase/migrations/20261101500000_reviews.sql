-- After delivery, a buyer rates the seller from 1 to 5 stars and can say something about
-- the seller and the product. The seller can reply once; admins can hide abusive reviews.
-- A shop's rating only shows once it has 5. Won items aren't reviewed: DrawMart delivers
-- them. Rules mirror src/domain/reviews.ts.

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
  'store_new_review', 'review_reply'
));

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  seller_comment text not null default '' check (length(seller_comment) <= 500),
  product_comment text not null default '' check (length(product_comment) <= 500),
  reply text check (length(reply) <= 500),
  replied_at timestamptz,
  hidden_at timestamptz,
  hidden_reason text check (length(hidden_reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reviews_merchant_idx on public.reviews (merchant_id, created_at desc);
create index reviews_listing_idx on public.reviews (listing_id);
alter table public.reviews enable row level security;

-- The buyer's own, on their orders; the shop's, on its orders. Everyone else reads them
-- through shop_reviews, which gives a first name and never an account.
create policy "the buyer, the shop and admins read reviews" on public.reviews for select to authenticated
  using (user_id = (select auth.uid()) or merchant_id = (select private.my_merchant_id()) or (select private.is_admin()));
grant select (id, order_id, merchant_id, listing_id, rating, seller_comment, product_comment, reply, replied_at, hidden_at, created_at, updated_at) on public.reviews to authenticated;

-- reviews.ts reviewerName.
create function private.reviewer_name(p_display_name text) returns text
language sql immutable set search_path = ''
as $$
  select case when w = '' or w ~ '[@0-9]' then 'A buyer' else upper(left(w, 1)) || substr(left(w, 20), 2) end
  from (select split_part(regexp_replace(btrim(coalesce(p_display_name, '')), '[[:space:]._]+', ' ', 'g'), ' ', 1) w) x
$$;

-- reviews.ts canReview and reviewError. Changes are allowed until the seller replies.
create function public.submit_review(p_order_id uuid, p_rating int, p_seller_comment text, p_product_comment text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  o public.orders;
  r public.reviews;
  v_seller text := btrim(coalesce(p_seller_comment, ''));
  v_product text := btrim(coalesce(p_product_comment, ''));
  v_id uuid;
begin
  select * into o from public.orders where id = p_order_id and user_id = v_uid;
  if not found then perform private.fail('not_found', 'That order doesn’t exist.'); end if;
  if o.is_prize then perform private.fail('invalid_input', 'Won items are delivered by DrawMart, so they aren’t reviewed here.'); end if;
  if o.status <> 'delivered' or o.delivered_at is null then perform private.fail('invalid_input', 'You can review an order once it’s delivered.'); end if;
  if o.delivered_at <= now() - interval '30 days' then perform private.fail('invalid_input', 'Reviews close 30 days after delivery.'); end if;
  if p_rating is null or p_rating not between 1 and 5 then perform private.fail('invalid_input', 'Pick a rating from 1 to 5 stars.'); end if;
  if length(v_seller) > 500 or length(v_product) > 500 then perform private.fail('invalid_input', 'Keep each comment to 500 characters.'); end if;

  select * into r from public.reviews where order_id = o.id for update;
  if found then
    if r.reply is not null then perform private.fail('invalid_input', 'The seller has replied, so this review can’t be changed.'); end if;
    if r.hidden_at is not null then perform private.fail('invalid_input', 'DrawMart has hidden this review, so it can’t be changed.'); end if;
    update public.reviews set rating = p_rating, seller_comment = v_seller, product_comment = v_product, updated_at = now() where id = r.id;
    return r.id;
  end if;
  insert into public.reviews (order_id, user_id, merchant_id, listing_id, rating, seller_comment, product_comment)
  values (o.id, v_uid, o.merchant_id, o.listing_id, p_rating, v_seller, v_product)
  returning id into v_id;
  perform private.notify_shop(o.merchant_id, 'store_new_review', o.listing_id);
  return v_id;
end $$;

-- Once, and it can't be changed.
create function public.reply_to_review(p_review_id uuid, p_reply text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.reviews;
  v_reply text := btrim(coalesce(p_reply, ''));
begin
  perform private.require_user();
  select * into r from public.reviews where id = p_review_id and merchant_id = private.my_merchant_id() for update;
  if not found then perform private.fail('not_found', 'That review doesn’t exist.'); end if;
  if r.reply is not null then perform private.fail('invalid_input', 'You’ve already replied to this review.'); end if;
  if r.hidden_at is not null then perform private.fail('invalid_input', 'DrawMart has hidden this review.'); end if;
  if v_reply = '' then perform private.fail('invalid_input', 'Write a reply.'); end if;
  if length(v_reply) > 500 then perform private.fail('invalid_input', 'Keep it to 500 characters.'); end if;
  update public.reviews set reply = v_reply, replied_at = now() where id = r.id;
  insert into public.notifications (user_id, kind, listing_id) values (r.user_id, 'review_reply', r.listing_id);
end $$;

create function public.set_review_hidden(p_review_id uuid, p_hidden boolean, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_admin();
  if p_hidden and length(v_reason) < 3 then perform private.fail('invalid_input', 'Say why it’s hidden.'); end if;
  if length(v_reason) > 200 then perform private.fail('invalid_input', 'Keep it to 200 characters.'); end if;
  update public.reviews
     set hidden_at = case when p_hidden then coalesce(hidden_at, now()) end,
         hidden_reason = case when p_hidden then v_reason end
   where id = p_review_id;
  if not found then perform private.fail('not_found', 'That review doesn’t exist.'); end if;
end $$;

-- One review as anyone may see it. Named fields: never the account.
create function private.review_json(r public.reviews) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'rating', r.rating, 'sellerComment', r.seller_comment, 'productComment', r.product_comment,
    'reply', r.reply, 'repliedAt', r.replied_at, 'createdAt', r.created_at, 'hidden', r.hidden_at is not null,
    'name', private.reviewer_name((select display_name from public.profiles where id = r.user_id)),
    'listingId', r.listing_id, 'listingTitle', l.title, 'productCode', l.product_code)
  from public.listings l where l.id = r.listing_id
$$;

-- A shop's rating and its latest reviews, or one listing's. Public, but nothing shows until
-- the shop has 5, except to the shop itself and admins, who also see hidden ones.
create function public.shop_reviews(p_merchant uuid, p_listing uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_insider boolean := coalesce(private.is_admin() or p_merchant = private.my_merchant_id(), false);
  v_count int;
  v_avg numeric;
  v_open boolean;
begin
  select count(*), round(avg(rating), 1) into v_count, v_avg from public.reviews where merchant_id = p_merchant and hidden_at is null;
  v_open := v_count >= 5 or v_insider;
  return jsonb_build_object(
    'count', v_count,
    'shown', v_count >= 5,
    'average', case when v_open then v_avg end,
    'breakdown', case when v_open then (
      select jsonb_agg((select count(*) from public.reviews where merchant_id = p_merchant and hidden_at is null and rating = s) order by s desc) from generate_series(1, 5) s
    ) end,
    'listingCount', case when p_listing is not null then (select count(*) from public.reviews where listing_id = p_listing and merchant_id = p_merchant and hidden_at is null) end,
    'reviews', case when v_open then coalesce((
      select jsonb_agg(private.review_json(x) order by x.created_at desc) from (
        select * from public.reviews r
         where r.merchant_id = p_merchant and (p_listing is null or r.listing_id = p_listing) and (r.hidden_at is null or v_insider)
         order by r.created_at desc limit 50
      ) x
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;

create function public.admin_reviews() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(private.review_json(x) || jsonb_build_object('merchantName', m.name, 'hiddenReason', x.hidden_reason) order by x.created_at desc)
    from (select * from public.reviews order by created_at desc limit 200) x join public.merchants m on m.id = x.merchant_id
  ), '[]'::jsonb);
end $$;

revoke all on function private.reviewer_name(text), private.review_json(public.reviews) from public, anon, authenticated;
revoke all on function public.submit_review(uuid, int, text, text), public.reply_to_review(uuid, text), public.set_review_hidden(uuid, boolean, text), public.admin_reviews() from public, anon;
grant execute on function public.submit_review(uuid, int, text, text), public.reply_to_review(uuid, text), public.set_review_hidden(uuid, boolean, text), public.admin_reviews() to authenticated;
grant execute on function public.shop_reviews(uuid, uuid) to anon, authenticated;

-- Same as before, with the two review notifications.
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
    -- store_new_message: push_for_message sends this one, since it knows the conversation.
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, wiping reviews too.
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
