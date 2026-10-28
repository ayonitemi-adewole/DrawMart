/**
 * In-browser mock backend. Everything lives in localStorage, money is fake,
 * and a little latency is added so loading states get exercised.
 *
 * It enforces the same rules a real backend must (src/domain/rules.ts), and
 * keeps draw seeds out of every response until a draw has run, so the UI is
 * built against realistic behaviour.
 */
import { commitmentFor, createSeed, randomHex, winningTicketNumber } from '@/domain/draw'
import { computeListingEconomics, validateListingEconomics } from '@/domain/fees'
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
import type { Category, DrawResult, LedgerEntry, Listing, Merchant, Ticket, User } from '@/domain/types'
import {
  ApiError,
  type DrawMartApi,
  type DrawResultView,
  type ListingFilter,
  type ListingView,
  type NewListingInput,
  type WalletView,
} from './types'

const STORAGE_KEY = 'drawmart:mock-db:v1'
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
  price: number
  ticket: number
  sold: number
  closesInHours: number
}

const SEED_LISTINGS: SeedListing[] = [
  { merchantId: MY_MERCHANT, title: 'Smartphone, 256GB', description: 'Brand new, sealed, one-year store warranty.', category: 'Phones', price: 1_000_000, ticket: 5_000, sold: 187, closesInHours: 28 },
  { merchantId: 'm-lekki', title: '55-inch 4K smart TV', description: 'Brand new with wall bracket. Delivery and mounting in Lagos included.', category: 'Electronics', price: 650_000, ticket: 2_500, sold: 241, closesInHours: 9 },
  { merchantId: 'm-surulere', title: 'Rice, 50kg bag', description: 'Premium parboiled long grain. Delivered to your door in Lagos.', category: 'Food', price: 85_000, ticket: 500, sold: 96, closesInHours: 48 },
  { merchantId: 'm-yaba', title: '5kVA inverter + battery', description: 'Inverter with two batteries, installed by the store.', category: 'Home', price: 1_800_000, ticket: 6_000, sold: 122, closesInHours: 96 },
  { merchantId: MY_MERCHANT, title: 'Laptop, 16GB RAM', description: '16GB RAM, 512GB SSD, brand new with warranty.', category: 'Electronics', price: 1_200_000, ticket: 5_000, sold: 40, closesInHours: 144 },
  { merchantId: 'm-vi', title: 'Saloon car, 2018', description: 'Foreign-used, inspected, papers complete. Registration in the winner’s name.', category: 'Cars', price: 9_000_000, ticket: 10_000, sold: 312, closesInHours: 288 },
]

async function makeListing(s: SeedListing, now: number, seeds: Record<string, string>): Promise<Listing> {
  const id = uid('L')
  const seed = createSeed()
  seeds[id] = seed
  const econ = computeListingEconomics({ priceKobo: nairaToKobo(s.price), ticketPriceKobo: nairaToKobo(s.ticket), feeBps: RULES.defaultFeeBps, feeMode: 'seller' })
  return {
    id,
    merchantId: s.merchantId,
    title: s.title,
    description: s.description,
    category: s.category,
    priceKobo: nairaToKobo(s.price),
    ticketPriceKobo: nairaToKobo(s.ticket),
    buyerTicketPriceKobo: econ.buyerTicketKobo,
    ticketCount: econ.ticketCount,
    ticketsSold: 0,
    feeMode: 'seller',
    feeBps: RULES.defaultFeeBps,
    unsoldPolicy: 'refund',
    durationDays: Math.ceil(s.closesInHours / 24),
    extended: false,
    status: 'live',
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
    crowdBuys(db, l, s.sold, iso(now - DAY))
    db.listings.push(l)
  }
  // Two finished draws so the results page isn't empty.
  for (const [i, s] of [
    { merchantId: 'm-yaba', title: 'Generator, 3.5kVA', description: 'Petrol generator, key start.', category: 'Home' as const, price: 450_000, ticket: 2_500, sold: 0, closesInHours: 1 },
    { merchantId: 'm-lekki', title: 'Smartwatch', description: 'Fitness smartwatch with GPS.', category: 'Electronics' as const, price: 180_000, ticket: 1_500, sold: 0, closesInHours: 1 },
  ].entries()) {
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
  db.results.push({ listingId: listing.id, commitment: listing.commitment, seed, closingRef, winningNumber, winnerUserId: winner.userId, drawnAt: at })

  // Consolation credit for every losing buyer (the crowd is a stand-in for many users).
  const losers = new Map<string, number>()
  for (const t of db.tickets) if (t.listingId === listing.id && t.userId !== winner.userId) losers.set(t.userId, (losers.get(t.userId) ?? 0) + 1)
  for (const [userId, count] of losers) {
    const credit = consolationCredit(count * listing.buyerTicketPriceKobo)
    if (credit > 0) db.ledger.push({ id: uid('E'), userId, kind: 'store_credit', cashKobo: 0, creditKobo: credit, memo: `Store credit · ${listing.title}`, listingId: listing.id, createdAt: at })
  }
}

/** Deadlines: extend once if the listing allows it, otherwise refund everyone. */
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
    l.status = 'refunded'
    const paid = new Map<string, { cash: number; credit: number }>()
    for (const e of db.ledger) {
      if (e.listingId !== l.id || e.kind !== 'ticket_purchase') continue
      const p = paid.get(e.userId) ?? { cash: 0, credit: 0 }
      paid.set(e.userId, { cash: p.cash - e.cashKobo, credit: p.credit - e.creditKobo })
    }
    for (const [userId, p] of paid) {
      // Refund to the same buckets the money came from.
      db.ledger.push({ id: uid('E'), userId, kind: 'refund', cashKobo: p.cash, creditKobo: p.credit, memo: `Refund · ${l.title} didn’t sell out`, listingId: l.id, createdAt: iso(now) })
    }
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
  return { ...r, listingTitle: l.title, ticketCount: l.ticketCount, iWon: r.winnerUserId === ME, myNumbers, myCreditKobo }
}

function listingView(db: Db, l: Listing): ListingView {
  const merchant = db.merchants.find((m) => m.id === l.merchantId)!
  const myNumbers = db.tickets.filter((t) => t.listingId === l.id && t.userId === ME).map((t) => t.number)
  const r = db.results.find((x) => x.listingId === l.id)
  return { ...l, merchant, myNumbers, result: r ? resultView(db, r) : null }
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
          .map((l) => listingView(db, l)),
      ),

    createListing: (input: NewListingInput) =>
      tx(async (db) => {
        const errors = validateListingEconomics(input)
        if (errors.length) throw new ApiError('invalid_input', errors.join(', '))
        if (!RULES.listingDurationsDays.includes(input.durationDays as (typeof RULES.listingDurationsDays)[number]))
          throw new ApiError('invalid_input', 'Pick a listed duration.')
        const econ = computeListingEconomics(input)
        const seed = createSeed()
        const id = uid('L')
        db.seeds[id] = seed
        const at = now()
        const listing: Listing = {
          id, merchantId: MY_MERCHANT, title: input.title.trim(), description: input.description.trim(), category: input.category,
          priceKobo: input.priceKobo, ticketPriceKobo: input.ticketPriceKobo, buyerTicketPriceKobo: econ.buyerTicketKobo,
          ticketCount: econ.ticketCount, ticketsSold: 0, feeMode: input.feeMode, feeBps: input.feeBps,
          unsoldPolicy: input.unsoldPolicy, durationDays: input.durationDays, extended: false, status: 'pending_review',
          commitment: await commitmentFor(seed), createdAt: iso(at), closesAt: iso(at + input.durationDays * DAY),
        }
        db.listings.push(listing)
        return listingView(db, listing)
      }),

    listPendingListings: () =>
      tx((db) => db.listings.filter((l) => l.status === 'pending_review').map((l) => listingView(db, l))),

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
