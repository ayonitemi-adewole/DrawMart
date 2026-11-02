-- Quick replies: answers a seller saves and drops into a buyer chat with a tap.
-- Only the shop itself reads them. Rules mirror src/domain/quickReplies.ts.

create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index quick_replies_merchant_idx on public.quick_replies (merchant_id, created_at);

alter table public.quick_replies enable row level security;
create policy "the shop reads its quick replies" on public.quick_replies for select to authenticated
  using (merchant_id = (select private.my_merchant_id()));
revoke all on public.quick_replies from anon, authenticated;
grant select (id, body, created_at) on public.quick_replies to authenticated;

-- A new one without an id; changes one with it. quickReplies.ts quickReplyError.
create function public.save_quick_reply(p_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_shop uuid := private.my_merchant_id();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  perform private.require_user();
  if v_shop is null then perform private.fail('forbidden', 'Only sellers have quick replies.'); end if;
  if v_body = '' then perform private.fail('invalid_input', 'Write the reply first.'); end if;
  if length(v_body) > 500 then perform private.fail('invalid_input', 'Keep it to 500 characters.'); end if;
  if p_id is not null then
    update public.quick_replies set body = v_body where id = p_id and merchant_id = v_shop returning id into v_id;
    if v_id is null then perform private.fail('not_found', 'That reply doesn’t exist.'); end if;
    return v_id;
  end if;
  perform 1 from public.merchants where id = v_shop for update; -- one at a time, so the count holds
  if (select count(*) from public.quick_replies where merchant_id = v_shop) >= 20 then
    perform private.fail('invalid_input', 'You can save up to 20. Delete one first.');
  end if;
  insert into public.quick_replies (merchant_id, body) values (v_shop, v_body) returning id into v_id;
  return v_id;
end $$;

create function public.delete_quick_reply(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_user();
  delete from public.quick_replies where id = p_id and merchant_id = private.my_merchant_id();
  if not found then perform private.fail('not_found', 'That reply doesn’t exist.'); end if;
end $$;

revoke all on function public.save_quick_reply(uuid, text), public.delete_quick_reply(uuid) from public, anon;
grant execute on function public.save_quick_reply(uuid, text), public.delete_quick_reply(uuid) to authenticated;

-- Same as before, wiping quick replies too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.quick_replies, public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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
