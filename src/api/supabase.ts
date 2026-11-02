/**
 * DrawMartApi backed by Supabase.
 *
 * Reads go straight to tables (row-level security decides what each user
 * sees). Every write is an RPC to a database function in
 * supabase/migrations, which enforces the same rules as src/domain.
 */
import type { StoreRole } from '@/domain/team'
import type { Discount } from '@/domain/discounts'
import type { PricingStats } from '@/domain/drawPricing'
import { STORE_APPLICATION_ERROR_TEXT, validateStoreApplication } from '@/domain/storeApplications'
import type { PayoutAccount, PayoutKind, PayoutStatus } from '@/domain/payouts'
import type { ListingCheckPlan, BankOption, CancelRateView, ClaimReview, PayoutLineView, ReturnJob, AdminReviewView, ShopReviews, StoreApplicationView, SupportMessage, SupportThreadSummary, QuickReply, BulkUploadResult, IncomingStoreInvite, StoreActivityEntry, StoreTeam } from './types'
import type { PostgrestError, Session, SupabaseClient } from '@supabase/supabase-js'
import { PURCHASE_ERROR_TEXT, type PurchaseError } from '@/domain/rules'
import { openFlutterwaveCheckout } from '@/lib/flutterwave'
import { fillDays, lagosDay, type DayMetrics } from '@/domain/metrics'
import { sortAddresses, type SavedAddress } from '@/domain/addresses'
import type { PinResult } from '@/domain/delivery'
import { lineAmountKobo } from '@/domain/cart'
import { WINNER_CONSENT_VERSION } from '@/domain/winnerStories'
import { DEFAULT_PUSH_PREFERENCES } from '@/domain/push'
import { ORDER_ERROR_TEXT, clampQuantity } from '@/domain/orders'
import { SELLER_APPLICATION_ERROR_TEXT, validateSellerApplication } from '@/domain/sellers'
import type { DeliveryArea } from '@/domain/deliveryFees'
import type { ClaimKind, ClaimStatus, CollectionProblem, CancelReason, Category, Kobo, PackageSize, Fulfilment, PickupPoint, FeeMode, Handover, LedgerEntry, LedgerKind, ListingKind, ListingStatus, Merchant, OrderStatus, RejectionReason, UnsoldPolicy, User } from '@/domain/types'
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
  type DeliveryJob,
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
  type MyWinnerStory,
  type PendingWinnerStory,
  type WinnerWallEntry,
} from './types'

// ------------------------------------------------------------------ rows

interface MerchantRow {
  id: string
  kind: Merchant['kind']
  name: string
  area: string
  public_cac: string
  show_cac: boolean
  verified: boolean
  verified_at: string | null
  about: string | null
  logo_url: string | null
  cover_url: string | null
  opening_hours: string | null
  shop_note: string | null
  public_phone: string | null
  delivery_area: string | null
  suspended_at: string | null
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
  sale?: { priceKobo: number | string; percentOff: number | null; amountOffKobo: number | string | null; endsAt: string } | null
  product_code: string
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
  stock: number
  package_size: PackageSize | null
  reviewed_price_kobo: number | null
  rejection_reason: RejectionReason | null
  rejection_note: string | null
  revision: number
  was_rejected: boolean
  boosted_until: string | null
  sold_out_at: string | null
  draw_at: string | null
  merchant: MerchantRow
  result: DrawResultRow | null
  handover: HandoverRow | null
}

interface PayoutAccountRow {
  bank_code: string
  bank_name: string
  account_number: string
  account_name: string
  confirmed_at: string
  payable_from: string
}

interface PayoutRow {
  id: string
  listing_id: string
  order_id: string | null
  kind: PayoutKind
  amount_kobo: number | string
  status: PayoutStatus
  created_at: string
  due_at: string | null
  paid_at: string | null
  reference: string | null
  paid_to: string | null
  listing: { title: string; product_code: string }
}

const PAYOUT_SELECT = 'id, listing_id, order_id, kind, amount_kobo, status, created_at, due_at, paid_at, reference, paid_to, listing:listings(title, product_code)'
const PAYOUT_ACCOUNT_SELECT = 'bank_code, bank_name, account_number, account_name, confirmed_at, payable_from'

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

interface DiscountRow {
  id: string
  kind: Discount['kind']
  percent_off: number | null
  amount_off_kobo: number | string | null
  code: string | null
  max_uses: number | null
  uses: number
  starts_at: string
  ends_at: string
  ended_at: string | null
  created_at: string
  discount_listings: { listing_id: string }[]
}

interface SupportMessageRow {
  id: string
  sender: SupportMessage['sender']
  body: string
  created_at: string
}
const toSupportMessage = (m: SupportMessageRow): SupportMessage => ({ id: m.id, sender: m.sender, body: m.body, createdAt: m.created_at })

interface StoreApplicationRow {
  id: string
  status: StoreApplicationView['status']
  business_name: string
  cac_number: string
  director_name: string
  phone: string
  address: string
  area: string
  certificate_path: string
  director_id_path: string
  review_note: string | null
  created_at: string
  updated_at: string
  reviewed_at: string | null
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
  quantity: number
  confirm_by: string | null
  confirmed_at: string | null
  confirm_photo: string | null
  refunded_at: string | null
  claim: { id: string; kind: ClaimKind; status: ClaimStatus; description: string; photos: string[] | null; return_fee_kobo: number; review_note: string | null } | null
  review: { id: string; rating: number; seller_comment: string; product_comment: string; reply: string | null; replied_at: string | null; hidden_at: string | null; created_at: string } | null
  ready_by: string | null
  collected_at: string | null
  collection_photos: string[] | null
  collection_problems: CollectionProblem[] | null
  refusal_photo: string | null
  return_state: 'returning' | 'returned' | null
  returned_at: string | null
  delivery_fee_kobo: number
  discount_kobo?: number
  cancelled_at: string | null
  cancel_reason: CancelReason | null
  cancel_note: string | null
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
  listing: { product_code: string; title: string; images: string[]; category: Category }
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
// Named, because the CAC number column isn't readable: `*` would fail.
const MERCHANT_COLUMNS = 'id, kind, name, area, public_cac, show_cac, verified, verified_at, delivery_area, suspended_at, about, logo_url, cover_url, opening_hours, shop_note, public_phone'
// sale:listing_sale is a computed field: the running sale, if any (discounts.ts).
const LISTING_SELECT = `*, sale:listing_sale, merchant:merchants(${MERCHANT_COLUMNS}), result:draw_results(${RESULT_COLUMNS}), handover:listing_handovers(*)`
const ORDER_SELECT = '*, claim:order_claims(id, kind, status, description, photos, return_fee_kobo, review_note), review:reviews(id, rating, seller_comment, product_comment, reply, replied_at, hidden_at, created_at), listing:listings(product_code, title, images, category), merchant:merchants(name), pickup_point:pickup_points(*)'
const PHOTO_BUCKET = 'listing-photos'
const CHECK_BUCKET = 'listing-checks'
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
  return { id: m.id, kind: m.kind, name: m.name, area: m.area, deliveryArea: m.delivery_area, suspendedAt: m.suspended_at, cacNumber: m.public_cac ?? '', showCac: m.show_cac, verifiedAt: m.verified_at, about: m.about, logoUrl: m.logo_url, coverUrl: m.cover_url, openingHours: m.opening_hours, shopNote: m.shop_note, publicPhone: m.public_phone, verified: m.verified }
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
  listing: { product_code: string; title: string; images: string[]; ticket_count: number },
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
    productCode: listing.product_code,
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
    sale: l.sale ? { priceKobo: num(l.sale.priceKobo), percentOff: l.sale.percentOff, amountOffKobo: l.sale.amountOffKobo === null ? null : num(l.sale.amountOffKobo), endsAt: l.sale.endsAt } : null,
    productCode: l.product_code,
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
    stock: l.stock,
    packageSize: l.package_size,
    reviewedPriceKobo: l.reviewed_price_kobo === null ? null : num(l.reviewed_price_kobo),
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
    revision: l.revision,
    wasRejected: l.was_rejected,
    rejection: l.rejection_reason ? { reason: l.rejection_reason, note: l.rejection_note } : null,
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
    quantity: o.quantity,
    refundedAt: o.refunded_at,
    claim: o.claim ? { id: o.claim.id, kind: o.claim.kind, status: o.claim.status, description: o.claim.description, photos: o.claim.photos ?? [], returnFeeKobo: num(o.claim.return_fee_kobo), reviewNote: o.claim.review_note } : null,
    confirmBy: o.confirm_by,
    confirmedAt: o.confirmed_at,
    confirmPhoto: o.confirm_photo,
    readyBy: o.ready_by,
    collectedAt: o.collected_at,
    collectionPhotos: o.collection_photos,
    collectionProblems: o.collection_problems,
    refusalPhoto: o.refusal_photo,
    returnState: o.return_state,
    returnedAt: o.returned_at,
    deliveryFeeKobo: num(o.delivery_fee_kobo),
    discountKobo: num(o.discount_kobo ?? 0),
    cancelledAt: o.cancelled_at,
    cancelReason: o.cancel_reason,
    cancelNote: o.cancel_note,
    delivery: { address: o.delivery_address ?? '', location: toPoint(o.delivery_lat, o.delivery_lng), contactPhone: o.delivery_phone },
    fulfilment: o.fulfilment,
    pickupPoint: o.pickup_point ? toPickupPoint(o.pickup_point) : null,
    isPrize: o.is_prize,
    handledBy: o.handled_by,
    status: o.status,
    createdAt: o.created_at,
    dispatchedAt: o.dispatched_at,
    deliveredAt: o.delivered_at,
    productCode: o.listing.product_code,
    listingTitle: o.listing.title,
    listingImage: o.listing.images?.[0] ?? null,
    category: o.listing.category,
    merchantName: o.merchant.name,
    review: o.review ? { id: o.review.id, rating: o.review.rating, sellerComment: o.review.seller_comment, productComment: o.review.product_comment, reply: o.review.reply, repliedAt: o.review.replied_at, hidden: !!o.review.hidden_at, createdAt: o.review.created_at } : null,
    deliveryPin: null,
  }
}


// ------------------------------------------------------------------- API

export interface SupabaseApiOptions {
  /** Must match app_settings.test_mode in the database (it decides what's allowed). */
  testMode: boolean
  pushPublicKey: string | null
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
  /** Into the private bucket: only the seller and admins can open these. */
  async function uploadCheckFile(merchantId: string, blob: Blob): Promise<string> {
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('webm') ? 'webm' : blob.type === 'image/png' ? 'png' : 'jpg'
    const path = `${merchantId}/${crypto.randomUUID()}.${ext}`
    const { error } = await client.storage.from(CHECK_BUCKET).upload(path, blob, { contentType: blob.type || undefined, upsert: false })
    if (error) throw new ApiError('invalid_input', `Couldn’t upload that: ${error.message}`)
    return path
  }

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

  /** The buyer's own PINs, which the orders table doesn't hold. */
  async function withPins(orders: OrderView[]): Promise<OrderView[]> {
    const pins = await rpc<Record<string, string>>('my_delivery_pins')
    return orders.map((o) => ({ ...o, deliveryPin: pins[o.id] ?? null }))
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

  async function toStoreApplicationView(a: StoreApplicationRow): Promise<StoreApplicationView> {
    const { data } = await client.storage.from(ID_BUCKET).createSignedUrls([a.certificate_path, a.director_id_path], 60 * 60)
    return {
      id: a.id,
      status: a.status,
      businessName: a.business_name,
      cacNumber: a.cac_number,
      directorName: a.director_name,
      phone: a.phone,
      address: a.address,
      area: a.area,
      certificateUrl: data?.[0]?.signedUrl ?? null,
      directorIdUrl: data?.[1]?.signedUrl ?? null,
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

  async function bankAccount<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.functions.invoke<T>('bank-account', { body })
    if (error) {
      const reply = await (error as { context?: Response }).context?.json?.().catch(() => null)
      throw new ApiError('invalid_input', reply?.error ?? 'Couldn’t reach the bank check. Try again in a moment.')
    }
    return data!
  }

  const toPayoutAccount = (a: PayoutAccountRow): PayoutAccount => ({
    bankCode: a.bank_code, bankName: a.bank_name, accountNumber: a.account_number, accountName: a.account_name, confirmedAt: a.confirmed_at, payableFrom: a.payable_from,
  })

  const toPayoutLine = (p: PayoutRow): PayoutLineView => ({
    id: p.id, listingId: p.listing_id, orderId: p.order_id, kind: p.kind, amountKobo: num(p.amount_kobo), status: p.status, createdAt: p.created_at, dueAt: p.due_at, paidAt: p.paid_at,
    reference: p.reference, paidTo: p.paid_to, listingTitle: p.listing.title, productCode: p.listing.product_code,
  })

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
    pushPublicKey: opts.pushPublicKey,
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
      if (filter.merchantId) q = q.eq('merchant_id', filter.merchantId)
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
      type Row = DrawResultRow & { listing: { product_code: string; title: string; images: string[]; ticket_count: number } }
      const rows = unwrap(
        await client.from('draw_results').select(`${RESULT_COLUMNS}, listing:listings(product_code, title, images, ticket_count)`).order('drawn_at', { ascending: false }).limit(100).returns<Row[]>(),
      ).filter((r) => r.listing)
      const [me, mine] = await Promise.all([myId(), mineFor(rows.map((r) => r.listing_id))])
      return rows.map((r) => toResultView(r, r.listing, me, mine))
    },

    listCart: async () => {
      const me = await requireId()
      const rows = unwrap(await client.from('cart_items').select('listing_id, quantity').eq('user_id', me).order('added_at').returns<{ listing_id: string; quantity: number }[]>())
      const ids = rows.map((r) => r.listing_id)
      if (!ids.length) return []
      const wanted = new Map(rows.map((r) => [r.listing_id, r.quantity]))
      const listings = await views(unwrap(await client.from('listings').select(LISTING_SELECT).in('id', ids).returns<ListingRow[]>()))
      return ids.flatMap((id) => {
        const listing = listings.find((l) => l.id === id)
        if (!listing) return []
        const quantity = clampQuantity(listing, wanted.get(id) ?? 1)
        return [{ listing, quantity, wanted: wanted.get(id) ?? 1, amountKobo: lineAmountKobo(listing, quantity) }]
      })
    },

    addToCart: (listingId, quantity = 1) => rpc('add_to_cart', { p_listing_id: listingId, p_quantity: quantity }),
    removeFromCart: (listingId) => rpc('remove_from_cart', { p_listing_id: listingId }),

    getPushPreferences: async () => {
      const row = unwrap(await client.from('push_preferences').select('wins, draw_results, orders, messages, saved_items, draw_reveal, store_orders, store_listings, store_draws, store_pickups, store_payouts').maybeSingle<{ wins: boolean; draw_results: boolean; orders: boolean; messages: boolean; saved_items: boolean; draw_reveal: boolean; store_orders: boolean; store_listings: boolean; store_draws: boolean; store_pickups: boolean; store_payouts: boolean }>())
      return row ? { wins: row.wins, drawResults: row.draw_results, orders: row.orders, messages: row.messages, savedItems: row.saved_items, drawReveal: row.draw_reveal, storeOrders: row.store_orders, storeListings: row.store_listings, storeDraws: row.store_draws, storePickups: row.store_pickups, storePayouts: row.store_payouts } : DEFAULT_PUSH_PREFERENCES
    },
    setPushPreference: (category, enabled) => rpc('set_push_preference', { p_category: category, p_enabled: enabled }),
    savePushSubscription: ({ endpoint, p256dh, auth }) => rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth }),
    deletePushSubscription: (endpoint) => rpc('delete_push_subscription', { p_endpoint: endpoint }),

    listWinnersWall: () => rpc<WinnerWallEntry[]>('winners_wall'),
    listMyWinnerStories: () => rpc<MyWinnerStory[]>('my_winner_stories'),
    shareWinnerStory: ({ listingId, firstName, consent }) =>
      rpc('share_winner_story', { p_listing_id: listingId, p_first_name: firstName, p_consent: consent, p_consent_version: WINNER_CONSENT_VERSION }),
    withdrawWinnerStory: (listingId) => rpc('withdraw_winner_story', { p_listing_id: listingId }),
    listPendingWinnerStories: () => rpc<PendingWinnerStory[]>('pending_winner_stories'),
    reviewWinnerStory: (id, approve) => rpc('review_winner_story', { p_id: id, p_approve: approve }),

    listSavedIds: async () => {
      const me = await requireId()
      return unwrap(await client.from('saved_listings').select('listing_id').eq('user_id', me).order('saved_at', { ascending: false }).returns<{ listing_id: string }[]>()).map((r) => r.listing_id)
    },

    listSavedListings: async () => {
      const me = await requireId()
      const ids = unwrap(await client.from('saved_listings').select('listing_id').eq('user_id', me).order('saved_at', { ascending: false }).returns<{ listing_id: string }[]>()).map((r) => r.listing_id)
      if (!ids.length) return []
      // A saved item that's since been taken down isn't readable, so it drops out here.
      const listings = await views(unwrap(await client.from('listings').select(LISTING_SELECT).in('id', ids).returns<ListingRow[]>()))
      return ids.flatMap((id) => listings.find((l) => l.id === id) ?? [])
    },

    saveListing: (listingId) => rpc('save_listing', { p_listing_id: listingId }),
    unsaveListing: (listingId) => rpc('unsave_listing', { p_listing_id: listingId }),

    listPickupPoints: async () => unwrap(await client.from('pickup_points').select('*').order('name').returns<PickupPointRow[]>()).map(toPickupPoint),

    checkout: async (input) => {
      const pickup = input.fulfilment === 'pickup'
      const ids = await rpc<string[]>('checkout', {
        p: {
          listingIds: input.listingIds,
          quantities: input.quantities ?? {},
          expectedTotalKobo: input.expectedTotalKobo ?? null,
          code: input.code ?? null,
          fulfilment: input.fulfilment,
          address: pickup ? null : input.delivery.address,
          phone: input.delivery.contactPhone,
          lat: pickup ? null : input.delivery.location?.lat,
          lng: pickup ? null : input.delivery.location?.lng,
          pickupPointId: input.pickupPointId,
        },
      })
      return withPins(unwrap(await client.from('orders').select(ORDER_SELECT).in('id', ids).returns<OrderRow[]>()).map(toOrderView))
    },

    listMyOrders: async () => {
      const me = await requireId()
      return withPins(unwrap(await client.from('orders').select(ORDER_SELECT).eq('user_id', me).order('created_at', { ascending: false }).returns<OrderRow[]>()).map(toOrderView))
    },

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
          .select('id, tx_ref, listing_id, days, price_kobo, status, starts_at, ends_at, created_at, listing:listings(product_code, title), merchant:merchants(name)')
          .order('created_at', { ascending: false })
          .limit(200)
          .returns<{ id: string; tx_ref: string; listing_id: string; days: number; price_kobo: number; status: BoostView['status']; starts_at: string | null; ends_at: string | null; created_at: string; listing: { product_code: string; title: string }; merchant: { name: string } }[]>(),
      )
      return rows.map((b) => ({
        id: b.id, txRef: b.tx_ref, listingId: b.listing_id, productCode: b.listing.product_code, listingTitle: b.listing.title, merchantName: b.merchant.name, days: b.days, priceKobo: num(b.price_kobo),
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

    getMyStoreApplication: async () => {
      const me = await requireId()
      const row = unwrap(await client.from('store_applications').select('*').eq('user_id', me).maybeSingle<StoreApplicationRow>())
      return row ? toStoreApplicationView(row) : null
    },

    submitStoreApplication: async (input) => {
      const me = await requireId()
      const problems = validateStoreApplication(input).map((e) => STORE_APPLICATION_ERROR_TEXT[e])
      if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
      const [certificatePhoto, directorIdPhoto] = await Promise.all([uploadIdPhoto(me, input.certificatePhoto, 'cac'), uploadIdPhoto(me, input.directorIdPhoto, 'director')])
      await rpc('submit_store_application', { p: { ...input, certificatePhoto, directorIdPhoto } })
      const row = unwrap(await client.from('store_applications').select('*').eq('user_id', me).single<StoreApplicationRow>())
      return toStoreApplicationView(row)
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
        id: n.id, kind: n.kind, listingId: n.listing_id ?? '', listingTitle: n.listing?.title ?? '', listingImage: n.listing?.images?.[0] ?? null, listingCategory: n.listing?.category, drawAt: n.listing?.draw_at,
        winningNumber: n.listing?.result?.winning_number ?? null, createdAt: n.created_at, read: n.read_at !== null, celebrated: n.celebrated_at !== null,
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
      const [row, cac] = await Promise.all([client.from('merchants').select(MERCHANT_COLUMNS).eq('id', id).single<MerchantRow>(), rpc<string>('merchant_cac_number', { p_merchant: id })])
      return { ...toMerchant(unwrap(row)), cacNumber: cac }
    },

    listMerchantListings: async () => {
      const id = await myMerchantId()
      const rows = unwrap(await client.from('listings').select(LISTING_SELECT).eq('merchant_id', id).order('created_at', { ascending: false }).returns<ListingRow[]>())
      // Row security only returns this seller's.
      const reviews = unwrap(await client.from('price_reviews').select('listing_id, new_price_kobo').returns<{ listing_id: string; new_price_kobo: number }[]>())
      const pending = new Map(reviews.map((r) => [r.listing_id, num(r.new_price_kobo)]))
      return (await views(rows)).map((l) => ({ ...l, pendingPriceKobo: pending.get(l.id) ?? null }))
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

    updateListing: async (id, input) => {
      const merchantId = await myMerchantId()
      const images = await uploadPhotos(merchantId, input.images ?? [])
      await rpc('update_listing', { p_listing_id: id, p: { ...input, images } })
      return getListing(id)
    },

    withdrawListing: (id) => rpc('withdraw_listing', { p_listing_id: id }),
    pauseListing: (id) => rpc('pause_listing', { p_listing_id: id }),
    resumeListing: (id) => rpc('resume_listing', { p_listing_id: id }),
    changeStock: (id, change) => rpc('change_stock', { p_listing_id: id, p_change: change }),
    changePrice: (id, priceKobo) => rpc<boolean>('change_price', { p_listing_id: id, p_price_kobo: priceKobo }),
    listPriceReviews: async () => {
      const rows = unwrap(await client.from('price_reviews').select('listing_id, new_price_kobo, requested_at').order('requested_at').returns<{ listing_id: string; new_price_kobo: number; requested_at: string }[]>())
      if (!rows.length) return []
      const listings = await views(unwrap(await client.from('listings').select(LISTING_SELECT).in('id', rows.map((r) => r.listing_id)).returns<ListingRow[]>()))
      return rows.flatMap((r) => {
        const listing = listings.find((l) => l.id === r.listing_id)
        return listing ? [{ listing, newPriceKobo: num(r.new_price_kobo), requestedAt: r.requested_at }] : []
      })
    },
    reviewPriceChange: (id, newPriceKobo, approve) => rpc('review_price_change', { p_listing_id: id, p_new_price: newPriceKobo, p_approve: approve }),

    listPayouts: async () => {
      const id = await myMerchantId()
      return unwrap(await client.from('payouts').select(PAYOUT_SELECT).eq('merchant_id', id).order('created_at', { ascending: false }).returns<PayoutRow[]>()).map(toPayoutLine)
    },

    getPayoutAccount: async () => {
      const id = await myMerchantId()
      const row = unwrap(await client.from('payout_accounts').select(PAYOUT_ACCOUNT_SELECT).eq('merchant_id', id).maybeSingle<PayoutAccountRow>())
      return row ? toPayoutAccount(row) : null
    },

    listBanks: async () => (await bankAccount<{ banks: BankOption[] }>({ action: 'banks' })).banks,
    lookupBankAccount: (bankCode, accountNumber) => bankAccount<{ accountName: string }>({ action: 'lookup', bankCode, accountNumber }),
    savePayoutAccount: async (bankCode, accountNumber) => {
      await bankAccount({ action: 'save', bankCode, accountNumber })
    },

    listDuePayouts: async () => {
      const rows = unwrap(await client.from('payouts').select(`merchant_id, merchant:merchants(name), ${PAYOUT_SELECT}`).eq('status', 'due').order('due_at').returns<(PayoutRow & { merchant_id: string; merchant: { name: string } })[]>())
      const ids = [...new Set(rows.map((r) => r.merchant_id))]
      const accounts = ids.length ? unwrap(await client.from('payout_accounts').select(`merchant_id, ${PAYOUT_ACCOUNT_SELECT}`).in('merchant_id', ids).returns<(PayoutAccountRow & { merchant_id: string })[]>()) : []
      return ids.map((merchantId) => {
        const mine = rows.filter((r) => r.merchant_id === merchantId)
        const account = accounts.find((a) => a.merchant_id === merchantId)
        return { merchantId, merchantName: mine[0].merchant.name, account: account ? toPayoutAccount(account) : null, lines: mine.map(toPayoutLine) }
      })
    },

    markPayoutsPaid: (ids, reference) => rpc('mark_payouts_paid', { p_ids: ids, p_reference: reference }),

    resubmitListing: async (id, input) => {
      const merchantId = await myMerchantId()
      const images = await uploadPhotos(merchantId, input.images ?? [])
      await rpc('resubmit_listing', { p_listing_id: id, p: { ...input, images } })
      return getListing(id)
    },

    createProduct: async ({ check, ...input }: NewProductInput) => {
      const merchantId = await myMerchantId()
      const images = await uploadPhotos(merchantId, input.images ?? [])
      const videoPath = check?.video ? await uploadCheckFile(merchantId, check.video) : null
      const proofPath = check?.proof ? await uploadCheckFile(merchantId, await (await fetch(check.proof)).blob()) : null
      const p = { ...input, images, check: check ? { code: check.code, serial: check.serial ?? '', videoPath, proofPath } : undefined }
      const id = await rpc<string>('create_product', { p })
      return getListing(id)
    },

    getListingCheckPlan: () => rpc<ListingCheckPlan>('listing_check_plan'),
    getListingCheck: async (listingId) => {
      const row = unwrap(await client.from('listing_checks').select('code, video_path, serial, proof_path').eq('listing_id', listingId).maybeSingle<{ code: string | null; video_path: string | null; serial: string | null; proof_path: string | null }>())
      if (!row) return null
      // Private bucket: links that run out after an hour.
      const signed = async (path: string | null) => (path ? (await client.storage.from(CHECK_BUCKET).createSignedUrl(path, 3600)).data?.signedUrl ?? null : null)
      return { code: row.code, hasVideo: !!row.video_path, serial: row.serial, videoUrl: await signed(row.video_path), proofUrl: await signed(row.proof_path) }
    },

    listMerchantOrders: async () => {
      const id = await myMerchantId()
      return unwrap(await client.from('orders').select(ORDER_SELECT).eq('merchant_id', id).order('created_at', { ascending: false }).returns<OrderRow[]>()).map(toOrderView)
    },

    getDeliveryPricing: async () => {
      const [areas, prices, extras] = await Promise.all([
        client.from('delivery_areas').select('id, name, lat, lng').order('sort').returns<DeliveryArea[]>(),
        client.from('delivery_prices').select('area_a, area_b, price_kobo').returns<{ area_a: string; area_b: string; price_kobo: number }[]>(),
        client.from('delivery_size_extras').select('size, extra_kobo').returns<{ size: PackageSize; extra_kobo: number }[]>(),
      ])
      const sizeExtras: Record<PackageSize, Kobo> = { small: 0, medium: 0, large: 0 }
      for (const e of unwrap(extras)) sizeExtras[e.size] = num(e.extra_kobo)
      return { areas: unwrap(areas), prices: unwrap(prices).map((p) => ({ areaA: p.area_a, areaB: p.area_b, priceKobo: num(p.price_kobo) })), sizeExtras }
    },
    setDeliveryPrice: (areaA, areaB, priceKobo) => rpc('set_delivery_price', { p_area_a: areaA, p_area_b: areaB, p_price_kobo: priceKobo }),
    setDeliverySizeExtra: (size, extraKobo) => rpc('set_delivery_size_extra', { p_size: size, p_extra_kobo: extraKobo }),
    openClaim: async (orderId, input) => {
      const photos = await uploadPhotos(`claims/${await requireId()}`, input.photos)
      await rpc('open_claim', { p_order_id: orderId, p_kind: input.kind, p_description: input.description, p_photos: photos, p_address: input.address ?? null, p_lat: input.location?.lat ?? null, p_lng: input.location?.lng ?? null, p_phone: input.phone ?? null })
    },
    contestFailure: (orderId, note) => rpc('contest_failure', { p_order_id: orderId, p_note: note }),
    listOpenClaims: () => rpc<ClaimReview[]>('open_claims'),
    reviewClaim: (claimId, approve, note) => rpc('review_claim', { p_claim_id: claimId, p_approve: approve, p_note: note }),
    listReturnJobs: () => rpc<ReturnJob[]>('return_jobs'),
    takeReturn: (claimId) => rpc('take_return', { p_claim_id: claimId }),
    releaseReturn: (claimId) => rpc('release_return', { p_claim_id: claimId }),
    passReturnPickup: async (claimId, photos) => {
      await rpc('pass_return_pickup', { p_claim_id: claimId, p_photos: await uploadPhotos(`riders/${await requireId()}`, photos) })
    },
    failReturnPickup: async (claimId, note, photos) => {
      await rpc('fail_return_pickup', { p_claim_id: claimId, p_note: note, p_photos: await uploadPhotos(`riders/${await requireId()}`, photos) })
    },
    finishReturn: async (claimId, photo) => {
      const [url] = await uploadPhotos(`riders/${await requireId()}`, [photo])
      await rpc('finish_return', { p_claim_id: claimId, p_photo: url })
    },
    getMyStoreRole: () => rpc<StoreRole | null>('my_store_role'),
    getStoreTeam: () => rpc<StoreTeam>('store_team'),
    inviteStoreMember: async (email, role) => {
      await rpc('invite_store_member', { p_email: email, p_role: role })
    },
    revokeStoreInvite: async (id) => {
      await rpc('revoke_store_invite', { p_id: id })
    },
    setStoreMemberRole: async (userId, role) => {
      await rpc('set_store_member_role', { p_user: userId, p_role: role })
    },
    removeStoreMember: async (userId) => {
      await rpc('remove_store_member', { p_user: userId })
    },
    listStoreActivity: () => rpc<StoreActivityEntry[]>('store_activity_log'),
    listMyStoreInvites: () => rpc<IncomingStoreInvite[]>('my_store_invites'),
    acceptStoreInvite: async (id) => {
      await rpc('accept_store_invite', { p_id: id })
    },
    createProductsBulk: async (items, onProgress) => {
      const merchantId = await myMerchantId()
      const total = items.reduce((n, i) => n + (i.images?.length ?? 0), 0)
      let done = 0
      const uploaded: NewProductInput[] = []
      // One product's photos at a time, so a slow connection still shows progress.
      for (const item of items) {
        const images = await uploadPhotos(merchantId, item.images ?? [])
        done += images.length
        onProgress?.(done, total)
        uploaded.push({ ...item, images })
      }
      return rpc<BulkUploadResult>('create_products_bulk', { p: { items: uploaded } })
    },
    listDiscounts: async () => {
      const rows = unwrap(
        await client
          .from('discounts')
          .select('id, kind, percent_off, amount_off_kobo, code, max_uses, uses, starts_at, ends_at, ended_at, created_at, discount_listings(listing_id)')
          .order('created_at', { ascending: false })
          .returns<DiscountRow[]>(),
      )
      return rows.map((d) => ({
        id: d.id, kind: d.kind, percentOff: d.percent_off, amountOffKobo: d.amount_off_kobo === null ? null : num(d.amount_off_kobo), code: d.code, maxUses: d.max_uses, uses: d.uses,
        startsAt: d.starts_at, endsAt: d.ends_at, endedAt: d.ended_at, createdAt: d.created_at, listingIds: d.discount_listings.map((x) => x.listing_id),
      }))
    },
    createDiscount: async (input) => {
      await rpc('create_discount', { p: input })
    },
    endDiscount: async (id) => {
      await rpc('end_discount', { p_id: id })
    },
    checkDiscountCode: async (code, listingIds) => {
      const r = await rpc<{ code: string; prices: Record<string, number | string> }>('check_discount_code', { p_code: code, p_listing_ids: listingIds })
      return { code: r.code, prices: Object.fromEntries(Object.entries(r.prices).map(([id, k]) => [id, num(k)])) }
    },
    getDrawPriceStats: (category, band) => rpc<PricingStats>('draw_price_stats', { p_category: category, p_band: band }),
    listQuickReplies: async () =>
      // Only the shop's own come back (RLS). Don't filter by merchant_id: clients can't read that column.
      unwrap(await client.from('quick_replies').select('id, body').order('created_at').returns<QuickReply[]>()),
    saveQuickReply: async ({ id, body }) => {
      await rpc('save_quick_reply', { p_id: id ?? null, p_body: body })
    },
    deleteQuickReply: async (id) => {
      await rpc('delete_quick_reply', { p_id: id })
    },
    getSupportThread: async () => {
      const shop = await myMerchantId()
      const [thread, rows] = await Promise.all([
        client.from('support_threads').select('shop_read_at').eq('merchant_id', shop).maybeSingle<{ shop_read_at: string }>(),
        client.from('support_messages').select('id, sender, body, created_at').eq('merchant_id', shop).order('created_at').returns<SupportMessageRow[]>(),
      ])
      const readAt = Date.parse(unwrap(thread)?.shop_read_at ?? '1970-01-01T00:00:00Z')
      const messages = unwrap(rows).map(toSupportMessage)
      return { messages, unread: messages.filter((m) => m.sender === 'drawmart' && Date.parse(m.createdAt) > readAt).length }
    },
    sendSupportMessage: async (body) => {
      await rpc('send_support_message', { p_body: body })
    },
    markSupportRead: async (merchantId) => {
      await rpc('mark_support_read', { p_merchant: merchantId ?? null })
    },
    listSupportThreads: () => rpc<SupportThreadSummary[]>('support_inbox'),
    getSupportMessages: async (merchantId) =>
      unwrap(await client.from('support_messages').select('id, sender, body, created_at').eq('merchant_id', merchantId).order('created_at').returns<SupportMessageRow[]>()).map(toSupportMessage),
    replySupport: async (merchantId, body) => {
      await rpc('reply_support', { p_merchant: merchantId, p_body: body })
    },
    setSupportResolved: async (merchantId, resolved) => {
      await rpc('set_support_resolved', { p_merchant: merchantId, p_resolved: resolved })
    },
    submitReview: async (orderId, input) => {
      await rpc('submit_review', { p_order_id: orderId, p_rating: input.rating, p_seller_comment: input.sellerComment, p_product_comment: input.productComment })
    },
    replyToReview: async (reviewId, reply) => {
      await rpc('reply_to_review', { p_review_id: reviewId, p_reply: reply })
    },
    getShopReviews: (merchantId, listingId) => rpc<ShopReviews>('shop_reviews', { p_merchant: merchantId, p_listing: listingId ?? null }),
    listAdminReviews: () => rpc<AdminReviewView[]>('admin_reviews'),
    setReviewHidden: async (reviewId, hidden, reason) => {
      await rpc('set_review_hidden', { p_review_id: reviewId, p_hidden: hidden, p_reason: reason })
    },
    getShop: async (merchantId) => {
      const row = unwrap(await client.from('merchants').select(MERCHANT_COLUMNS).eq('id', merchantId).maybeSingle<MerchantRow>())
      if (!row) throw new ApiError('not_found', 'That shop doesn’t exist.')
      return toMerchant(row)
    },
    updateShopProfile: async (input) => {
      const merchantId = await myMerchantId()
      const [logoUrl, coverUrl] = await uploadPhotos(merchantId, [input.logoUrl ?? '', input.coverUrl ?? ''])
      await rpc('update_shop_profile', { p: { ...input, logoUrl: logoUrl || null, coverUrl: coverUrl || null } })
    },
    getMerchantCacNumber: (merchantId) => rpc<string>('merchant_cac_number', { p_merchant: merchantId }),
    getShopPickup: async () => {
      const row = unwrap(await client.from('shop_pickups').select('address, lat, lng, contact_phone').eq('merchant_id', await myMerchantId()).maybeSingle<{ address: string; lat: number; lng: number; contact_phone: string }>())
      return row ? { address: row.address, location: { lat: row.lat, lng: row.lng }, contactPhone: row.contact_phone } : null
    },
    saveShopPickup: ({ address, location, contactPhone }) => rpc('save_shop_pickup', { p_address: address, p_lat: location.lat, p_lng: location.lng, p_phone: contactPhone }),
    setShopDeliveryArea: (area) => rpc('set_shop_delivery_area', { p_area: area }),
    passCollection: async (orderId, photos) => {
      await rpc('pass_collection', { p_order_id: orderId, p_photos: await uploadPhotos(`riders/${await requireId()}`, photos) })
    },
    failCollection: async (orderId, problems, note, photos) => {
      await rpc('fail_collection', { p_order_id: orderId, p_problems: problems, p_note: note, p_photos: await uploadPhotos(`riders/${await requireId()}`, photos) })
    },
    refuseDelivery: async (orderId, pin, reason, note, photo) => {
      const [url] = await uploadPhotos(`riders/${await requireId()}`, [photo])
      return rpc<PinResult>('refuse_delivery', { p_order_id: orderId, p_pin: pin, p_reason: reason, p_note: note, p_photo: url })
    },
    completeReturn: async (orderId, photo) => {
      const [url] = await uploadPhotos(`riders/${await requireId()}`, [photo])
      await rpc('complete_return', { p_order_id: orderId, p_photo: url })
    },
    liftSuspension: (merchantId) => rpc('lift_suspension', { p_merchant_id: merchantId }),
    sellerConfirmOrder: async (orderId, photo) => {
      const [url] = await uploadPhotos(await myMerchantId(), [photo])
      await rpc('seller_confirm_order', { p_order_id: orderId, p_photo: url })
    },
    cancelOrder: (orderId, reason, note) => rpc('cancel_order', { p_order_id: orderId, p_reason: reason, p_note: note }),
    listCancelRates: () => rpc<CancelRateView[]>('merchant_cancel_rates'),
    dispatchOrder: (orderId) => rpc('dispatch_order', { p_order_id: orderId }),

    // Admin
    listPendingListings: async () => {
      if ((await myProfile()).role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
      const rows = unwrap(await client.from('listings').select(LISTING_SELECT).eq('status', 'pending_review').order('created_at').returns<ListingRow[]>())
      return views(rows)
    },

    approveListing: (id, revision) => rpc('approve_listing', { p_listing_id: id, p_revision: revision ?? null }),

    listPrizeOrders: async () =>
      unwrap(await client.from('orders').select(ORDER_SELECT).eq('handled_by', 'drawmart').order('created_at', { ascending: false }).returns<OrderRow[]>()).map(toOrderView),

    // Delivery accounts
    listDeliveryJobs: () => rpc<DeliveryJob[]>('delivery_jobs'),
    takeDelivery: (orderId) => rpc('take_delivery', { p_order_id: orderId }),
    releaseDelivery: (orderId) => rpc('release_delivery', { p_order_id: orderId }),
    confirmDelivery: (orderId, pin) => rpc<PinResult>('confirm_delivery', { p_order_id: orderId, p_pin: pin }),

    listSellerApplications: async () => {
      const rows = unwrap(await client.from('seller_applications').select('*').eq('status', 'pending').order('updated_at').returns<SellerApplicationRow[]>())
      return Promise.all(rows.map(toApplicationView))
    },

    approveSeller: (id) => rpc('approve_seller', { p_application_id: id }),
    listStoreApplications: async () => {
      const rows = unwrap(await client.from('store_applications').select('*').eq('status', 'pending').order('updated_at').returns<StoreApplicationRow[]>())
      return Promise.all(rows.map(toStoreApplicationView))
    },
    approveStoreApplication: (id) => rpc('approve_store_application', { p_application_id: id }),
    rejectStoreApplication: (id, note) => rpc('reject_store_application', { p_application_id: id, p_note: note }),
    rejectSeller: (id, note) => rpc('reject_seller', { p_application_id: id, p_note: note }),
    rejectListing: (id, reason, note) => rpc('reject_listing', { p_listing_id: id, p_reason: reason, p_note: note }),

    // Demo (admins only, test mode only; enforced in the database)
    demoSellOut: (id) => rpc('demo_sell_out', { p_listing_id: id }),
    demoRunDraw: (id) => rpc('demo_run_draw', { p_listing_id: id }),
    resetTestData: () => rpc('reset_test_data'),
    demoExpire: (id) => rpc('demo_expire', { p_listing_id: id }),
  }
}
