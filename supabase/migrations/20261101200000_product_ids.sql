-- Every product gets a short, permanent ID people can read out, type and search
-- for: PRD-7K3Q9X. listings.id stays the internal key. domain/productCode.ts.

create function private.new_product_code() returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  -- No 0, O, 1, I or L, which get mixed up when read aloud or typed from a label.
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(6);
    v_code := 'PRD-';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, 1 + get_byte(v_bytes, i) % length(v_alphabet), 1);
    end loop;
    exit when not exists (select 1 from public.listings where product_code = v_code);
  end loop;
  return v_code;
end $$;

alter table public.listings add column product_code text;
update public.listings set product_code = private.new_product_code() where product_code is null;
alter table public.listings
  alter column product_code set not null,
  add constraint listings_product_code_key unique (product_code),
  add constraint listings_product_code_format check (product_code ~ '^PRD-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$');

-- Set here so no way of creating a listing can skip it, and fixed from then on,
-- because labels, chats and delivery notes will quote it.
create function private.assign_product_code() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.product_code := private.new_product_code();
  elsif new.product_code is distinct from old.product_code then
    perform private.fail('forbidden', 'A product ID never changes.');
  end if;
  return new;
end $$;

create trigger listings_product_code before insert or update of product_code on public.listings
  for each row execute function private.assign_product_code();

revoke execute on function private.new_product_code(), private.assign_product_code() from public, anon, authenticated;

create or replace function public.list_conversations() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."updatedAt" desc), '[]'::jsonb)
  from (
    select
      c.id,
      c.listing_id as "listingId",
      l.product_code as "productCode",
      l.title as "listingTitle",
      l.images[1] as "listingImage",
      l.category,
      case when l.kind = 'product' then l.price_kobo else coalesce(l.fallback_price_kobo, l.price_kobo) end as "priceKobo",
      l.status as "listingStatus",
      m.name as "merchantName",
      p.display_name as "buyerName",
      case when c.buyer_id = auth.uid() then 'buyer' else 'seller' end as me,
      (select jsonb_build_object('body', mm.body, 'sender', mm.sender, 'createdAt', mm.created_at)
         from public.messages mm where mm.conversation_id = c.id order by mm.created_at desc limit 1) as "lastMessage",
      (select count(*)::int from public.messages mm
        where mm.conversation_id = c.id
          and case when c.buyer_id = auth.uid() then mm.sender = 'seller' and mm.created_at > c.buyer_read_at
                   else mm.sender = 'buyer' and mm.created_at > c.seller_read_at end) as unread,
      case when c.buyer_id = auth.uid() then (select mc.call_phone from public.merchant_contacts mc where mc.merchant_id = c.merchant_id) end as "callPhone",
      c.last_message_at as "updatedAt"
    from public.conversations c
    join public.listings l on l.id = c.listing_id
    join public.merchants m on m.id = c.merchant_id
    join public.profiles p on p.id = c.buyer_id
    where c.buyer_id = auth.uid() or c.merchant_id = private.my_merchant_id()
  ) x
$$;

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
        where l.merchant_id = v_merchant and l.status <> 'rejected'
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
