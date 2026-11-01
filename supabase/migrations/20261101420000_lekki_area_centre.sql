-- Lekki's centre was too far east, so Lekki Phase 1 counted as Victoria Island. Moving it
-- also moves its placeholder prices (deliveryFees.ts placeholderPriceKobo). Any price an
-- admin has already changed is left alone.
with moved as (
  select p.area_a, p.area_b,
         -- The area at the other end of the pair; Lekki to itself stays the minimum.
         case when p.area_a = 'lekki' then p.area_b else p.area_a end as other
    from public.delivery_prices p
   where (p.area_a = 'lekki' or p.area_b = 'lekki') and p.area_a <> p.area_b
)
update public.delivery_prices p
   set price_kobo = least(350000, 100000 + floor(sqrt(power((6.45 - o.lat) * 111.32, 2) + power((3.49 - o.lng) * cos(radians(6.5)) * 111.32, 2)) * 0.6 + 0.5)::bigint * 10000)
  from moved m join public.delivery_areas o on o.id = m.other
 where p.area_a = m.area_a and p.area_b = m.area_b
   and p.price_kobo = least(350000, 100000 + floor(sqrt(power((6.45 - o.lat) * 111.32, 2) + power((3.54 - o.lng) * cos(radians(6.5)) * 111.32, 2)) * 0.6 + 0.5)::bigint * 10000);

update public.delivery_areas set lng = 3.49 where id = 'lekki';
