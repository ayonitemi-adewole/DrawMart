/**
 * Runs the real migration + seed in PGlite (Postgres compiled to WASM), with
 * the bits of Supabase it relies on (auth schema, roles) stubbed. No Docker.
 *
 * Calls are made as the `authenticated` role with a user id, the same way
 * Supabase runs API requests, so grants and row-level security are exercised.
 */
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { verifyDraw, winningTicketNumber, createSeed } from '@/domain/draw'
import { computeListingEconomics } from '@/domain/fees'
import { addDays, localDate } from '@/domain/listing'

const sql = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema extensions;
  grant usage on schema public, extensions to anon, authenticated;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`

let db: PGlite

interface PgError extends Error {
  detail?: string
}

async function asUser<T = Record<string, unknown>>(userId: string | null, query: string, params: unknown[] = []): Promise<T[]> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
  await db.exec(userId ? 'set role authenticated' : 'set role anon')
  try {
    return (await db.query<T>(query, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

async function admin<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(query, params)).rows
}

async function expectFail(p: Promise<unknown>, code: string): Promise<PgError> {
  try {
    await p
  } catch (e) {
    expect((e as PgError).message).toBe(code)
    return e as PgError
  }
  throw new Error(`expected ${code}`)
}

async function newUser(email: string, opts: { role?: 'admin'; merchantId?: string } = {}): Promise<string> {
  const [u] = await admin<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email])
  if (opts.role) await admin(`update public.profiles set role = $2 where id = $1`, [u.id, opts.role])
  if (opts.merchantId) await admin(`update public.profiles set merchant_id = $2 where id = $1`, [u.id, opts.merchantId])
  return u.id
}

const balance = async (userId: string) =>
  (await asUser<{ cash: string; credit: string }>(userId, `select coalesce(sum(cash_kobo),0) cash, coalesce(sum(credit_kobo),0) credit from public.ledger_entries`))[0]

const IKEJA = '11111111-1111-4111-8111-000000000001'

function listingInput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Blender, 1.5L',
    description: 'Brand new.',
    category: 'Home',
    images: ['/assets/x.jpg'],
    priceKobo: 100_000, // ₦1,000
    ticketPriceKobo: 10_000, // ₦100 → 10 tickets
    feeMode: 'seller',
    feeBps: 1000,
    durationDays: 7,
    unsoldPolicy: 'refund',
    handover: { address: '12 Allen Avenue, Ikeja', contactPhone: '0803 123 4567', date: addDays(localDate(new Date()), 2), slot: 'morning' },
    ...overrides,
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(SUPABASE_STUBS)
  await db.exec(sql('migrations/20261028200000_drawmart_core.sql'))
  await db.exec(sql('seed.sql'))
}, 60_000)

describe('schema and seed', () => {
  it('seeds stores and listings, and is safe to run twice', async () => {
    await db.exec(sql('seed.sql'))
    const [{ n }] = await admin<{ n: number }>(`select count(*)::int n from public.merchants`)
    expect(n).toBe(5)
    const [{ results }] = await admin<{ results: number }>(`select count(*)::int results from public.draw_results`)
    expect(results).toBe(3)
  })

  it('hides draw seeds from API users', async () => {
    const u = await newUser('nosy@example.com')
    await expect(asUser(u, `select * from private.listing_seeds`)).rejects.toThrow(/permission denied/)
    await expect(asUser(null, `select * from private.listing_seeds`)).rejects.toThrow(/permission denied/)
  })

  it('shows buyers only public listings, and never handovers', async () => {
    const u = await newUser('buyer0@example.com')
    const statuses = (await asUser<{ status: string }>(u, `select distinct status from public.listings`)).map((r) => r.status).sort()
    expect(statuses).toEqual(['drawn', 'for_sale', 'live'])
    expect(await asUser(u, `select * from public.listing_handovers`)).toEqual([])
    expect((await asUser(null, `select id from public.listings`)).length).toBeGreaterThan(0)
  })

  it('blocks direct writes from API users', async () => {
    const u = await newUser('hacker@example.com')
    await expect(asUser(u, `insert into public.ledger_entries (user_id, kind, cash_kobo, memo) values ($1, 'topup', 999999999, 'free money')`, [u])).rejects.toThrow(/permission denied/)
    await expect(asUser(u, `update public.listings set tickets_sold = 0`)).rejects.toThrow(/permission denied/)
    await expect(asUser(u, `update public.profiles set role = 'admin'`)).rejects.toThrow(/permission denied/)
    await expect(asUser(u, `select private.run_draw(gen_random_uuid(), 'x')`)).rejects.toThrow(/permission denied/)
    await expect(asUser(null, `select public.top_up(100)`)).rejects.toThrow(/permission denied/)
  })
})

describe('new accounts', () => {
  it('get a test-mode profile and welcome money', async () => {
    const u = await newUser('ada@example.com')
    const [p] = await asUser<{ display_name: string; state: string; age_verified: boolean; weekly_limit_kobo: string }>(u, `select * from public.profiles`)
    expect(p).toMatchObject({ display_name: 'ada', state: 'Lagos', age_verified: true })
    expect(Number(p.weekly_limit_kobo)).toBe(5_000_000)
    expect(await balance(u)).toEqual({ cash: '2500000', credit: '0' })
  })
})

describe('buy_tickets', () => {
  let buyer: string
  let iphone: { id: string; ticket_count: number; tickets_sold: number; buyer_ticket_price_kobo: string }

  beforeAll(async () => {
    buyer = await newUser('buyer@example.com')
    ;[iphone] = await admin(`select * from public.listings where title like 'iPhone%'`)
  })

  it('sells numbered tickets and charges the wallet, credit first', async () => {
    await admin(`insert into public.ledger_entries (user_id, kind, credit_kobo, memo) values ($1, 'store_credit', 200000, 'test credit')`, [buyer])
    const [{ r }] = await asUser<{ r: { numbers: number[]; costKobo: number; drawn: boolean } }>(buyer, `select public.buy_tickets($1, 3) r`, [iphone.id])
    expect(r.numbers).toEqual([iphone.tickets_sold + 1, iphone.tickets_sold + 2, iphone.tickets_sold + 3])
    expect(r.costKobo).toBe(1_500_000)
    expect(r.drawn).toBe(false)
    expect(await balance(buyer)).toEqual({ cash: String(2_500_000 - 1_300_000), credit: '0' })
    expect((await asUser(buyer, `select number from public.tickets`)).length).toBe(3)
  })

  it('enforces the purchase rules in the same order as rules.ts', async () => {
    await expectFail(asUser(buyer, `select public.buy_tickets($1, 3)`, [iphone.id]), 'insufficient_funds')
    await expectFail(asUser(buyer, `select public.buy_tickets($1, 0)`, [iphone.id]), 'invalid_quantity')
    await expectFail(asUser(buyer, `select public.buy_tickets($1, 18)`, [iphone.id]), 'per_user_limit')
    const [pending] = await admin<{ id: string }>(`select id from public.listings where status = 'pending_review' limit 1`)
    await expectFail(asUser(buyer, `select public.buy_tickets($1, 1)`, [pending.id]), 'not_live')
    await expectFail(asUser(buyer, `select public.buy_tickets(gen_random_uuid(), 1)`), 'not_found')

    await asUser(buyer, `select public.update_profile(null, 'Kano')`)
    const e = await expectFail(asUser(buyer, `select public.buy_tickets($1, 1)`, [iphone.id]), 'state_not_licensed')
    expect(e.detail).toBe('')
    await asUser(buyer, `select public.update_profile(null, 'Lagos')`)

    await asUser(buyer, `select public.top_up(10000000)`)
    await asUser(buyer, `select public.set_weekly_limit(1900000)`)
    await expectFail(asUser(buyer, `select public.buy_tickets($1, 1)`, [iphone.id]), 'weekly_limit')
  })

  it('applies limit decreases now and increases after the delay', async () => {
    const limit = async () => Number((await asUser<{ l: string }>(buyer, `select weekly_limit_kobo l from public.profiles`))[0].l)
    expect(await limit()).toBe(1_900_000)
    await asUser(buyer, `select public.set_weekly_limit(9000000)`)
    expect(await limit()).toBe(1_900_000)
    expect((await asUser(buyer, `select * from public.pending_limits`)).length).toBe(1)
    await admin(`update public.pending_limits set effective_at = now() - interval '1 minute'`)
    await admin(`select private.process_deadlines()`)
    expect(await limit()).toBe(9_000_000)
  })

  it('sums the wallet in the database', async () => {
    const [{ w }] = await asUser<{ w: Record<string, number> }>(buyer, `select public.wallet_summary() w`)
    const b = await balance(buyer)
    expect(w).toMatchObject({ cashKobo: Number(b.cash), creditKobo: Number(b.credit), weeklyLimitKobo: 9_000_000 })
    expect(w.spentThisWeekKobo).toBe(1_500_000)
  })
})

describe('store → admin → draw', () => {
  let store: string
  let adminUser: string
  let alice: string
  let bob: string
  let listingId: string

  beforeAll(async () => {
    store = await newUser('store@example.com', { merchantId: IKEJA })
    adminUser = await newUser('admin@example.com', { role: 'admin' })
    alice = await newUser('alice@example.com')
    bob = await newUser('bob@example.com')
  })

  it('only lets linked, verified stores create listings', async () => {
    await expectFail(asUser(alice, `select public.create_listing($1)`, [listingInput()]), 'forbidden')
  })

  it('validates listings like the TypeScript rules', async () => {
    const bad = listingInput({ title: ' ', ticketPriceKobo: 5_000, feeBps: 500, durationDays: 90, unsoldPolicy: 'convert_to_sale', images: ['data:image/png;base64,xx'] })
    const e = await expectFail(asUser(store, `select public.create_listing($1)`, [bad]), 'invalid_input')
    for (const text of ['Give the item a name.', 'at least ₦100', 'between 10% and 30%', 'between 3 and 60 days', 'if the draw doesn’t sell out', 'up to 4 photos'])
      expect(e.detail).toContain(text)
    const badHandover = listingInput({ handover: { address: 'Ikeja', contactPhone: '12345', date: localDate(new Date()), slot: 'night' } })
    const e2 = await expectFail(asUser(store, `select public.create_listing($1)`, [badHandover]), 'invalid_input')
    for (const text of ['full address', 'Nigerian mobile', 'between tomorrow', 'time slot']) expect(e2.detail).toContain(text)
  })

  it('prices listings exactly like computeListingEconomics', async () => {
    for (const feeMode of ['seller', 'buyer', 'split'] as const) {
      const input = listingInput({ feeMode, priceKobo: 1_234_567, ticketPriceKobo: 33_333, feeBps: 1250 })
      const [{ id }] = await asUser<{ id: string }>(store, `select public.create_listing($1) id`, [input])
      const [row] = await asUser<{ ticket_count: number; buyer_ticket_price_kobo: string; caution_fee_kobo: string }>(store, `select * from public.listings where id = $1`, [id])
      const econ = computeListingEconomics({ priceKobo: 1_234_567, ticketPriceKobo: 33_333, feeBps: 1250, feeMode })
      expect(row.ticket_count).toBe(econ.ticketCount)
      expect(Number(row.buyer_ticket_price_kobo)).toBe(econ.buyerTicketKobo)
      expect(Number(row.caution_fee_kobo)).toBe(1_000_000)
      await asUser(adminUser, `select public.reject_listing($1)`, [id])
    }
  })

  it('creates a pending listing the store can see, with a private handover', async () => {
    const [{ id }] = await asUser<{ id: string }>(store, `select public.create_listing($1) id`, [listingInput()])
    listingId = id
    const [own] = await asUser<{ status: string; commitment: string }>(store, `select * from public.listings where id = $1`, [id])
    expect(own.status).toBe('pending_review')
    expect(own.commitment).toMatch(/^[0-9a-f]{64}$/)
    expect((await asUser(store, `select * from public.listing_handovers where listing_id = $1`, [id])).length).toBe(1)
    expect(await asUser(alice, `select * from public.listings where id = $1`, [id])).toEqual([])
  })

  it('only admins approve', async () => {
    await expectFail(asUser(store, `select public.approve_listing($1)`, [listingId]), 'forbidden')
    await asUser(adminUser, `select public.approve_listing($1)`, [listingId])
    await expectFail(asUser(adminUser, `select public.approve_listing($1)`, [listingId]), 'invalid_input')
    expect((await asUser(alice, `select * from public.listings where id = $1`, [listingId])).length).toBe(1)
  })

  it('runs a draw the TypeScript verifier accepts when the last ticket sells', async () => {
    await asUser(alice, `select public.buy_tickets($1, 4)`, [listingId])
    const [{ r }] = await asUser<{ r: { drawn: boolean; purchaseId: string } }>(bob, `select public.buy_tickets($1, 6) r`, [listingId])
    expect(r.drawn).toBe(true)

    const [l] = await asUser<{ status: string; commitment: string; caution_fee_status: string }>(alice, `select * from public.listings where id = $1`, [listingId])
    const [res] = await asUser<{ seed: string; closing_ref: string; winning_number: number; winner_user_id: string }>(alice, `select * from public.draw_results where listing_id = $1`, [listingId])
    expect(l.status).toBe('drawn')
    expect(res.closing_ref).toBe(r.purchaseId)
    const v = await verifyDraw({ commitment: l.commitment, seed: res.seed, closingRef: res.closing_ref, ticketCount: 10, claimedWinner: res.winning_number })
    expect(v.valid).toBe(true)
    expect(res.winner_user_id).toBe(res.winning_number <= 4 ? alice : bob)

    // Loser gets 20% of what they spent as store credit; winner gets none.
    const loser = res.winner_user_id === alice ? bob : alice
    const spent = (loser === alice ? 4 : 6) * 10_000
    const credits = async (u: string) => asUser<{ credit_kobo: string }>(u, `select credit_kobo from public.ledger_entries where kind = 'store_credit' and listing_id = $1`, [listingId])
    expect((await credits(loser)).map((c) => Number(c.credit_kobo))).toEqual([spent * 0.2])
    expect(await credits(res.winner_user_id)).toEqual([])
  })
})

describe('deadlines and demo controls', () => {
  let adminUser: string
  let buyer: string

  beforeAll(async () => {
    adminUser = await newUser('admin2@example.com', { role: 'admin' })
    buyer = await newUser('late@example.com')
  })

  it('extends once, then refunds buyers to the same buckets', async () => {
    const [tv] = await admin<{ id: string }>(`select id from public.listings where title like 'LG 55%'`)
    await admin(`insert into public.ledger_entries (user_id, kind, credit_kobo, memo) values ($1, 'store_credit', 100000, 'credit')`, [buyer])
    const before = await balance(buyer)
    await asUser(buyer, `select public.buy_tickets($1, 2)`, [tv.id])

    await expectFail(asUser(buyer, `select public.demo_expire($1)`, [tv.id]), 'forbidden')
    await asUser(adminUser, `select public.demo_expire($1)`, [tv.id])
    const [extended] = await admin<{ status: string; extended: boolean }>(`select * from public.listings where id = $1`, [tv.id])
    expect(extended).toMatchObject({ status: 'live', extended: true })

    await asUser(adminUser, `select public.demo_expire($1)`, [tv.id])
    const [closed] = await admin<{ status: string; caution_fee_status: string }>(`select * from public.listings where id = $1`, [tv.id])
    expect(closed).toMatchObject({ status: 'refunded', caution_fee_status: 'kept' })
    expect(await balance(buyer)).toEqual(before)
  })

  it('converts unsold convert_to_sale listings to fixed-price products', async () => {
    const [tv] = await admin<{ id: string }>(`select id from public.listings where title like 'Samsung 65%'`)
    await asUser(adminUser, `select public.demo_expire($1)`, [tv.id])
    const [l] = await admin<{ status: string }>(`select status from public.listings where id = $1`, [tv.id])
    expect(l.status).toBe('for_sale')
  })

  it('demo sell-out draws with filler tickets', async () => {
    const [mac] = await admin<{ id: string }>(`select id from public.listings where title like 'MacBook Pro 14-inch, M5'`)
    await asUser(buyer, `select public.buy_tickets($1, 1)`, [mac.id])
    await asUser(adminUser, `select public.demo_sell_out($1)`, [mac.id])
    const [l] = await admin<{ status: string }>(`select status from public.listings where id = $1`, [mac.id])
    expect(l.status).toBe('drawn')
  })

  it('switches off money and demo helpers outside test mode', async () => {
    await admin(`update public.app_settings set test_mode = false`)
    try {
      await expectFail(asUser(buyer, `select public.top_up(100)`), 'forbidden')
      await expectFail(asUser(buyer, `select public.update_profile(null, 'Oyo')`), 'forbidden')
      const [l] = await admin<{ id: string }>(`select id from public.listings where status = 'live' limit 1`)
      await expectFail(asUser(adminUser, `select public.demo_sell_out($1)`, [l.id]), 'forbidden')
      const fresh = await newUser('prod@example.com')
      const [p] = await asUser<{ state: string | null; age_verified: boolean }>(fresh, `select * from public.profiles`)
      expect(p).toMatchObject({ state: null, age_verified: false })
      expect(await balance(fresh)).toEqual({ cash: '0', credit: '0' })
    } finally {
      await admin(`update public.app_settings set test_mode = true`)
    }
  })
})

describe('winning number', () => {
  it('matches the TypeScript draw for random seeds and sizes', async () => {
    for (let i = 0; i < 40; i++) {
      const seed = createSeed()
      const ref = `P-${i.toString(16).toUpperCase().padStart(6, '0')}`
      const n = [1, 2, 7, 10, 999, 6600, 10_000][i % 7]
      const [{ w }] = await admin<{ w: number }>(`select private.winning_number($1, $2, $3) w`, [seed, ref, n])
      expect(w).toBe(await winningTicketNumber(seed, ref, n))
    }
  })
})
