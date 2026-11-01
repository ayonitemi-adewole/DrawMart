-- Stores can edit a listing while it's in review, or withdraw it, up to the pickup or
-- inspection day. Rules mirror src/domain/listingActions.ts. A withdrawn listing stays
-- on the store's own list, but like rejected ones it's never public: the listings
-- policy only opens the statuses buyers may see, so it needs no change.

alter table public.listings
  drop constraint listings_status_check,
  add constraint listings_status_check
    check (status in ('pending_review', 'live', 'sold_out', 'drawn', 'refunded', 'for_sale', 'sold', 'rejected', 'withdrawn')),
  -- Counts changes in review, so an admin can't approve a version they haven't seen.
  add column revision int not null default 0,
  -- Rejected since it was last approved: withdrawing then doesn't get the fee back.
  -- Cleared on approval, so buyers never see it set.
  add column was_rejected boolean not null default false;

update public.listings set was_rejected = true where status = 'rejected';

create function private.can_change_in_review(l public.listings) returns boolean
language sql stable security definer set search_path = ''
as $$
  select l.status = 'pending_review' and (
    l.kind = 'product'
    or not exists (
      select 1 from public.listing_handovers h
       where h.listing_id = l.id and h.date <= (now() at time zone 'Africa/Lagos')::date
    )
  )
$$;

-- Checks new details like create_listing and create_product, then saves them.
-- Callers lock the row and set the status themselves.
create function private.set_listing_details(l public.listings, p jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_errors text[] := '{}';
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_description text := btrim(coalesce(p ->> 'description', ''));
  v_category text := p ->> 'category';
  v_price bigint := (p ->> 'priceKobo')::bigint;
  v_ticket bigint := (p ->> 'ticketPriceKobo')::bigint;
  v_fee_mode text := p ->> 'feeMode';
  v_fee_bps int;
  v_duration int := (p ->> 'durationDays')::int;
  v_unsold text := p ->> 'unsoldPolicy';
  v_fallback bigint := nullif(p ->> 'fallbackPriceKobo', '')::bigint;
  v_images text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'images', '[]'::jsonb))), '{}');
  h jsonb := coalesce(p -> 'handover', '{}'::jsonb);
  v_address text := btrim(coalesce(h ->> 'address', ''));
  v_phone text := coalesce(h ->> 'contactPhone', '');
  v_date date;
  v_slot text := h ->> 'slot';
  v_lat double precision;
  v_lng double precision;
  v_pin_error text;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_ticket_count int;
  v_buyer_bps numeric;
  v_buyer_ticket bigint;
  v_fee bigint;
begin
  if v_category is null or v_category not in ('Phones', 'Electronics', 'Home', 'Cars', 'Fashion') then v_errors := array_append(v_errors, 'Pick a category.'); end if;
  if cardinality(v_images) > 4 or exists (select 1 from unnest(v_images) u where u !~ '^(https://|/assets/)') then
    v_errors := array_append(v_errors, 'Upload up to 4 photos.');
  end if;
  if v_title = '' then v_errors := array_append(v_errors, 'Give the item a name.'); end if;


  if l.kind = 'product' then
    if v_price is null or v_price < 10000 then v_errors := array_append(v_errors, 'Set a price of at least ₦100.'); end if;
    if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

    update public.listings
       set title = v_title, description = v_description, category = v_category, images = v_images, price_kobo = v_price,
           fee_bps = private.platform_fee_bps(v_price), closes_at = now()
     where id = l.id;
    return;
  end if;

  begin v_date := (h ->> 'date')::date; exception when others then v_date := null; end;
  begin
    v_lat := (h -> 'location' ->> 'lat')::double precision;
    v_lng := (h -> 'location' ->> 'lng')::double precision;
  exception when others then
    v_lat := null;
  end;
  v_pin_error := private.location_error(v_lat, v_lng);

  -- fees.ts validateListingEconomics
  if v_price is null or v_price <= 0 then v_errors := array_append(v_errors, 'Enter your price.'); end if;
  if v_ticket is null or v_ticket < 10000 then v_errors := array_append(v_errors, 'Tickets must cost at least ₦100.'); end if;
  if v_price > 0 and v_ticket > v_price then v_errors := array_append(v_errors, 'A ticket can’t cost more than the item.'); end if;
  if v_price > 0 and v_ticket > 0 and (v_price + v_ticket - 1) / v_ticket > 10000 then
    v_errors := array_append(v_errors, 'That would need more than 10,000 tickets. Raise the ticket price.');
  end if;
  if v_fee_mode is null or v_fee_mode not in ('seller', 'buyer', 'split') then v_errors := array_append(v_errors, 'Pick who pays the fee.'); end if;
  -- listing.ts validateListingTerms
  if v_duration is null or v_duration not between 3 and 60 then v_errors := array_append(v_errors, 'Pick a deadline between 3 and 60 days.'); end if;
  if v_unsold is null or v_unsold not in ('refund', 'extend_once', 'convert_to_sale') then v_errors := array_append(v_errors, 'Pick what happens if it doesn’t sell out.'); end if;
  if v_unsold = 'convert_to_sale' and not coalesce(v_fallback > 0, false) then
    v_errors := array_append(v_errors, 'Enter the price you’ll sell it for if the draw doesn’t sell out.');
  end if;
  -- listing.ts validateHandover
  if length(v_address) < 10 then v_errors := array_append(v_errors, 'Enter the full address, with street and area.'); end if;
  if v_pin_error is not null then v_errors := array_append(v_errors, v_pin_error); end if;
  if regexp_replace(v_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  if v_date is null or v_date < v_today + 1 or v_date > v_today + 14 then
    v_errors := array_append(v_errors, 'Pick a date between tomorrow and 14 days from now.');
  end if;
  if v_slot is null or v_slot not in ('morning', 'afternoon') then v_errors := array_append(v_errors, 'Pick a time slot.'); end if;
  -- listing.ts validatePickup
  if l.pickup_batch_id is not null and v_category = 'Cars' then
    v_errors := array_append(v_errors, 'Cars are inspected where they are, so they can’t share a pickup. List them on their own.');
  end if;

  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  v_fee_bps := private.platform_fee_bps(v_price);
  -- fees.ts computeListingEconomics
  v_ticket_count := (v_price + v_ticket - 1) / v_ticket;
  v_buyer_bps := case v_fee_mode when 'buyer' then v_fee_bps when 'split' then v_fee_bps / 2.0 else 0 end;
  v_buyer_ticket := v_ticket + round(v_ticket * v_buyer_bps / 10000.0)::bigint;
  -- rejection.ts resentCautionFee
  v_fee := greatest(l.caution_fee_kobo, (select amount_kobo from public.caution_fees where category = v_category));

  -- Every item in a shared pickup shows the same fee.
  if l.pickup_batch_id is not null then
    update public.listings set caution_fee_kobo = v_fee where pickup_batch_id = l.pickup_batch_id;
  end if;

  update public.listings
     set title = v_title, description = v_description, category = v_category, images = v_images,
         price_kobo = v_price, ticket_price_kobo = v_ticket, buyer_ticket_price_kobo = v_buyer_ticket,
         ticket_count = v_ticket_count, fee_mode = v_fee_mode, fee_bps = v_fee_bps,
         unsold_policy = v_unsold, fallback_price_kobo = case when v_unsold = 'convert_to_sale' then v_fallback end,
         duration_days = v_duration, closes_at = now() + make_interval(days => v_duration),
         caution_fee_kobo = v_fee
   where id = l.id;

  insert into public.listing_handovers (listing_id, method, address, contact_phone, date, slot, lat, lng)
  values (l.id, case when v_category = 'Cars' then 'inspection' else 'pickup' end, v_address, v_phone, v_date, v_slot, v_lat, v_lng)
  on conflict (listing_id) do update
    set method = excluded.method, address = excluded.address, contact_phone = excluded.contact_phone,
        date = excluded.date, slot = excluded.slot, lat = excluded.lat, lng = excluded.lng;
end $$;

-- This store's own listing, locked.
create function private.my_listing_for_update(p_listing_id uuid) returns public.listings
language plpgsql security definer set search_path = ''
as $$
declare
  v_merchant public.merchants;
  l public.listings;
begin
  perform private.require_user();
  select m.* into v_merchant from public.merchants m where m.id = private.my_merchant_id();
  if not found then perform private.fail('forbidden', 'This account isn’t linked to a store.'); end if;
  if not v_merchant.verified then perform private.fail('forbidden', 'Your store hasn’t been verified yet.'); end if;
  select * into l from public.listings where id = p_listing_id and merchant_id = v_merchant.id for update;
  if not found then perform private.fail('not_found', 'That listing doesn’t exist.'); end if;
  return l;
end $$;

create function public.update_listing(p_listing_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings := private.my_listing_for_update(p_listing_id);
begin
  if l.status <> 'pending_review' then perform private.fail('invalid_input', 'Only listings in review can be edited.'); end if;
  if not private.can_change_in_review(l) then
    perform private.fail('invalid_input', 'Your pickup or inspection day has arrived, so this can’t be changed now.');
  end if;
  perform private.set_listing_details(l, p);
  update public.listings set revision = revision + 1 where id = l.id;
end $$;

-- As before, now sharing its checks with update_listing.
create or replace function public.resubmit_listing(p_listing_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings := private.my_listing_for_update(p_listing_id);
begin
  if l.status <> 'rejected' then perform private.fail('invalid_input', 'Only rejected listings can be sent again.'); end if;
  perform private.set_listing_details(l, p);
  -- For a shared pickup, the settle_pickup_fee trigger then has the last word on the fee's status.
  update public.listings
     set status = 'pending_review',
         caution_fee_status = case when kind = 'raffle' then 'held' else caution_fee_status end,
         rejection_reason = null, rejection_note = null, revision = revision + 1
   where id = l.id;
end $$;

-- listingActions.ts withdrawalFees. The item leaves its shared pickup, so its row only
-- shows what it got back and the items left show the pickup's fee without it.
create function public.withdraw_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings := private.my_listing_for_update(p_listing_id);
  v_left int := 0;
  v_highest bigint;
  v_remaining bigint;
  v_kobo bigint := l.caution_fee_kobo;
  v_status text := l.caution_fee_status;
begin
  if l.status <> 'pending_review' then perform private.fail('invalid_input', 'Only listings in review can be withdrawn.'); end if;
  if not private.can_change_in_review(l) then
    perform private.fail('invalid_input', 'Your pickup or inspection day has arrived, so this can’t be withdrawn now.');
  end if;

  if l.pickup_batch_id is not null then
    perform 1 from public.listings where pickup_batch_id = l.pickup_batch_id and id <> l.id order by id for update;
    select count(*), max(f.amount_kobo) into v_left, v_highest
      from public.listings m join public.caution_fees f on f.category = m.category
     where m.pickup_batch_id = l.pickup_batch_id and m.id <> l.id;
  end if;

  if l.caution_fee_status = 'none' then
    null;
  elsif v_left = 0 then
    v_status := case when l.was_rejected or l.caution_fee_status = 'kept' then 'kept' else 'refunded' end;
  elsif l.was_rejected or l.caution_fee_status <> 'held' then
    v_kobo := 0;
    v_status := 'none';
  else
    v_remaining := least(l.caution_fee_kobo, v_highest);
    v_kobo := l.caution_fee_kobo - v_remaining;
    v_status := case when v_kobo > 0 then 'refunded' else 'none' end;
    update public.listings set caution_fee_kobo = v_remaining where pickup_batch_id = l.pickup_batch_id and id <> l.id;
  end if;

  update public.listings
     set status = 'withdrawn', pickup_batch_id = null, caution_fee_kobo = v_kobo, caution_fee_status = v_status
   where id = l.id;
end $$;

-- Now also remembers the rejection, for withdraw_listing.
create or replace function public.reject_listing(p_listing_id uuid, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.require_admin();
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.status <> 'pending_review' then
    perform private.fail('invalid_input', 'Only listings in review can be rejected.');
  end if;
  if p_reason is null or p_reason not in ('photos_unclear', 'price_wrong', 'item_not_allowed', 'failed_escrow_check', 'other')
     or (p_reason = 'failed_escrow_check' and l.kind = 'product') then
    perform private.fail('invalid_input', 'Pick a reason.');
  end if;
  if length(coalesce(v_note, '')) > 300 then perform private.fail('invalid_input', 'Keep the note to 300 characters.'); end if;
  if p_reason = 'other' and length(coalesce(v_note, '')) < 5 then
    perform private.fail('invalid_input', 'Say what’s wrong, so the store can fix it.');
  end if;

  update public.listings
     set status = 'rejected',
         rejection_reason = p_reason,
         rejection_note = v_note,
         was_rejected = true,
         caution_fee_status = case when caution_fee_status = 'held' then 'kept' else caution_fee_status end
   where id = p_listing_id;
end $$;

-- p_revision is the version the admin was looking at. Null skips the check.
drop function public.approve_listing(uuid);

create function public.approve_listing(p_listing_id uuid, p_revision int default null) returns void
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
     set status = case when kind = 'product' then 'for_sale' else 'live' end,
         closes_at = case when kind = 'product' then closes_at else now() + make_interval(days => duration_days) end,
         was_rejected = false
   where id = p_listing_id;
end $$;

-- Withdrawn listings don't belong in a store's insights.
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
          select count(*)::int as units, count(distinct od.user_id)::int as buyers, coalesce(sum(od.price_kobo), 0)::bigint as sales
            from public.orders od
           where od.listing_id = l.id and not od.is_prize and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
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
           where od.merchant_id = v_merchant and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
           group by 1
        ) u
        group by day
      ) d
    ), '[]'::jsonb)
  );
end $$;

revoke all on function
  public.update_listing(uuid, jsonb),
  public.withdraw_listing(uuid),
  public.approve_listing(uuid, int)
from public, anon;
grant execute on function
  public.update_listing(uuid, jsonb),
  public.withdraw_listing(uuid),
  public.approve_listing(uuid, int)
to authenticated;
