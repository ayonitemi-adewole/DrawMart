# Connecting DrawMart to Supabase

About 20 minutes. You'll create a Supabase project, push the database, point the app at it, and make yourself an admin.

The app still runs on the in-browser mock by default. Supabase switches on only when `.env.local` says `VITE_BACKEND=supabase`, so you can flip back and forth.

## What's in the repo

| Path | What |
|---|---|
| `supabase/migrations/…_drawmart_core.sql` | Tables, security rules, and every write as a database function (buy tickets, run draws, refunds, listings, approvals) |
| `supabase/seed.sql` | The same sample stores and draws as the mock |
| `supabase/tests/db.test.ts` | Runs the migration in a local Postgres (PGlite, no Docker) and checks it against `src/domain` |
| `supabase/migrations/…_flutterwave_deposits.sql` | Deposits table and the functions that start and complete a Flutterwave top-up |
| `supabase/functions/` | Edge Functions: `confirm-deposit` (checks a payment after checkout) and `flutterwave-webhook` |
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

Everyone signs in on `/login`, either with an emailed link or with a password if their account has one. The first emailed link creates a **buyer** account. After sign-in, each account goes to its own app: buyers to `/`, stores to `/store`, admins to `/admin`. Browsing draws doesn't need an account.

If the app is deployed (e.g. on Vercel), set **Site URL** to that address and add `https://<your-domain>/**` to **Redirect URLs** too.

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

## Step 7: Set up a store account and an admin account

Buyer, store and admin are separate apps, and **each account belongs to exactly one**. A store or admin account can't buy tickets or top up, and the database enforces that. So use three emails, e.g. `you@example.com` (buyer), `you+store@example.com` and `you+admin@example.com`. Sign in once with each email so the account exists, then run this in **SQL Editor**:

```sql
-- Store app (/store): link the account to a store
update public.profiles
set role = 'store', merchant_id = '11111111-1111-4111-8111-000000000001'  -- Ikeja Partner Store from the seed
where id = (select id from auth.users where email = 'you+store@example.com');

-- Admin app (/admin): review queue, live draws and demo controls
update public.profiles
set role = 'admin', merchant_id = null
where id = (select id from auth.users where email = 'you+admin@example.com');
```

`role` and `merchant_id` must change together: a store account always has a store, and other accounts never do. Sign out and back in to land in the new app.

## Step 8: Try the whole flow

- **Buyer**: buy tickets on a live draw; your wallet goes down and your numbers appear under Tickets.
- **Store** (`/store`): create a raffle listing with a photo (it uploads to the `listing-photos` storage bucket), and a regular product.
- **Admin** (`/admin`): approve both in the review queue. The raffle goes live; the product goes straight on sale.
- **Individual seller**: as a buyer, open **Sell** and apply with ID photos. As the admin, approve it under **Seller ID checks**. Back as the buyer, list a product from **Sell**; the admin approves it like any listing.
- **Messages**: as a buyer, open a product and tap **Message**; reply from the store's **Messages**, where the store can also share a call number.
- **Boosts**: as the admin, open **Boosts** and tick "Open boosts now" (a new project has far fewer than 1,000 active buyers). As a store, press **Boost** on a live listing; it then shows first on the home page, marked Sponsored. Without Flutterwave keys, test mode pays with pretend money.
- **Insights**: open a few listings as a buyer (or signed out), then check **Insights** in the store app.
- **Buyer**: buy the product under "Skip the draw" on the home page, with a delivery address. The store marks the order sent under **Orders**; the buyer confirms delivery under **Tickets → Orders**. Under **Live draws & demo**, "Run the draw" sells it out and draws a winner; as the buyer, open the result and press **Verify**.
- **Wallet**: top-ups (instant test money, or Flutterwave's test checkout once Step 9 is done) and spending limits.

Use a private window per account to keep several signed in at once. Sign in from a second buyer email to see another buyer's view. You won't see the first account's tickets or wallet.

## Step 9 (optional): Flutterwave top-ups

Without this, the wallet's top-up buttons add test money instantly. With it, they open Flutterwave's checkout (card, bank transfer, USSD). Use Flutterwave **test** keys until the licence is granted: the app and the Edge Functions both refuse a live key while test mode is on (and a test key once it's off).

1. In the [Flutterwave dashboard](https://app.flutterwave.com), switch to **Test mode** and open **Settings → API keys**. Copy the public key (`FLWPUBK_TEST-…`) and secret key (`FLWSECK_TEST-…`).
2. Pick a long random string as your webhook secret hash.
3. Give the secret key and hash to your Supabase project and deploy the functions:

   ```bash
   npx supabase secrets set FLW_SECRET_KEY=FLWSECK_TEST-… FLW_WEBHOOK_HASH=your-random-string
   npx supabase functions deploy confirm-deposit
   npx supabase functions deploy flutterwave-webhook
   ```

4. In Flutterwave, **Settings → Webhooks**: set the URL to `https://<project-ref>.supabase.co/functions/v1/flutterwave-webhook`, paste the same secret hash, and tick the charge-completed events.
5. Add the public key to `.env.local` and restart `npm run dev`:

   ```bash
   VITE_FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-…
   ```

Try it on the Wallet page with one of [Flutterwave's test cards](https://developer.flutterwave.com/docs/test-cards).

**How a top-up works:** `start_deposit` records a pending deposit with a fresh `tx_ref`; the buyer pays in Flutterwave's modal; `confirm-deposit` asks Flutterwave's API (with the secret key) whether that `tx_ref` was paid in full, in naira, and only then calls `complete_deposit`, which adds the `topup` ledger entry. The webhook does the same for payments that settle later, such as bank transfers. Either path can run first or both can run: a deposit is credited once. The browser's "payment successful" is never trusted on its own, and the secret key only lives in Supabase secrets.

Running the functions locally: copy `supabase/functions/.env.example` to `supabase/functions/.env`, then `npx supabase functions serve`. Flutterwave can't reach your computer, so webhooks only work on the hosted project (or through a tunnel).

## How it's secured

- The app can only **read** tables, and row-level security limits what each person sees: their own tickets, wallet and profile; public listings; and, for stores and admins, their own listings and pickup details.
- Every **write** is a database function (`buy_tickets`, `create_listing`, `approve_listing`, …) that checks the same rules as `src/domain`. People can't change balances or ticket counts directly, even with the API key.
- **Draw seeds** sit in a `private` schema the API never exposes, and are copied into `draw_results` only when the draw runs.
- **Who won** isn't public: anyone can read and verify a draw result, but not `draw_results.winner_user_id`. The app works out "you won" from your own tickets.
- **Top-ups**: only the Edge Functions (service role) can call `complete_deposit`, and only after Flutterwave's API confirms the payment. Short or non-naira payments are marked failed, not credited.
- `app_settings.test_mode` (on by default) allows test top-ups and the admin demo controls. While it's on, new accounts are treated as verified Lagos adults.

## Optional: run Supabase on your computer

If you install [Docker Desktop](https://www.docker.com/products/docker-desktop/), you can run the whole stack locally instead of using a hosted project:

```bash
npx supabase start      # prints a local API URL and publishable key for .env.local
npx supabase db reset   # re-runs migrations, seed.sql and seed-local-accounts.sql
```

`seed-local-accounts.sql` adds `admin@drawmart.test` (password `drawmart-demo`) for local testing only. **Never run that file on a hosted project.** It creates an admin with a published password. `db push` doesn't run seeds, so it can't happen by accident.

## Test accounts and resetting test data

While test mode is on, the database has password accounts for testing, all with the password `drawmart-demo` (listed in `src/api/demoAccounts.ts`; the sign-in page shows a button for each):

- Buyers: `buyer@`, `chidi@`, `ngozi@`, `emeka@`, `funke@drawmart.test`, and `seller@drawmart.test`, a buyer who passed the ID check and has a shop (Tolu’s Gadgets).
- Stores: `store@` (Ikeja), `lekki@`, `surulere@`, `yaba@`, `vi@drawmart.test`.

To start over, sign in as an admin, open **Live draws & demo**, and press **Reset test data**. It deletes every listing, ticket, result, order, wallet entry, top-up, chat, boost, seller application and page view; puts the sample stores and listings back; creates any missing test accounts; and gives every buyer the starting ₦25,000. Accounts and their roles are kept. It refuses to run once test mode is off.

On a project that's never been seeded, the same thing from the **SQL Editor**: `select private.seed_demo_data(); select private.seed_test_accounts();`

The test accounts use a published password, so anyone who reads the repo can sign in as them. That's fine with test money; they're never created once test mode is off, but **delete them before going live** (Authentication → Users, search `drawmart.test`).

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
- Switch Flutterwave to live keys (`FLWPUBK-…` in the app, `FLWSECK-…` in Supabase secrets) at the same time as test mode goes off, and set the live webhook in Flutterwave's live dashboard.
- A way for admins to see deposits marked failed (paid short, or the wrong currency) and settle them with Flutterwave.
- KYC (NIN/BVN) to set `age_verified` and `state` on profiles. Until then, new accounts can't buy tickets outside test mode.
- Store payouts and caution-fee charging.
- **Draw fairness:** today the server makes the closing reference, so a dishonest operator could in theory retry it. Before launch, take it from a public randomness source after the draw closes, such as a [drand](https://drand.love) round.
- Custom SMTP, your production URL in **Redirect URLs**, and the same env vars on your hosting (Vercel, Netlify…).
