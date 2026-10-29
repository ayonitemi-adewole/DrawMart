-- Individual sellers (src/domain/sellers.ts).
--
-- A buyer account can apply to sell regular products: shop name, legal name,
-- NIN, phone, address, a photo of a government ID and a selfie holding it.
-- An admin compares them and approves (which creates an 'individual'
-- merchant, linked as profiles.seller_id) or rejects with a reason.
--
-- Individuals stay buyer accounts (they shop too) and can only list regular
-- products: create_listing (raffles) still needs a store account.

alter table public.merchants
  add column kind text not null default 'store' check (kind in ('store', 'individual'));

alter table public.profiles
  add column seller_id uuid unique references public.merchants (id),
  add constraint profiles_seller_is_buyer check (seller_id is null or role = 'buyer');

-- The shop this account manages: a store's, or an individual seller's own.
-- Used by the listings, handovers and orders policies and the photo bucket.
create or replace function private.my_merchant_id() returns uuid
language sql stable security definer set search_path = ''
as $$ select coalesce(merchant_id, seller_id) from public.profiles where id = auth.uid() $$;

-- ------------------------------------------------------- applications

create table public.seller_applications (
  id uuid primary key default gen_random_uuid(),
  -- One per account; a rejected seller edits and resubmits it.
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  shop_name text not null,
  legal_name text not null,
  nin text not null check (nin ~ '^[0-9]{11}$'),
  phone text not null,
  address text not null,
  area text not null,
  -- Paths in the private seller-ids bucket: <user id>/<file>.
  id_photo_path text not null,
  selfie_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index seller_applications_status_idx on public.seller_applications (status, updated_at);

alter table public.seller_applications enable row level security;
create policy "own application, or admins" on public.seller_applications for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
revoke all on public.seller_applications from anon, authenticated;
grant select on public.seller_applications to authenticated;

-- sellers.ts validateSellerApplication
create function public.submit_seller_application(p jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_errors text[] := '{}';
  v_shop text := btrim(coalesce(p ->> 'shopName', ''));
  v_name text := btrim(coalesce(p ->> 'legalName', ''));
  v_nin text := regexp_replace(coalesce(p ->> 'nin', ''), '\s', '', 'g');
  v_phone text := btrim(coalesce(p ->> 'phone', ''));
  v_address text := btrim(coalesce(p ->> 'address', ''));
  v_area text := btrim(coalesce(p ->> 'area', ''));
  v_id_photo text := coalesce(p ->> 'idPhoto', '');
  v_selfie text := coalesce(p ->> 'selfie', '');
  v_existing public.seller_applications;
  v_id uuid;
begin
  perform private.require_buyer(v_uid);
  select * into v_existing from public.seller_applications where user_id = v_uid for update;
  if v_existing.status = 'pending' then perform private.fail('invalid_input', 'Your application is already being reviewed.'); end if;
  if v_existing.status = 'approved' then perform private.fail('invalid_input', 'You’re already a verified seller.'); end if;

  if length(v_shop) < 2 then v_errors := array_append(v_errors, 'Give your shop a name buyers will see.'); end if;
  if (select count(*) from regexp_split_to_table(v_name, '\s+') w where length(w) > 1) < 2 then
    v_errors := array_append(v_errors, 'Enter your full legal name, as on your ID.');
  end if;
  if v_nin !~ '^[0-9]{11}$' then v_errors := array_append(v_errors, 'Enter your 11-digit NIN.'); end if;
  if regexp_replace(v_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567.');
  end if;
  if length(v_address) < 10 then v_errors := array_append(v_errors, 'Enter your full home address, with street and area.'); end if;
  if length(v_area) < 2 then v_errors := array_append(v_errors, 'Enter your area in Lagos, e.g. Yaba.'); end if;
  -- The photos must be this account's own uploads.
  if v_id_photo not like v_uid::text || '/%' then v_errors := array_append(v_errors, 'Add a photo of your ID.'); end if;
  if v_selfie not like v_uid::text || '/%' then v_errors := array_append(v_errors, 'Add a selfie of you holding the same ID.'); end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  insert into public.seller_applications (user_id, shop_name, legal_name, nin, phone, address, area, id_photo_path, selfie_path)
  values (v_uid, v_shop, v_name, v_nin, v_phone, v_address, v_area, v_id_photo, v_selfie)
  on conflict (user_id) do update
    set shop_name = excluded.shop_name, legal_name = excluded.legal_name, nin = excluded.nin, phone = excluded.phone,
        address = excluded.address, area = excluded.area, id_photo_path = excluded.id_photo_path, selfie_path = excluded.selfie_path,
        status = 'pending', review_note = null, reviewed_at = null, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

create function public.approve_seller(p_application_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.seller_applications;
  v_merchant uuid;
begin
  perform private.require_admin();
  select * into a from public.seller_applications where id = p_application_id and status = 'pending' for update;
  if not found then perform private.fail('invalid_input', 'Only applications waiting for review can be approved.'); end if;
  insert into public.merchants (kind, name, area, cac_number, verified) values ('individual', a.shop_name, a.area, '', true)
  returning id into v_merchant;
  update public.profiles set seller_id = v_merchant where id = a.user_id and role = 'buyer';
  if not found then perform private.fail('invalid_input', 'Only buyer accounts can become individual sellers.'); end if;
  update public.seller_applications set status = 'approved', reviewed_at = now() where id = a.id;
end $$;

create function public.reject_seller(p_application_id uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if length(btrim(coalesce(p_note, ''))) < 5 then perform private.fail('invalid_input', 'Tell the applicant what to fix.'); end if;
  update public.seller_applications set status = 'rejected', review_note = btrim(p_note), reviewed_at = now()
   where id = p_application_id and status = 'pending';
  if not found then perform private.fail('invalid_input', 'Only applications waiting for review can be rejected.'); end if;
end $$;

-- ------------------------------------------------- products and orders

-- Stores and individual sellers both list regular products.
create or replace function public.create_product(p jsonb) returns uuid
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
  select m.* into v_merchant from public.merchants m where m.id = private.my_merchant_id();
  if not found then perform private.fail('forbidden', 'Get verified as a seller, or sign in with a store account, to list products.'); end if;
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

-- Sellers can't buy their own items (e.g. to fake sales).
create function private.not_own_item() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.merchant_id = (select seller_id from public.profiles where id = new.user_id) then
    perform private.fail('forbidden', 'You can’t buy your own item.');
  end if;
  return new;
end $$;

create trigger orders_not_own_item before insert on public.orders
for each row execute function private.not_own_item();

-- ------------------------------------------------------------ storage

-- ID photos: private. The applicant uploads into a folder named after their
-- user id; only they and admins can read them (admins through signed URLs).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('seller-ids', 'seller-ids', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$
      create policy "applicants upload their ID photos" on storage.objects for insert to authenticated
      with check (bucket_id = 'seller-ids' and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    execute $p$
      create policy "applicants and admins read ID photos" on storage.objects for select to authenticated
      using (bucket_id = 'seller-ids' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin())))
    $p$;
  end if;
end $$;

revoke execute on function
  public.submit_seller_application(jsonb),
  public.approve_seller(uuid),
  public.reject_seller(uuid, text),
  private.not_own_item()
from public, anon, authenticated;
grant execute on function
  public.submit_seller_application(jsonb),
  public.approve_seller(uuid),
  public.reject_seller(uuid, text)
to authenticated;
