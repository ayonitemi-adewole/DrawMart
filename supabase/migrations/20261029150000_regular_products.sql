-- Regular products and fixed-price orders.
--
-- A store lists an item either as a raffle (tickets, escrow, caution fee) or
-- as a regular product (src/domain/orders.ts): admin review only, no tickets,
-- no escrow and no caution fee. Approved products go straight to 'for_sale'.
--
-- Buyers buy anything 'for_sale' (products, and raffles that ended unsold
-- with convert_to_sale) from their wallet, store credit first. That creates
-- an order: paid -> the store dispatches it -> the buyer confirms delivery.

-- ------------------------------------------------------------- listings

alter table public.listings
  add column kind text not null default 'raffle' check (kind in ('raffle', 'product'));

-- Products have no tickets: relax the ticket checks to raffles only.
alter table public.listings
  drop constraint listings_ticket_price_kobo_check,
  drop constraint listings_buyer_ticket_price_kobo_check,
  drop constraint listings_ticket_count_check,
  drop constraint listings_status_check,
  drop constraint listings_caution_fee_status_check,
  add constraint listings_tickets_check check (
    case kind
      when 'raffle' then ticket_price_kobo > 0 and buyer_ticket_price_kobo > 0 and ticket_count between 1 and 10000
      else ticket_price_kobo = 0 and buyer_ticket_price_kobo = 0 and ticket_count = 0
    end),
  add constraint listings_status_check
    check (status in ('pending_review', 'live', 'drawn', 'refunded', 'for_sale', 'sold', 'rejected')),
  add constraint listings_caution_fee_status_check check (caution_fee_status in ('held', 'refunded', 'kept', 'none'));

-- Sold items stay visible, so buyers can open what they bought.
drop policy "read public, own-store or all (admin) listings" on public.listings;
create policy "read public, own-store or all (admin) listings" on public.listings for select
  using (
    status in ('live', 'drawn', 'refunded', 'for_sale', 'sold')
    or merchant_id = (select private.my_merchant_id())
    or (select private.is_admin())
  );

-- --------------------------------------------------------------- orders

alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check
  check (kind in ('topup', 'ticket_purchase', 'refund', 'store_credit', 'order_payment', 'adjustment'));

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- One unit per listing, so one order.
  listing_id uuid not null unique references public.listings (id),
  user_id uuid not null references public.profiles (id),
  merchant_id uuid not null references public.merchants (id),
  price_kobo bigint not null check (price_kobo > 0),
  fee_kobo bigint not null check (fee_kobo >= 0),
  delivery_address text not null,
  delivery_phone text not null,
  status text not null default 'paid' check (status in ('paid', 'dispatched', 'delivered')),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  delivered_at timestamptz
);
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_merchant_idx on public.orders (merchant_id, created_at desc);

alter table public.orders enable row level security;
create policy "buyer, store and admins read orders" on public.orders for select to authenticated
  using (user_id = (select auth.uid()) or merchant_id = (select private.my_merchant_id()) or (select private.is_admin()));
revoke all on public.orders from anon, authenticated;
grant select on public.orders to authenticated;

-- Only buyer accounts place orders (one_app_per_account).
create trigger orders_buyers_only before insert on public.orders
for each row execute function private.buyers_only();

-- --------------------------------------------------------------- RPCs

-- orders.ts validateProduct. The store pays the fee; buyers see one price.
create function public.create_product(p jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_merchant public.merchants;
  v_errors text[] := '{}';
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_category text := p ->> 'category';
  v_price bigint := (p ->> 'priceKobo')::bigint;
  v_fee_bps int := (p ->> 'feeBps')::int;
  v_images text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'images', '[]'::jsonb))), '{}');
  v_id uuid;
begin
  select m.* into v_merchant from public.merchants m join public.profiles pr on pr.merchant_id = m.id where pr.id = v_uid;
  if not found then perform private.fail('forbidden', 'This account isn’t linked to a store.'); end if;
  if not v_merchant.verified then perform private.fail('forbidden', 'Your store hasn’t been verified yet.'); end if;

  if v_title = '' then v_errors := array_append(v_errors, 'Give the item a name.'); end if;
  if v_price is null or v_price < 10000 then v_errors := array_append(v_errors, 'Set a price of at least ₦100.'); end if;
  if v_fee_bps is null or v_fee_bps not between 1000 and 3000 then v_errors := array_append(v_errors, 'Platform fee must be between 10% and 30%.'); end if;
  if v_category is null or v_category not in ('Phones', 'Electronics', 'Home', 'Cars', 'Fashion') then v_errors := array_append(v_errors, 'Pick a category.'); end if;
  if cardinality(v_images) > 4 or exists (select 1 from unnest(v_images) u where u !~ '^(https://|/assets/)') then
    v_errors := array_append(v_errors, 'Upload up to 4 photos.');
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  insert into public.listings (
    kind, merchant_id, title, description, category, images, price_kobo, ticket_price_kobo, buyer_ticket_price_kobo,
    ticket_count, fee_mode, fee_bps, unsold_policy, duration_days, status, caution_fee_kobo, caution_fee_status, commitment, closes_at)
  values (
    'product', v_merchant.id, v_title, btrim(coalesce(p ->> 'description', '')), v_category, v_images, v_price, 0, 0,
    0, 'seller', v_fee_bps, 'refund', 0, 'pending_review', 0, 'none', '', now())
  returning id into v_id;
  return v_id;
end $$;

-- Products skip the draw: approved means on sale.
create or replace function public.approve_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  -- A raffle's clock starts when the draw goes live.
  update public.listings
     set status = case when kind = 'product' then 'for_sale' else 'live' end,
         closes_at = case when kind = 'product' then closes_at else now() + make_interval(days => duration_days) end
   where id = p_listing_id and status = 'pending_review';
  if not found then perform private.fail('invalid_input', 'Only listings in review can be approved.'); end if;
end $$;

create or replace function public.reject_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.listings
     set status = 'rejected',
         caution_fee_status = case when caution_fee_status = 'held' then 'kept' else caution_fee_status end
   where id = p_listing_id and status = 'pending_review';
  if not found then perform private.fail('invalid_input', 'Only listings in review can be rejected.'); end if;
end $$;

-- orders.ts checkOrder + validateDelivery. Pays from the wallet, credit first.
create function public.buy_now(p_listing_id uuid, p_address text, p_phone text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  l public.listings;
  v_price bigint;
  v_cash bigint;
  v_credit bigint;
  v_from_credit bigint;
  v_errors text[] := '{}';
  v_id uuid;
begin
  perform private.require_buyer(v_uid);
  -- Same lock order as buy_tickets: the buyer's profile (wallet), then the listing.
  perform 1 from public.profiles where id = v_uid for update;
  select * into l from public.listings where id = p_listing_id for update;
  if not found then perform private.fail('not_found', 'That item doesn’t exist.'); end if;
  v_price := case when l.status <> 'for_sale' then null when l.kind = 'product' then l.price_kobo else l.fallback_price_kobo end;
  if v_price is null then perform private.fail('not_for_sale', 'This item isn’t for sale any more.'); end if;

  if length(btrim(coalesce(p_address, ''))) < 10 then v_errors := array_append(v_errors, 'Enter the full delivery address, with street and area.'); end if;
  if regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  select coalesce(sum(cash_kobo), 0), coalesce(sum(credit_kobo), 0) into v_cash, v_credit from public.ledger_entries where user_id = v_uid;
  if v_cash + v_credit < v_price then perform private.fail('insufficient_funds'); end if;
  v_from_credit := least(greatest(v_credit, 0), v_price);

  insert into public.orders (listing_id, user_id, merchant_id, price_kobo, fee_kobo, delivery_address, delivery_phone)
  values (l.id, v_uid, l.merchant_id, v_price, round(v_price * l.fee_bps / 10000.0)::bigint, btrim(p_address), btrim(p_phone))
  returning id into v_id;
  insert into public.ledger_entries (user_id, kind, cash_kobo, credit_kobo, memo, listing_id)
  values (v_uid, 'order_payment', -(v_price - v_from_credit), -v_from_credit, 'Bought · ' || l.title, l.id);
  update public.listings set status = 'sold' where id = l.id;
  return v_id;
end $$;

create function public.dispatch_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.orders set status = 'dispatched', dispatched_at = now()
   where id = p_order_id and status = 'paid' and merchant_id = private.my_merchant_id();
  if not found then perform private.fail('invalid_input', 'Only your store’s paid orders can be marked as sent.'); end if;
end $$;

-- The store is paid once the buyer confirms (payouts aren't automated yet).
create function public.confirm_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  update public.orders set status = 'delivered', delivered_at = now(), dispatched_at = coalesce(dispatched_at, now())
   where id = p_order_id and user_id = v_uid and status in ('paid', 'dispatched');
  if not found then perform private.fail('invalid_input', 'Only your own orders that are on the way can be confirmed.'); end if;
end $$;

revoke execute on function
  public.create_product(jsonb),
  public.buy_now(uuid, text, text),
  public.dispatch_order(uuid),
  public.confirm_order(uuid)
from public, anon, authenticated;
grant execute on function
  public.create_product(jsonb),
  public.buy_now(uuid, text, text),
  public.dispatch_order(uuid),
  public.confirm_order(uuid)
to authenticated;
