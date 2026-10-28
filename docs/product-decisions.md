# Product decisions (as of 28 Oct 2026)

Working name: DrawMart (placeholder)

## Decided
- **Launch market:** Lagos only, under an LSLGA public online lottery licence. Expand state by state; restrict ticket purchases by state in the code from day one.
- **Sellers:** Registered stores and companies only (CAC verified, admin-approved). No individual sellers at launch.
- **Escrow:** Item is delivered to a DrawMart escrow point and verified before tickets go on sale. Seller is paid after the winner confirms delivery.
- **Fees:** Platform fee is a per-listing setting: store pays / buyer pays / split. Launch default: store pays, so buyers see one clean ticket price.
- **Payments:** Users top up a wallet; tickets are bought from the wallet to avoid gateway fees on small tickets. Store credit is spent before cash.
- **Draws:** Provably fair. Publish SHA-256 of a secret seed before sales; at sell-out, winner = SHA-256(seed:last-ticket-ref) mod total + 1; reveal seed after. Stream draws live.
- **Consolation:** Losing tickets return a share (default 20%) of spend as store credit.
- **Responsible gaming:** 18+ KYC, max 20 tickets per person per draw, user-set weekly spending limit (lowering instant, raising waits 24h).
- **No real money** until the licence is granted; run in test mode.
- **Tech:** React + TypeScript + Tailwind v4 (Vite), React Router, TanStack Query. UI talks only to a `DrawMartApi` interface; backend to be chosen later.

## Open
- What happens to unsold draws (current default: merchant picks refund, or extend once by 7 days then refund).
- Backend choice (Supabase vs Node/NestJS).
- Final name and brand.
- Fee percentage per category.

## Status
- Clickable prototype (buyer app + merchant dashboard) built as a design canvas in Claude.
- Frontend MVP on a mock backend (this repo). 34 tests on domain logic and mock API.

## Legal context
- Since the Supreme Court ruling of 22 Nov 2024, lotteries are regulated by each state, not federally (the FCT is separate). The National Lottery Act 2005 was struck down.
- A ticket-for-a-prize-by-chance model counts as a lottery under Lagos rules, so it needs an LSLGA licence. The "promotional raffle" category excludes standalone, continuous gaming businesses.
- Several northern states restrict gambling; plan expansion state by state.
- Get advice from a Nigerian gaming lawyer before launch.
