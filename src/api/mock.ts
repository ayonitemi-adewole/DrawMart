/**
 * In-browser mock backend. Everything lives in localStorage, money is fake,
 * and a little latency is added so loading states get exercised.
 *
 * It enforces the same rules a real backend must (src/domain/rules.ts), and
 * keeps draw seeds out of every response until a draw has run, so the UI is
 * built against realistic behaviour.
 */
import { commitmentFor, createSeed, randomHex, winningTicketNumber } from '@/domain/draw'
import { LISTING_ERROR_TEXT, computeListingEconomics, validateListingEconomics } from '@/domain/fees'
import {
  HANDOVER_ERROR_TEXT,
  LISTING_TERMS_ERROR_TEXT,
  addDays,
  cautionFeeFor,
  handoverMethodFor,
  localDate,
  settleCautionFee,
  validateHandover,
  validateListingTerms,
} from '@/domain/listing'
import { nairaToKobo } from '@/domain/money'
import {
  PURCHASE_ERROR_TEXT,
  RULES,
  balanceFromLedger,
  checkPurchase,
  consolationCredit,
  spentInLastWeek,
  splitPayment,
} from '@/domain/rules'
import type { Category, DrawResult, LedgerEntry, Listing, ListingStatus, Merchant, Ticket, UnsoldPolicy, User } from '@/domain/types'
import {
  ApiError,
  type DrawMartApi,
  type DrawResultView,
  type ListingFilter,
  type ListingView,
  type NewListingInput,
  type WalletView,
} from './types'

const STORAGE_KEY = 'drawmart:mock-db:v3' // bump when seed data or the Db shape changes
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
  { id: MY_MERCHANT, name: 'Ikeja Partner Store', area: 'Ikeja', cacNumber: 'RC [NUMBER]', verified: true },
  { id: 'm-lekki', name: 'Lekki Partner Store', area: 'Lekki', cacNumber: 'RC [NUMBER]', verified: true },
  { id: 'm-surulere', name: 'Surulere Partner Store', area: 'Surulere', cacNumber: 'RC [NUMBER]', verified: true },
  { id: 'm-yaba', name: 'Yaba Partner Store', area: 'Yaba', cacNumber: 'RC [NUMBER]', verified: true },
  { id: 'm-vi', name: 'Victoria Island Partner Dealer', area: 'Victoria Island', cacNumber: 'RC [NUMBER]', verified: true },
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

async function makeListing(s: SeedListing, now: number, seeds: Record<string, string>): Promise<Listing> {
  const id = uid('L')
  const merchant = MERCHANTS.find((m) => m.id === s.merchantId)!
  const status = s.status ?? 'live'
  const seed = createSeed()
  seeds[id] = seed
  const econ = computeListingEconomics({ priceKobo: nairaToKobo(s.price), ticketPriceKobo: nairaToKobo(s.ticket), feeBps: RULES.defaultFeeBps, feeMode: 'seller' })
  return {
    id,
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
    feeBps: RULES.defaultFeeBps,
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
    ],
    merchants: MERCHANTS,
    listings: [],
    seeds: {},
    tickets: [],
    ledger: [{ id: uid('E'), userId: ME, kind: 'topup', cashKobo: nairaToKobo(25_000), creditKobo: 0, memo: 'Welcome top-up (test money)', createdAt: iso(now - DAY) }],
    results: [],
    pendingLimits: {},
  }
  for (const s of SEED_LISTINGS) {
    const l = await makeListing(s, now, db.seeds)
    if (s.sold) crowdBuys(db, l, s.sold, iso(now - DAY))
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
  return db
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

  const me = (db: Db) => db.users.find((u) => u.id === ME)!
  const getListingOr404 = (db: Db, id: string) => {
    const l = db.listings.find((x) => x.id === id)
    if (!l) throw new ApiError('not_found', 'That listing doesn’t exist.')
    return l
  }

  return {
    testMode: true,

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

    getWallet: () =>
      tx((db): WalletView => {
        const mine = db.ledger.filter((e) => e.userId === ME)
        return {
          balance: balanceFromLedger(mine),
          entries: [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          spentThisWeekKobo: spentInLastWeek(mine, new Date(now())),
          weeklyLimitKobo: me(db).weeklyLimitKobo,
          pendingLimit: db.pendingLimits[ME] ?? null,
        }
      }),

    topUp: (amountKobo) =>
      tx((db) => {
        if (!Number.isInteger(amountKobo) || amountKobo <= 0) throw new ApiError('invalid_input', 'Enter an amount to add.')
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

    getMyMerchant: () => tx((db) => db.merchants.find((m) => m.id === MY_MERCHANT)!),

    listMerchantListings: () =>
      tx((db) =>
        db.listings
          .filter((l) => l.merchantId === MY_MERCHANT)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((l) => listingView(db, l, 'full')),
      ),

    createListing: (input: NewListingInput) =>
      tx(async (db) => {
        const today = localDate(new Date(now()))
        const problems = [
          ...validateListingEconomics(input).map((e) => LISTING_ERROR_TEXT[e]),
          ...validateListingTerms(input).map((e) => LISTING_TERMS_ERROR_TEXT[e]),
          ...validateHandover(input.handover, today).map((e) => HANDOVER_ERROR_TEXT[e]),
        ]
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const econ = computeListingEconomics(input)
        const seed = createSeed()
        const id = uid('L')
        db.seeds[id] = seed
        const at = now()
        const listing: Listing = {
          id, merchantId: MY_MERCHANT, title: input.title.trim(), description: input.description.trim(), category: input.category, images: input.images ?? [],
          priceKobo: input.priceKobo, ticketPriceKobo: input.ticketPriceKobo, buyerTicketPriceKobo: econ.buyerTicketKobo,
          ticketCount: econ.ticketCount, ticketsSold: 0, feeMode: input.feeMode, feeBps: input.feeBps,
          unsoldPolicy: input.unsoldPolicy, fallbackPriceKobo: input.unsoldPolicy === 'convert_to_sale' ? input.fallbackPriceKobo! : null,
          durationDays: input.durationDays, extended: false, status: 'pending_review',
          handover: { ...input.handover, address: input.handover.address.trim(), method: handoverMethodFor(input.category) },
          // In test mode the fee is recorded, not charged. A real backend takes it before booking the pickup.
          cautionFee: { amountKobo: cautionFeeFor(input.category), status: 'held' },
          commitment: await commitmentFor(seed), createdAt: iso(at), closesAt: iso(at + input.durationDays * DAY),
        }
        db.listings.push(listing)
        return listingView(db, listing, 'full')
      }),

    listPendingListings: () =>
      tx((db) => db.listings.filter((l) => l.status === 'pending_review').map((l) => listingView(db, l, 'full'))),

    approveListing: (id) =>
      tx((db) => {
        const l = getListingOr404(db, id)
        if (l.status !== 'pending_review') throw new ApiError('invalid_input', 'Only listings in review can be approved.')
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
