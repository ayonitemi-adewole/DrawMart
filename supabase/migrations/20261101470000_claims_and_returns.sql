-- A sale's payout waits 48 hours after delivery, so a buyer can report a fault or return
-- an item while DrawMart still holds the money. Sellers can contest a failure they blame on
-- someone else. Rules mirror src/domain/claims.ts.

alter table public.orders
  add column refunded_at timestamptz,
  add column failure_excused boolean not null default false;

alter table public.payouts drop constraint payouts_kind_check;
alter table public.payouts add constraint payouts_kind_check check (kind in ('sale', 'draw', 'caution_fee', 'charge', 'return_fee', 'charge_refund'));

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
  'order_claim_update', 'store_order_claim'
));

-- One per order: a buyer's fault report or change of mind, or a seller contesting a failure.
create table public.order_claims (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  kind text not null check (kind in ('fault', 'change_of_mind', 'contest')),
  status text not null check (status in ('open', 'declined', 'awaiting_pickup', 'returning', 'returned', 'pickup_failed', 'upheld')),
  description text not null default '',
  photos text[] not null default '{}',
  return_address text,
  return_lat double precision,
  return_lng double precision,
  return_phone text,
  return_fee_kobo bigint not null default 0,
  trip_kobo bigint not null default 0,
  seller_share_kobo bigint not null default 0,
  rider_id uuid references public.profiles (id),
  pickup_photos text[],
  return_photo text,
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  picked_up_at timestamptz,
  returned_at timestamptz
);
create index order_claims_open_idx on public.order_claims (status);
alter table public.order_claims enable row level security;
create policy "the buyer, the seller and admins read claims" on public.order_claims for select to authenticated
  using (
    (select private.is_admin())
    or exists (select 1 from public.orders o where o.id = order_id and (o.user_id = (select auth.uid()) or o.merchant_id = (select private.my_merchant_id())))
  );
-- Not the return address or the trip's cost: riders get the address from return_jobs.
revoke all on public.order_claims from anon, authenticated;
grant select (id, order_id, kind, status, description, photos, return_fee_kobo, seller_share_kobo, pickup_photos, review_note, created_at, picked_up_at, returned_at) on public.order_claims to authenticated;

-- Buyers can add photos of a fault, only in their own folder.
do $$
begin
  if to_regclass('storage.objects') is not null then
    create policy "buyers upload claim photos" on storage.objects for insert to authenticated
      with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = 'claims' and (storage.foldername(name))[2] = (select auth.uid())::text);
  end if;
end $$;

-- claims.ts returnFeeKobo. The band goes by what one costs; the fee is on the whole order.
create function private.return_fee_kobo(p_price bigint, p_quantity int) returns bigint
language sql immutable set search_path = ''
as $$
  select floor(p_price * (case when p_price / p_quantity < 10000000 then 30 when p_price / p_quantity < 50000000 then 20 else 10 end) / 100.0)::bigint
$$;

create function public.open_claim(p_order_id uuid, p_kind text, p_description text, p_photos text[], p_address text, p_lat double precision, p_lng double precision, p_phone text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  o public.orders;
  l public.listings;
  m public.merchants;
  v_description text := btrim(coalesce(p_description, ''));
  v_address text := coalesce(nullif(btrim(coalesce(p_address, '')), ''), (select delivery_address from public.orders where id = p_order_id));
  v_lat double precision := coalesce(p_lat, (select delivery_lat from public.orders where id = p_order_id));
  v_lng double precision := coalesce(p_lng, (select delivery_lng from public.orders where id = p_order_id));
  v_phone text := coalesce(nullif(btrim(coalesce(p_phone, '')), ''), (select delivery_phone from public.orders where id = p_order_id));
  v_fee bigint := 0;
  v_trip bigint := 0;
  v_id uuid;
begin
  select * into o from public.orders where id = p_order_id and user_id = v_uid for update;
  if not found then perform private.fail('not_found', 'That order doesn’t exist.'); end if;
  select * into l from public.listings where id = o.listing_id;
  if o.is_prize or l.category = 'Cars' then perform private.fail('invalid_input', 'Won items and cars can’t be returned here. Contact DrawMart.'); end if;
  if o.status <> 'delivered' or o.delivered_at is null or o.delivered_at <= now() - interval '48 hours' then
    perform private.fail('invalid_input', 'You can report a problem or return an item for 48 hours after delivery.');
  end if;
  if exists (select 1 from public.order_claims where order_id = o.id) then perform private.fail('invalid_input', 'You’ve already reported this order.'); end if;
  if p_kind is null or p_kind not in ('fault', 'change_of_mind') then perform private.fail('invalid_input', 'Pick what’s happened.'); end if;
  if p_kind = 'fault' then
    if length(v_description) < 10 then perform private.fail('invalid_input', 'Say what’s wrong, in a few words.'); end if;
    perform private.check_delivery_photos(p_photos);
  end if;
  if length(v_description) > 500 then perform private.fail('invalid_input', 'Keep it to 500 characters.'); end if;
  if length(coalesce(v_address, '')) < 10 or private.location_error(v_lat, v_lng) is not null then perform private.fail('invalid_input', 'Pin where a rider can collect it.'); end if;
  if regexp_replace(coalesce(v_phone, ''), '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then perform private.fail('invalid_input', 'Enter a Nigerian mobile number, e.g. 0803 123 4567.'); end if;

  select * into m from public.merchants where id = o.merchant_id;
  if p_kind = 'change_of_mind' then
    v_fee := private.return_fee_kobo(o.price_kobo, o.quantity);
    v_trip := private.delivery_fee(m.delivery_area, v_lat, v_lng, private.package_size_of(l.package_size, l.category));
  end if;
  insert into public.order_claims (order_id, kind, status, description, photos, return_address, return_lat, return_lng, return_phone, return_fee_kobo, trip_kobo, seller_share_kobo)
  values (o.id, p_kind, case when p_kind = 'fault' then 'open' else 'awaiting_pickup' end, v_description, coalesce(p_photos, '{}'), v_address, v_lat, v_lng, v_phone, v_fee, v_trip, floor(greatest(v_fee - v_trip, 0) / 2.0)::bigint)
  returning id into v_id;
  perform private.notify_shop(o.merchant_id, 'store_order_claim', o.listing_id);
  return v_id;
end $$;

-- For a failed check or refusal the seller thinks is wrong. 7 days. The buyer keeps their refund either way.
create function public.contest_failure(p_order_id uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.require_user();
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.merchant_id is distinct from private.my_merchant_id() then perform private.fail('not_found', 'That order doesn’t exist.'); end if;
  if o.cancel_reason is null or o.cancel_reason not in ('failed_check', 'refused_wrong', 'refused_damaged') or o.cancelled_at <= now() - interval '7 days' then
    perform private.fail('invalid_input', 'You can contest a failed check or a refusal for 7 days.');
  end if;
  if exists (select 1 from public.order_claims where order_id = o.id) then perform private.fail('invalid_input', 'You’ve already contested this.'); end if;
  if length(v_note) < 10 or length(v_note) > 500 then perform private.fail('invalid_input', 'Say what happened, in 10 to 500 characters.'); end if;
  insert into public.order_claims (order_id, kind, status, description) values (o.id, 'contest', 'open', v_note);
end $$;

create function public.open_claims() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'description', c.description, 'photos', to_jsonb(c.photos), 'createdAt', c.created_at,
      'orderId', o.id, 'productCode', l.product_code, 'listingTitle', l.title, 'listingImage', l.images[1], 'priceKobo', o.price_kobo, 'merchantName', m.name,
      'confirmPhoto', o.confirm_photo, 'collectionPhotos', to_jsonb(coalesce(o.collection_photos, '{}')), 'refusalPhoto', o.refusal_photo, 'cancelReason', o.cancel_reason
    ) order by c.created_at)
    from public.order_claims c join public.orders o on o.id = c.order_id join public.listings l on l.id = o.listing_id join public.merchants m on m.id = o.merchant_id
    where c.status = 'open'
  ), '[]'::jsonb);
end $$;

create function public.review_claim(p_claim_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.order_claims;
  o public.orders;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.require_admin();
  select * into c from public.order_claims where id = p_claim_id for update;
  if not found or c.status <> 'open' then perform private.fail('invalid_input', 'That’s already been dealt with.'); end if;
  if not p_approve and length(coalesce(v_note, '')) < 5 then perform private.fail('invalid_input', 'Say why, so they understand.'); end if;
  select * into o from public.orders where id = c.order_id;
  update public.order_claims
     set status = case when not p_approve then 'declined' when c.kind = 'contest' then 'upheld' else 'awaiting_pickup' end, review_note = v_note, reviewed_at = now()
   where id = c.id;
  if c.kind = 'contest' then
    if p_approve then
      update public.orders set failure_excused = true where id = o.id;
      delete from public.payouts where order_id = o.id and kind = 'charge' and status = 'due';
      if not found then
        insert into public.payouts (merchant_id, listing_id, order_id, kind, amount_kobo, status, due_at) values (o.merchant_id, o.listing_id, o.id, 'charge_refund', 250000, 'due', now());
      end if;
    end if;
    perform private.notify_shop(o.merchant_id, 'store_order_claim', o.listing_id);
  else
    insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_claim_update', o.listing_id);
    if not p_approve then perform private.sync_payouts(o.listing_id); end if;
  end if;
end $$;

create function public.return_jobs() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'status', c.status, 'mine', c.rider_id is not null,
      'productCode', l.product_code, 'listingTitle', l.title, 'listingImage', l.images[1], 'quantity', o.quantity, 'category', l.category,
      'returnTo', jsonb_build_object('name', m.name, 'area', m.area) || case when c.rider_id = v_uid and c.status = 'returning' then coalesce((
        select jsonb_build_object('address', sp.address, 'contactPhone', sp.contact_phone, 'location', jsonb_build_object('lat', sp.lat, 'lng', sp.lng)) from public.shop_pickups sp where sp.merchant_id = m.id
      ), '{}'::jsonb) else '{}'::jsonb end,
      'pickupFrom', case when c.rider_id = v_uid and c.status = 'awaiting_pickup' then jsonb_build_object(
        'buyerName', b.display_name, 'address', c.return_address, 'location', jsonb_build_object('lat', c.return_lat, 'lng', c.return_lng), 'contactPhone', c.return_phone) end
    ) order by c.created_at)
    from public.order_claims c
    join public.orders o on o.id = c.order_id join public.listings l on l.id = o.listing_id
    join public.merchants m on m.id = o.merchant_id join public.profiles b on b.id = o.user_id
    where (c.status = 'awaiting_pickup' and c.rider_id is null) or (c.rider_id = v_uid and c.status in ('awaiting_pickup', 'returning'))
  ), '[]'::jsonb);
end $$;

create function public.take_return(p_claim_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  update public.order_claims set rider_id = v_uid where id = p_claim_id and status = 'awaiting_pickup' and rider_id is null;
  if not found then perform private.fail('invalid_input', 'Another rider has taken this return.'); end if;
end $$;

create function public.release_return(p_claim_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_delivery();
begin
  update public.order_claims set rider_id = null where id = p_claim_id and status = 'awaiting_pickup' and rider_id = v_uid;
  if not found then perform private.fail('invalid_input', 'Only returns you haven’t collected can be handed back.'); end if;
end $$;

-- The rider has it, so the buyer is refunded now. claims.ts returnRefundSplit.
create function public.pass_return_pickup(p_claim_id uuid, p_photos text[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  c public.order_claims;
  o public.orders;
  l public.listings;
  p private.order_payments;
  v_cash bigint;
  v_credit bigint;
begin
  perform private.check_delivery_photos(p_photos);
  select * into c from public.order_claims where id = p_claim_id and rider_id = v_uid and status = 'awaiting_pickup' for update;
  if not found then perform private.fail('invalid_input', 'Only returns you’re collecting can be checked.'); end if;
  select * into o from public.orders where id = c.order_id for update;
  select * into l from public.listings where id = o.listing_id;
  select * into p from private.order_payments where order_id = o.id;
  v_cash := coalesce(p.cash_kobo, o.price_kobo);
  v_credit := coalesce(p.credit_kobo, 0);

  update public.order_claims set status = 'returning', pickup_photos = p_photos, picked_up_at = now() where id = c.id;
  update public.orders set refunded_at = now() where id = o.id;
  delete from public.payouts where order_id = o.id and kind = 'sale' and status = 'waiting';
  if c.kind = 'fault' then
    insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
    values (o.user_id, 'order_refund', v_cash + coalesce(p.fee_cash_kobo, 0), v_credit + coalesce(p.fee_credit_kobo, 0), 'Refund · ' || l.title, l.id);
    perform private.penalise_seller(o.id);
  else
    insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
    values (o.user_id, 'order_refund', greatest(v_cash - c.return_fee_kobo, 0), v_credit - greatest(c.return_fee_kobo - v_cash, 0), 'Return · ' || l.title, l.id);
  end if;
  insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_claim_update', l.id);
end $$;

-- Not as described, for instance used when they said it wasn't. Nobody is refunded.
create function public.fail_return_pickup(p_claim_id uuid, p_note text, p_photos text[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  c public.order_claims;
  o public.orders;
  v_note text := btrim(coalesce(p_note, ''));
begin
  select * into c from public.order_claims where id = p_claim_id and rider_id = v_uid and status = 'awaiting_pickup' for update;
  if not found then perform private.fail('invalid_input', 'Only returns you’re collecting can be checked.'); end if;
  if length(v_note) < 5 then perform private.fail('invalid_input', 'Say what’s wrong.'); end if;
  if coalesce(cardinality(p_photos), 0) > 0 then perform private.check_delivery_photos(p_photos); end if;
  select * into o from public.orders where id = c.order_id;
  update public.order_claims set status = 'pickup_failed', review_note = v_note, pickup_photos = p_photos where id = c.id;
  insert into public.notifications (user_id, kind, listing_id) values (o.user_id, 'order_claim_update', o.listing_id);
  perform private.sync_payouts(o.listing_id);
end $$;

-- Back with the seller. An unused item goes back on sale, and the seller gets their share of the fee.
create function public.finish_return(p_claim_id uuid, p_photo text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_delivery();
  c public.order_claims;
  o public.orders;
begin
  perform private.check_delivery_photos(array[p_photo]);
  select * into c from public.order_claims where id = p_claim_id and rider_id = v_uid and status = 'returning' for update;
  if not found then perform private.fail('invalid_input', 'Only returns you’re carrying can be finished.'); end if;
  select * into o from public.orders where id = c.order_id;
  update public.order_claims set status = 'returned', return_photo = p_photo, returned_at = now() where id = c.id;
  if c.kind = 'change_of_mind' then
    update public.listings
       set stock = stock + o.quantity, status = case when status = 'sold' then 'for_sale' else status end
     where id = o.listing_id;
    if c.seller_share_kobo > 0 then
      insert into public.payouts (merchant_id, listing_id, order_id, kind, amount_kobo, status, due_at)
      values (o.merchant_id, o.listing_id, o.id, 'return_fee', c.seller_share_kobo, 'due', now());
    end if;
  end if;
  perform private.notify_shop(o.merchant_id, 'store_order_claim', o.listing_id);
end $$;

-- One order failing can't stop the rest.
create function private.release_sale_payouts() returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    select distinct o.listing_id from public.payouts p join public.orders o on o.id = p.order_id
     where p.kind = 'sale' and p.status = 'waiting' and o.status = 'delivered' and o.delivered_at <= now() - interval '48 hours'
  loop
    begin
      perform private.sync_payouts(r.listing_id);
    exception when others then
      raise warning 'release_sale_payouts %: %', r.listing_id, sqlerrm;
    end;
  end loop;
end $$;

revoke execute on function private.return_fee_kobo(bigint, int), private.release_sale_payouts() from public, anon, authenticated;
revoke all on function public.open_claim(uuid, text, text, text[], text, double precision, double precision, text), public.contest_failure(uuid, text), public.open_claims(), public.review_claim(uuid, boolean, text), public.return_jobs(), public.take_return(uuid), public.release_return(uuid), public.pass_return_pickup(uuid, text[]), public.fail_return_pickup(uuid, text, text[]), public.finish_return(uuid, text) from public, anon;
grant execute on function public.open_claim(uuid, text, text, text[], text, double precision, double precision, text), public.contest_failure(uuid, text), public.open_claims(), public.review_claim(uuid, boolean, text), public.return_jobs(), public.take_return(uuid), public.release_return(uuid), public.pass_return_pickup(uuid, text[]), public.fail_return_pickup(uuid, text, text[]), public.finish_return(uuid, text) to authenticated;

-- Same as before: the wait, and nothing for a refunded order.
create or replace function private.sync_payouts(p_listing uuid) returns void
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

  for o in select * from public.orders where listing_id = p_listing and not is_prize and status <> 'cancelled' and refunded_at is null loop
    insert into public.payouts (merchant_id, listing_id, order_id, kind, amount_kobo)
    select o.merchant_id, o.listing_id, o.id, 'sale', o.price_kobo - o.fee_kobo
     where o.price_kobo - o.fee_kobo > 0
    on conflict (order_id) where kind = 'sale' do nothing;
    -- claims.ts: a sale waits out the claim window, and any claim still being dealt with.
    if o.status = 'delivered' and coalesce(o.delivered_at, now() - interval '48 hours') <= now() - interval '48 hours'
       and not exists (select 1 from public.order_claims c where c.order_id = o.id and c.status in ('open', 'awaiting_pickup', 'returning')) then
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

-- Same as before: a refunded order isn't a sale.
create or replace function public.merchant_metrics(p_days int) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_merchant uuid := private.my_merchant_id();
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_from date;
begin
  if v_merchant is null then perform private.fail('forbidden', 'Only sellers have insights.'); end if;
  if p_days not in (7, 30) then perform private.fail('invalid_input', 'Pick 7 or 30 days.'); end if;
  v_from := v_today - (p_days - 1);

  return jsonb_build_object(
    'listings', coalesce((
      select jsonb_agg(x order by x."views" desc, x."createdAt" desc)
      from (
        select
          l.id as "listingId", l.product_code as "productCode", l.title, l.images[1] as image, l.category, l.kind, l.status, l.created_at as "createdAt",
          (select count(*) from public.listing_views v where v.listing_id = l.id and v.day >= v_from)::int as views,
          (select count(distinct v.visitor) from public.listing_views v where v.listing_id = l.id and v.day >= v_from)::int as visitors,
          (select count(*) from public.conversations c where c.listing_id = l.id and (c.created_at at time zone 'Africa/Lagos')::date >= v_from)::int as chats,
          -- A raffle that ended unsold can still sell at a fixed price, so add both.
          coalesce(t.units, 0) + o.units as units,
          coalesce(t.buyers, 0) + o.buyers as buyers,
          coalesce(t.sales, 0) + o.sales as "salesKobo"
        from public.listings l
        left join lateral (
          select count(*)::int as units,
                 count(distinct coalesce(tk.user_id::text, tk.purchase_ref))::int as buyers,
                 (count(*) * l.buyer_ticket_price_kobo)::bigint as sales
            from public.tickets tk
           where tk.listing_id = l.id and l.kind = 'raffle' and l.status in ('live', 'sold_out', 'drawn')
             and (tk.purchased_at at time zone 'Africa/Lagos')::date >= v_from
        ) t on l.kind = 'raffle'
        left join lateral (
          select coalesce(sum(od.quantity), 0)::int as units, count(distinct od.user_id)::int as buyers, coalesce(sum(od.price_kobo), 0)::bigint as sales
            from public.orders od
           where od.listing_id = l.id and not od.is_prize and od.status <> 'cancelled' and od.refunded_at is null and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
        ) o on true
        where l.merchant_id = v_merchant and l.status not in ('rejected', 'withdrawn')
      ) x
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'views', d.views, 'salesKobo', d.sales) order by d.day)
      from (
        select day, sum(views)::int as views, sum(sales)::bigint as sales
        from (
          select v.day, count(*) as views, 0::bigint as sales
            from public.listing_views v join public.listings l on l.id = v.listing_id
           where l.merchant_id = v_merchant and v.day >= v_from
           group by v.day
          union all
          select (tk.purchased_at at time zone 'Africa/Lagos')::date, 0, sum(l.buyer_ticket_price_kobo)
            from public.tickets tk join public.listings l on l.id = tk.listing_id
           where l.merchant_id = v_merchant and l.kind = 'raffle' and l.status in ('live', 'sold_out', 'drawn')
             and (tk.purchased_at at time zone 'Africa/Lagos')::date >= v_from
           group by 1
          union all
          select (od.created_at at time zone 'Africa/Lagos')::date, 0, sum(od.price_kobo)
            from public.orders od
           where od.merchant_id = v_merchant and od.status <> 'cancelled' and od.refunded_at is null and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
           group by 1
        ) u
        group by day
      ) d
    ), '[]'::jsonb)
  );
end $$;

-- Same as before: approved faults count, and excused failures don't.
create or replace function private.penalise_seller(p_order uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  insert into public.payouts (merchant_id, listing_id, order_id, kind, amount_kobo, status, due_at)
  values (o.merchant_id, o.listing_id, o.id, 'charge', -250000, 'due', now());
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  values (o.user_id, 'store_credit', 0, 50000, 'Sorry about your order', o.listing_id);
  perform private.notify_shop(o.merchant_id, 'store_order_failed', o.listing_id);

  if (select count(*) from public.orders x
       where x.merchant_id = o.merchant_id and not x.failure_excused
         and ((x.cancel_reason in ('failed_check', 'refused_wrong', 'refused_damaged') and x.cancelled_at >= now() - interval '30 days')
              or exists (select 1 from public.order_claims c where c.order_id = x.id and c.kind = 'fault' and c.picked_up_at >= now() - interval '30 days'))) >= 3
     and exists (select 1 from public.merchants where id = o.merchant_id and suspended_at is null) then
    update public.merchants set suspended_at = now() where id = o.merchant_id;
    update public.listings set status = 'paused' where merchant_id = o.merchant_id and kind = 'product' and status = 'for_sale';
    perform private.notify_shop(o.merchant_id, 'store_suspended', null);
  end if;
end $$;

-- Same as before, releasing sale payouts when their wait is over.
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
  perform private.order_confirm_deadlines();
  perform private.release_sale_payouts();

  return n;
end $$;

-- Same as before, with claims and returns.
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
    -- store_new_message: push_for_message sends this one, since it knows the conversation.
    else null;
  end case;
  return null;
exception when others then
  raise warning 'push_for_notification: %', sqlerrm;
  return null;
end $$;

-- Same as before, wiping claims too.
create or replace function public.reset_test_data() returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.app_settings := private.settings();
begin
  perform private.require_admin();
  if not s.test_mode then perform private.fail('forbidden', 'Test data can only be reset while test mode is on.'); end if;

  -- No CASCADE: if a new table points at these, this fails instead of quietly emptying it.
  truncate public.order_claims, private.order_payments, public.price_reviews, private.payout_account_history, private.bank_lookups, public.payouts, public.payout_accounts, public.messages, public.conversations, public.merchant_contacts, private.order_pins, public.orders, public.boosts,
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
