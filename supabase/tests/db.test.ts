/**
 * Runs the real migration + seed in PGlite (Postgres compiled to WASM), with
 * the bits of Supabase it relies on (auth schema, roles) stubbed. No Docker.
 *
 * Calls are made as the `authenticated` role with a user id, the same way
 * Supabase runs API requests, so grants and row-level security are exercised.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { verifyDraw, winningTicketNumber, createSeed } from '@/domain/draw'
import { computeListingEconomics, platformFeeBps } from '@/domain/fees'
import { addDays, localDate } from '@/domain/listing'

const sql = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema extensions;
  grant usage on schema public, extensions to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (
    id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}',
    -- Columns supabase/seed-local-accounts.sql fills in, as on real Supabase.
    instance_id uuid, aud text, role text, encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb,
    created_at timestamptz, updated_at timestamptz, confirmation_token text, recovery_token text, email_change_token_new text, email_change text
  );
  create table auth.identities (
    id uuid primary key, user_id uuid, provider_id text, identity_data jsonb, provider text,
    last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
  );
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

/** As the Edge Functions run: the service role, no user. */
async function asService<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('set role service_role')
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
  if (opts.merchantId) await admin(`update public.profiles set role = 'store', merchant_id = $2 where id = $1`, [u.id, opts.merchantId])
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
  // Every migration, in order, like `supabase db push`.
  for (const f of readdirSync(new URL('../migrations', import.meta.url)).sort()) await db.exec(sql(`migrations/${f}`))
  await db.exec(sql('seed.sql'))
}, 60_000)

describe('schema and seed', () => {
  it('never updates or deletes without a WHERE clause in API functions (Supabase blocks it)', async () => {
    const fns = await admin<{ name: string; body: string }>(
      `select p.proname as name, p.prosrc as body from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef`,
    )
    // PGlite can't load pg_safeupdate, so check the function bodies instead.
    const offenders = fns.flatMap(({ name, body }) =>
      body
        .replace(/--[^\n]*/g, '')
        .split(';')
        .filter((stmt) => /\b(update|delete\s+from)\s+public\./i.test(stmt) && !/\bwhere\b/i.test(stmt))
        .map(() => name),
    )
    expect(offenders).toEqual([])
  })

  it('seeds stores and listings, and is safe to run twice', async () => {
    await db.exec(sql('seed.sql'))
    const [{ n }] = await admin<{ n: number }>(`select count(*)::int n from public.merchants`)
    expect(n).toBe(5)
    const [{ products }] = await admin<{ products: number }>(`select count(*)::int products from public.listings where kind = 'product'`)
    expect(products).toBe(4)
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

  it('shows draw results to everyone but never who won', async () => {
    const u = await newUser('curious@example.com')
    for (const who of [u, null]) {
      expect((await asUser(who, `select listing_id, seed, winning_number from public.draw_results`)).length).toBe(3)
      await expect(asUser(who, `select winner_user_id from public.draw_results`)).rejects.toThrow(/permission denied/)
      await expect(asUser(who, `select * from public.draw_results`)).rejects.toThrow(/permission denied/)
    }
  })

  it('creates the local demo accounts with the right access', async () => {
    await db.exec(sql('seed-local-accounts.sql'))
    await db.exec(sql('seed-local-accounts.sql')) // safe to re-run
    const rows = await admin<{ email: string; role: string; merchant_id: string | null; has_identity: boolean }>(
      `select u.email, p.role, p.merchant_id, exists (select 1 from auth.identities i where i.user_id = u.id) has_identity
         from auth.users u join public.profiles p on p.id = u.id where u.email like '%@drawmart.test' order by u.email`,
    )
    expect(rows).toEqual([
      { email: 'admin@drawmart.test', role: 'admin', merchant_id: null, has_identity: true },
      { email: 'buyer@drawmart.test', role: 'buyer', merchant_id: null, has_identity: true },
      { email: 'store@drawmart.test', role: 'store', merchant_id: IKEJA, has_identity: true },
    ])
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
    for (const text of ['Give the item a name.', 'at least ₦100', 'between 3 and 60 days', 'if the draw doesn’t sell out', 'up to 4 photos'])
      expect(e.detail).toContain(text)
    const badHandover = listingInput({ handover: { address: 'Ikeja', contactPhone: '12345', date: localDate(new Date()), slot: 'night' } })
    const e2 = await expectFail(asUser(store, `select public.create_listing($1)`, [badHandover]), 'invalid_input')
    for (const text of ['full address', 'Nigerian mobile', 'between tomorrow', 'time slot']) expect(e2.detail).toContain(text)
  })

  it('prices listings exactly like computeListingEconomics', async () => {
    for (const feeMode of ['seller', 'buyer', 'split'] as const) {
      // The 1250 sent here is ignored: the fee comes from the price.
      const input = listingInput({ feeMode, priceKobo: 1_234_567, ticketPriceKobo: 33_333, feeBps: 1250 })
      const [{ id }] = await asUser<{ id: string }>(store, `select public.create_listing($1) id`, [input])
      const [row] = await asUser<{ ticket_count: number; buyer_ticket_price_kobo: string; caution_fee_kobo: string }>(store, `select * from public.listings where id = $1`, [id])
      const econ = computeListingEconomics({ priceKobo: 1_234_567, ticketPriceKobo: 33_333, feeBps: platformFeeBps(1_234_567), feeMode })
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
    const [res] = await asUser<{ seed: string; closing_ref: string; winning_number: number }>(
      alice, `select seed, closing_ref, winning_number from public.draw_results where listing_id = $1`, [listingId],
    )
    // Only the database knows who won; API users can't read it.
    const [{ winner_user_id }] = await admin<{ winner_user_id: string }>(`select winner_user_id from public.draw_results where listing_id = $1`, [listingId])
    expect(l.status).toBe('drawn')
    expect(res.closing_ref).toBe(r.purchaseId)
    const v = await verifyDraw({ commitment: l.commitment, seed: res.seed, closingRef: res.closing_ref, ticketCount: 10, claimedWinner: res.winning_number })
    expect(v.valid).toBe(true)
    expect(winner_user_id).toBe(res.winning_number <= 4 ? alice : bob)

    // Loser gets 20% of what they spent as store credit; winner gets none.
    const loser = winner_user_id === alice ? bob : alice
    const spent = (loser === alice ? 4 : 6) * 10_000
    const credits = async (u: string) => asUser<{ credit_kobo: string }>(u, `select credit_kobo from public.ledger_entries where kind = 'store_credit' and listing_id = $1`, [listingId])
    expect((await credits(loser)).map((c) => Number(c.credit_kobo))).toEqual([spent * 0.2])
    expect(await credits(winner_user_id)).toEqual([])
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

describe('flutterwave deposits', () => {
  let buyer: string
  let other: string
  type Checkout = { txRef: string; amountKobo: number; email: string; name: string }
  const start = async (amount: number, who = buyer) => (await asUser<{ c: Checkout }>(who, `select public.start_deposit($1) c`, [amount]))[0].c
  const complete = async (txRef: string, status: string, amountKobo: number | null, currency = 'NGN') =>
    (await asService<{ s: string }>(`select public.complete_deposit($1, $2, $3, $4, 'FLW-1') s`, [txRef, status, amountKobo, currency]))[0].s
  const depositStatus = async (txRef: string) => (await admin<{ status: string }>(`select status from public.deposits where tx_ref = $1`, [txRef]))[0].status

  beforeAll(async () => {
    buyer = await newUser('payer@example.com')
    other = await newUser('snoop@example.com')
  })

  it('starts a pending deposit with what the checkout needs', async () => {
    const c = await start(2_000_000)
    expect(c).toMatchObject({ amountKobo: 2_000_000, email: 'payer@example.com', name: 'payer' })
    expect(c.txRef).toMatch(/^DM-[0-9A-F]{32}$/)
    expect(await asUser(buyer, `select status from public.deposits where tx_ref = $1`, [c.txRef])).toEqual([{ status: 'pending' }])
    expect(await asUser(other, `select * from public.deposits`)).toEqual([])
  })

  it('checks the amount like topUpError', async () => {
    for (const [amount, text] of [[0, 'Enter an amount'], [9_999, 'smallest top-up is ₦100.'], [50_000_001, 'largest single top-up is ₦500,000.']] as const) {
      const e = await expectFail(start(amount), 'invalid_input')
      expect(e.detail).toContain(text)
    }
    await expectFail(asUser(buyer, `select public.top_up(50000001)`), 'invalid_input')
    await expect(asUser(null, `select public.start_deposit(10000)`)).rejects.toThrow(/permission denied/)
  })

  it('credits the wallet once, only through the service role', async () => {
    const c = await start(1_500_000)
    const before = await balance(buyer)
    await expect(asUser(buyer, `select public.complete_deposit($1, 'successful', 1500000, 'NGN', 'x')`, [c.txRef])).rejects.toThrow(/permission denied/)

    expect(await complete(c.txRef, 'successful', 1_500_000)).toBe('successful')
    expect(await complete(c.txRef, 'successful', 1_500_000)).toBe('successful') // webhook and confirm both arrive
    expect(Number((await balance(buyer)).cash)).toBe(Number(before.cash) + 1_500_000)
    const [entry] = await asUser<{ memo: string }>(buyer, `select memo from public.ledger_entries order by created_at desc limit 1`)
    expect(entry.memo).toBe('Wallet top-up (Flutterwave test)')
  })

  it('never credits short or foreign-currency payments', async () => {
    const before = await balance(buyer)
    const short = await start(1_000_000)
    expect(await complete(short.txRef, 'successful', 999_999)).toBe('failed')
    const usd = await start(1_000_000)
    expect(await complete(usd.txRef, 'successful', 1_000_000, 'USD')).toBe('failed')
    expect(await balance(buyer)).toEqual(before)
  })

  it('keeps pending while unpaid, and still credits a late payment after a cancel', async () => {
    const c = await start(500_000)
    expect(await complete(c.txRef, 'pending', null)).toBe('pending')
    await asUser(other, `select public.cancel_deposit($1)`, [c.txRef]) // not theirs: no effect
    expect(await depositStatus(c.txRef)).toBe('pending')
    await asUser(buyer, `select public.cancel_deposit($1)`, [c.txRef])
    expect(await depositStatus(c.txRef)).toBe('cancelled')
    expect(await complete(c.txRef, 'failed', null)).toBe('cancelled')
    expect(await complete(c.txRef, 'successful', 500_000)).toBe('successful')
    await expectFail(complete('DM-NOPE', 'successful', 1), 'not_found')
  })

  it('limits unfinished deposits', async () => {
    const spammer = await newUser('spam@example.com')
    for (let i = 0; i < 10; i++) await start(10_000, spammer)
    const e = await expectFail(start(10_000, spammer), 'invalid_input')
    expect(e.detail).toContain('Too many unfinished top-ups')
  })
})

describe('one app per account', () => {
  let store: string
  let staff: string

  beforeAll(async () => {
    store = await newUser('shopkeeper@example.com', { merchantId: IKEJA })
    staff = await newUser('staff@example.com', { role: 'admin' })
  })

  it('keeps store links and roles in step', async () => {
    const u = await newUser('mixed@example.com')
    await expect(admin(`update public.profiles set merchant_id = $2 where id = $1`, [u, IKEJA])).rejects.toThrow(/profiles_store_has_merchant/)
    await expect(admin(`update public.profiles set role = 'store' where id = $1`, [u])).rejects.toThrow(/profiles_store_has_merchant/)
    await expect(admin(`update public.profiles set role = 'admin', merchant_id = $2 where id = $1`, [u, IKEJA])).rejects.toThrow(/profiles_store_has_merchant/)
  })

  it('stops store and admin accounts buying tickets or topping up', async () => {
    const [live] = await admin<{ id: string }>(`select id from public.listings where status = 'live' limit 1`)
    for (const who of [store, staff]) {
      await expectFail(asUser(who, `select public.buy_tickets($1, 1)`, [live.id]), 'forbidden')
      await expectFail(asUser(who, `select public.top_up(100000)`), 'forbidden')
      await expectFail(asUser(who, `select public.start_deposit(100000)`), 'forbidden')
    }
  })

  it('still lets the store and admin do their jobs', async () => {
    const [{ id }] = await asUser<{ id: string }>(store, `select public.create_listing($1) id`, [listingInput()])
    await asUser(staff, `select public.approve_listing($1)`, [id])
    const [l] = await admin<{ status: string }>(`select status from public.listings where id = $1`, [id])
    expect(l.status).toBe('live')
  })
})

describe('regular products and orders', () => {
  let store: string
  let otherStore: string
  let staff: string
  let buyer: string
  let productId: string
  const product = { title: 'Office chair', description: 'Ergonomic, mesh back.', category: 'Home', priceKobo: 4_000_000, feeBps: 1250, images: ['/assets/x.jpg'] }
  const delivery = ['15 Awolowo Road, Ikoyi', '0803 123 4567']

  beforeAll(async () => {
    store = await newUser('chairs@example.com', { merchantId: IKEJA })
    otherStore = await newUser('rival@example.com', { merchantId: '11111111-1111-4111-8111-000000000002' })
    staff = await newUser('staff3@example.com', { role: 'admin' })
    buyer = await newUser('shopper@example.com')
  })

  it('lists products for review with no tickets, handover or caution fee', async () => {
    const e = await expectFail(asUser(store, `select public.create_product($1)`, [{ ...product, title: ' ', priceKobo: 9_999, feeBps: 900 }]), 'invalid_input')
    for (const text of ['Give the item a name.', 'at least ₦100']) expect(e.detail).toContain(text)
    await expectFail(asUser(buyer, `select public.create_product($1)`, [product]), 'forbidden')

    ;[{ id: productId }] = await asUser<{ id: string }>(store, `select public.create_product($1) id`, [product])
    const [row] = await admin<Record<string, unknown>>(`select * from public.listings where id = $1`, [productId])
    expect(row).toMatchObject({ kind: 'product', status: 'pending_review', ticket_count: 0, caution_fee_status: 'none', commitment: '' })
    expect(await admin(`select * from public.listing_handovers where listing_id = $1`, [productId])).toEqual([])
  })

  it('goes straight on sale when approved', async () => {
    await asUser(staff, `select public.approve_listing($1)`, [productId])
    const [row] = await asUser<{ status: string }>(buyer, `select status from public.listings where id = $1`, [productId])
    expect(row.status).toBe('for_sale')
  })

  it('checks the delivery details and the wallet before selling', async () => {
    const e = await expectFail(asUser(buyer, `select public.buy_now($1, 'Ikoyi', '123')`, [productId]), 'invalid_input')
    expect(e.detail).toContain('full delivery address')
    expect(e.detail).toContain('Nigerian mobile')
    await expectFail(asUser(buyer, `select public.buy_now($1, $2, $3)`, [productId, ...delivery]), 'insufficient_funds') // ₦25,000 < ₦40,000
    await expectFail(asUser(store, `select public.buy_now($1, $2, $3)`, [productId, ...delivery]), 'forbidden')
    const [live] = await admin<{ id: string }>(`select id from public.listings where status = 'live' limit 1`)
    await expectFail(asUser(buyer, `select public.buy_now($1, $2, $3)`, [live.id, ...delivery]), 'not_for_sale')
  })

  it('sells once, paying with credit first, and records the order', async () => {
    await admin(`insert into public.ledger_entries (user_id, kind, credit_kobo, memo) values ($1, 'store_credit', 300000, 'credit')`, [buyer])
    await asUser(buyer, `select public.top_up(1500000)`)
    const [{ id }] = await asUser<{ id: string }>(buyer, `select public.buy_now($1, $2, $3) id`, [productId, ...delivery])
    expect(await balance(buyer)).toEqual({ cash: String(2_500_000 + 1_500_000 - 3_700_000), credit: '0' })
    const [order] = await asUser<{ status: string; price_kobo: number; fee_kobo: number; delivery_address: string }>(buyer, `select * from public.orders where id = $1`, [id])
    expect(order).toMatchObject({ status: 'paid', price_kobo: 4_000_000, fee_kobo: 300_000, delivery_address: '15 Awolowo Road, Ikoyi' })
    const [l] = await admin<{ status: string }>(`select status from public.listings where id = $1`, [productId])
    expect(l.status).toBe('sold')
    await expectFail(asUser(buyer, `select public.buy_now($1, $2, $3)`, [productId, ...delivery]), 'not_for_sale')
    expect((await asUser(buyer, `select id from public.listings where id = $1`, [productId])).length).toBe(1) // still visible once sold
  })

  it('shows orders only to the buyer, the store and admins', async () => {
    expect((await asUser(store, `select * from public.orders`)).length).toBe(1)
    expect((await asUser(staff, `select * from public.orders`)).length).toBeGreaterThanOrEqual(1)
    expect(await asUser(otherStore, `select * from public.orders`)).toEqual([])
    expect(await asUser(null, `select * from public.orders`).catch(() => [])).toEqual([])
  })

  it('is dispatched by its store and confirmed by its buyer', async () => {
    const [{ id }] = await admin<{ id: string }>(`select id from public.orders where listing_id = $1`, [productId])
    await expectFail(asUser(otherStore, `select public.dispatch_order($1)`, [id]), 'invalid_input')
    await expectFail(asUser(store, `select public.confirm_order($1)`, [id]), 'invalid_input')
    await asUser(store, `select public.dispatch_order($1)`, [id])
    await asUser(buyer, `select public.confirm_order($1)`, [id])
    const [o] = await admin<{ status: string; delivered_at: string | null }>(`select * from public.orders where id = $1`, [id])
    expect(o.status).toBe('delivered')
    expect(o.delivered_at).not.toBeNull()
  })

  it('sells unsold raffles at their fallback price', async () => {
    const rich = await newUser('rich@example.com')
    await asUser(rich, `select public.top_up(50000000)`)
    await asUser(rich, `select public.top_up(50000000)`)
    await asUser(rich, `select public.top_up(50000000)`)
    await asUser(rich, `select public.top_up(50000000)`)
    const [s26] = await admin<{ id: string }>(`select id from public.listings where kind = 'raffle' and status = 'for_sale' and title like 'Samsung Galaxy S26 Ultra, 256GB'`)
    const [{ id }] = await asUser<{ id: string }>(rich, `select public.buy_now($1, $2, $3) id`, [s26.id, ...delivery])
    const [o] = await asUser<{ price_kobo: string }>(rich, `select price_kobo from public.orders where id = $1`, [id])
    expect(Number(o.price_kobo)).toBe(165_000_000)
  })

  it('keeps the caution fee rules for raffles when rejecting', async () => {
    const [{ id }] = await asUser<{ id: string }>(store, `select public.create_listing($1) id`, [listingInput()])
    await asUser(staff, `select public.reject_listing($1)`, [id])
    const [{ id: pid }] = await asUser<{ id: string }>(store, `select public.create_product($1) id`, [product])
    await asUser(staff, `select public.reject_listing($1)`, [pid])
    const rows = await admin<{ kind: string; caution_fee_status: string }>(`select kind, caution_fee_status from public.listings where id in ($1, $2) order by kind`, [pid, id])
    expect(rows).toEqual([{ kind: 'product', caution_fee_status: 'none' }, { kind: 'raffle', caution_fee_status: 'kept' }])
  })
})

describe('individual sellers', () => {
  let seller: string
  let staff: string
  let shopper: string
  const application = (who: string, patch: Record<string, unknown> = {}) => ({
    shopName: 'Tolu’s Gadgets', legalName: 'Toluwani Adebayo', nin: '123 4567 8901', phone: '0803 123 4567',
    address: '12 Herbert Macaulay Way, Yaba', area: 'Yaba', idPhoto: `${who}/id.jpg`, selfie: `${who}/selfie.jpg`, ...patch,
  })
  const product = { title: 'PS5 Slim, barely used', description: 'With two pads.', category: 'Electronics', priceKobo: 1_500_000, feeBps: 1000, images: [] }
  const appFor = async (u: string) => (await admin<{ id: string; status: string; review_note: string | null }>(`select * from public.seller_applications where user_id = $1`, [u]))[0]

  beforeAll(async () => {
    seller = await newUser('tolu@example.com')
    staff = await newUser('staff4@example.com', { role: 'admin' })
    shopper = await newUser('ngozi@example.com')
  })

  it('validates applications like sellers.ts, and only own photos', async () => {
    const e = await expectFail(asUser(seller, `select public.submit_seller_application($1)`, [application(seller, { shopName: '', legalName: 'Tolu', nin: '12', phone: '1', address: 'Yaba', area: '', idPhoto: `${shopper}/id.jpg`, selfie: '' })]), 'invalid_input')
    for (const text of ['shop a name', 'full legal name', '11-digit NIN', 'Nigerian mobile', 'home address', 'area in Lagos', 'photo of your ID', 'selfie']) expect(e.detail).toContain(text)
    const store = await newUser('store5@example.com', { merchantId: IKEJA })
    await expectFail(asUser(store, `select public.submit_seller_application($1)`, [application(store)]), 'forbidden')
  })

  it('keeps applications private to the applicant and admins', async () => {
    await asUser(seller, `select public.submit_seller_application($1)`, [application(seller)])
    await expectFail(asUser(seller, `select public.submit_seller_application($1)`, [application(seller)]), 'invalid_input') // already pending
    expect((await asUser(seller, `select nin from public.seller_applications`))).toEqual([{ nin: '12345678901' }])
    expect(await asUser(shopper, `select * from public.seller_applications`)).toEqual([])
    expect((await asUser(staff, `select * from public.seller_applications where user_id = $1`, [seller])).length).toBe(1)
  })

  it('can’t list anything before approval', async () => {
    await expectFail(asUser(seller, `select public.create_product($1)`, [product]), 'forbidden')
  })

  it('needs a reason to reject, and lets the seller fix and resubmit', async () => {
    const a = await appFor(seller)
    await expectFail(asUser(seller, `select public.reject_seller($1, 'nope')`, [a.id]), 'forbidden')
    await expectFail(asUser(staff, `select public.reject_seller($1, '')`, [a.id]), 'invalid_input')
    await asUser(staff, `select public.reject_seller($1, 'The selfie is blurry.')`, [a.id])
    expect(await appFor(seller)).toMatchObject({ status: 'rejected', review_note: 'The selfie is blurry.' })
    await asUser(seller, `select public.submit_seller_application($1)`, [application(seller, { selfie: `${seller}/selfie2.jpg` })])
    expect(await appFor(seller)).toMatchObject({ status: 'pending', review_note: null })
  })

  it('approves into an individual shop that lists products but never raffles', async () => {
    const a = await appFor(seller)
    await expectFail(asUser(seller, `select public.approve_seller($1)`, [a.id]), 'forbidden')
    await asUser(staff, `select public.approve_seller($1)`, [a.id])
    const [p] = await admin<{ role: string; seller_id: string; kind: string; name: string; cac_number: string }>(
      `select p.role, p.seller_id, m.kind, m.name, m.cac_number from public.profiles p join public.merchants m on m.id = p.seller_id where p.id = $1`, [seller],
    )
    expect(p).toMatchObject({ role: 'buyer', kind: 'individual', name: 'Tolu’s Gadgets', cac_number: '' })

    await expectFail(asUser(seller, `select public.create_listing($1)`, [listingInput()]), 'forbidden')
    const [{ id }] = await asUser<{ id: string }>(seller, `select public.create_product($1) id`, [product])
    expect((await asUser(seller, `select status from public.listings where id = $1`, [id]))).toEqual([{ status: 'pending_review' }])
    await asUser(staff, `select public.approve_listing($1)`, [id])

    // Still a buyer: can buy tickets, but not their own item.
    await expectFail(asUser(seller, `select public.buy_now($1, '12 Herbert Macaulay Way, Yaba', '0803 123 4567')`, [id]), 'forbidden')
    const [live] = await admin<{ id: string }>(`select id from public.listings where status = 'live' limit 1`)
    await asUser(seller, `select public.buy_tickets($1, 1)`, [live.id])

    // A buyer buys it; the seller sees and dispatches the order.
    await asUser(shopper, `select public.top_up(1000000)`)
    const [{ order }] = await asUser<{ order: string }>(shopper, `select public.buy_now($1, '4 Admiralty Way, Lekki', '0803 765 4321') "order"`, [id])
    expect((await asUser(seller, `select id from public.orders`)).map((o) => o.id)).toEqual([order])
    await asUser(seller, `select public.dispatch_order($1)`, [order])
  })

  it('only links buyers as individual sellers', async () => {
    await expect(admin(`update public.profiles set role = 'admin' where id = $1`, [seller])).rejects.toThrow(/profiles_seller_is_buyer/)
  })
})

describe('value-based platform fee', () => {
  it('matches platformFeeBps at every tier boundary', async () => {
    for (const price of [100, 4_999_999, 5_000_000, 49_999_999, 50_000_000, 499_999_999, 500_000_000, 33_000_000_000]) {
      const [{ bps }] = await admin<{ bps: number }>(`select private.platform_fee_bps($1) bps`, [price])
      expect(bps).toBe(platformFeeBps(price))
    }
  })

  it('ignores any fee a seller sends', async () => {
    const store = await newUser('cheeky@example.com', { merchantId: IKEJA })
    const [{ id }] = await asUser<{ id: string }>(store, `select public.create_product($1) id`, [{ title: 'Lamp', category: 'Home', priceKobo: 60_000_000, feeBps: 1000 }])
    const [{ id: raffle }] = await asUser<{ id: string }>(store, `select public.create_listing($1) id`, [listingInput({ feeBps: 3000 })])
    const rows = await admin<{ id: string; fee_bps: number }>(`select id, fee_bps from public.listings where id in ($1, $2)`, [id, raffle])
    expect(Object.fromEntries(rows.map((r) => [r.id, r.fee_bps]))).toEqual({ [id]: platformFeeBps(60_000_000), [raffle]: platformFeeBps(100_000) })
  })

  it('can’t be read for a private function by API users', async () => {
    await expect(asUser(null, `select private.platform_fee_bps(100)`)).rejects.toThrow(/permission denied/)
  })
})

describe('buyer and seller messages', () => {
  let store: string
  let rival: string
  let buyer: string
  let nosy: string
  let productId: string
  let raffleId: string
  let convo: string
  type Convo = { id: string; me: string; unread: number; callPhone: string | null; buyerName: string; merchantName: string; lastMessage: { body: string } | null }
  const inbox = async (who: string) => (await asUser<{ c: Convo[] }>(who, `select public.list_conversations() c`))[0].c

  beforeAll(async () => {
    store = await newUser('chatstore@example.com', { merchantId: IKEJA })
    rival = await newUser('chatrival@example.com', { merchantId: '11111111-1111-4111-8111-000000000002' })
    buyer = await newUser('asker@example.com')
    nosy = await newUser('nosy2@example.com')
    ;[{ id: productId }] = await admin<{ id: string }>(`select id from public.listings where kind = 'product' and status = 'for_sale' and merchant_id = $1 limit 1`, [IKEJA])
    ;[{ id: raffleId }] = await admin<{ id: string }>(`select id from public.listings where kind = 'raffle' and status = 'live' limit 1`)
  })

  it('opens one conversation per buyer per product, never for raffles', async () => {
    ;[{ id: convo }] = await asUser<{ id: string }>(buyer, `select public.start_conversation($1) id`, [productId])
    const [{ again }] = await asUser<{ again: string }>(buyer, `select public.start_conversation($1) again`, [productId])
    expect(again).toBe(convo)
    await expectFail(asUser(buyer, `select public.start_conversation($1)`, [raffleId]), 'invalid_input')
    await expectFail(asUser(store, `select public.start_conversation($1)`, [productId]), 'forbidden')
  })

  it('lets only the buyer and the seller read and write', async () => {
    await asUser(buyer, `select public.send_message($1, 'Is it still available?')`, [convo])
    await asUser(store, `select public.send_message($1, 'Yes! Sealed in the box.')`, [convo])
    expect((await asUser(buyer, `select body from public.messages order by created_at`)).map((m) => m.body)).toEqual(['Is it still available?', 'Yes! Sealed in the box.'])
    expect((await asUser(store, `select sender from public.messages where conversation_id = $1 order by created_at`, [convo])).map((m) => m.sender)).toEqual(['buyer', 'seller'])
    for (const who of [nosy, rival]) {
      expect(await asUser(who, `select * from public.messages`)).toEqual([])
      expect(await asUser(who, `select * from public.conversations`)).toEqual([])
      await expectFail(asUser(who, `select public.send_message($1, 'hi')`, [convo]), 'forbidden')
    }
    await expect(asUser(buyer, `insert into public.messages (conversation_id, sender, sender_user_id, body) values ($1, 'seller', $2, 'fake')`, [convo, buyer])).rejects.toThrow(/permission denied/)
    await expectFail(asUser(buyer, `select public.send_message($1, '   ')`, [convo]), 'invalid_input')
  })

  it('counts unread messages for each side', async () => {
    const [b] = await inbox(buyer)
    expect(b).toMatchObject({ me: 'buyer', unread: 1, merchantName: 'Ikeja Partner Store', lastMessage: { body: 'Yes! Sealed in the box.' } })
    await asUser(buyer, `select public.mark_conversation_read($1)`, [convo])
    expect((await inbox(buyer))[0].unread).toBe(0)
    const [s] = await inbox(store)
    expect(s).toMatchObject({ me: 'seller', unread: 0, buyerName: 'asker' })
    expect(await inbox(nosy)).toEqual([])
  })

  it('shares the seller’s call number only with buyers they’re talking to', async () => {
    await expectFail(asUser(store, `select public.set_call_phone('123')`), 'invalid_input')
    await expectFail(asUser(nosy, `select public.set_call_phone('0803 555 0000')`), 'forbidden')
    await asUser(store, `select public.set_call_phone('0803 555 0000')`)
    expect((await inbox(buyer))[0].callPhone).toBe('0803 555 0000')
    expect((await inbox(store))[0].callPhone).toBeNull()
    expect((await asUser(buyer, `select call_phone from public.merchant_contacts`))).toEqual([{ call_phone: '0803 555 0000' }])
    expect(await asUser(nosy, `select * from public.merchant_contacts`)).toEqual([])
    await asUser(store, `select public.set_call_phone(null)`)
    expect((await inbox(buyer))[0].callPhone).toBeNull()
  })

  it('limits how fast one person can send', async () => {
    for (let i = 0; i < 19; i++) await asUser(buyer, `select public.send_message($1, $2)`, [convo, `msg ${i}`])
    const e = await expectFail(asUser(buyer, `select public.send_message($1, 'one too many')`, [convo]), 'invalid_input')
    expect(e.detail).toContain('very fast')
  })
})

describe('seller metrics', () => {
  let seller: string
  let staff: string
  let productId: string
  type Metrics = { listings: { listingId: string; views: number; visitors: number; chats: number; units: number; buyers: number; salesKobo: number }[]; daily: { date: string; views: number; salesKobo: number }[] }
  const metrics = async (who: string, days = 7) => (await asUser<{ m: Metrics }>(who, `select public.merchant_metrics($1) m`, [days]))[0].m

  beforeAll(async () => {
    seller = await newUser('metrics@example.com')
    staff = await newUser('staff6@example.com', { role: 'admin' })
    const [{ id: shop }] = await admin<{ id: string }>(`insert into public.merchants (kind, name, area, cac_number, verified) values ('individual', 'Stat Shop', 'Yaba', '', true) returning id`)
    await admin(`update public.profiles set seller_id = $2 where id = $1`, [seller, shop])
    ;[{ id: productId }] = await asUser<{ id: string }>(seller, `select public.create_product($1) id`, [{ title: 'Desk lamp', category: 'Home', priceKobo: 2_000_000 }])
  })

  it('counts views once per visitor per day, and never the seller’s own', async () => {
    await asUser(null, `select public.record_listing_view($1, 'visitor-aaaa')`, [productId]) // not on sale yet: ignored
    await asUser(staff, `select public.approve_listing($1)`, [productId])
    const viewer = await newUser('looker@example.com')
    for (let i = 0; i < 3; i++) await asUser(viewer, `select public.record_listing_view($1, null)`, [productId])
    await asUser(null, `select public.record_listing_view($1, 'visitor-bbbb')`, [productId])
    await asUser(null, `select public.record_listing_view($1, 'x')`, [productId]) // bad id: ignored
    await asUser(seller, `select public.record_listing_view($1, 'visitor-cccc')`, [productId])
    const [l] = (await metrics(seller)).listings
    expect(l).toMatchObject({ listingId: productId, views: 2, visitors: 2 })
    await expect(asUser(seller, `select * from public.listing_views`)).rejects.toThrow(/permission denied/)
  })

  it('adds chats and sales, per listing and per day', async () => {
    const buyer = await newUser('statbuyer@example.com')
    await asUser(buyer, `select public.record_listing_view($1, null)`, [productId])
    await asUser(buyer, `select public.start_conversation($1)`, [productId])
    await asUser(buyer, `select public.buy_now($1, '15 Awolowo Road, Ikoyi', '0803 123 4567')`, [productId])
    const m = await metrics(seller, 30)
    expect(m.listings[0]).toMatchObject({ views: 3, visitors: 3, chats: 1, units: 1, buyers: 1, salesKobo: 2_000_000 })
    expect(m.daily).toEqual([{ date: expect.any(String), views: 3, salesKobo: 2_000_000 }])
  })

  it('is only for sellers, over 7 or 30 days', async () => {
    const plain = await newUser('nostats@example.com')
    await expectFail(metrics(plain), 'forbidden')
    await expectFail(metrics(seller, 12), 'invalid_input')
    expect((await metrics(staff).catch((e) => e.message))).toBe('forbidden')
  })

  it('counts ticket sales on live raffles for stores', async () => {
    const store = await newUser('statstore@example.com', { merchantId: IKEJA })
    const m = await metrics(store, 30)
    const iphone = m.listings.find((l) => l.units > 0)
    expect(iphone?.salesKobo).toBeGreaterThan(0)
  })
})

describe('boosts', () => {
  let store: string
  let staff: string
  let buyer: string
  let products: string[]
  type Status = { unlocked: boolean; slotsLeft: number; packages: { id: string; priceKobo: number }[]; admin: { activeBuyers: number } | null }
  const status = async (who: string) => (await asUser<{ s: Status }>(who, `select public.boost_status() s`))[0].s
  const start = async (listing: string, pkg = '3d', who = store) => (await asUser<{ c: { txRef: string; amountKobo: number } }>(who, `select public.start_boost($1, $2) c`, [listing, pkg]))[0].c
  const complete = async (txRef: string, amount: number, st = 'successful') =>
    (await asService<{ s: string }>(`select public.complete_boost($1, $2, $3, 'NGN', 'FLW-9') s`, [txRef, st, amount]))[0].s
  const boostedUntil = async (id: string) => (await asUser<{ b: string | null }>(buyer, `select boosted_until b from public.listings where id = $1`, [id]))[0].b

  beforeAll(async () => {
    store = await newUser('booster@example.com', { merchantId: IKEJA })
    staff = await newUser('staff7@example.com', { role: 'admin' })
    buyer = await newUser('scroller@example.com')
    products = (await admin<{ id: string }>(`select id from public.listings where merchant_id = $1 and status in ('live', 'for_sale') order by id`, [IKEJA])).map((r) => r.id)
  })

  it('stays locked until enough active buyers, unless an admin opens it', async () => {
    expect(await status(store)).toMatchObject({ unlocked: false, admin: null, packages: [{ id: '3d', priceKobo: 250000 }, { id: '7d' }, { id: '14d' }] })
    await expectFail(start(products[0]), 'forbidden')
    expect((await status(staff)).admin?.activeBuyers).toBeGreaterThan(0)
    await expectFail(asUser(store, `select public.set_boost_settings(0, true, 2)`), 'forbidden')
    await asUser(staff, `select public.set_boost_settings(1000, true, 2)`)
    expect(await status(store)).toMatchObject({ unlocked: true, slotsLeft: 2 })
  })

  it('only boosts the shop’s own live or on-sale listings', async () => {
    const [other] = await admin<{ id: string }>(`select id from public.listings where merchant_id <> $1 and status = 'live' limit 1`, [IKEJA])
    await expectFail(start(other.id), 'not_found')
    const [pending] = await admin<{ id: string }>(`select id from public.listings where merchant_id = $1 and status = 'pending_review' limit 1`, [IKEJA])
    await expectFail(start(pending.id), 'invalid_input')
    await expectFail(start(products[0], 'nope'), 'invalid_input')
    await expectFail(start(products[0], '3d', buyer), 'forbidden')
  })

  it('starts once Flutterwave confirms a full naira payment, and only from the service role', async () => {
    const short = await start(products[0])
    expect(await complete(short.txRef, 100)).toBe('failed')
    expect(await boostedUntil(products[0])).toBeNull()

    const c = await start(products[0])
    await expect(asUser(store, `select public.complete_boost($1, 'successful', 250000, 'NGN', 'x')`, [c.txRef])).rejects.toThrow(/permission denied/)
    expect(await complete(c.txRef, 250000)).toBe('successful')
    expect(await complete(c.txRef, 250000)).toBe('successful') // webhook and confirm both arrive
    const until = Date.parse((await boostedUntil(products[0]))!)
    expect(until - Date.now()).toBeGreaterThan(2.9 * 86_400_000)

    // A second boost runs on after the first.
    const more = await start(products[0], '7d')
    await asUser(store, `select public.test_pay_boost($1)`, [more.txRef])
    expect(Date.parse((await boostedUntil(products[0]))!) - until).toBeGreaterThan(6.9 * 86_400_000)
  })

  it('caps how many run at once', async () => {
    expect((await status(store)).slotsLeft).toBe(0)
    const e = await expectFail(start(products[1]), 'invalid_input')
    expect(e.detail).toContain('slots are taken')
  })

  it('keeps boosts private to the shop and admins, and pretend payments to test mode', async () => {
    expect(await asUser(buyer, `select * from public.boosts`)).toEqual([])
    expect((await asUser(staff, `select id from public.boosts`)).length).toBeGreaterThanOrEqual(3)
    await asUser(staff, `select public.set_boost_settings(1000, true, 12)`)
    const c = await start(products[1])
    await admin(`update public.app_settings set test_mode = false`)
    try {
      await expectFail(asUser(store, `select public.test_pay_boost($1)`, [c.txRef]), 'forbidden')
    } finally {
      await admin(`update public.app_settings set test_mode = true`)
      await asUser(staff, `select public.set_boost_settings(1000, false, 12)`)
    }
  })
})

describe('boost results', () => {
  it('compares the boost days with the same number of days before, for the shop only', async () => {
    const seller = await newUser('boostresults@example.com')
    const staff = await newUser('staff8@example.com', { role: 'admin' })
    const [{ id: shop }] = await admin<{ id: string }>(`insert into public.merchants (kind, name, area, cac_number, verified) values ('individual', 'Result Shop', 'Ikeja', '', true) returning id`)
    await admin(`update public.profiles set seller_id = $2 where id = $1`, [seller, shop])
    const [{ id }] = await asUser<{ id: string }>(seller, `select public.create_product($1) id`, [{ title: 'Rug', category: 'Home', priceKobo: 3_000_000 }])
    await asUser(staff, `select public.approve_listing($1)`, [id])
    // Two visitors yesterday, three today.
    await admin(`insert into public.listing_views (listing_id, visitor, day) select $1, 'v:old-' || n, (now() at time zone 'Africa/Lagos')::date - 1 from generate_series(1, 2) n`, [id])
    for (const v of ['visitor-aa01', 'visitor-aa02', 'visitor-aa03']) await asUser(null, `select public.record_listing_view($1, $2)`, [id, v])

    await asUser(staff, `select public.set_boost_settings(1000, true, 12)`)
    try {
      const [{ c }] = await asUser<{ c: { txRef: string } }>(seller, `select public.start_boost($1, '3d') c`, [id])
      const [{ boost }] = await admin<{ boost: string }>(`select id boost from public.boosts where tx_ref = $1`, [c.txRef])
      await expectFail(asUser(seller, `select public.boost_insights($1)`, [boost]), 'invalid_input') // not paid yet
      await asUser(seller, `select public.test_pay_boost($1)`, [c.txRef])

      type R = { window: { days: number }; during: { views: number }; before: { views: number }; daily: { views: number }[] }
      const [{ r }] = await asUser<{ r: R }>(seller, `select public.boost_insights($1) r`, [boost])
      expect(r.window.days).toBe(1)
      expect(r.during.views).toBe(3)
      expect(r.before.views).toBe(2)
      expect(r.daily.map((d) => d.views)).toEqual([2, 3])

      const other = await newUser('otherseller@example.com', { merchantId: IKEJA })
      await expectFail(asUser(other, `select public.boost_insights($1)`, [boost]), 'not_found')
      expect((await asUser(staff, `select public.boost_insights($1) r`, [boost])).length).toBe(1)
    } finally {
      await asUser(staff, `select public.set_boost_settings(1000, false, 12)`)
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
