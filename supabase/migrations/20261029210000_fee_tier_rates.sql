-- New platform fee rates (fees.ts FEE_TIERS). Listings already created keep
-- the fee they were created with.
update public.fee_tiers set fee_bps = case from_price_kobo
    when 0 then 1500           -- under ₦50,000: 15%
    when 5000000 then 1300     -- ₦50,000 – ₦499,999: 13%
    when 50000000 then 1150    -- ₦500,000 – ₦4,999,999: 11.5%
    when 500000000 then 1000   -- ₦5,000,000 and up: 10%
    else fee_bps
  end;

create or replace function private.platform_fee_bps(p_price_kobo bigint) returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select fee_bps from public.fee_tiers where from_price_kobo <= coalesce(p_price_kobo, 0) order by from_price_kobo desc limit 1),
    1500)
$$;
