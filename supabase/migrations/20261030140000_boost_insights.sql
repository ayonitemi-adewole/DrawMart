-- Results of a paid boost (boosts.ts boostWindow / boostComparison): the
-- listing's views, chats and sales during the boost so far, against the same
-- number of days just before it started. Days are Lagos days; the whole start
-- day counts as boosted, because views are counted per day.

-- One listing's numbers between two Lagos days, inclusive (metrics.ts
-- ListingMetricsInput). Raffle ticket sales only count while live or drawn.
create function private.listing_stats(p_listing_id uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'views', (select count(*) from public.listing_views v where v.listing_id = l.id and v.day between p_from and p_to),
    'visitors', (select count(distinct v.visitor) from public.listing_views v where v.listing_id = l.id and v.day between p_from and p_to),
    'chats', (select count(*) from public.conversations c where c.listing_id = l.id and (c.created_at at time zone 'Africa/Lagos')::date between p_from and p_to),
    'units', coalesce(t.units, 0) + o.units,
    'buyers', coalesce(t.buyers, 0) + o.buyers,
    'salesKobo', coalesce(t.sales, 0) + o.sales)
  from public.listings l
  left join lateral (
    select count(*)::int as units, count(distinct coalesce(tk.user_id::text, tk.purchase_ref))::int as buyers, (count(*) * l.buyer_ticket_price_kobo)::bigint as sales
      from public.tickets tk
     where tk.listing_id = l.id and l.status in ('live', 'drawn')
       and (tk.purchased_at at time zone 'Africa/Lagos')::date between p_from and p_to
  ) t on l.kind = 'raffle'
  left join lateral (
    select count(*)::int as units, count(distinct od.user_id)::int as buyers, coalesce(sum(od.price_kobo), 0)::bigint as sales
      from public.orders od
     where od.listing_id = l.id and (od.created_at at time zone 'Africa/Lagos')::date between p_from and p_to
  ) o on true
  where l.id = p_listing_id
$$;

create function public.boost_insights(p_boost_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  b public.boosts;
  v_from date;
  v_to date;
  v_days int;
begin
  select * into b from public.boosts where id = p_boost_id and (merchant_id = private.my_merchant_id() or private.is_admin());
  if not found then perform private.fail('not_found', 'That boost doesn’t exist.'); end if;
  if b.status <> 'paid' then perform private.fail('invalid_input', 'Results show once the boost has started.'); end if;

  v_from := (b.starts_at at time zone 'Africa/Lagos')::date;
  v_to := (least(b.ends_at, now()) at time zone 'Africa/Lagos')::date;
  v_days := greatest(1, v_to - v_from + 1);

  return jsonb_build_object(
    'window', jsonb_build_object('from', v_from, 'to', v_to, 'days', v_days, 'beforeFrom', v_from - v_days, 'beforeTo', v_from - 1),
    'during', private.listing_stats(b.listing_id, v_from, v_to),
    'before', private.listing_stats(b.listing_id, v_from - v_days, v_from - 1),
    'daily', (
      select jsonb_agg(jsonb_build_object(
               'date', d::date,
               'views', (private.listing_stats(b.listing_id, d::date, d::date) ->> 'views')::int,
               'salesKobo', (private.listing_stats(b.listing_id, d::date, d::date) ->> 'salesKobo')::bigint)
             order by d)
        from generate_series(v_from - v_days, v_to, interval '1 day') d));
end $$;

revoke execute on function private.listing_stats(uuid, date, date), public.boost_insights(uuid) from public, anon, authenticated;
grant execute on function public.boost_insights(uuid) to authenticated;
