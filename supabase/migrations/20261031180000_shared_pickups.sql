-- Shared pickups (src/domain/listing.ts): a store sends several draw items in
-- one pickup and pays one caution fee, the highest among them.
--
-- Every item keeps its own listing, review and draw, and shows the same fee.
-- The fee is refunded once every draw in the pickup has sold out, and kept as
-- soon as any of them ends any other way (settlePickupFee). Cars are inspected
-- where they are, so they can't share a pickup; regular products have no pickup.

alter table public.listings add column pickup_batch_id uuid;
create index listings_pickup_batch_idx on public.listings (pickup_batch_id) where pickup_batch_id is not null;

-- listing.ts settlePickupFee
create function private.settle_pickup_fee() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_kept boolean;
  v_all_drawn boolean;
begin
  select bool_or(status in ('refunded', 'for_sale', 'sold', 'rejected')), bool_and(status = 'drawn')
    into v_kept, v_all_drawn
    from public.listings where pickup_batch_id = new.pickup_batch_id;
  update public.listings
     set caution_fee_status = case when v_kept then 'kept' when v_all_drawn then 'refunded' else 'held' end
   where pickup_batch_id = new.pickup_batch_id;
  return null;
end $$;

-- Runs after whatever changed the status, so it has the last word on the fee:
-- run_draw marks its own listing's fee refunded, which only holds if all sold out.
-- Only the fee column changes in the update above, so this doesn't fire itself.
create trigger listings_settle_pickup_fee after update of status on public.listings
for each row when (new.pickup_batch_id is not null and old.status is distinct from new.status)
execute function private.settle_pickup_fee();

-- p: {"items": [<create_listing input without handover>, ...], "handover": {...}}.
-- Everything is created or nothing is. Returns the new listing ids.
create function public.create_listing_batch(p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_items jsonb := coalesce(p -> 'items', '[]'::jsonb);
  v_batch uuid := gen_random_uuid();
  v_ids uuid[] := '{}';
  v_item jsonb;
  v_errors text[] := '{}';
begin
  perform private.require_user();
  if jsonb_typeof(v_items) <> 'array' then perform private.fail('invalid_input', 'A shared pickup needs at least 2 items.'); end if;
  -- listing.ts validatePickup
  if jsonb_array_length(v_items) < 2 then v_errors := array_append(v_errors, 'A shared pickup needs at least 2 items.'); end if;
  if jsonb_array_length(v_items) > 10 then v_errors := array_append(v_errors, 'One pickup can take at most 10 items.'); end if;
  if exists (select 1 from jsonb_array_elements(v_items) i where i ->> 'category' = 'Cars') then
    v_errors := array_append(v_errors, 'Cars are inspected where they are, so they can’t share a pickup. List them on their own.');
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  -- create_listing checks each item and who is asking; any failure undoes the lot.
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_ids := array_append(v_ids, public.create_listing(v_item || jsonb_build_object('handover', p -> 'handover')));
  end loop;

  update public.listings
     set pickup_batch_id = v_batch,
         caution_fee_kobo = (select max(f.amount_kobo) from public.caution_fees f join public.listings l on l.category = f.category where l.id = any (v_ids))
   where id = any (v_ids);
  return to_jsonb(v_ids);
end $$;

revoke execute on function private.settle_pickup_fee(), public.create_listing_batch(jsonb) from public, anon, authenticated;
grant execute on function public.create_listing_batch(jsonb) to authenticated;
