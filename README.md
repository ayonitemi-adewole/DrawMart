# DrawMart

A Lagos marketplace where verified stores list real items and buyers get tickets for a fraction of the price. When every ticket sells, a provably fair draw picks the winner. Losing buyers get part of their spend back as store credit.

> **Status:** runs on an in-browser mock by default, or on Supabase (see [docs/supabase-setup.md](docs/supabase-setup.md)). **Test mode only: no real money.** Do not take real payments until the LSLGA licence is in place.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # domain, mock API and database tests (Vitest + PGlite)
npm run typecheck
npm run lint       # oxlint
npm run build
```

To run against Supabase instead of the mock, follow [docs/supabase-setup.md](docs/supabase-setup.md) and set `VITE_BACKEND=supabase` in `.env.local`.

Routes:

| Path | What |
|---|---|
| `/` | Live draws, category filter |
| `/listings/:id` | Item page, ticket picker, demo controls |
| `/tickets` | Your tickets, waiting and finished |
| `/draws`, `/draws/:id` | Results, with in-browser verification |
| `/wallet` | Balance, store credit, test top-ups, weekly limit, state of residence |
| `/merchant` | Store dashboard: new listing, then pickup or inspection booking and caution fee |
| `/admin` | Approve listings once the item is in escrow or the car has passed inspection |

Demo data lives in `localStorage`; **Wallet → Reset demo data** starts over.

## How it's built

```
src/
  domain/      Pure business logic, no React. Shared with the future backend.
    types.ts     Listing, Ticket, LedgerEntry, DrawResult… (money is integer kobo)
    money.ts     Formatting/parsing ₦, basis-point maths
    fees.ts      Listing economics: ticket count, buyer price, payout, platform cut
    listing.ts   Submission rules: deadline, unsold fallback price, pickup/inspection, caution fee
    draw.ts      Commit–reveal draw: SHA-256 commitment, winner calc, verifier
    rules.ts     Purchase rules: licensed states, 18+, per-person cap, weekly limit…
  api/
    types.ts     DrawMartApi interface: the contract the backend must implement
    mock.ts      localStorage implementation of that contract
    supabase.ts  Supabase implementation (reads via RLS, writes via RPC)
  lib/flutterwave.ts  Flutterwave checkout modal (top-ups on Supabase)
    hooks.ts     TanStack Query hooks used by pages
    index.ts     Picks the implementation from VITE_BACKEND
  components/  UI kit, icons, toasts, listing card
  layouts/     Buyer shell (mobile bottom nav) and back-office shell
  pages/       Screens (/login only matters with Supabase; browsing never needs an account)
supabase/
  migrations/  Schema, row-level security, and the database functions for every write
  seed.sql     Sample stores and draws
  tests/       Runs the migration in PGlite and checks it against src/domain
```

The UI only talks to `DrawMartApi`. To add a real backend, implement that interface (Supabase, NestJS, …) and change one line in `src/api/index.ts`. `src/api/mock.test.ts` describes the behaviour the backend must match.

## Key rules (src/domain/rules.ts)

- Tickets sold only to users in licensed states (Lagos), 18+.
- Max 20 tickets per person per draw.
- Weekly spending limit; lowering is instant, raising waits 24 h.
- Store credit is spent before cash.
- Losing buyers get 20% of their spend back as store credit.
- Platform fee is at least 10% of the price.
- Stores pick the deadline: 3–60 days, counted from approval.
- Unsold at deadline, the store's choice: refund to wallet; extend once by 7 days, then refund; or refund and keep the item on sale at a fixed price the store set up front.
- No perishables (no Food category).
- After the listing form, the store books a pickup into escrow, or for cars an on-site inspection, and pays a caution fee. It's refunded with the payout on a sell-out and kept to cover delivery otherwise.
- Merchant listings go live only after admin approval (item checked into escrow, or car inspected).

## How draws stay fair

1. When a listing is created, the server generates a secret seed and publishes only `SHA-256(seed)`.
2. The purchase that sells the last ticket produces a reference nobody could predict.
3. `winner = SHA-256(seed + ":" + reference) mod ticketCount + 1`
4. The seed is revealed; anyone can check it matches the commitment and recompute the winner (the result page does this in the browser).

**Production note:** seeds must be generated and stored server-side only and never sent to clients before the draw. The mock keeps them out of API responses to mimic this.

## Before going live

- Finish the Supabase setup for production (see the last section of docs/supabase-setup.md).
- Payments (bank transfer / card) and payouts to merchants after delivery confirmation.
- KYC (NIN/BVN) for age and state of residence.
- Merchant onboarding with CAC verification, escrow check-in, product photo uploads.
- Buy-now checkout.
- LSLGA licence.
