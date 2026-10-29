/**
 * DrawMartApi backed by Supabase.
 *
 * Reads go straight to tables (row-level security decides what each user
 * sees). Every write is an RPC to a database function in
 * supabase/migrations, which enforces the same rules as src/domain.
 */
import type { PostgrestError, Session, SupabaseClient } from '@supabase/supabase-js'
import { PURCHASE_ERROR_TEXT, type PurchaseError } from '@/domain/rules'
import { openFlutterwaveCheckout } from '@/lib/flutterwave'
import type { Category, FeeMode, Handover, LedgerEntry, LedgerKind, ListingStatus, Merchant, UnsoldPolicy, User } from '@/domain/types'
import { DEMO_ACCOUNTS } from './demoAccounts'
import {
  type AccountRole,
  ApiError,
  type ApiErrorCode,
  type AuthAdapter,
  type AuthSession,
  type DepositStatus,
  type DrawMartApi,
  type DrawResultView,
  type ListingFilter,
  type ListingView,
  type NewListingInput,
  type PaymentsAdapter,
  type PurchaseReceipt,
  type WalletView,
} from './types'

// ------------------------------------------------------------------ rows

interface MerchantRow {
  id: string
  name: string
  area: string
  cac_number: string
  verified: boolean
}

interface HandoverRow {
  method: Handover['method']
  address: string
  contact_phone: string
  date: string
  slot: Handover['slot']
}

interface DrawResultRow {
  listing_id: string
  commitment: string
  seed: string
  closing_ref: string
  winning_number: number
  drawn_at: string
}

interface ListingRow {
  id: string
  merchant_id: string
  title: string
  description: string
  category: Category
  images: string[]
  price_kobo: number
  ticket_price_kobo: number
  buyer_ticket_price_kobo: number
  ticket_count: number
  tickets_sold: number
  fee_mode: FeeMode
  fee_bps: number
  unsold_policy: UnsoldPolicy
  fallback_price_kobo: number | null
  duration_days: number
  extended: boolean
  status: ListingStatus
  caution_fee_kobo: number
  caution_fee_status: 'held' | 'refunded' | 'kept'
  commitment: string
  created_at: string
  closes_at: string
  merchant: MerchantRow
  result: DrawResultRow | null
  handover: HandoverRow | null
}

interface ProfileRow {
  id: string
  display_name: string
  state: string | null
  weekly_limit_kobo: number
  age_verified: boolean
  role: AccountRole
  merchant_id: string | null
}

interface LedgerRow {
  id: string
  user_id: string
  kind: LedgerKind
  cash_kobo: number
  credit_kobo: number
  memo: string
  listing_id: string | null
  created_at: string
}

// draw_results.winner_user_id isn't readable by clients, so name the columns.
const RESULT_COLUMNS = 'listing_id, commitment, seed, closing_ref, winning_number, drawn_at'
const LISTING_SELECT = `*, merchant:merchants(*), result:draw_results(${RESULT_COLUMNS}), handover:listing_handovers(*)`
const PHOTO_BUCKET = 'listing-photos'

// ---------------------------------------------------------------- errors

const PURCHASE_CODES = Object.keys(PURCHASE_ERROR_TEXT) as PurchaseError[]
const OTHER_TEXT: Record<'not_found' | 'invalid_input' | 'forbidden', string> = {
  not_found: 'That doesn’t exist.',
  invalid_input: 'Check the details and try again.',
  forbidden: 'You can’t do that.',
}

/** Database functions raise `message = code`, `detail = text for the user`. */
export function toApiError(e: Pick<PostgrestError, 'message' | 'details' | 'code'>): ApiError {
  const code = e.message as ApiErrorCode
  if ((PURCHASE_CODES as string[]).includes(code)) return new ApiError(code, e.details || PURCHASE_ERROR_TEXT[code as PurchaseError])
  if (code in OTHER_TEXT) return new ApiError(code, e.details || OTHER_TEXT[code as keyof typeof OTHER_TEXT])
  if (e.code === '42501') return new ApiError('forbidden', OTHER_TEXT.forbidden) // permission denied
  return new ApiError('invalid_input', e.message)
}

function unwrap<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw toApiError(res.error)
  return res.data as T
}

// --------------------------------------------------------------- mappers

const num = (v: number | string | null | undefined) => Number(v ?? 0)

function toMerchant(m: MerchantRow): Merchant {
  return { id: m.id, name: m.name, area: m.area, cacNumber: m.cac_number, verified: m.verified }
}

function toUser(p: ProfileRow): User {
  return { id: p.id, displayName: p.display_name, state: p.state ?? '', weeklyLimitKobo: num(p.weekly_limit_kobo), ageVerified: p.age_verified }
}

function toLedgerEntry(e: LedgerRow): LedgerEntry {
  return {
    id: e.id,
    userId: e.user_id,
    kind: e.kind,
    cashKobo: num(e.cash_kobo),
    creditKobo: num(e.credit_kobo),
    memo: e.memo,
    listingId: e.listing_id ?? undefined,
    createdAt: e.created_at,
  }
}

export interface Mine {
  numbers: Map<string, number[]>
  credits: Map<string, number>
}

/** "You won" comes from your own tickets; who else won is never sent to the browser. */
export function toResultView(
  r: DrawResultRow,
  listing: { title: string; images: string[]; ticket_count: number },
  me: string | null,
  mine: Mine,
): DrawResultView {
  const myNumbers = mine.numbers.get(r.listing_id) ?? []
  const iWon = !!me && myNumbers.includes(r.winning_number)
  return {
    listingId: r.listing_id,
    commitment: r.commitment,
    seed: r.seed,
    closingRef: r.closing_ref,
    winningNumber: r.winning_number,
    winnerUserId: iWon ? me! : '',
    drawnAt: r.drawn_at,
    listingTitle: listing.title,
    listingImage: listing.images[0] ?? null,
    ticketCount: listing.ticket_count,
    iWon,
    myNumbers,
    myCreditKobo: mine.credits.get(r.listing_id) ?? 0,
  }
}

function toListingView(l: ListingRow, me: string | null, mine: Mine): ListingView {
  return {
    id: l.id,
    merchantId: l.merchant_id,
    title: l.title,
    description: l.description,
    category: l.category,
    images: l.images ?? [],
    priceKobo: num(l.price_kobo),
    ticketPriceKobo: num(l.ticket_price_kobo),
    buyerTicketPriceKobo: num(l.buyer_ticket_price_kobo),
    ticketCount: l.ticket_count,
    ticketsSold: l.tickets_sold,
    feeMode: l.fee_mode,
    feeBps: l.fee_bps,
    unsoldPolicy: l.unsold_policy,
    fallbackPriceKobo: l.fallback_price_kobo === null ? null : num(l.fallback_price_kobo),
    durationDays: l.duration_days,
    extended: l.extended,
    status: l.status,
    cautionFee: { amountKobo: num(l.caution_fee_kobo), status: l.caution_fee_status },
    commitment: l.commitment,
    createdAt: l.created_at,
    closesAt: l.closes_at,
    handover: l.handover
      ? { method: l.handover.method, address: l.handover.address, contactPhone: l.handover.contact_phone, date: l.handover.date, slot: l.handover.slot }
      : null,
    merchant: toMerchant(l.merchant),
    myNumbers: mine.numbers.get(l.id) ?? [],
    result: l.result ? toResultView(l.result, l, me, mine) : null,
  }
}

function sortForBrowsing(a: ListingView, b: ListingView) {
  if (a.status !== b.status) return a.status === 'live' ? -1 : 1
  return b.ticketsSold / b.ticketCount - a.ticketsSold / a.ticketCount
}


// ------------------------------------------------------------------- API

export interface SupabaseApiOptions {
  /** Must match app_settings.test_mode in the database (it decides what's allowed). */
  testMode: boolean
  /** Flutterwave public key. Without it, top-ups are instant test money. */
  flutterwavePublicKey?: string
}

export function createSupabaseApi(client: SupabaseClient, opts: SupabaseApiOptions): DrawMartApi {
  async function myId(): Promise<string | null> {
    const { data } = await client.auth.getSession()
    return data.session?.user.id ?? null
  }

  async function requireId(): Promise<string> {
    const id = await myId()
    if (!id) throw new ApiError('forbidden', 'Sign in first.')
    return id
  }

  async function myProfile(): Promise<ProfileRow> {
    const id = await requireId()
    const p = unwrap(await client.from('profiles').select('*').eq('id', id).maybeSingle<ProfileRow>())
    if (!p) throw new ApiError('not_found', 'Your profile is missing. Try signing out and in again.')
    return p
  }

  async function myMerchantId(): Promise<string> {
    const p = await myProfile()
    if (!p.merchant_id) throw new ApiError('forbidden', 'This account isn’t linked to a store yet.')
    return p.merchant_id
  }

  /** The signed-in user's ticket numbers and consolation credit for some listings. */
  async function mineFor(listingIds: string[]): Promise<Mine> {
    const mine: Mine = { numbers: new Map(), credits: new Map() }
    const me = await myId()
    if (!me || listingIds.length === 0) return mine
    const [tickets, credits] = await Promise.all([
      client.from('tickets').select('listing_id, number').eq('user_id', me).in('listing_id', listingIds).order('number'),
      client.from('ledger_entries').select('listing_id, credit_kobo').eq('user_id', me).eq('kind', 'store_credit').in('listing_id', listingIds),
    ])
    for (const t of unwrap(tickets) as { listing_id: string; number: number }[]) {
      mine.numbers.set(t.listing_id, [...(mine.numbers.get(t.listing_id) ?? []), t.number])
    }
    for (const c of unwrap(credits) as { listing_id: string; credit_kobo: number }[]) {
      mine.credits.set(c.listing_id, (mine.credits.get(c.listing_id) ?? 0) + num(c.credit_kobo))
    }
    return mine
  }

  async function views(rows: ListingRow[]): Promise<ListingView[]> {
    const [me, mine] = await Promise.all([myId(), mineFor(rows.map((r) => r.id))])
    return rows.map((r) => toListingView(r, me, mine))
  }

  async function getListing(id: string): Promise<ListingView> {
    const row = unwrap(await client.from('listings').select(LISTING_SELECT).eq('id', id).maybeSingle<ListingRow>())
    if (!row) throw new ApiError('not_found', 'That listing doesn’t exist.')
    return (await views([row]))[0]
  }

  async function rpc<T = void>(fn: string, args?: Record<string, unknown>): Promise<T> {
    return unwrap(await client.rpc(fn, args)) as T
  }

  /** Photos picked in the browser arrive as data: URLs; store them in Supabase Storage. */
  async function uploadPhotos(merchantId: string, images: string[]): Promise<string[]> {
    return Promise.all(
      images.map(async (src) => {
        if (!src.startsWith('data:')) return src
        const blob = await (await fetch(src)).blob()
        const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
        const path = `${merchantId}/${crypto.randomUUID()}.${ext}`
        const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false })
        if (error) throw new ApiError('invalid_input', `Couldn’t upload a photo: ${error.message}`)
        return client.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
      }),
    )
  }

  /** Adds which app the account belongs to (profiles.role) to the auth session. */
  async function toSession(s: Session | null): Promise<AuthSession | null> {
    if (!s) return null
    const { data } = await client.from('profiles').select('role').eq('id', s.user.id).maybeSingle<Pick<ProfileRow, 'role'>>()
    return { userId: s.user.id, email: s.user.email ?? null, role: data?.role ?? 'buyer' }
  }

  const auth: AuthAdapter = {
    emailLinks: true,
    // The demo accounts only exist on a local database (supabase/seed-local-accounts.sql).
    demoAccounts: import.meta.env.DEV && opts.testMode ? DEMO_ACCOUNTS : [],
    async getSession() {
      const { data } = await client.auth.getSession()
      return toSession(data.session)
    },
    onChange(callback) {
      // Supabase warns against awaiting other Supabase calls inside this callback, so defer.
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION') return
        setTimeout(() => void toSession(session).then(callback, () => callback(null)), 0)
      })
      return () => data.subscription.unsubscribe()
    },
    async signInWithPassword(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password })
      if (error) throw new ApiError('invalid_input', error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message)
    },
    async sendSignInLink(email, redirectTo) {
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
      if (error) throw new ApiError('invalid_input', error.message)
    },
    async signOut() {
      await client.auth.signOut()
    },
  }

  async function checkDeposit(txRef: string): Promise<DepositStatus> {
    const { data, error } = await client.functions.invoke<{ status: DepositStatus }>('confirm-deposit', { body: { txRef } })
    if (error) {
      // FunctionsHttpError carries the function's JSON reply in `context`.
      const reply = await (error as { context?: Response }).context?.json?.().catch(() => null)
      throw new ApiError('invalid_input', reply?.error ?? 'Couldn’t check the payment. Try again in a moment.')
    }
    return data!.status
  }

  const publicKey = opts.flutterwavePublicKey
  const payments: PaymentsAdapter | undefined = publicKey
    ? {
        provider: 'Flutterwave',
        async deposit(amountKobo) {
          const c = await rpc<{ txRef: string; amountKobo: number; email: string; name: string }>('start_deposit', { p_amount_kobo: amountKobo })
          const result = await openFlutterwaveCheckout({ publicKey, ...c })
          // If the check fails, the webhook still credits it; show it as pending meanwhile.
          const status = await checkDeposit(c.txRef).catch((): DepositStatus => 'pending')
          if (result === 'closed' && status === 'pending') {
            // Left without paying. A bank transfer that still lands is credited by the webhook.
            await rpc('cancel_deposit', { p_tx_ref: c.txRef })
            return 'cancelled'
          }
          return status
        },
        checkDeposit,
      }
    : undefined

  return {
    testMode: opts.testMode,
    auth,
    payments,

    // Session
    getCurrentUser: async () => toUser(await myProfile()),

    updateProfile: async (patch) => {
      await rpc('update_profile', { p_display_name: patch.displayName ?? null, p_state: patch.state ?? null })
      return toUser(await myProfile())
    },

    // Buyer
    listListings: async (filter: ListingFilter = {}) => {
      let q = client.from('listings').select(LISTING_SELECT).in('status', filter.status ?? ['live'])
      if (filter.category) q = q.eq('category', filter.category)
      const rows = unwrap(await q.returns<ListingRow[]>())
      return (await views(rows)).sort(sortForBrowsing)
    },

    getListing,

    buyTickets: (listingId, quantity) => rpc<PurchaseReceipt>('buy_tickets', { p_listing_id: listingId, p_quantity: quantity }),

    listMyListings: async () => {
      const me = await requireId()
      const tickets = unwrap(await client.from('tickets').select('listing_id').eq('user_id', me)) as { listing_id: string }[]
      const ids = [...new Set(tickets.map((t) => t.listing_id))]
      if (!ids.length) return []
      const rows = unwrap(await client.from('listings').select(LISTING_SELECT).in('id', ids).returns<ListingRow[]>())
      return views(rows)
    },

    listResults: async () => {
      type Row = DrawResultRow & { listing: { title: string; images: string[]; ticket_count: number } }
      const rows = unwrap(
        await client.from('draw_results').select(`${RESULT_COLUMNS}, listing:listings(title, images, ticket_count)`).order('drawn_at', { ascending: false }).limit(100).returns<Row[]>(),
      ).filter((r) => r.listing)
      const [me, mine] = await Promise.all([myId(), mineFor(rows.map((r) => r.listing_id))])
      return rows.map((r) => toResultView(r, r.listing, me, mine))
    },

    // Wallet
    getWallet: async (): Promise<WalletView> => {
      const me = await requireId()
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [summary, entries, pending, deposits] = await Promise.all([
        rpc<{ cashKobo: number; creditKobo: number; spentThisWeekKobo: number; weeklyLimitKobo: number }>('wallet_summary'),
        client.from('ledger_entries').select('*').eq('user_id', me).order('created_at', { ascending: false }).limit(200).returns<LedgerRow[]>(),
        client.from('pending_limits').select('*').eq('user_id', me).maybeSingle<{ amount_kobo: number; effective_at: string }>(),
        client
          .from('deposits')
          .select('tx_ref, amount_kobo, created_at')
          .eq('user_id', me)
          .eq('status', 'pending')
          .gte('created_at', dayAgo)
          .order('created_at', { ascending: false })
          .returns<{ tx_ref: string; amount_kobo: number; created_at: string }[]>(),
      ])
      const p = unwrap(pending)
      return {
        balance: { cashKobo: num(summary.cashKobo), creditKobo: num(summary.creditKobo) },
        entries: unwrap(entries).map(toLedgerEntry),
        spentThisWeekKobo: num(summary.spentThisWeekKobo),
        weeklyLimitKobo: num(summary.weeklyLimitKobo),
        pendingLimit: p ? { amountKobo: num(p.amount_kobo), effectiveAt: p.effective_at } : null,
        pendingDeposits: unwrap(deposits).map((d) => ({ txRef: d.tx_ref, amountKobo: num(d.amount_kobo), createdAt: d.created_at })),
      }
    },

    topUp: (amountKobo) => rpc('top_up', { p_amount_kobo: amountKobo }),

    setWeeklyLimit: (amountKobo) => rpc('set_weekly_limit', { p_amount_kobo: amountKobo }),

    // Merchant
    getMyMerchant: async () => {
      const id = await myMerchantId()
      return toMerchant(unwrap(await client.from('merchants').select('*').eq('id', id).single<MerchantRow>()))
    },

    listMerchantListings: async () => {
      const id = await myMerchantId()
      const rows = unwrap(await client.from('listings').select(LISTING_SELECT).eq('merchant_id', id).order('created_at', { ascending: false }).returns<ListingRow[]>())
      return views(rows)
    },

    createListing: async (input: NewListingInput) => {
      const merchantId = await myMerchantId()
      const images = await uploadPhotos(merchantId, input.images ?? [])
      const id = await rpc<string>('create_listing', { p: { ...input, images } })
      return getListing(id)
    },

    // Admin
    listPendingListings: async () => {
      if ((await myProfile()).role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
      const rows = unwrap(await client.from('listings').select(LISTING_SELECT).eq('status', 'pending_review').order('created_at').returns<ListingRow[]>())
      return views(rows)
    },

    approveListing: (id) => rpc('approve_listing', { p_listing_id: id }),
    rejectListing: (id) => rpc('reject_listing', { p_listing_id: id }),

    // Demo (admins only, test mode only; enforced in the database)
    demoSellOut: (id) => rpc('demo_sell_out', { p_listing_id: id }),
    demoExpire: (id) => rpc('demo_expire', { p_listing_id: id }),
  }
}
