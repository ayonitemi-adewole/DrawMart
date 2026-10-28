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
- Access in the UI comes from `useAccess()` (signed in / store / admin; everything allowed on the mock). Guard routes with `RequireSignIn`; browsing stays public.
- Wallet balances are derived from the append-only ledger; never store a balance.
- Draw seeds are secret until the draw runs. Never include `seed` in a listing response before `status === 'drawn'`.
- Design tokens are in `src/index.css` (`@theme`): use `bg-brand`, `text-muted`, `bg-ticket` etc., not raw hex values. Dark mode overrides the same tokens under `.dark`, so don't add `dark:` colour variants; use `text-on-brand` / `text-on-ticket` / `text-on-hero` for text on those fills.
- Reuse the UI kit before writing new markup: `components/ui.tsx` (Button/`buttonClass`, Card, Badge, Notice, Segmented, StatTile, EmptyState, Field/`inputCls`), `Sheet` for modals, `Countdown`, `TicketStub`.
- Touch targets ≥ 44px (`min-h-11`), real `<button>`/`<a>`/`<label>`, `aria-label` on icon-only buttons.
- Test mode (`api.testMode`) shows demo controls and the test banner. Never let demo helpers run against a real backend.

## Product decisions
Read `docs/product-decisions.md` before changing business rules. It records what's decided, what's still open, and the legal context. Update it when a decision changes.
