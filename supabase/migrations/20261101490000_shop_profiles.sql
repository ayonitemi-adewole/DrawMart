-- Each shop gets a public profile page. What a seller writes there is public; their CAC
-- number and phone only show if they choose. The CAC number column itself stops being
-- readable by anyone but the seller and admins. Rules mirror src/domain/shopProfile.ts.

alter table public.merchants
  add column about text check (length(about) <= 300),
  add column logo_url text,
  add column cover_url text,
  add column opening_hours text check (length(opening_hours) <= 80),
  add column shop_note text check (length(shop_note) <= 300),
  add column public_phone text,
  add column show_cac boolean not null default false,
  add column verified_at timestamptz,
  add column public_cac text generated always as (case when show_cac then cac_number else '' end) stored;
update public.merchants set verified_at = created_at where verified;

-- Everyone can read a shop, except its CAC number. A column added later needs adding here,
-- or `select *` on merchants will fail for clients.
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'merchants' and column_name <> 'cac_number';
  execute 'revoke select on public.merchants from anon, authenticated';
  execute format('grant select (%s) on public.merchants to anon, authenticated', v_cols);
end $$;

-- The seller's own, or any for admins.
create function public.merchant_cac_number(p_merchant uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_user();
  if not (private.is_admin() or p_merchant is not distinct from private.my_merchant_id() and p_merchant is not null) then perform private.fail('forbidden', 'Only the shop and DrawMart can see this.'); end if;
  return (select cac_number from public.merchants where id = p_merchant);
end $$;

-- shopProfile.ts shopProfileErrors.
create function public.update_shop_profile(p jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.merchants;
  v_errors text[] := '{}';
  v_about text := nullif(btrim(coalesce(p ->> 'about', '')), '');
  v_hours text := nullif(btrim(coalesce(p ->> 'openingHours', '')), '');
  v_note text := nullif(btrim(coalesce(p ->> 'shopNote', '')), '');
  v_phone text := nullif(btrim(coalesce(p ->> 'publicPhone', '')), '');
  v_logo text := nullif(p ->> 'logoUrl', '');
  v_cover text := nullif(p ->> 'coverUrl', '');
  v_show_cac boolean := coalesce((p ->> 'showCac')::boolean, false);
begin
  perform private.require_user();
  select * into m from public.merchants where id = private.my_merchant_id() for update;
  if not found then perform private.fail('forbidden', 'This account isn’t linked to a shop.'); end if;
  if length(coalesce(v_about, '')) > 300 then v_errors := array_append(v_errors, 'Keep the description to 300 characters.'); end if;
  if length(coalesce(v_hours, '')) > 80 then v_errors := array_append(v_errors, 'Keep opening hours to 80 characters.'); end if;
  if length(coalesce(v_note, '')) > 300 then v_errors := array_append(v_errors, 'Keep your note to buyers to 300 characters.'); end if;
  if v_phone is not null and regexp_replace(v_phone, '[\s-]', '', 'g') !~ '^(\+?234|0)[789][01][0-9]{8}$' then
    v_errors := array_append(v_errors, 'Enter a Nigerian mobile number, e.g. 0803 123 4567, or leave it blank.');
  end if;
  if coalesce(v_logo, 'https://') !~ '^(https://|/assets/)' or coalesce(v_cover, 'https://') !~ '^(https://|/assets/)' then
    v_errors := array_append(v_errors, 'Upload the logo and cover again.');
  end if;
  if v_show_cac and m.kind = 'individual' then v_errors := array_append(v_errors, 'Only registered stores have a CAC number to show.'); end if;
  if cardinality(v_errors) > 0 then perform private.fail('invalid_input', array_to_string(v_errors, ' ')); end if;

  update public.merchants
     set about = v_about, opening_hours = v_hours, shop_note = v_note, public_phone = v_phone, logo_url = v_logo, cover_url = v_cover, show_cac = v_show_cac
   where id = m.id;
end $$;

-- Verified since: set when an individual's shop is created, or a store is verified.
create function private.merchant_verified_at() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.verified and new.verified_at is null then new.verified_at := now(); end if;
  return new;
end $$;
create trigger merchants_verified_at before insert or update of verified on public.merchants
  for each row execute function private.merchant_verified_at();

revoke execute on function private.merchant_verified_at() from public, anon, authenticated;
revoke all on function public.merchant_cac_number(uuid), public.update_shop_profile(jsonb) from public, anon;
grant execute on function public.merchant_cac_number(uuid), public.update_shop_profile(jsonb) to authenticated;
