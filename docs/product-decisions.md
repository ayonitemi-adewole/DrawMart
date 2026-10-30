# Product decisions (as of 28 Oct 2026, store listing flow updated same day)

Working name: DrawMart (placeholder)

## Decided
- **Launch market:** Lagos only, under an LSLGA public online lottery licence. Expand state by state; restrict ticket purchases by state in the code from day one.
- **Separate apps:** Buyer, store and admin are separate apps, entered only through one shared sign-in page that sends each account to its own app. Each account belongs to exactly one app; store and admin accounts can't buy tickets. Sign-ups are buyers; DrawMart sets up store accounts after verification. Browsing draws stays public.
- **Regular products:** Stores list each item as a raffle draw or a regular product. Regular products get an admin review, then go straight on sale at a fixed price; no tickets, escrow or caution fee, and the item stays with the store. The store pays the platform fee (10–30%) out of the sale.
- **Buy now:** Anything on sale at a fixed price (regular products, and draws that ended unsold) is bought from the wallet, store credit first. Fixed-price buys don't count towards the weekly ticket-spending limit. The buyer gives a Lagos delivery address and phone; the store marks the order sent; the buyer confirms delivery, and only then is the store due its payout. One unit per listing.
- **Messages:** Buyers can message the seller (store or individual) of any regular product from its page; one chat per buyer per product, readable only by the two of them. No chat on raffles: DrawMart holds and checks those items. Sellers can opt in to a call number that buyers see only inside a chat with them. Messages that look like a request to pay outside DrawMart (an account number, "transfer to my Opay") get a warning for the reader. Chats refresh every few seconds while open.
- **Seller insights:** Stores (Insights in the store app) and individual sellers (Sell → Insights) see, for the last 7 or 30 days: views, different visitors, buyer chats, tickets or items sold, sales in naira, and the share of visitors who bought, in total, per day and per listing, with a plain-language tip per live listing. A view is one visitor opening a listing page, once per visitor per listing per Lagos day; signed-in visitors count by account, signed-out ones by a random browser id. The seller's own visits don't count. Ticket sales on refunded draws don't count. Sellers never see who viewed.
- **Boosts (paid promotion):** Stores and individual sellers can pay to show a live draw or an item on sale in the explore page's Sponsored banner (an automatic carousel under the hero, one boosted item at a time, every 5 seconds) and first on the home page and in its category, marked "Sponsored". Fixed packages: 3 days ₦2,500, 7 days ₦5,000, 14 days ₦9,000 (placeholders, in `public.boost_packages`). Paid by card/bank through Flutterwave and started only after the server verifies the payment; a new boost on an already-boosted listing runs on after the current one. Boosts unlock once 1,000 buyers have been active in the last 30 days (bought a ticket or item, or topped up by card/bank); an admin can change that number or open boosts early. At most 12 run at once app-wide, and each list shows at most 4 sponsored items at the top. Not refunded if the item sells or the draw ends early. Sellers see when a boost payment is still pending, when a boost is active, and its results: views, people, chats, units sold and sales during the boost against the same number of days just before it.
- **Explore and browsing:** The explore page groups live draws and buy-now items by category, each in one row that scrolls sideways (at most 4 cards in view on large screens: 3 whole and three-quarters of the next, so it's clear the row scrolls; 2 + ¾ on tablets, 1 + ¾ on phones), with an "All …" link to `/browse`, which shows everything for a category, a seller or a search, 15 items a page.
- **Related items:** Under every listing: a scrolling row of more items from the same seller ("All from …" opens that seller's items), then a scrolling row of similar items from other sellers ("All …" opens the category). Same layout as the explore page.
- **Sellers:** Raffle draws: registered stores and companies only (CAC verified, admin-approved). Regular products: stores, and individuals who pass an ID check.
- **Individual sellers:** Any buyer can apply under **Sell** in the buyer app with their legal name, NIN, phone, home address, a photo of a government ID and a selfie holding it. An admin compares them against a checklist and approves (opening a shop) or sends it back with a reason. Individuals keep their buyer account, sell regular products only (each listing still reviewed), can't buy their own items, and get paid after the buyer confirms delivery. ID photos sit in a private bucket only the applicant and admins can open.
- **Escrow:** DrawMart collects the item from the store (the store books a pickup day and address) and verifies it in escrow before tickets go on sale. Seller is paid after the winner confirms delivery.
- **Cars:** Too big to store, so they skip escrow. The store books an on-site inspection (car, VIN, papers, photos) instead, and the car stays with the dealer until the winner collects it.
- **Caution fee:** Paid by the store when it sends a listing for review. Refunded with the payout if the draw sells out; kept to cover pickup/return or the inspection visit if it doesn't sell out or is rejected.
- **Shared pickups:** A store can send 2 to 10 draw items in one pickup and pay one caution fee, the highest among the items. Each item keeps its own listing, admin review and draw. The whole fee is refunded only once every draw in the pickup has sold out, and kept as soon as any one ends another way (unsold, kept on sale, or rejected). Cars can't share a pickup, because each is inspected where it is; regular products have no pickup or fee.
- **Pinned locations:** Delivery checkout and pickup/inspection booking use a live map: the buyer or store pins the exact spot (drag the map, search, or use their location) and gives a written address. A pin inside Lagos is required on new orders and bookings. The pin is as private as the address: buyer, store and admins for orders; store and admins for bookings. Stores and admins get a directions link. Uses OpenStreetMap maps and Nominatim lookups, so the map area and pinned point are sent to OpenStreetMap's servers.
- **Saved pickups:** While listing draw items, a store can continue to pickup details, save and add another item, or save and come back later to add more or book the pickup. One saved pickup per store; no listing exists and no fee is paid until it's sent. It lasts 7 days from the first save (`app_settings.saved_pickup_days` and `RULES.savedPickupDays`); edits don't extend it, and afterwards the items are removed. Cars can't be saved, because they can't share a pickup.
- **Categories:** No perishable goods (Food removed), since items can sit in escrow for weeks.
- **Deadlines:** The store picks the draw length, 3–60 days, counted from approval.
- **Unsold draws:** The store picks one of: refund buyers; extend once by 7 days, then refund; or refund buyers and keep the item on DrawMart as a regular product at a fixed price the store sets when listing.
- **Fees:** DrawMart sets the platform fee from the item's value; sellers (stores and individuals) never choose the rate and the form doesn't show it, only the naira fee and their payout. Under ₦50,000: 7.5%; ₦50,000–₦499,999: 5%; ₦500,000–₦4,999,999: 3%; ₦5,000,000 and up: 2.5% (the floor). Raffles are rated on the item price, products on the sale price. On raffles the store still picks who carries the fee: store pays (launch default, so buyers see one clean ticket price) / buyer pays / split. Products: the seller always pays it.
- **Payments:** Users top up a wallet; tickets are bought from the wallet to avoid gateway fees on small tickets. Store credit is spent before cash.
- **Top-up provider:** Flutterwave (card, bank transfer, USSD), test keys only until the licence is granted. A top-up is ₦100 to ₦500,000. The wallet is credited only after our server verifies the payment with Flutterwave.
- **Draws:** Provably fair. Publish SHA-256 of a secret seed before sales; at sell-out, winner = SHA-256(seed:last-ticket-ref) mod total + 1; reveal seed after. Stream draws live.
- **Consolation:** Losing tickets return a share (default 20%) of spend as store credit.
- **Responsible gaming:** 18+ KYC, max 20 tickets per person per draw, user-set weekly spending limit (lowering instant, raising waits 24h).
- **No real money** until the licence is granted; run in test mode. Test mode has shared-password test accounts (6 buyers, one an ID-verified seller, and 5 stores) and an admin "Reset test data" button; delete the test accounts before launch.
- **Tech:** React + TypeScript + Tailwind v4 (Vite), React Router, TanStack Query. UI talks only to a `DrawMartApi` interface. **Backend: Supabase** (Postgres + Auth + Storage), with all writes as database functions; the in-browser mock stays for demos.

## Open
- Caution fee amounts. Placeholders in `src/domain/listing.ts`: ₦2,500 phones/fashion, ₦7,500 electronics, ₦10,000 home, ₦25,000 cars.
- Whether the caution fee should also be kept when admin rejects a listing before pickup happens (currently: kept in every non-sell-out case).
- Order problems: cancellations, refunds if a store can't deliver, and disputes (not built yet; admins handle them by hand).
- Automatic NIN verification with NIMC through a KYC provider (Dojah, Prembly, Smile ID), instead of only an admin's eyes. Also: how long to keep ID photos and NINs after review (NDPA 2023), and whether to encrypt the NIN column.
- Limits for new individual sellers (e.g. price cap or number of live items until they have good sales), and removing a seller's shop.
- Messages: instant delivery (Supabase Realtime) and email/push notifications for new messages; letting users report or block someone, and whether admins can read a chat when a report comes in; in-app voice calls instead of a phone number.
- Insights: signed-out views can be inflated by someone clearing their browser or scripting visits; add bot filtering or rate limits per IP before sellers rely on the numbers (or before paid promotion, idea 6). How long to keep raw view rows. Where a view came from (search, home page, shared link).
- Boosts: final package prices; whether a boost should pause or refund when its listing sells out early; whether paid placement needs approval under the LSLGA licence (it promotes lottery draws, not just products); a waiting list when all slots are taken.
- Map provider for launch: OpenStreetMap's public map and lookup servers are fine for testing but their usage policy rules out heavy use; move to a paid or self-hosted provider (Mapbox, MapTiler, Google) before launch. Also check the privacy notice covers sending locations to that provider (NDPA 2023). Delivery fees by distance could use the pins later.
- Stock: one unit per listing today. Should regular products have a quantity?
- "Skip the draw: buy now" on a live raffle (the button still says "coming next").
- Whether selling regular fixed-price items affects the LSLGA licence terms; check with the gaming lawyer.
- Draw fairness: the closing reference is generated by our server; take it from a public randomness source (e.g. drand) before launch.
- Store payouts and caution-fee charging: Flutterwave transfers too, or another provider.
- Whether ₦500,000 is the right single top-up cap, and whether to add a daily deposit cap for responsible gaming.
- Final name and brand.
- The fee tier rates and boundaries above are placeholders (edit `public.fee_tiers` and `FEE_TIERS` in `src/domain/fees.ts` together).

## Status
- Clickable prototype (buyer app + merchant dashboard) built as a design canvas in Claude.
- Frontend MVP on a mock backend (this repo).
- Supabase backend: schema, security rules, draw/wallet/listing functions, email sign-in. Setup: docs/supabase-setup.md.
- Flutterwave top-ups (test mode): checkout in the wallet, verification in Supabase Edge Functions, webhook for late bank transfers.

## Legal context
- Since the Supreme Court ruling of 22 Nov 2024, lotteries are regulated by each state, not federally (the FCT is separate). The National Lottery Act 2005 was struck down.
- A ticket-for-a-prize-by-chance model counts as a lottery under Lagos rules, so it needs an LSLGA licence. The "promotional raffle" category excludes standalone, continuous gaming businesses.
- Several northern states restrict gambling; plan expansion state by state.
- Get advice from a Nigerian gaming lawyer before launch.
