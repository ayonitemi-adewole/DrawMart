-- seed_test_accounts only runs from seed.sql and resets, so a database set up before
-- pickup counters (20261102120000) never got counter@drawmart.test, the counter staff
-- account. Run it once here, like 20261101220000_create_test_rider.sql. It does nothing
-- outside test mode, and on a new database the sample stores it links to don't exist
-- yet, so seed.sql does it instead. Accounts that already exist are matched by email
-- and only have their test role, shop and name put back.
do $$
begin
  if (select count(*) from public.merchants where id in (
    '11111111-1111-4111-8111-000000000001', '11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000003',
    '11111111-1111-4111-8111-000000000004', '11111111-1111-4111-8111-000000000005', '11111111-1111-4111-8111-000000000006'
  )) = 6 then
    perform private.seed_test_accounts();
  end if;
end $$;
