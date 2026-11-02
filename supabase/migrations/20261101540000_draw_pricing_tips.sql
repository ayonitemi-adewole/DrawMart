-- Pricing tips for a new draw: how similar finished draws did, by category and ticket
-- price band. Only over at least 5 draws from at least 3 stores, so nobody can work out
-- one store's sales. Rules mirror src/domain/drawPricing.ts.

-- When a draw went on sale. Older draws fall back to their closing time less their length.
alter table public.listings add column live_at timestamptz;

create function private.set_live_at() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then new.live_at := now(); end if;
  return new;
end $$;
create trigger listings_live_at before insert or update of status on public.listings
  for each row execute function private.set_live_at();

-- drawPricing.ts ticketBand.
create function private.ticket_band(p_ticket_kobo bigint) returns int
language sql immutable set search_path = ''
as $$
  select coalesce((select i - 1 from unnest(array[50000, 100000, 250000, 500000, 1000000]::bigint[]) with ordinality t(top, i) where p_ticket_kobo <= top order by i limit 1), 5)::int
$$;

create function public.draw_price_stats(p_category text, p_band int) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  r record;
begin
  if not (private.is_admin() or exists (select 1 from public.profiles where id = v_uid and role = 'store')) then
    perform private.fail('forbidden', 'Only stores run draws.');
  end if;
  select count(*) n, count(distinct merchant_id) stores, count(sold_out_at) sold,
         round((avg(extract(epoch from sold_out_at - coalesce(live_at, closes_at - make_interval(days => duration_days)))) filter (where sold_out_at is not null) / 86400)::numeric, 1) days
    into r
    from public.listings
   where kind = 'raffle' and category = p_category and status in ('sold_out', 'drawn', 'refunded', 'for_sale', 'sold')
     and private.ticket_band(ticket_price_kobo) = p_band;
  if r.n < 5 or r.stores < 3 then
    return jsonb_build_object('category', p_category, 'band', p_band, 'draws', null, 'soldOut', null, 'avgDaysToSellOut', null);
  end if;
  return jsonb_build_object('category', p_category, 'band', p_band, 'draws', r.n, 'soldOut', r.sold, 'avgDaysToSellOut', r.days);
end $$;

revoke all on function private.set_live_at(), private.ticket_band(bigint) from public, anon, authenticated;
revoke all on function public.draw_price_stats(text, int) from public, anon;
grant execute on function public.draw_price_stats(text, int) to authenticated;
