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
import { fillDays, lagosDay, type DayMetrics } from '@/domain/metrics'
import { sortAddresses, type SavedAddress } from '@/domain/addresses'
import { lineAmountKobo } from '@/domain/cart'
import { ORDER_ERROR_TEXT } from '@/domain/orders'
import { SELLER_APPLICATION_ERROR_TEXT, validateSellerApplication } from '@/domain/sellers'
import type { Category, Fulfilment, PickupPoint, FeeMode, Handover, LedgerEntry, LedgerKind, ListingKind, ListingStatus, Merchant, OrderStatus, UnsoldPolicy, User } from '@/domain/types'
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
  type NewPickupInput,
  type NotificationView,
  type PickupItemInput,
  type SavedPickupView,
  type NewProductInput,
  type OrderView,
  type PaymentsAdapter,
  type SellerApplicationView,
  type ChatMessage,
  type ConversationView,
  type ListingMetrics,
  type BoostStatus,
  type BoostView,
  type BoostInsightsView,
  type MerchantMetricsView,
  type PurchaseReceipt,
  type WalletView,
} from './types'

// ------------------------------------------------------------------ rows

interface MerchantRow {
  id: string
  kind: Merchant['kind']
  name: string
  area: string
  cac_number: string
  verified: boolean
}

interface HandoverRow {
  method: Handover['method']
  address: string
  contact_phone: string
  lat: number | null
  lng: number | null
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
  kind: ListingKind
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
  caution_fee_status: 'held' | 'refunded' | 'kept' | 'none'
  commitment: string
  created_at: string
  closes_at: string
  pickup_batch_id: string | null
  boosted_until: string | null
  sold_out_at: string | null
  draw_at: string | null
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
  phone: string | null
  /** An individual seller's own shop (buyer accounts only). */
  seller_id: string | null
}

interface SellerApplicationRow {
  id: string
  status: SellerApplicationView['status']
  shop_name: string
  legal_name: string
  nin: string
  phone: string
  address: string
  area: string
  id_photo_path: string
  selfie_path: string
  review_note: string | null
  created_at: string
  updated_at: string
  reviewed_at: string | null
}

interface PickupPointRow {
  id: string
  name: string
  area: string
  address: string
  hours: string
  lat: number
  lng: number
}

interface OrderRow {
  id: string
  listing_id: string
  user_id: string
  merchant_id: string
  price_kobo: number
  fee_kobo: number
  delivery_address: string | null
  delivery_phone: string
  delivery_lat: number | null
  delivery_lng: number | null
  status: OrderStatus
  created_at: string
  dispatched_at: string | null
  delivered_at: string | null
  fulfilment: Fulfilment
  is_prize: boolean
  handled_by: 'store' | 'drawmart'
  pickup_point: PickupPointRow | null
  listing: { title: string; images: string[]; category: Category }
  merchant: { name: string }
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
const ORDER_SELECT = '*, listing:listings(title, images, category), merchant:merchants(name), pickup_point:pickup_points(*)'
const PHOTO_BUCKET = 'listing-photos'
/** Private: ID photos for seller checks. */
const ID_BUCKET = 'seller-ids'

// ---------------------------------------------------------------- errors

const PURCHASE_CODES = Object.keys(PURCHASE_ERROR_TEXT) as PurchaseError[]
const OTHER_TEXT: Record<'not_found' | 'invalid_input' | 'forbidden' | 'not_for_sale', string> = {
  not_for_sale: ORDER_ERROR_TEXT.not_for_sale,
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

const toPoint = (lat: number | null, lng: number | null) => (lat === null || lng === null ? null : { lat, lng })

function toMerchant(m: MerchantRow): Merchant {
  return { id: m.id, kind: m.kind, name: m.name, area: m.area, cacNumber: m.cac_number, verified: m.verified }
}

function toUser(p: ProfileRow): User {
  return { id: p.id, displayName: p.display_name, state: p.state ?? '', weeklyLimitKobo: num(p.weekly_limit_kobo), ageVerified: p.age_verified, phone: p.phone }
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
    kind: l.kind,
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
    boostedUntil: l.boosted_until,
    soldOutAt: l.sold_out_at,
    drawAt: l.draw_at,
    pickupBatchId: l.pickup_batch_id,
    handover: l.handover
      ? { method: l.handover.method, address: l.handover.address, location: toPoint(l.handover.lat, l.handover.lng), contactPhone: l.handover.contact_phone, date: l.handover.date, slot: l.handover.slot }
      : null,
    merchant: toMerchant(l.merchant),
    myNumbers: mine.numbers.get(l.id) ?? [],
    result: l.result ? toResultView(l.result, l, me, mine) : null,
  }
}

const soldShare = (l: ListingView) => (l.ticketCount ? l.ticketsSold / l.ticketCount : 0)

function sortForBrowsing(a: ListingView, b: ListingView) {
  if (a.status !== b.status) return a.status === 'live' ? -1 : 1
  return soldShare(b) - soldShare(a)
}

const toPickupPoint = (p: PickupPointRow): PickupPoint => ({ id: p.id, name: p.name, area: p.area, address: p.address, hours: p.hours, location: { lat: p.lat, lng: p.lng } })

function toOrderView(o: OrderRow): OrderView {
  return {
    id: o.id,
    listingId: o.listing_id,
    buyerId: o.user_id,
    merchantId: o.merchant_id,
    priceKobo: num(o.price_kobo),
    feeKobo: num(o.fee_kobo),
    delivery: { address: o.delivery_address ?? '', location: toPoint(o.delivery_lat, o.delivery_lng), contactPhone: o.delivery_phone },
    fulfilment: o.fulfilment,
    pickupPoint: o.pickup_point ? toPickupPoint(o.pickup_point) : null,
    isPrize: o.is_prize,
    handledBy: o.handled_by,
    status: o.status,
    createdAt: o.created_at,
    dispatchedAt: o.dispatched_at,
    deliveredAt: o.delivered_at,
    listingTitle: o.listing.title,
    listingImage: o.listing.images?.[0] ?? null,
    category: o.listing.category,
    merchantName: o.merchant.name,
  }
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
    const shop = p.merchant_id ?? p.seller_id
    if (!shop) throw new ApiError('forbidden', 'This account isn’t linked to a store or a verified seller shop yet.')
    return shop
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

  /** Row security hides other stores' saved items and expired ones. */
  async function readSavedPickup(): Promise<SavedPickupView | null> {
    const row = unwrap(await client.from('saved_pickups').select('items, saved_at, expires_at').maybeSingle<{ items: PickupItemInput[]; saved_at: string; expires_at: string }>())
    return row ? { items: row.items, savedAt: row.saved_at, expiresAt: row.expires_at } : null
  }

  /** Row security limits these to the signed-in buyer's own. */
  async function readAddresses(): Promise<SavedAddress[]> {
    const rows = unwrap(
      await client
        .from('saved_addresses')
        .select('id, label, address, lat, lng, phone, is_default')
        .order('created_at')
        .returns<{ id: string; label: string; address: string; lat: number; lng: number; phone: string; is_default: boolean }[]>(),
    )
    return sortAddresses(rows.map((a) => ({ id: a.id, label: a.label, address: a.address, location: { lat: a.lat, lng: a.lng }, contactPhone: a.phone, isDefault: a.is_default })))
  }

  /** ID photos are private: hand out links that expire after an hour. */
  async function toApplicationView(a: SellerApplicationRow): Promise<SellerApplicationView> {
    const { data } = await client.storage.from(ID_BUCKET).createSignedUrls([a.id_photo_path, a.selfie_path], 60 * 60)
    return {
      id: a.id,
      status: a.status,
      shopName: a.shop_name,
      legalName: a.legal_name,
      nin: a.nin,
      phone: a.phone,
      address: a.address,
      area: a.area,
      idPhotoUrl: data?.[0]?.signedUrl ?? null,
      selfieUrl: data?.[1]?.signedUrl ?? null,
      reviewNote: a.review_note,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      reviewedAt: a.reviewed_at,
    }
  }

  async function uploadIdPhoto(userId: string, dataUrl: string, name: string): Promise<string> {
    const blob = await (await fetch(dataUrl)).blob()
    const path = `${userId}/${name}-${crypto.randomUUID()}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`
    const { error } = await client.storage.from(ID_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false })
    if (error) throw new ApiError('invalid_input', `Couldn’t upload a photo: ${error.message}`)
    return path
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
    // Buyer and store test accounts exist on any test-mode project (seed_test_accounts);
    // the admin only on a local database.
    demoAccounts: opts.testMode ? DEMO_ACCOUNTS.filter((a) => a.role !== 'admin' || import.meta.env.DEV) : [],
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
      if (patch.displayName !== undefined || patch.state !== undefined) await rpc('update_profile', { p_display_name: patch.displayName ?? null, p_state: patch.state ?? null })
      if (patch.phone !== undefined) await rpc('set_contact_phone', { p_phone: patch.phone })
      return toUser(await myProfile())
    },

    // Saved delivery addresses
    listAddresses: () => readAddresses(),

    saveAddress: async (input) => {
      await rpc('save_address', { p: { id: input.id, label: input.label, address: input.address, phone: input.contactPhone, lat: input.location?.lat, lng: input.location?.lng, makeDefault: input.makeDefault } })
      return readAddresses()
    },

    setDefaultAddress: async (id) => {
      await rpc('set_default_address', { p_id: id })
      return readAddresses()
    },

    deleteAddress: async (id) => {
      await rpc('delete_address', { p_id: id })
      return readAddresses()
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

    listCart: async () => {
      const me = await requireId()
      const rows = unwrap(await client.from('cart_items').select('listing_id').eq('user_id', me).order('added_at').returns<{ listing_id: string }[]>())
      const ids = rows.map((r) => r.listing_id)
      if (!ids.length) return []
      const listings = await views(unwrap(await client.from('listings').select(LISTING_SELECT).in('id', ids).returns<ListingRow[]>()))
      return ids.flatMap((id) => {
        const listing = listings.find((l) => l.id === id)
        return listing ? [{ listing, amountKobo: lineAmountKobo(listing) }] : []
      })
    },

    addToCart: (listingId) => rpc('add_to_cart', { p_listing_id: listingId }),
    removeFromCart: (listingId) => rpc('remove_from_cart', { p_listing_id: listingId }),

    listPickupPoints: async () => unwrap(await client.from('pickup_points').select('*').order('name').returns<PickupPointRow[]>()).map(toPickupPoint),

    checkout: async (input) => {
      const pickup = input.fulfilment === 'pickup'
      const ids = await rpc<string[]>('checkout', {
        p: {
          listingIds: input.listingIds,
          fulfilment: input.fulfilment,
          address: pickup ? null : input.delivery.address,
          phone: input.delivery.contactPhone,
          lat: pickup ? null : input.delivery.location?.lat,
          lng: pickup ? null : input.delivery.location?.lng,
          pickupPointId: input.pickupPointId,
        },
      })
      return unwrap(await client.from('orders').select(ORDER_SELECT).in('id', ids).returns<OrderRow[]>()).map(toOrderView)
    },

    listMyOrders: async () => {
      const me = await requireId()
      return unwrap(await client.from('orders').select(ORDER_SELECT).eq('user_id', me).order('created_at', { ascending: false }).returns<OrderRow[]>()).map(toOrderView)
    },

    confirmOrder: (orderId) => rpc('confirm_order', { p_order_id: orderId }),

    // Messages
    sendFirstMessage: async (listingId, body) => {
      const id = await rpc<string>('send_first_message', { p_listing_id: listingId, p_body: body })
      const all = await rpc<ConversationView[]>('list_conversations')
      const c = all.find((x) => x.id === id)
      if (!c) throw new ApiError('not_found', 'That conversation doesn’t exist.')
      return { ...c, priceKobo: num(c.priceKobo) }
    },

    listConversations: async () => (await rpc<ConversationView[]>('list_conversations')).map((c) => ({ ...c, priceKobo: num(c.priceKobo) })),

    listMessages: async (conversationId) => {
      const rows = unwrap(
        await client
          .from('messages')
          .select('id, conversation_id, sender, body, created_at')
          .eq('conversation_id', conversationId)
          .order('created_at')
          .limit(500)
          .returns<{ id: string; conversation_id: string; sender: ChatMessage['sender']; body: string; created_at: string }[]>(),
      )
      return rows.map((m) => ({ id: m.id, conversationId: m.conversation_id, sender: m.sender, body: m.body, createdAt: m.created_at }))
    },

    sendMessage: async (conversationId, body) => {
      const id = await rpc<string>('send_message', { p_conversation_id: conversationId, p_body: body })
      const m = unwrap(await client.from('messages').select('id, sender, body, created_at').eq('id', id).single<{ id: string; sender: ChatMessage['sender']; body: string; created_at: string }>())
      return { id: m.id, conversationId, sender: m.sender, body: m.body, createdAt: m.created_at }
    },

    markConversationRead: (conversationId) => rpc('mark_conversation_read', { p_conversation_id: conversationId }),

    recordListingView: async (listingId, visitorId) => {
      await rpc('record_listing_view', { p_listing_id: listingId, p_visitor: visitorId })
    },

    getMerchantMetrics: async (days) => {
      const m = await rpc<{ listings: ListingMetrics[]; daily: DayMetrics[] }>('merchant_metrics', { p_days: days })
      return {
        days,
        listings: m.listings.map((l) => ({ ...l, salesKobo: num(l.salesKobo) })),
        daily: fillDays(m.daily.map((d) => ({ ...d, salesKobo: num(d.salesKobo) })), days, lagosDay(Date.now())),
      } satisfies MerchantMetricsView
    },

    getBoostStatus: async () => {
      const s = await rpc<BoostStatus>('boost_status')
      return { ...s, packages: s.packages.map((p) => ({ ...p, priceKobo: num(p.priceKobo) })) }
    },

    buyBoost: async (listingId, packageId) => {
      const c = await rpc<{ txRef: string; amountKobo: number; email: string; name: string }>('start_boost', { p_listing_id: listingId, p_package_id: packageId })
      if (!publicKey) {
        // No Flutterwave keys: only possible in test mode, where pretend money pays for it.
        if (!opts.testMode) throw new ApiError('invalid_input', 'Payments aren’t set up yet.')
        await rpc('test_pay_boost', { p_tx_ref: c.txRef })
        return 'successful'
      }
      const result = await openFlutterwaveCheckout({ publicKey, ...c, amountKobo: num(c.amountKobo), description: 'Boost a listing' })
      const status = await checkDeposit(c.txRef).catch((): DepositStatus => 'pending')
      if (result === 'closed' && status === 'pending') {
        await rpc('cancel_boost', { p_tx_ref: c.txRef })
        return 'cancelled'
      }
      return status
    },

    listBoosts: async () => {
      const rows = unwrap(
        await client
          .from('boosts')
          .select('id, tx_ref, listing_id, days, price_kobo, status, starts_at, ends_at, created_at, listing:listings(title), merchant:merchants(name)')
          .order('created_at', { ascending: false })
          .limit(200)
          .returns<{ id: string; tx_ref: string; listing_id: string; days: number; price_kobo: number; status: BoostView['status']; starts_at: string | null; ends_at: string | null; created_at: string; listing: { title: string }; merchant: { name: string } }[]>(),
      )
      return rows.map((b) => ({
        id: b.id, txRef: b.tx_ref, listingId: b.listing_id, listingTitle: b.listing.title, merchantName: b.merchant.name, days: b.days, priceKobo: num(b.price_kobo),
        status: b.status, startsAt: b.starts_at, endsAt: b.ends_at, createdAt: b.created_at,
      }))
    },

    getBoostInsights: async (boostId) => {
      const r = await rpc<BoostInsightsView>('boost_insights', { p_boost_id: boostId })
      const stats = (m: BoostInsightsView['before']) => ({ ...m, salesKobo: num(m.salesKobo) })
      return { ...r, before: stats(r.before), during: stats(r.during), daily: r.daily.map((d) => ({ ...d, salesKobo: num(d.salesKobo) })) }
    },

    setBoostSettings: (s) => rpc('set_boost_settings', { p_min_active_buyers: s.minActiveBuyers, p_forced_on: s.forcedOn, p_max_active: s.maxActive }),

    getCallPhone: async () => {
      const shop = await myMerchantId().catch(() => null)
      if (!shop) return null
      const row = unwrap(await client.from('merchant_contacts').select('call_phone').eq('merchant_id', shop).maybeSingle<{ call_phone: string }>())
      return row?.call_phone ?? null
    },

    setCallPhone: (phone) => rpc('set_call_phone', { p_phone: phone }),

    // Individual sellers
    getMySellerApplication: async () => {
      const me = await requireId()
      const row = unwrap(await client.from('seller_applications').select('*').eq('user_id', me).maybeSingle<SellerApplicationRow>())
      return row ? toApplicationView(row) : null
    },

    submitSellerApplication: async (input) => {
      const me = await requireId()
      // Photos come from the browser as data: URLs. Upload them only once the rest is valid,
      // so a typo doesn't leave stray ID photos behind.
      const problems = validateSellerApplication(input).map((e) => SELLER_APPLICATION_ERROR_TEXT[e])
      if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
      const [idPhoto, selfie] = await Promise.all([uploadIdPhoto(me, input.idPhoto, 'id'), uploadIdPhoto(me, input.selfie, 'selfie')])
      await rpc('submit_seller_application', { p: { ...input, idPhoto, selfie } })
      const row = unwrap(await client.from('seller_applications').select('*').eq('user_id', me).single<SellerApplicationRow>())
      return toApplicationView(row)
    },

    // Notifications
    listNotifications: async () => {
      const me = await requireId()
      const rows = unwrap(
        await client
          .from('notifications')
          .select('id, kind, listing_id, created_at, read_at, celebrated_at, listing:listings(title, images, category, draw_at, result:draw_results(winning_number))')
          .eq('user_id', me)
          .order('created_at', { ascending: false })
          .limit(100)
          .returns<{ id: string; kind: NotificationView['kind']; listing_id: string; created_at: string; read_at: string | null; celebrated_at: string | null; listing: { title: string; images: string[]; category: Category; draw_at: string | null; result: { winning_number: number } | null } }[]>(),
      )
      return rows.map((n) => ({
        id: n.id, kind: n.kind, listingId: n.listing_id, listingTitle: n.listing.title, listingImage: n.listing.images?.[0] ?? null, listingCategory: n.listing.category, drawAt: n.listing.draw_at,
        winningNumber: n.listing.result?.winning_number ?? null, createdAt: n.created_at, read: n.read_at !== null, celebrated: n.celebrated_at !== null,
      }))
    },

    markNotificationsRead: () => rpc('mark_notifications_read'),

    markWinCelebrated: (listingId) => rpc('mark_win_celebrated', { p_listing_id: listingId }),

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

    createListingBatch: async (input: NewPickupInput) => {
      const merchantId = await myMerchantId()
      const items = await Promise.all(input.items.map(async (item) => ({ ...item, images: await uploadPhotos(merchantId, item.images ?? []) })))
      const ids = await rpc<string[]>('create_listing_batch', { p: { items, handover: input.handover } })
      return Promise.all(ids.map((id) => getListing(id)))
    },

    getSavedPickup: () => readSavedPickup(),

    savePickupItems: async (input) => {
      const merchantId = await myMerchantId()
      // Saved items live on the server, so their photos need to as well.
      const items = await Promise.all(input.map(async (item) => ({ ...item, images: await uploadPhotos(merchantId, item.images ?? []) })))
      await rpc('save_pickup_items', { p_items: items })
      return readSavedPickup()
    },

    createProduct: async (input: NewProductInput) => {
      const merchantId = await myMerchantId()
      const images = await uploadPhotos(merchantId, input.images ?? [])
      const id = await rpc<string>('create_product', { p: { ...input, images } })
      return getListing(id)
    },

    listMerchantOrders: async () => {
      const id = await myMerchantId()
      return unwrap(await client.from('orders').select(ORDER_SELECT).eq('merchant_id', id).order('created_at', { ascending: false }).returns<OrderRow[]>()).map(toOrderView)
    },

    dispatchOrder: (orderId) => rpc('dispatch_order', { p_order_id: orderId }),

    // Admin
    listPendingListings: async () => {
      if ((await myProfile()).role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
      const rows = unwrap(await client.from('listings').select(LISTING_SELECT).eq('status', 'pending_review').order('created_at').returns<ListingRow[]>())
      return views(rows)
    },

    approveListing: (id) => rpc('approve_listing', { p_listing_id: id }),

    listPrizeOrders: async () =>
      unwrap(await client.from('orders').select(ORDER_SELECT).eq('handled_by', 'drawmart').order('created_at', { ascending: false }).returns<OrderRow[]>()).map(toOrderView),

    listSellerApplications: async () => {
      const rows = unwrap(await client.from('seller_applications').select('*').eq('status', 'pending').order('updated_at').returns<SellerApplicationRow[]>())
      return Promise.all(rows.map(toApplicationView))
    },

    approveSeller: (id) => rpc('approve_seller', { p_application_id: id }),
    rejectSeller: (id, note) => rpc('reject_seller', { p_application_id: id, p_note: note }),
    rejectListing: (id) => rpc('reject_listing', { p_listing_id: id }),

    // Demo (admins only, test mode only; enforced in the database)
    demoSellOut: (id) => rpc('demo_sell_out', { p_listing_id: id }),
    demoRunDraw: (id) => rpc('demo_run_draw', { p_listing_id: id }),
    resetTestData: () => rpc('reset_test_data'),
    demoExpire: (id) => rpc('demo_expire', { p_listing_id: id }),
  }
}
