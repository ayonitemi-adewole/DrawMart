/**
 * In-browser mock backend. Everything lives in localStorage, money is fake,
 * and a little latency is added so loading states get exercised.
 *
 * It enforces the same rules a real backend must (src/domain/rules.ts), and
 * keeps draw seeds out of every response until a draw has run, so the UI is
 * built against realistic behaviour.
 */
import { commitmentFor, createSeed, randomHex, winningTicketNumber } from '@/domain/draw'
import { LISTING_ERROR_TEXT, computeListingEconomics, platformFeeBps, validateListingEconomics } from '@/domain/fees'
import {
  HANDOVER_ERROR_TEXT,
  LISTING_TERMS_ERROR_TEXT,
  addDays,
  cautionFeeFor,
  handoverMethodFor,
  isNigerianMobile,
  localDate,
  settleCautionFee,
  validateHandover,
  validateListingTerms,
} from '@/domain/listing'
import { nairaToKobo } from '@/domain/money'
import { DEMO_ACCOUNTS } from './demoAccounts'
import {
  PURCHASE_ERROR_TEXT,
  RULES,
  balanceFromLedger,
  checkPurchase,
  consolationCredit,
  spentInLastWeek,
  splitPayment,
  topUpError,
} from '@/domain/rules'
import { DELIVERY_ERROR_TEXT, ORDER_ERROR_TEXT, PRODUCT_ERROR_TEXT, checkOrder, saleEconomics, salePriceKobo, validateDelivery, validateProduct } from '@/domain/orders'
import { MAX_MESSAGES_PER_MINUTE, messageError } from '@/domain/messages'
import { fillDays, lagosDay } from '@/domain/metrics'
import { BOOST_DEFAULTS, BOOST_ERROR_TEXT, DEFAULT_BOOST_PACKAGES, boostEndsAt, boostWindow, boostsUnlocked, canBoost } from '@/domain/boosts'
import { SELLER_APPLICATION_ERROR_TEXT, normalizeNin, validateSellerApplication } from '@/domain/sellers'
import type { Category, DrawResult, LedgerEntry, Listing, ListingStatus, Merchant, Order, Ticket, UnsoldPolicy, User } from '@/domain/types'
import {
  ApiError,
  type DrawMartApi,
  type DrawResultView,
  type ListingFilter,
  type ListingView,
  type NewListingInput,
  type WalletView,
  type NewProductInput,
  type SellerApplicationView,
  type ChatMessage,
  type ChatSide,
  type ConversationView,
  type ListingMetrics,
  type BoostSettings,
  type BoostView,
  type BoostInsightsView,
  type MerchantMetricsView,
  type OrderView,
  type AuthAdapter,
  type AuthSession,
} from './types'

const STORAGE_KEY = 'drawmart:mock-db:v8' // bump when seed data or the Db shape changes
const SESSION_KEY = 'drawmart:mock-session'
const ME = 'u-me'
const MY_MERCHANT = 'm-ikeja'
const CROWD = 'u-crowd'
const DAY = 24 * 60 * 60 * 1000

interface Db {
  users: User[]
  merchants: Merchant[]
  listings: Listing[]
  /** Server-side secrets. Never returned before the draw. */
  seeds: Record<string, string>
  tickets: Ticket[]
  ledger: LedgerEntry[]
  results: DrawResult[]
  pendingLimits: Record<string, { amountKobo: number; effectiveAt: string }>
  orders: Order[]
  /** The demo buyer's application to sell, if any. */
  sellerApplication: SellerApplicationView | null
  /** The demo buyer's own shop once approved. */
  sellerShopId: string | null
  conversations: MockConversation[]
  messages: ChatMessage[]
  /** Opt-in call numbers by merchant id. */
  callPhones: Record<string, string>
  /** One per visitor per listing per Lagos day. */
  views: { listingId: string; visitor: string; day: string }[]
  boosts: (Omit<BoostView, 'listingTitle' | 'merchantName'> & { merchantId: string })[]
  boostSettings: BoostSettings
}

interface MockConversation {
  id: string
  listingId: string
  buyerId: string
  merchantId: string
  lastMessageAt: string
  buyerReadAt: string
  sellerReadAt: string
}

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function memoryStore(): KeyValueStore {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
}

const uid = (prefix: string) => `${prefix}-${randomHex(6)}`
const iso = (ms: number) => new Date(ms).toISOString()

// ---------------------------------------------------------------- seed data

const MERCHANTS: Merchant[] = [
  { id: MY_MERCHANT, kind: 'store', name: 'Ikeja Partner Store', area: 'Ikeja', cacNumber: 'RC [NUMBER]', verified: true },
  { id: 'm-lekki', kind: 'store', name: 'Lekki Partner Store', area: 'Lekki', cacNumber: 'RC [NUMBER]', verified: true },
  { id: 'm-surulere', kind: 'store', name: 'Surulere Partner Store', area: 'Surulere', cacNumber: 'RC [NUMBER]', verified: true },
  { id: 'm-yaba', kind: 'store', name: 'Yaba Partner Store', area: 'Yaba', cacNumber: 'RC [NUMBER]', verified: true },
  { id: 'm-vi', kind: 'store', name: 'Victoria Island Partner Dealer', area: 'Victoria Island', cacNumber: 'RC [NUMBER]', verified: true },
]

interface SeedListing {
  merchantId: string
  title: string
  description: string
  category: Category
  images?: string[]
  price: number
  ticket: number
  sold: number
  closesInHours: number
  status?: Extract<ListingStatus, 'live' | 'pending_review' | 'for_sale'>
  unsold?: UnsoldPolicy
  /** Naira; regular price for convert_to_sale listings. */
  fallback?: number
}

const img = (...files: string[]) => files.map((f) => `/assets/${f}`)

const SEED_LISTINGS: SeedListing[] = [
  {
    merchantId: MY_MERCHANT, title: 'iPhone 18 Pro Max, 256GB', category: 'Phones', images: img('iphone18pmBurgundy.jpg', 'iphone18pmBlack.jpg', 'iphone18pmGlacier.jpg'),
    description: 'Brand new and sealed, with a one-year store warranty. The winner picks Burgundy, Black or Glacier.',
    price: 2_600_000, ticket: 5_000, sold: 448, closesInHours: 28,
  },
  {
    merchantId: 'm-lekki', title: 'Samsung Galaxy S26 Ultra, 512GB', category: 'Phones', images: img('samsungS26Ultra.jpg'),
    description: 'Brand new and sealed, with S Pen and local warranty.',
    price: 2_100_000, ticket: 5_000, sold: 230, closesInHours: 60,
  },
  {
    merchantId: 'm-lekki', title: 'LG 55-inch 4K UHD TV + soundbar', category: 'Electronics', images: img('LG55inchSmartTv.jpg'),
    description: 'Smart TV with matching soundbar. Delivery and wall mounting anywhere in Lagos included.',
    price: 650_000, ticket: 2_500, sold: 241, closesInHours: 9, unsold: 'extend_once',
  },
  {
    merchantId: 'm-surulere', title: 'Samsung 65-inch 4K smart TV', category: 'Electronics', images: img('samsung65inch4KTV.jpg'),
    description: 'Crystal UHD smart TV with remote and wall bracket.',
    price: 950_000, ticket: 2_500, sold: 190, closesInHours: 48, unsold: 'convert_to_sale', fallback: 990_000,
  },
  {
    merchantId: MY_MERCHANT, title: 'MacBook Pro 14-inch, M5', category: 'Electronics', images: img('macbookProM5.jpg', 'macbookProM5-2.jpg'),
    description: '16GB unified memory, 512GB SSD. Brand new with manufacturer warranty.',
    price: 3_200_000, ticket: 5_000, sold: 85, closesInHours: 144,
  },
  {
    merchantId: 'm-yaba', title: 'LG 75-inch smart TV', category: 'Electronics', images: img('LG75inchSmartTv.jpg'),
    description: 'Big-screen 4K smart TV. Delivery and installation included.',
    price: 1_450_000, ticket: 5_000, sold: 122, closesInHours: 96,
  },
  {
    merchantId: 'm-vi', title: 'Toyota Camry 2025', category: 'Cars', images: img('toyotaCamry2025.jpg'),
    description: 'Brand new with dealer warranty. Registration and plates in the winner’s name.',
    price: 48_000_000, ticket: 20_000, sold: 760, closesInHours: 288,
  },
  {
    merchantId: 'm-vi', title: 'Mercedes-AMG GLE 63 S Coupé 2025', category: 'Cars', images: img('mercedesBenzGle63s2025.jpg'),
    description: 'Foreign-used, inspected, papers complete. Registration in the winner’s name.',
    price: 210_000_000, ticket: 50_000, sold: 1_130, closesInHours: 480,
  },
  {
    merchantId: 'm-vi', title: 'Mercedes-AMG G 63 2025', category: 'Cars', images: img('MercedesG-wagon.jpg'),
    description: 'Brand new with full dealer history. Registration in the winner’s name.',
    price: 330_000_000, ticket: 50_000, sold: 540, closesInHours: 600,
  },
  {
    merchantId: 'm-yaba', title: '5kVA inverter + battery', category: 'Home',
    description: 'Inverter with two batteries, installed by the store.',
    price: 1_800_000, ticket: 6_000, sold: 122, closesInHours: 96,
  },
  // A draw that ended unsold and stayed on as a regular product.
  {
    merchantId: 'm-lekki', title: 'Samsung Galaxy S26 Ultra, 256GB', category: 'Phones', images: img('samsungS26UltraBlack.jpg'),
    description: 'Brand new and sealed, Titanium Black, with local warranty.',
    price: 1_700_000, ticket: 5_000, sold: 0, closesInHours: -48, status: 'for_sale', unsold: 'convert_to_sale', fallback: 1_650_000,
  },
  // Waiting in the admin queue.
  {
    merchantId: MY_MERCHANT, title: 'MacBook Pro 14-inch, M1 Pro', category: 'Electronics', images: img('macbookProM1Pro.jpg'),
    description: 'UK-used, excellent condition, battery health 92%. Charger included.',
    price: 1_100_000, ticket: 2_500, sold: 0, closesInHours: 168, status: 'pending_review',
  },
  {
    merchantId: 'm-vi', title: 'Mercedes-Benz S-Class 2025', category: 'Cars', images: img('mercedesBenzSClass2025.jpg'),
    description: 'Brand new S 580. Registration in the winner’s name.',
    price: 280_000_000, ticket: 50_000, sold: 0, closesInHours: 720, status: 'pending_review',
  },
]

/** Regular products: no draw. Naira prices. */
const SEED_PRODUCTS: { merchantId: string; title: string; description: string; category: Category; images: string[]; price: number; status: 'for_sale' | 'pending_review' }[] = [
  {
    merchantId: MY_MERCHANT, title: 'iPhone 18 Pro Max, 512GB, Glacier', category: 'Phones', images: img('iphone18pmGlacier.jpg'),
    description: 'Brand new and sealed, with a one-year store warranty. Ships in 2 days.', price: 2_950_000, status: 'for_sale',
  },
  {
    merchantId: 'm-surulere', title: 'Samsung 50-inch smart TV', category: 'Electronics', images: img('samsung50inchTV.jpg'),
    description: 'Crystal UHD smart TV with wall bracket. Delivery anywhere in Lagos.', price: 480_000, status: 'for_sale',
  },
  {
    merchantId: 'm-yaba', title: 'MacBook Pro 14-inch, M5, 1TB', category: 'Electronics', images: img('macbookProM5-2.jpg'),
    description: '24GB unified memory, 1TB SSD. Brand new with manufacturer warranty.', price: 3_850_000, status: 'for_sale',
  },
  {
    merchantId: 'm-vi', title: 'Mercedes-AMG G 63 2025, Night Black', category: 'Cars', images: img('mercedesBenzG632025.jpg'),
    description: 'Brand new, dealer warranty, registration in the buyer’s name. View at our VI showroom.', price: 345_000_000, status: 'pending_review',
  },
]

function productListing(input: NewProductInput & { merchantId: string; status: ListingStatus }, at: number): Listing {
  return {
    id: uid('L'), kind: 'product', merchantId: input.merchantId, title: input.title.trim(), description: input.description.trim(), category: input.category,
    images: input.images ?? [], priceKobo: input.priceKobo, ticketPriceKobo: 0, buyerTicketPriceKobo: 0, ticketCount: 0, ticketsSold: 0,
    feeMode: 'seller', feeBps: platformFeeBps(input.priceKobo), unsoldPolicy: 'refund', fallbackPriceKobo: null, durationDays: 0, extended: false,
    status: input.status, handover: null, cautionFee: { amountKobo: 0, status: 'none' }, commitment: '', createdAt: iso(at), closesAt: iso(at), boostedUntil: null,
  }
}

async function makeListing(s: SeedListing, now: number, seeds: Record<string, string>): Promise<Listing> {
  const id = uid('L')
  const merchant = MERCHANTS.find((m) => m.id === s.merchantId)!
  const status = s.status ?? 'live'
  const seed = createSeed()
  seeds[id] = seed
  const feeBps = platformFeeBps(nairaToKobo(s.price))
  const econ = computeListingEconomics({ priceKobo: nairaToKobo(s.price), ticketPriceKobo: nairaToKobo(s.ticket), feeBps, feeMode: 'seller' })
  return {
    id,
    kind: 'raffle',
    merchantId: s.merchantId,
    title: s.title,
    description: s.description,
    category: s.category,
    images: s.images ?? [],
    priceKobo: nairaToKobo(s.price),
    ticketPriceKobo: nairaToKobo(s.ticket),
    buyerTicketPriceKobo: econ.buyerTicketKobo,
    ticketCount: econ.ticketCount,
    ticketsSold: 0,
    feeMode: 'seller',
    feeBps,
    unsoldPolicy: s.unsold ?? 'refund',
    fallbackPriceKobo: s.fallback ? nairaToKobo(s.fallback) : null,
    durationDays: Math.max(RULES.minDurationDays, Math.ceil(s.closesInHours / 24)),
    extended: false,
    status,
    handover: {
      method: handoverMethodFor(s.category),
      address: `${merchant.name}, ${merchant.area}, Lagos`,
      contactPhone: '0803 000 0000',
      date: addDays(localDate(new Date(now)), status === 'pending_review' ? 2 : -3),
      slot: 'morning',
    },
    cautionFee: settleCautionFee({ amountKobo: cautionFeeFor(s.category), status: 'held' }, status),
    commitment: await commitmentFor(seed),
    createdAt: iso(now - 2 * DAY),
    closesAt: iso(now + s.closesInHours * 60 * 60 * 1000),
    boostedUntil: null,
  }
}

function crowdBuys(db: Db, listing: Listing, quantity: number, at: string): string {
  const purchaseId = `P-${randomHex(3).toUpperCase()}`
  for (let i = 0; i < quantity; i++) {
    listing.ticketsSold += 1
    db.tickets.push({ id: uid('T'), listingId: listing.id, userId: CROWD, number: listing.ticketsSold, purchaseId, purchasedAt: at })
  }
  return purchaseId
}

async function freshDb(): Promise<Db> {
  const now = Date.now()
  const db: Db = {
    users: [
      { id: ME, displayName: 'You', state: 'Lagos', weeklyLimitKobo: RULES.defaultWeeklyLimitKobo, ageVerified: true },
      { id: CROWD, displayName: 'Other buyers', state: 'Lagos', weeklyLimitKobo: Number.MAX_SAFE_INTEGER, ageVerified: true },
      { id: 'u-ada', displayName: 'Ada O.', state: 'Lagos', weeklyLimitKobo: RULES.defaultWeeklyLimitKobo, ageVerified: true },
    ],
    merchants: MERCHANTS.map((x) => ({ ...x })),
    listings: [],
    seeds: {},
    tickets: [],
    ledger: [{ id: uid('E'), userId: ME, kind: 'topup', cashKobo: nairaToKobo(25_000), creditKobo: 0, memo: 'Welcome top-up (test money)', createdAt: iso(now - DAY) }],
    results: [],
    pendingLimits: {},
    orders: [],
    sellerApplication: null,
    sellerShopId: null,
    conversations: [],
    messages: [],
    callPhones: { 'm-surulere': '0803 000 1234' },
    views: [],
    boosts: [],
    // The demo never reaches the real threshold, so boosts start switched on.
    boostSettings: { minActiveBuyers: BOOST_DEFAULTS.minActiveBuyers, forcedOn: true, maxActive: BOOST_DEFAULTS.maxActiveBoosts },
  }
  for (const p of SEED_PRODUCTS) {
    db.listings.push(productListing({ ...p, priceKobo: nairaToKobo(p.price) }, now - DAY))
  }
  for (const s of SEED_LISTINGS) {
    const l = await makeListing(s, now, db.seeds)
    // Spread seeded sales over the last fortnight so seller insights have a shape.
    if (s.sold) for (let day = 13, left = s.sold; left > 0; day = Math.max(0, day - 1)) {
      const n = day === 0 ? left : Math.min(left, Math.ceil((s.sold / 14) * (0.4 + Math.random() * 1.2)))
      crowdBuys(db, l, n, iso(now - day * DAY - 2 * 60 * 60 * 1000))
      left -= n
    }
    db.listings.push(l)
  }
  // Finished draws so the results page isn't empty.
  for (const [i, s] of ([
    { merchantId: MY_MERCHANT, title: 'MacBook Pro 13-inch, M1', description: 'UK-used, 8GB RAM, 256GB SSD.', category: 'Electronics', images: img('macbookProM1.jpg'), price: 900_000, ticket: 2_500, sold: 0, closesInHours: 1 },
    { merchantId: 'm-lekki', title: 'Samsung 50-inch smart TV', description: 'Crystal UHD smart TV with wall bracket.', category: 'Electronics', images: img('samsung50inchTV.jpg'), price: 420_000, ticket: 1_500, sold: 0, closesInHours: 1 },
    { merchantId: 'm-vi', title: 'Toyota Camry 2018', description: 'Foreign-used, inspected, papers complete.', category: 'Cars', images: img('toyotaCamry2018.jpg'), price: 14_000_000, ticket: 10_000, sold: 0, closesInHours: 1 },
  ] satisfies SeedListing[]).entries()) {
    const l = await makeListing(s, now - (2 + i * 2) * DAY, db.seeds)
    const at = iso(now - (2 + i * 2) * DAY)
    const ref = crowdBuys(db, l, l.ticketCount, at)
    db.listings.push(l)
    await runDraw(db, l, ref, at)
  }
  seedChats(db, now)
  seedViews(db, now)
  seedBoosts(db, now)
  return db
}

/** Two other stores already paid for boosts, so Sponsored shows on the home page. */
function seedBoosts(db: Db, now: number) {
  const picks = [
    db.listings.find((l) => l.merchantId === 'm-vi' && l.status === 'live'),
    db.listings.find((l) => l.merchantId === 'm-surulere' && l.kind === 'product' && l.status === 'for_sale'),
  ]
  for (const l of picks) {
    if (!l) continue
    const pkg = DEFAULT_BOOST_PACKAGES[1]
    l.boostedUntil = iso(now + 4 * DAY)
    db.boosts.push({ id: uid('B'), txRef: `BST-${randomHex(8).toUpperCase()}`, listingId: l.id, merchantId: l.merchantId, days: pkg.days, priceKobo: pkg.priceKobo, status: 'paid', startsAt: iso(now - 3 * DAY), endsAt: l.boostedUntil, createdAt: iso(now - 3 * DAY) })
  }
}

/** A month of made-up visits to the demo store's listings, so its insights aren't empty. */
function seedViews(db: Db, now: number) {
  for (const l of db.listings) {
    if (l.merchantId !== MY_MERCHANT || !['live', 'for_sale', 'drawn'].includes(l.status)) continue
    const popularity = 2 + Math.random() * 10
    for (let d = 29; d >= 0; d--) {
      const day = lagosDay(now - d * DAY)
      const n = Math.round(popularity * (0.5 + Math.random()) * (d < 10 ? 1.4 : 1))
      for (let i = 0; i < n; i++) db.views.push({ listingId: l.id, visitor: `v:seed-${i}`, day })
    }
  }
}

/** A chat the demo buyer started, and one waiting for the demo store, so both inboxes have something. */
function seedChats(db: Db, now: number) {
  const tv = db.listings.find((l) => l.kind === 'product' && l.merchantId === 'm-surulere')
  const phone = db.listings.find((l) => l.kind === 'product' && l.merchantId === MY_MERCHANT)
  const chat = (listing: Listing | undefined, buyerId: string, lines: [ChatSide, string, number][], readByBuyer: boolean) => {
    if (!listing) return
    const id = uid('C')
    for (const [sender, body, minsAgo] of lines) db.messages.push({ id: uid('X'), conversationId: id, sender, body, createdAt: iso(now - minsAgo * 60_000) })
    const last = iso(now - lines[lines.length - 1][2] * 60_000)
    db.conversations.push({ id, listingId: listing.id, buyerId, merchantId: listing.merchantId, lastMessageAt: last, buyerReadAt: readByBuyer ? last : iso(now - DAY), sellerReadAt: iso(now - DAY) })
  }
  chat(tv, ME, [
    ['buyer', 'Hi, does the TV come with the wall bracket?', 95],
    ['seller', 'Yes, bracket and remote are in the box. We can deliver to Yaba tomorrow.', 80],
  ], false)
  chat(phone, 'u-ada', [['buyer', 'Is the Glacier colour still available? Can I see it in person in Ikeja?', 30]], true)
}

// -------------------------------------------------------------- draw engine

async function runDraw(db: Db, listing: Listing, closingRef: string, at: string): Promise<void> {
  const seed = db.seeds[listing.id]
  const winningNumber = await winningTicketNumber(seed, closingRef, listing.ticketCount)
  const winner = db.tickets.find((t) => t.listingId === listing.id && t.number === winningNumber)
  if (!winner) throw new Error(`No ticket ${winningNumber} for ${listing.id}`)
  listing.status = 'drawn'
  listing.cautionFee = settleCautionFee(listing.cautionFee, 'drawn')
  db.results.push({ listingId: listing.id, commitment: listing.commitment, seed, closingRef, winningNumber, winnerUserId: winner.userId, drawnAt: at })

  // Consolation credit for every losing buyer (the crowd is a stand-in for many users).
  const losers = new Map<string, number>()
  for (const t of db.tickets) if (t.listingId === listing.id && t.userId !== winner.userId) losers.set(t.userId, (losers.get(t.userId) ?? 0) + 1)
  for (const [userId, count] of losers) {
    const credit = consolationCredit(count * listing.buyerTicketPriceKobo)
    if (credit > 0) db.ledger.push({ id: uid('E'), userId, kind: 'store_credit', cashKobo: 0, creditKobo: credit, memo: `Store credit · ${listing.title}`, listingId: listing.id, createdAt: at })
  }
}

/** Pays every ticket buyer back into the same buckets (cash/credit) the money came from. */
function refundBuyers(db: Db, l: Listing, at: string) {
  const paid = new Map<string, { cash: number; credit: number }>()
  for (const e of db.ledger) {
    if (e.listingId !== l.id || e.kind !== 'ticket_purchase') continue
    const p = paid.get(e.userId) ?? { cash: 0, credit: 0 }
    paid.set(e.userId, { cash: p.cash - e.cashKobo, credit: p.credit - e.creditKobo })
  }
  for (const [userId, p] of paid) {
    db.ledger.push({ id: uid('E'), userId, kind: 'refund', cashKobo: p.cash, creditKobo: p.credit, memo: `Refund · ${l.title} didn’t sell out`, listingId: l.id, createdAt: at })
  }
}

/**
 * Deadlines: extend once if the listing allows it; otherwise refund every
 * buyer, then either close the listing or keep it on as a regular product.
 */
function processDeadlines(db: Db, now: number): boolean {
  let changed = false
  for (const l of db.listings) {
    if (l.status !== 'live' || new Date(l.closesAt).getTime() > now) continue
    changed = true
    if (l.unsoldPolicy === 'extend_once' && !l.extended) {
      l.extended = true
      l.closesAt = iso(now + RULES.extensionDays * DAY)
      continue
    }
    refundBuyers(db, l, iso(now))
    l.status = l.unsoldPolicy === 'convert_to_sale' && l.fallbackPriceKobo ? 'for_sale' : 'refunded'
    l.cautionFee = settleCautionFee(l.cautionFee, l.status)
  }
  return changed
}

function applyPendingLimits(db: Db, now: number): boolean {
  let changed = false
  for (const [userId, p] of Object.entries(db.pendingLimits)) {
    if (new Date(p.effectiveAt).getTime() > now) continue
    const u = db.users.find((x) => x.id === userId)
    if (u) u.weeklyLimitKobo = p.amountKobo
    delete db.pendingLimits[userId]
    changed = true
  }
  return changed
}

// ------------------------------------------------------------------ views

function resultView(db: Db, r: DrawResult): DrawResultView {
  const l = db.listings.find((x) => x.id === r.listingId)!
  const myNumbers = db.tickets.filter((t) => t.listingId === l.id && t.userId === ME).map((t) => t.number)
  const myCreditKobo = db.ledger.filter((e) => e.userId === ME && e.kind === 'store_credit' && e.listingId === l.id).reduce((s, e) => s + e.creditKobo, 0)
  return { ...r, listingTitle: l.title, listingImage: l.images[0] ?? null, ticketCount: l.ticketCount, iWon: r.winnerUserId === ME, myNumbers, myCreditKobo }
}

/**
 * `full` is for the listing's own store and for admins. Buyers never see the
 * store's pickup address or phone number.
 */
function listingView(db: Db, l: Listing, audience: 'buyer' | 'full' = 'buyer'): ListingView {
  const merchant = db.merchants.find((m) => m.id === l.merchantId)!
  const myNumbers = db.tickets.filter((t) => t.listingId === l.id && t.userId === ME).map((t) => t.number)
  const r = db.results.find((x) => x.listingId === l.id)
  return { ...l, handover: audience === 'full' ? l.handover : null, merchant, myNumbers, result: r ? resultView(db, r) : null }
}

function conversationView(db: Db, c: MockConversation, me: ChatSide): ConversationView {
  const l = db.listings.find((x) => x.id === c.listingId)!
  const msgs = db.messages.filter((m) => m.conversationId === c.id)
  const last = msgs[msgs.length - 1]
  const readAt = me === 'buyer' ? c.buyerReadAt : c.sellerReadAt
  return {
    id: c.id, listingId: l.id, listingTitle: l.title, listingImage: l.images[0] ?? null, category: l.category,
    priceKobo: l.kind === 'product' ? l.priceKobo : (l.fallbackPriceKobo ?? l.priceKobo), listingStatus: l.status,
    merchantName: db.merchants.find((m) => m.id === c.merchantId)!.name,
    buyerName: db.users.find((u) => u.id === c.buyerId)?.displayName ?? 'Buyer',
    me,
    lastMessage: last ? { body: last.body, sender: last.sender, createdAt: last.createdAt } : null,
    unread: msgs.filter((m) => m.sender !== me && m.createdAt > readAt).length,
    callPhone: me === 'buyer' ? (db.callPhones[c.merchantId] ?? null) : null,
    updatedAt: c.lastMessageAt,
  }
}

/** One listing's numbers between two Lagos days, inclusive (metrics.ts ListingMetricsInput). */
function statsBetween(db: Db, l: Listing, from: string, to: string) {
  const inRange = (at: string) => {
    const day = lagosDay(at)
    return day >= from && day <= to
  }
  const views = db.views.filter((v) => v.listingId === l.id && v.day >= from && v.day <= to)
  // A refunded draw's tickets were paid back, so they aren't sales.
  const tickets = l.kind === 'raffle' && (l.status === 'live' || l.status === 'drawn') ? db.tickets.filter((t) => t.listingId === l.id && inRange(t.purchasedAt)) : []
  const orders = db.orders.filter((o) => o.listingId === l.id && inRange(o.createdAt))
  return {
    views: views.length,
    visitors: new Set(views.map((v) => v.visitor)).size,
    chats: db.conversations.filter((c) => c.listingId === l.id && inRange(c.lastMessageAt)).length,
    units: tickets.length + orders.length,
    // Demo crowd buyers count once per purchase.
    buyers: new Set(tickets.map((t) => (t.userId === CROWD ? t.purchaseId : t.userId))).size + new Set(orders.map((o) => o.buyerId)).size,
    salesKobo: tickets.length * l.buyerTicketPriceKobo + orders.reduce((s, o) => s + o.priceKobo, 0),
  }
}

function orderView(db: Db, o: Order): OrderView {
  const l = db.listings.find((x) => x.id === o.listingId)!
  const merchant = db.merchants.find((m) => m.id === o.merchantId)!
  return { ...o, listingTitle: l.title, listingImage: l.images[0] ?? null, category: l.category, merchantName: merchant.name }
}

// -------------------------------------------------------------------- API

export interface MockOptions {
  store?: KeyValueStore
  latencyMs?: number
  now?: () => number
}

export function createMockApi(opts: MockOptions = {}): DrawMartApi {
  const store = opts.store ?? (typeof localStorage !== 'undefined' ? localStorage : memoryStore())
  const latency = opts.latencyMs ?? 180
  const now = opts.now ?? (() => Date.now())
  let loading: Promise<Db> | null = null
  // Serialise writes so two quick clicks can't sell the same ticket twice.
  let queue: Promise<unknown> = Promise.resolve()

  const sleep = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve())

  async function load(): Promise<Db> {
    const raw = store.getItem(STORAGE_KEY)
    if (raw) {
      try {
        return JSON.parse(raw) as Db
      } catch {
        /* fall through to a fresh db */
      }
    }
    loading ??= freshDb().then((db) => {
      store.setItem(STORAGE_KEY, JSON.stringify(db))
      loading = null
      return db
    })
    return loading
  }

  const save = (db: Db) => store.setItem(STORAGE_KEY, JSON.stringify(db))

  /** Runs a unit of work against a consistent snapshot, housekeeping first. */
  function tx<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      await sleep()
      const db = await load()
      const t = now()
      processDeadlines(db, t)
      applyPendingLimits(db, t)
      const out = await fn(db)
      save(db)
      return out
    })
    queue = run.catch(() => undefined)
    return run
  }

  // Demo sign-in, so the mock opens the same three apps as a real backend. It
  // only decides which app you see: the mock's data rules don't check roles.
  const sessionListeners = new Set<(s: AuthSession | null) => void>()
  function readSession(): AuthSession | null {
    try {
      return JSON.parse(store.getItem(SESSION_KEY) ?? 'null') as AuthSession | null
    } catch {
      return null
    }
  }
  function setSession(s: AuthSession | null) {
    if (s) store.setItem(SESSION_KEY, JSON.stringify(s))
    else store.removeItem(SESSION_KEY)
    sessionListeners.forEach((l) => l(s))
  }
  const auth: AuthAdapter = {
    emailLinks: false,
    demoAccounts: DEMO_ACCOUNTS,
    getSession: async () => readSession(),
    onChange(callback) {
      sessionListeners.add(callback)
      return () => void sessionListeners.delete(callback)
    },
    async sendSignInLink() {
      throw new ApiError('invalid_input', 'The demo can’t send email. Use one of the demo accounts.')
    },
    async signInWithPassword(email, password) {
      await sleep()
      const a = DEMO_ACCOUNTS.find((d) => d.email === email.trim().toLowerCase())
      if (!a || a.password !== password) throw new ApiError('invalid_input', 'That email and password don’t match. Try one of the demo accounts.')
      setSession({ userId: a.role === 'buyer' ? ME : `u-${a.role}`, email: a.email, role: a.role })
    },
    async signOut() {
      setSession(null)
    },
  }

  const me = (db: Db) => db.users.find((u) => u.id === ME)!
  /** The shop whose side of chats the signed-in user sees, if any. */
  const myShop = (db: Db): string | null => {
    const role = readSession()?.role
    return role === 'store' || role === undefined ? MY_MERCHANT : role === 'buyer' ? db.sellerShopId : null
  }
  /** As buyer if the signed-in user is the demo buyer; otherwise as the shop. */
  const sideIn = (db: Db, c: MockConversation): ChatSide | null => {
    const role = readSession()?.role
    if ((role === 'buyer' || role === undefined) && c.buyerId === ME) return 'buyer'
    if (c.merchantId === myShop(db)) return 'seller'
    return null
  }
  /** Buyers who bought a ticket or an item in the last 30 days. */
  const activeBuyerCount = (db: Db) => {
    const monthAgo = iso(now() - 30 * DAY)
    return new Set(db.ledger.filter((e) => (e.kind === 'ticket_purchase' || e.kind === 'order_payment') && e.createdAt > monthAgo).map((e) => e.userId)).size
  }
  const conversationOr404 = (db: Db, id: string) => {
    const c = db.conversations.find((x) => x.id === id)
    const side = c ? sideIn(db, c) : null
    if (!c || !side) throw new ApiError('not_found', 'That conversation doesn’t exist.')
    return { c, side }
  }
  /** The shop being managed: the demo buyer's own once approved, otherwise the demo store. */
  const shopId = (db: Db) => {
    if (readSession()?.role !== 'buyer') return MY_MERCHANT
    if (!db.sellerShopId) throw new ApiError('forbidden', 'Get verified as a seller to list products.')
    return db.sellerShopId
  }
  const getListingOr404 = (db: Db, id: string) => {
    const l = db.listings.find((x) => x.id === id)
    if (!l) throw new ApiError('not_found', 'That listing doesn’t exist.')
    return l
  }

  return {
    testMode: true,
    auth,

    getCurrentUser: () => tx((db) => ({ ...me(db) })),

    updateProfile: (patch) =>
      tx((db) => {
        Object.assign(me(db), patch)
        return { ...me(db) }
      }),

    listListings: (filter: ListingFilter = {}) =>
      tx((db) => {
        const statuses = filter.status ?? ['live']
        return db.listings
          .filter((l) => statuses.includes(l.status) && (!filter.category || l.category === filter.category))
          .map((l) => listingView(db, l))
          .sort((a, b) => {
            if (a.status !== b.status) return a.status === 'live' ? -1 : 1
            return b.ticketsSold / b.ticketCount - a.ticketsSold / a.ticketCount
          })
      }),

    getListing: (id) => tx((db) => listingView(db, getListingOr404(db, id))),

    buyTickets: (listingId, quantity) =>
      tx(async (db) => {
        const user = me(db)
        const listing = getListingOr404(db, listingId)
        const mine = db.ledger.filter((e) => e.userId === ME)
        const balance = balanceFromLedger(mine)
        const held = db.tickets.filter((t) => t.listingId === listingId && t.userId === ME).length
        const err = checkPurchase({ user, listing, quantity, ticketsAlreadyHeld: held, balance, spentThisWeekKobo: spentInLastWeek(mine, new Date(now())) })
        if (err) throw new ApiError(err, PURCHASE_ERROR_TEXT[err])

        const costKobo = quantity * listing.buyerTicketPriceKobo
        const { fromCash, fromCredit } = splitPayment(costKobo, balance)
        const purchaseId = `P-${randomHex(3).toUpperCase()}`
        const at = iso(now())
        const numbers: number[] = []
        for (let i = 0; i < quantity; i++) {
          listing.ticketsSold += 1
          numbers.push(listing.ticketsSold)
          db.tickets.push({ id: uid('T'), listingId, userId: ME, number: listing.ticketsSold, purchaseId, purchasedAt: at })
        }
        db.ledger.push({
          id: uid('E'), userId: ME, kind: 'ticket_purchase', cashKobo: -fromCash, creditKobo: -fromCredit,
          memo: `${quantity} ${quantity === 1 ? 'ticket' : 'tickets'} · ${listing.title}`, listingId, createdAt: at,
        })
        const drawn = listing.ticketsSold === listing.ticketCount
        if (drawn) await runDraw(db, listing, purchaseId, at)
        return { purchaseId, numbers, costKobo, drawn }
      }),

    listMyListings: () =>
      tx((db) => {
        const ids = new Set(db.tickets.filter((t) => t.userId === ME).map((t) => t.listingId))
        return db.listings.filter((l) => ids.has(l.id)).map((l) => listingView(db, l))
      }),

    listResults: () =>
      tx((db) => db.results.map((r) => resultView(db, r)).sort((a, b) => b.drawnAt.localeCompare(a.drawnAt))),

    buyNow: (listingId, delivery) =>
      tx((db) => {
        const l = getListingOr404(db, listingId)
        if (l.merchantId === db.sellerShopId) throw new ApiError('forbidden', 'You can’t buy your own item.')
        const mine = db.ledger.filter((e) => e.userId === ME)
        const balance = balanceFromLedger(mine)
        const notForSale = checkOrder(l, { cashKobo: Number.MAX_SAFE_INTEGER, creditKobo: 0 })
        if (notForSale) throw new ApiError(notForSale, ORDER_ERROR_TEXT[notForSale])
        const problems = validateDelivery(delivery).map((e) => DELIVERY_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const blocked = checkOrder(l, balance)
        if (blocked) throw new ApiError(blocked, ORDER_ERROR_TEXT[blocked])

        const price = salePriceKobo(l)!
        const pay = splitPayment(price, balance)
        const at = iso(now())
        db.ledger.push({ id: uid('E'), userId: ME, kind: 'order_payment', cashKobo: -pay.fromCash, creditKobo: -pay.fromCredit, memo: `Bought · ${l.title}`, listingId: l.id, createdAt: at })
        const order: Order = {
          id: uid('O'), listingId: l.id, buyerId: ME, merchantId: l.merchantId, priceKobo: price, feeKobo: saleEconomics(price, l.feeBps).feeKobo,
          delivery: { address: delivery.address.trim(), contactPhone: delivery.contactPhone.trim() }, status: 'paid', createdAt: at, dispatchedAt: null, deliveredAt: null,
        }
        db.orders.push(order)
        l.status = 'sold'
        return orderView(db, order)
      }),

    listMyOrders: () =>
      tx((db) => db.orders.filter((o) => o.buyerId === ME).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => orderView(db, o))),

    confirmOrder: (orderId) =>
      tx((db) => {
        const o = db.orders.find((x) => x.id === orderId && x.buyerId === ME && x.status !== 'delivered')
        if (!o) throw new ApiError('invalid_input', 'Only your own orders that are on the way can be confirmed.')
        const at = iso(now())
        o.status = 'delivered'
        o.dispatchedAt ??= at
        o.deliveredAt = at
      }),

    getWallet: () =>
      tx((db): WalletView => {
        const mine = db.ledger.filter((e) => e.userId === ME)
        return {
          balance: balanceFromLedger(mine),
          entries: [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          spentThisWeekKobo: spentInLastWeek(mine, new Date(now())),
          weeklyLimitKobo: me(db).weeklyLimitKobo,
          pendingLimit: db.pendingLimits[ME] ?? null,
          pendingDeposits: [], // the mock has no payment provider
        }
      }),

    topUp: (amountKobo) =>
      tx((db) => {
        const problem = topUpError(amountKobo)
        if (problem) throw new ApiError('invalid_input', problem)
        db.ledger.push({ id: uid('E'), userId: ME, kind: 'topup', cashKobo: amountKobo, creditKobo: 0, memo: 'Wallet top-up (test money)', createdAt: iso(now()) })
      }),

    setWeeklyLimit: (amountKobo) =>
      tx((db) => {
        if (!Number.isInteger(amountKobo) || amountKobo <= 0) throw new ApiError('invalid_input', 'Enter a limit.')
        const u = me(db)
        if (amountKobo <= u.weeklyLimitKobo) {
          u.weeklyLimitKobo = amountKobo // lowering is instant
          delete db.pendingLimits[ME]
        } else {
          db.pendingLimits[ME] = { amountKobo, effectiveAt: iso(now() + RULES.limitIncreaseDelayHours * 60 * 60 * 1000) }
        }
      }),

    getMyMerchant: () => tx((db) => db.merchants.find((m) => m.id === shopId(db))!),

    listMerchantListings: () =>
      tx((db) =>
        db.listings
          .filter((l) => l.merchantId === shopId(db))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((l) => listingView(db, l, 'full')),
      ),

    createListing: (input: NewListingInput) =>
      tx(async (db) => {
        if (readSession()?.role === 'buyer') throw new ApiError('forbidden', 'Only registered stores can run raffle draws.')
        const today = localDate(new Date(now()))
        const problems = [
          ...validateListingEconomics(input).map((e) => LISTING_ERROR_TEXT[e]),
          ...validateListingTerms(input).map((e) => LISTING_TERMS_ERROR_TEXT[e]),
          ...validateHandover(input.handover, today).map((e) => HANDOVER_ERROR_TEXT[e]),
        ]
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        // DrawMart sets the fee from the item's value; the store never chooses it.
        const feeBps = platformFeeBps(input.priceKobo)
        const econ = computeListingEconomics({ ...input, feeBps })
        const seed = createSeed()
        const id = uid('L')
        db.seeds[id] = seed
        const at = now()
        const listing: Listing = {
          id, kind: 'raffle', merchantId: MY_MERCHANT, title: input.title.trim(), description: input.description.trim(), category: input.category, images: input.images ?? [],
          priceKobo: input.priceKobo, ticketPriceKobo: input.ticketPriceKobo, buyerTicketPriceKobo: econ.buyerTicketKobo,
          ticketCount: econ.ticketCount, ticketsSold: 0, feeMode: input.feeMode, feeBps,
          unsoldPolicy: input.unsoldPolicy, fallbackPriceKobo: input.unsoldPolicy === 'convert_to_sale' ? input.fallbackPriceKobo! : null,
          durationDays: input.durationDays, extended: false, status: 'pending_review',
          handover: { ...input.handover, address: input.handover.address.trim(), method: handoverMethodFor(input.category) },
          // In test mode the fee is recorded, not charged. A real backend takes it before booking the pickup.
          cautionFee: { amountKobo: cautionFeeFor(input.category), status: 'held' },
          commitment: await commitmentFor(seed), createdAt: iso(at), closesAt: iso(at + input.durationDays * DAY), boostedUntil: null,
        }
        db.listings.push(listing)
        return listingView(db, listing, 'full')
      }),

    createProduct: (input: NewProductInput) =>
      tx((db) => {
        const problems = validateProduct(input).map((e) => PRODUCT_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const listing = productListing({ ...input, merchantId: shopId(db), status: 'pending_review' }, now())
        db.listings.push(listing)
        return listingView(db, listing, 'full')
      }),

    listMerchantOrders: () =>
      tx((db) => db.orders.filter((o) => o.merchantId === shopId(db)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => orderView(db, o))),

    dispatchOrder: (orderId) =>
      tx((db) => {
        const o = db.orders.find((x) => x.id === orderId && x.merchantId === shopId(db) && x.status === 'paid')
        if (!o) throw new ApiError('invalid_input', 'Only your store’s paid orders can be marked as sent.')
        o.status = 'dispatched'
        o.dispatchedAt = iso(now())
      }),

    startConversation: (listingId) =>
      tx((db) => {
        const l = getListingOr404(db, listingId)
        if (l.kind !== 'product') throw new ApiError('invalid_input', 'Raffle items are held and checked by DrawMart, so there’s no seller chat.')
        if (l.status !== 'for_sale' && l.status !== 'sold') throw new ApiError('not_found', 'That item isn’t on sale.')
        if (l.merchantId === db.sellerShopId) throw new ApiError('invalid_input', 'This is your own item.')
        let c = db.conversations.find((x) => x.listingId === l.id && x.buyerId === ME)
        if (!c) {
          const at = iso(now())
          c = { id: uid('C'), listingId: l.id, buyerId: ME, merchantId: l.merchantId, lastMessageAt: at, buyerReadAt: at, sellerReadAt: iso(0) }
          db.conversations.push(c)
        }
        return conversationView(db, c, 'buyer')
      }),

    listConversations: () =>
      tx((db) =>
        db.conversations
          .flatMap((c) => {
            const side = sideIn(db, c)
            return side ? [conversationView(db, c, side)] : []
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      ),

    listMessages: (conversationId) =>
      tx((db) => {
        conversationOr404(db, conversationId)
        return db.messages.filter((m) => m.conversationId === conversationId)
      }),

    sendMessage: (conversationId, body) =>
      tx((db) => {
        const { c, side } = conversationOr404(db, conversationId)
        const problem = messageError(body)
        if (problem) throw new ApiError('invalid_input', problem)
        const minuteAgo = iso(now() - 60_000)
        if (db.messages.filter((m) => m.conversationId === c.id && m.sender === side && m.createdAt > minuteAgo).length >= MAX_MESSAGES_PER_MINUTE)
          throw new ApiError('invalid_input', 'You’re sending messages very fast. Wait a moment.')
        const at = iso(now())
        const msg: ChatMessage = { id: uid('X'), conversationId: c.id, sender: side, body: body.trim(), createdAt: at }
        db.messages.push(msg)
        c.lastMessageAt = at
        if (side === 'buyer') c.buyerReadAt = at
        else c.sellerReadAt = at
        return msg
      }),

    markConversationRead: (conversationId) =>
      tx((db) => {
        const { c, side } = conversationOr404(db, conversationId)
        if (side === 'buyer') c.buyerReadAt = iso(now())
        else c.sellerReadAt = iso(now())
      }),

    recordListingView: (listingId, visitorId) =>
      tx((db) => {
        const l = db.listings.find((x) => x.id === listingId)
        if (!l || !['live', 'drawn', 'refunded', 'for_sale', 'sold'].includes(l.status)) return
        const role = readSession()?.role
        if (role && l.merchantId === myShop(db)) return // a seller looking at their own item
        const visitor = role ? `u:${role === 'buyer' ? ME : role}` : /^[A-Za-z0-9-]{8,64}$/.test(visitorId) ? `v:${visitorId}` : null
        if (!visitor) return
        const day = lagosDay(now())
        if (!db.views.some((v) => v.listingId === l.id && v.visitor === visitor && v.day === day)) db.views.push({ listingId: l.id, visitor, day })
      }),

    getMerchantMetrics: (days) =>
      tx((db): MerchantMetricsView => {
        const shop = readSession() ? myShop(db) : null
        if (!shop) throw new ApiError('forbidden', 'Only sellers have insights.')
        const range = fillDays([], days, lagosDay(now()))
        const from = range[0].date
        const daily = new Map(range.map((d) => [d.date, { ...d }]))
        const today = range[range.length - 1].date
        const listings = db.listings
          .filter((l) => l.merchantId === shop && l.status !== 'rejected')
          .map((l): ListingMetrics => {
            for (const d of range) {
              const day = statsBetween(db, l, d.date, d.date)
              daily.get(d.date)!.views += day.views
              daily.get(d.date)!.salesKobo += day.salesKobo
            }
            return { listingId: l.id, title: l.title, image: l.images[0] ?? null, category: l.category, kind: l.kind, status: l.status, ...statsBetween(db, l, from, today) }
          })
          .sort((a, b) => b.views - a.views)
        return { days, listings, daily: [...daily.values()] }
      }),

    getBoostStatus: () =>
      tx((db) => {
        const s = db.boostSettings
        const running = db.boosts.filter((b) => b.status === 'paid' && b.endsAt! > iso(now())).length
        const activeBuyers = activeBuyerCount(db)
        return {
          unlocked: boostsUnlocked(activeBuyers, s.minActiveBuyers, s.forcedOn),
          slotsLeft: Math.max(0, s.maxActive - running),
          packages: DEFAULT_BOOST_PACKAGES,
          admin: readSession()?.role === 'admin' ? { ...s, activeBuyers } : null,
        }
      }),

    buyBoost: (listingId, packageId) =>
      tx((db) => {
        const shop = readSession() ? myShop(db) : null
        if (!shop) throw new ApiError('forbidden', 'Only sellers can boost listings.')
        const s = db.boostSettings
        if (!boostsUnlocked(activeBuyerCount(db), s.minActiveBuyers, s.forcedOn)) throw new ApiError('forbidden', BOOST_ERROR_TEXT.locked)
        const l = db.listings.find((x) => x.id === listingId && x.merchantId === shop)
        if (!l) throw new ApiError('not_found', 'That listing isn’t yours.')
        if (!canBoost(l)) throw new ApiError('invalid_input', BOOST_ERROR_TEXT.not_boostable)
        const pkg = DEFAULT_BOOST_PACKAGES.find((p) => p.id === packageId)
        if (!pkg) throw new ApiError('invalid_input', BOOST_ERROR_TEXT.no_package)
        if (db.boosts.filter((b) => b.status === 'paid' && b.endsAt! > iso(now())).length >= s.maxActive) throw new ApiError('invalid_input', BOOST_ERROR_TEXT.slots_full)
        // Test money: paid at once.
        const startsAt = l.boostedUntil && l.boostedUntil > iso(now()) ? l.boostedUntil : iso(now())
        l.boostedUntil = boostEndsAt(l.boostedUntil, pkg.days, now())
        db.boosts.push({ id: uid('B'), txRef: `BST-${randomHex(8).toUpperCase()}`, listingId: l.id, merchantId: shop, days: pkg.days, priceKobo: pkg.priceKobo, status: 'paid', startsAt, endsAt: l.boostedUntil, createdAt: iso(now()) })
        return 'successful'
      }),

    listBoosts: () =>
      tx((db) => {
        const role = readSession()?.role
        const shop = role && role !== 'admin' ? myShop(db) : null
        return db.boosts
          .filter((b) => role === 'admin' || b.merchantId === shop)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(({ merchantId, ...b }) => ({
            ...b,
            listingTitle: db.listings.find((l) => l.id === b.listingId)?.title ?? '',
            merchantName: db.merchants.find((m) => m.id === merchantId)?.name ?? '',
          }))
      }),

    getBoostInsights: (boostId) =>
      tx((db): BoostInsightsView => {
        const role = readSession()?.role
        const shop = role && role !== 'admin' ? myShop(db) : null
        const b = db.boosts.find((x) => x.id === boostId && (role === 'admin' || x.merchantId === shop))
        if (!b) throw new ApiError('not_found', 'That boost doesn’t exist.')
        if (b.status !== 'paid' || !b.startsAt || !b.endsAt) throw new ApiError('invalid_input', 'Results show once the boost has started.')
        const l = getListingOr404(db, b.listingId)
        const w = boostWindow(b.startsAt, b.endsAt, now())
        const daily = fillDays([], w.days * 2, w.to).map((d) => {
          const day = statsBetween(db, l, d.date, d.date)
          return { date: d.date, views: day.views, salesKobo: day.salesKobo }
        })
        return { window: w, before: statsBetween(db, l, w.beforeFrom, w.beforeTo), during: statsBetween(db, l, w.from, w.to), daily }
      }),

    setBoostSettings: (settings) =>
      tx((db) => {
        if (readSession()?.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
        if (settings.minActiveBuyers < 0 || settings.maxActive < 1) throw new ApiError('invalid_input', 'Check the boost settings.')
        db.boostSettings = { ...settings }
      }),

    getCallPhone: () =>
      tx((db) => {
        const shop = myShop(db)
        return shop ? (db.callPhones[shop] ?? null) : null
      }),

    setCallPhone: (phone) =>
      tx((db) => {
        const shop = myShop(db)
        if (!shop) throw new ApiError('forbidden', 'Only sellers can share a call number.')
        if (!phone?.trim()) {
          delete db.callPhones[shop]
          return
        }
        if (!isNigerianMobile(phone)) throw new ApiError('invalid_input', 'Enter a Nigerian mobile number, e.g. 0803 123 4567.')
        db.callPhones[shop] = phone.trim()
      }),

    getMySellerApplication: () => tx((db) => db.sellerApplication),

    submitSellerApplication: (input) =>
      tx((db) => {
        const prev = db.sellerApplication
        if (prev?.status === 'pending') throw new ApiError('invalid_input', 'Your application is already being reviewed.')
        if (prev?.status === 'approved') throw new ApiError('invalid_input', 'You’re already a verified seller.')
        const problems = validateSellerApplication(input).map((e) => SELLER_APPLICATION_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const at = iso(now())
        db.sellerApplication = {
          id: prev?.id ?? uid('S'), status: 'pending', shopName: input.shopName.trim(), legalName: input.legalName.trim(), nin: normalizeNin(input.nin),
          phone: input.phone.trim(), address: input.address.trim(), area: input.area.trim(), idPhotoUrl: input.idPhoto, selfieUrl: input.selfie,
          reviewNote: null, createdAt: prev?.createdAt ?? at, updatedAt: at, reviewedAt: null,
        }
        return db.sellerApplication
      }),

    listSellerApplications: () => tx((db) => (db.sellerApplication?.status === 'pending' ? [db.sellerApplication] : [])),

    approveSeller: (applicationId) =>
      tx((db) => {
        const a = db.sellerApplication
        if (!a || a.id !== applicationId || a.status !== 'pending') throw new ApiError('invalid_input', 'Only applications waiting for review can be approved.')
        const shop: Merchant = { id: uid('M'), kind: 'individual', name: a.shopName, area: a.area, cacNumber: '', verified: true }
        db.merchants.push(shop)
        db.sellerShopId = shop.id
        Object.assign(a, { status: 'approved', reviewedAt: iso(now()) })
      }),

    rejectSeller: (applicationId, note) =>
      tx((db) => {
        const a = db.sellerApplication
        if (note.trim().length < 5) throw new ApiError('invalid_input', 'Tell the applicant what to fix.')
        if (!a || a.id !== applicationId || a.status !== 'pending') throw new ApiError('invalid_input', 'Only applications waiting for review can be rejected.')
        Object.assign(a, { status: 'rejected', reviewNote: note.trim(), reviewedAt: iso(now()) })
      }),

    listPendingListings: () =>
      tx((db) => db.listings.filter((l) => l.status === 'pending_review').map((l) => listingView(db, l, 'full'))),

    approveListing: (id) =>
      tx((db) => {
        const l = getListingOr404(db, id)
        if (l.status !== 'pending_review') throw new ApiError('invalid_input', 'Only listings in review can be approved.')
        if (l.kind === 'product') {
          l.status = 'for_sale' // products skip the draw
          return
        }
        l.status = 'live'
        l.closesAt = iso(now() + l.durationDays * DAY) // the clock starts when it goes live
      }),

    rejectListing: (id) =>
      tx((db) => {
        const l = getListingOr404(db, id)
        if (l.status !== 'pending_review') throw new ApiError('invalid_input', 'Only listings in review can be rejected.')
        l.status = 'rejected'
        l.cautionFee = settleCautionFee(l.cautionFee, 'rejected')
      }),

    demoSellOut: (listingId) =>
      tx(async (db) => {
        const l = getListingOr404(db, listingId)
        if (l.status !== 'live') throw new ApiError('not_live', PURCHASE_ERROR_TEXT.not_live)
        const at = iso(now())
        const ref = crowdBuys(db, l, l.ticketCount - l.ticketsSold, at)
        await runDraw(db, l, ref, at)
      }),

    demoExpire: (listingId) =>
      tx((db) => {
        const l = getListingOr404(db, listingId)
        if (l.status !== 'live') throw new ApiError('not_live', PURCHASE_ERROR_TEXT.not_live)
        l.closesAt = iso(now() - 1)
        processDeadlines(db, now())
      }),

    demoReset: async () => {
      await queue
      store.removeItem(STORAGE_KEY)
    },
  }
}
