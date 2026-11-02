-- Bulk product upload for stores: up to 100 products from a spreadsheet, created in one
-- go, all or nothing. Spot checks still apply: some rows are picked, aren't created, and are
-- owed: the store's next listings need a video until they're done. Stores only, once they're
-- past the listings that always need a video. Rules mirror src/domain/bulkUpload.ts.

create table private.owed_checks (
  merchant_id uuid primary key references public.merchants (id) on delete cascade,
  owed int not null check (owed > 0)
);
alter table private.owed_checks enable row level security;
revoke all on private.owed_checks from public, anon, authenticated;

-- Same as before, and while spot checks from a bulk upload are owed.
create or replace function private.video_required(m public.merchants) returns boolean
language sql stable security definer set search_path = ''
as $$
  select m.kind = 'individual'
      or (select count(*) from public.listings where merchant_id = m.id and kind = 'product') < (private.settings()).check_first_listings
      or coalesce((select video_required from private.listing_check_tickets where merchant_id = m.id), false)
      or exists (select 1 from private.owed_checks where merchant_id = m.id)
$$;

-- Same as before, and a listing with a video pays off one owed check.
create or replace function private.record_listing_proof(p_listing uuid, p_merchant uuid, c jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.listing_checks (listing_id, code, video_path, serial, proof_path)
  values (p_listing, c ->> 'code', nullif(c ->> 'videoPath', ''), nullif(btrim(coalesce(c ->> 'serial', '')), ''), nullif(c ->> 'proofPath', ''));
  delete from private.listing_check_tickets where merchant_id = p_merchant;
  if nullif(c ->> 'videoPath', '') is not null then
    delete from private.owed_checks where merchant_id = p_merchant and owed = 1;
    update private.owed_checks set owed = owed - 1 where merchant_id = p_merchant;
  end if;
end $$;

create function public.create_products_bulk(p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m public.merchants;
  v_items jsonb := coalesce(p -> 'items', '[]'::jsonb);
  v_n int := jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb));
  v_spot int := (private.settings()).spot_check_percent;
  v_picked int[] := '{}';
  v_titles text[] := '{}';
  v_errors text[] := '{}';
  v_detail text;
  v_created int := 0;
begin
  perform private.require_user();
  select * into m from public.merchants where id = private.my_merchant_id() for update;
  if not found or m.kind <> 'store' then perform private.fail('forbidden', 'Bulk upload is for stores. Add your items one at a time.'); end if;
  if v_n = 0 then perform private.fail('invalid_input', 'Add at least one product.'); end if;
  if v_n > 100 then perform private.fail('invalid_input', 'Upload up to 100 products at a time.'); end if;
  if private.video_required(m) then
    perform private.fail('invalid_input', 'Your next listing needs a short video. Add it with the form, then upload the rest.');
  end if;

  -- Decided here, so the store can't tell in advance which rows will be picked.
  for i in 0 .. v_n - 1 loop
    if random() * 100 < v_spot then
      v_picked := array_append(v_picked, i);
      v_titles := array_append(v_titles, btrim(coalesce(v_items -> i ->> 'title', '')));
    end if;
  end loop;

  -- The same checks as one at a time. Collect every row's problems, then undo everything if there are any.
  for i in 0 .. v_n - 1 loop
    continue when i = any (v_picked);
    begin
      perform public.create_product(v_items -> i);
      v_created := v_created + 1;
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      v_errors := array_append(v_errors, 'Row ' || (i + 2) || ': ' || coalesce(nullif(v_detail, ''), sqlerrm));
    end;
  end loop;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  if cardinality(v_picked) > 0 then
    insert into private.owed_checks (merchant_id, owed) values (m.id, cardinality(v_picked))
    on conflict (merchant_id) do update set owed = private.owed_checks.owed + excluded.owed;
  end if;
  return jsonb_build_object('created', v_created, 'checkTitles', to_jsonb(v_titles));
end $$;

revoke all on function public.create_products_bulk(jsonb) from public, anon;
grant execute on function public.create_products_bulk(jsonb) to authenticated;

-- Same as before, wiping owed checks too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate private.owed_checks, private.discount_redemptions, public.discount_listings, public.discounts, public.quick_replies, public.support_messages, public.support_threads, public.reviews, public.listing_checks, private.listing_check_tickets, public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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
