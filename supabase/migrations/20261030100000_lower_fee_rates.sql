-- Lower platform fee rates, with a 2.5% floor (fees.ts FEE_TIERS,
-- MIN_FEE_BPS / MAX_FEE_BPS). Listings already created keep the fee they
-- were created with.
alter table public.fee_tiers drop constraint fee_tiers_fee_bps_check;
alter table public.fee_tiers add constraint fee_tiers_fee_bps_check check (fee_bps between 250 and 2000);

update public.fee_tiers set fee_bps = case from_price_kobo
    when 0 then 750            -- under ₦50,000: 7.5%
    when 5000000 then 500      -- ₦50,000 – ₦499,999: 5%
    when 50000000 then 300     -- ₦500,000 – ₦4,999,999: 3%
    when 500000000 then 250    -- ₦5,000,000 and up: 2.5%
    else fee_bps
  end;

create or replace function private.platform_fee_bps(p_price_kobo bigint) returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select fee_bps from public.fee_tiers where from_price_kobo <= coalesce(p_price_kobo, 0) order by from_price_kobo desc limit 1),
    750)
$$;
