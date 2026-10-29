# DrawMart: notes for Claude Code

Ticket-draw marketplace for Lagos. React 19 + TypeScript + Tailwind v4 + Vite, React Router, TanStack Query. Backend not chosen yet; the app runs on an in-browser mock.

## Commands
- `npm run dev`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
- Run `npm run typecheck && npm test && npm run lint` before committing.

## Rules of the codebase
- **Money is integer kobo** everywhere (`Kobo` type). Format only at the edge with `formatNaira`. Never use floats for money.
- **Business rules live in `src/domain/`** as pure functions with tests. Pages must not re-implement them; import from `domain/rules.ts`, `domain/fees.ts`, `domain/draw.ts`.
- **Pages talk only to `DrawMartApi`** through the hooks in `src/api/hooks.ts`. Don't import `mock.ts` from pages.
- When adding an API method: add it to `src/api/types.ts`, implement it in `mock.ts` (test in `mock.test.ts`) and in `supabase.ts`, then add a hook.
- Supabase: clients only read tables (RLS); every write is a `security definer` function in a new migration under `supabase/migrations/`, granted to `authenticated`. Never edit a pushed migration. Mirror `src/domain` rules in SQL and cover them in `supabase/tests/db.test.ts` (PGlite, runs in `npm test`).
- Secrets (draw seeds) live in the `private` schema, which the API doesn't expose. Never use the Supabase secret key in the app.
- `draw_results.winner_user_id` is not readable by clients: select named columns, never `*`, and derive "you won" from the user's own tickets.
- Buyer (`/`), store (`/store`) and admin (`/admin`) are separate apps that never link to each other; everyone enters through `/login`, which sends each account to its own app (`src/lib/apps.ts`). Each account has exactly one `role` (`profiles.role`, `AuthSession.role`); only buyers hold tickets or wallet money (enforced in SQL). Use `useAccess().role` and guard routes with `<RequireSignIn role=…>`; buyer browsing stays public. The mock has demo accounts (`src/api/demoAccounts.ts`) so it goes through sign-in too.
- Wallet balances are derived from the append-only ledger; never store a balance.
- The platform fee rate is never a seller input: it's `platformFeeBps(price)` (`src/domain/fees.ts` FEE_TIERS ↔ `public.fee_tiers`), set by the database when a listing is created. Don't show the percentage to sellers or add a fee control to their forms; show the naira fee and payout.
- Individual sellers are buyer accounts with `profiles.seller_id` (an `individual` merchant), created when an admin approves their `seller_applications` ID check. They sell regular products only, never raffles; `private.my_merchant_id()` covers both stores and individuals. NINs and ID photos (private `seller-ids` bucket) are only for the applicant and admins: never show them to buyers or stores. In the UI, `useHasShop()` gates shop data; the seller tools are `/sell` in the buyer app.
- Listings have a `kind`: `raffle` (tickets, escrow, caution fee) or `product` (fixed price, admin review only, no tickets/handover/caution fee). Anything `for_sale` is bought with `buyNow` → an `Order` (paid → dispatched by the store → delivered, confirmed by the buyer). Price and checkout rules live in `src/domain/orders.ts` (`salePriceKobo`, `checkOrder`); products have `ticketCount` 0, so guard any ticket maths.
- Real top-ups go through `api.payments` (Flutterwave, Supabase only). Only `complete_deposit`, called by the Edge Functions in `supabase/functions/` after Flutterwave's verify API confirms the payment, may credit a deposit; never trust the browser's checkout result. The Flutterwave secret key lives only in Supabase secrets. Test keys while test mode is on.
- Draw seeds are secret until the draw runs. Never include `seed` in a listing response before `status === 'drawn'`.
- Design tokens are in `src/index.css` (`@theme`): use `bg-brand`, `text-muted`, `bg-ticket` etc., not raw hex values. Dark mode overrides the same tokens under `.dark`, so don't add `dark:` colour variants; use `text-on-brand` / `text-on-ticket` / `text-on-hero` for text on those fills.
- Reuse the UI kit before writing new markup: `components/ui.tsx` (Button/`buttonClass`, Card, Badge, Notice, Segmented, StatTile, EmptyState, Field/`inputCls`), `Sheet` for modals, `Countdown`, `TicketStub`.
- Touch targets ≥ 44px (`min-h-11`), real `<button>`/`<a>`/`<label>`, `aria-label` on icon-only buttons.
- Test mode (`api.testMode`) shows demo controls (admin app, Live draws) and the test banner. Never let demo helpers run against a real backend.

## Product decisions
Read `docs/product-decisions.md` before changing business rules. It records what's decided, what's still open, and the legal context. Update it when a decision changes.
