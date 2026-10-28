# Connecting DrawMart to Supabase

About 20 minutes. You'll create a Supabase project, push the database, point the app at it, and make yourself an admin.

The app still runs on the in-browser mock by default. Supabase switches on only when `.env.local` says `VITE_BACKEND=supabase`, so you can flip back and forth.

## What's in the repo

| Path | What |
|---|---|
| `supabase/migrations/…_drawmart_core.sql` | Tables, security rules, and every write as a database function (buy tickets, run draws, refunds, listings, approvals) |
| `supabase/seed.sql` | The same sample stores and draws as the mock |
| `supabase/tests/db.test.ts` | Runs the migration in a local Postgres (PGlite, no Docker) and checks it against `src/domain` |
| `supabase/config.toml` | Supabase CLI settings |
| `src/api/supabase.ts` | `DrawMartApi` implemented on Supabase |
| `src/pages/SignInPage.tsx` | Email sign-in link screen |

## Step 1: Create the project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and sign in (GitHub sign-in is fine).
2. Click **New project**. Name it `drawmart`, set a strong **database password** and save it in your password manager, and pick the region closest to Lagos.
3. Wait a minute or two while it sets up.

## Step 2: Get your keys

In the dashboard click **Connect** (top bar), or go to **Project Settings → API Keys**. Copy:

- the **Project URL**, `https://<project-ref>.supabase.co`. The `<project-ref>` part is your project ref; you need it in step 3.
- the **publishable key**, which starts with `sb_publishable_`.

Don't use the **secret** key in the app. It bypasses all security rules.

## Step 3: Push the database

From the repo folder in the VS Code terminal (the CLI is already a dev dependency):

```bash
npm install
npx supabase login                               # opens the browser once
npx supabase link --project-ref <project-ref>    # asks for the database password
npx supabase db push --include-seed              # creates everything + sample data
```

`db push` lists the migration and asks you to confirm. The seed only runs if the database has no stores yet, so it's safe to run again.

Check it worked: in the dashboard, **Table Editor** should show `listings`, `tickets`, `ledger_entries` and so on, with 16 listings.

## Step 4: Check the deadline job

Draws that don't sell out are closed by a job that runs every minute.

1. Go to **Integrations → Cron**. You should see a job called `drawmart-process-deadlines`.
2. If Cron isn't enabled or the job is missing, enable Cron there, then run this in **SQL Editor**:

```sql
select cron.schedule('drawmart-process-deadlines', '* * * * *', 'select private.process_deadlines()');
```

## Step 5: Set up sign-in

1. **Authentication → URL Configuration**:
   - **Site URL**: `http://localhost:5173`
   - **Redirect URLs**: add `http://localhost:5173/**`
2. **Authentication → Sign In / Providers → Email** should be enabled (it is by default).

Supabase's built-in email sender only allows a few emails per hour. That's fine for testing; before launch, add your own SMTP provider under **Authentication → Emails → SMTP Settings**.

## Step 6: Point the app at Supabase

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
VITE_BACKEND=supabase
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_TEST_MODE=true
```

`.env.local` is git-ignored. Then:

```bash
npm run dev
```

Open http://localhost:5173, enter your email, and click the link in the email. You're in, with ₦25,000 of test money.

## Step 7: Make yourself an admin and a store

New accounts are buyers. To use **Admin review**, the **demo controls**, and the **merchant dashboard**, run this in **SQL Editor** with your email:

```sql
update public.profiles
set role = 'admin',
    merchant_id = '11111111-1111-4111-8111-000000000001'  -- Ikeja Partner Store from the seed
where id = (select id from auth.users where email = 'you@example.com');
```

Reload the app.

## Step 8: Try the whole flow

- **Buy tickets** on a live draw; your wallet goes down and your numbers appear under Tickets.
- **Demo controls** on a listing: "sell out" runs the draw; open the result and press **Verify**.
- **Merchant dashboard**: create a listing with a photo. The photo uploads to the `listing-photos` storage bucket.
- **Admin review**: approve it; it appears on the home page.
- **Wallet**: test top-ups and spending limits.

Sign in from a second email in a private window to see another buyer's view. You won't see the first account's tickets or wallet.

## How it's secured

- The app can only **read** tables, and row-level security limits what each person sees: their own tickets, wallet and profile; public listings; and, for stores and admins, their own listings and pickup details.
- Every **write** is a database function (`buy_tickets`, `create_listing`, `approve_listing`, …) that checks the same rules as `src/domain`. People can't change balances or ticket counts directly, even with the API key.
- **Draw seeds** sit in a `private` schema the API never exposes, and are copied into `draw_results` only when the draw runs.
- `app_settings.test_mode` (on by default) allows test top-ups and the admin demo controls. While it's on, new accounts are treated as verified Lagos adults.

## Changing the database later

```bash
npx supabase migration new add_something     # creates supabase/migrations/<timestamp>_add_something.sql
# write the SQL, add a test to supabase/tests/db.test.ts, run npm test
npx supabase db push
```

Never edit a migration that has already been pushed; add a new one.

If you install Docker, `npx supabase start` runs a full local Supabase (with a mail inbox at http://localhost:54324) and `npx supabase db reset` rebuilds it from the migrations and seed.

## Before real money

- Turn off test mode: set `test_mode = false` in the `app_settings` table **and** `VITE_TEST_MODE=false`.
- Real top-ups from a payment provider (e.g. Paystack or Flutterwave): an Edge Function that verifies the payment webhook and inserts the `topup` ledger entry.
- KYC (NIN/BVN) to set `age_verified` and `state` on profiles. Until then, new accounts can't buy tickets outside test mode.
- Store payouts and caution-fee charging.
- **Draw fairness:** today the server makes the closing reference, so a dishonest operator could in theory retry it. Before launch, take it from a public randomness source after the draw closes, such as a [drand](https://drand.love) round.
- Custom SMTP, your production URL in **Redirect URLs**, and the same env vars on your hosting (Vercel, Netlify…).
