-- Seller insights (src/domain/metrics.ts): how often each listing is seen,
-- and how often that turns into a sale.
--
-- A view is one visitor opening a listing page, counted once per visitor
-- per listing per Lagos day. Signed-in visitors are counted by account;
-- signed-out ones by a random id the browser keeps. The listing's own shop
-- isn't counted. Nobody can read listing_views directly: sellers get
-- totals for their own listings through merchant_metrics.

create table public.listing_views (
  listing_id uuid not null references public.listings (id) on delete cascade,
  visitor text not null,
  day date not null default (now() at time zone 'Africa/Lagos')::date,
  primary key (listing_id, day, visitor)
);

alter table public.listing_views enable row level security;
revoke all on public.listing_views from anon, authenticated;

create function public.record_listing_view(p_listing_id uuid, p_visitor text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.listings;
  v_visitor text;
begin
  select * into l from public.listings where id = p_listing_id;
  if not found or l.status not in ('live', 'drawn', 'refunded', 'for_sale', 'sold') then return; end if;
  if l.merchant_id = private.my_merchant_id() then return; end if; -- the seller looking at their own item
  if auth.uid() is not null then
    v_visitor := 'u:' || auth.uid()::text;
  elsif p_visitor ~ '^[A-Za-z0-9-]{8,64}$' then
    v_visitor := 'v:' || p_visitor;
  else
    return;
  end if;
  insert into public.listing_views (listing_id, visitor) values (l.id, v_visitor) on conflict do nothing;
end $$;

-- Totals per listing and per day for the signed-in shop (a store or an
-- individual seller). Raffle ticket sales only count while the draw is live
-- or drawn: a refunded draw's tickets were paid back.
create function public.merchant_metrics(p_days int) returns jsonb
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
          l.id as "listingId", l.title, l.images[1] as image, l.category, l.kind, l.status, l.created_at as "createdAt",
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
           where tk.listing_id = l.id and l.kind = 'raffle' and l.status in ('live', 'drawn')
             and (tk.purchased_at at time zone 'Africa/Lagos')::date >= v_from
        ) t on l.kind = 'raffle'
        left join lateral (
          select count(*)::int as units, count(distinct od.user_id)::int as buyers, coalesce(sum(od.price_kobo), 0)::bigint as sales
            from public.orders od
           where od.listing_id = l.id and (od.created_at at time zone 'Africa/Lagos')::date >= v_from
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
           where l.merchant_id = v_merchant and l.kind = 'raffle' and l.status in ('live', 'drawn')
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

revoke execute on function public.record_listing_view(uuid, text), public.merchant_metrics(int) from public, anon, authenticated;
grant execute on function public.record_listing_view(uuid, text) to anon, authenticated;
grant execute on function public.merchant_metrics(int) to authenticated;
