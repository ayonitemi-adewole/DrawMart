# DrawMart: notes for Claude Code

Ticket-draw marketplace for Lagos. React 19 + TypeScript + Tailwind v4 + Vite, React Router, TanStack Query. Backend not chosen yet; the app runs on an in-browser mock.

## Commands
- `npm run dev`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
- Run `npm run typecheck && npm test && npm run lint` before committing.

## Rules of the codebase
- **Money is integer kobo** everywhere (`Kobo` type). Format only at the edge with `formatNaira`. Never use floats for money.
- **Business rules live in `src/domain/`** as pure functions with tests. Pages must not re-implement them; import from `domain/rules.ts`, `domain/fees.ts`, `domain/draw.ts`.
- **Pages talk only to `DrawMartApi`** through the hooks in `src/api/hooks.ts`. Don't import `mock.ts` from pages.
- When adding an API method: add it to `src/api/types.ts`, implement it in `mock.ts`, cover it in `mock.test.ts`, then add a hook.
- Wallet balances are derived from the append-only ledger; never store a balance.
- Draw seeds are secret until the draw runs. Never include `seed` in a listing response before `status === 'drawn'`.
- Design tokens are in `src/index.css` (`@theme`): use `bg-brand`, `text-muted`, `bg-ticket` etc., not raw hex values.
- Touch targets ≥ 44px (`min-h-11`), real `<button>`/`<a>`/`<label>`, `aria-label` on icon-only buttons.
- Test mode (`api.testMode`) shows demo controls and the test banner. Never let demo helpers run against a real backend.

## Open product decisions
- Final rule for unsold draws (currently merchant picks refund or extend-once).
- Backend choice (Supabase vs. Node/NestJS).
- Fee % per category.
