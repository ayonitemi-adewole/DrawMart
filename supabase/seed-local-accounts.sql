-- LOCAL DEVELOPMENT ONLY. Runs after seed.sql on `supabase db reset`.
-- Never run this on a hosted project: it creates an admin with a published password.
--
-- Sign in on /login with "Use a password" (password for all three: drawmart-demo)
--   buyer@drawmart.test   buyer with test money
--   store@drawmart.test   manages Ikeja Partner Store
--   admin@drawmart.test   admin: review queue and demo controls

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('drawmart-demo', extensions.gen_salt('bf')), now(),
       '{"provider": "email", "providers": ["email"]}', jsonb_build_object('display_name', u.name), now(), now(),
       '', '', '', ''
  from (values
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'buyer@drawmart.test', 'Ada'),
    ('a0000000-0000-4000-8000-000000000002'::uuid, 'store@drawmart.test', 'Ikeja Partner Store'),
    ('a0000000-0000-4000-8000-000000000003'::uuid, 'admin@drawmart.test', 'DrawMart Admin')
  ) as u (id, email, name)
on conflict (id) do nothing;

-- Email sign-in needs a matching identity row.
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
  from auth.users u
 where u.email like '%@drawmart.test'
   and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- The sign-up trigger made buyer profiles; promote two of them.
update public.profiles set merchant_id = '11111111-1111-4111-8111-000000000001' where id = 'a0000000-0000-4000-8000-000000000002';
update public.profiles set role = 'admin' where id = 'a0000000-0000-4000-8000-000000000003';
