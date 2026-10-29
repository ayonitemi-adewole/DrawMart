-- LOCAL DEVELOPMENT ONLY. Runs after seed.sql on `supabase db reset`.
-- Never run this on a hosted project: it creates an admin with a published password.
--
-- The buyer and store test accounts come from seed.sql (private.seed_test_accounts).
-- This adds the admin: admin@drawmart.test, password drawmart-demo.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'admin@drawmart.test',
       extensions.crypt('drawmart-demo', extensions.gen_salt('bf')), now(),
       '{"provider": "email", "providers": ["email"]}', '{"display_name": "DrawMart Admin"}', now(), now(),
       '', '', '', ''
 where not exists (select 1 from auth.users where email = 'admin@drawmart.test');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
  from auth.users u
 where u.email = 'admin@drawmart.test'
   and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

update public.profiles p set role = 'admin', merchant_id = null, seller_id = null
  from auth.users u where p.id = u.id and u.email = 'admin@drawmart.test';
