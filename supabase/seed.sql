-- Sample stores and listings (and, in test mode, the test accounts), matching
-- the in-browser mock. Both live in database functions so an admin can put
-- them back later with reset_test_data() (see …_test_data_reset.sql).
-- Safe to run more than once: listings are only added to an empty database.
select private.seed_demo_data();
select private.seed_test_accounts();
