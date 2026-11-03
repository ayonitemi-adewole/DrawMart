/**
 * In-browser mock backend. Everything lives in localStorage, money is fake,
 * and a little latency is added so loading states get exercised.
 *
 * It enforces the same rules a real backend must (src/domain/rules.ts), and
 * keeps draw seeds out of every response until a draw has run, so the UI is
 * built against realistic behaviour.
 */
import type { ReturnJob, ReviewView, StoreApplicationView, SupportMessage, QuickReply } from './types'
import { catalogDraws, catalogProducts } from './seedCatalog'
import { canSaveListing } from '@/domain/saved'
import { crossedAlmostSold, isClosingSoon, isRelistOf, relistAlertKind, sameLagosDay, savedAlertAllowed, type SavedAlertKind } from '@/domain/savedAlerts'
import { DEFAULT_PUSH_PREFERENCES, pushSubscriptionValid, type PushPreferences, type PushSubscriptionKeys } from '@/domain/push'
import { WINNER_CONSENT_VERSION, WINNER_STORY_ERROR_TEXT, winnerStoryError } from '@/domain/winnerStories'
import { commitmentFor, createSeed, randomHex, winningTicketNumber, announcementDate } from '@/domain/draw'
import { LISTING_ERROR_TEXT, computeListingEconomics, platformFeeBps, validateListingEconomics } from '@/domain/fees'
import {
  HANDOVER_ERROR_TEXT,
  LISTING_TERMS_ERROR_TEXT,
  addDays,
  PICKUP_ERROR_TEXT,
  cautionFeeFor,
  pickupCautionFee,
  savedPickupExpiry,
  settlePickupFee,
  validatePickup,
  handoverMethodFor,
  isNigerianMobile,
  localDate,
  settleCautionFee,
  validateHandover,
  validateListingTerms,
} from '@/domain/listing'
import { nairaToKobo } from '@/domain/money'
import { canChangeInReview, withdrawalFees } from '@/domain/listingActions'
import { NEW_SELLER, newCheckCode, newSellerLimitError, proofErrors, serialError } from '@/domain/listingChecks'
import { canClaim, canContest, claimError, contestError, returnFeeKobo, returnRefundSplit, sellerShareOfReturnFee } from '@/domain/claims'
import { deliveryFeeKobo, packageSizeOf, sellerAreaOf } from '@/domain/deliveryFees'
import { locationError } from '@/domain/location'
import { shopProfileErrors } from '@/domain/shopProfile'
import { quickReplyError } from '@/domain/quickReplies'
import { pricingStats } from '@/domain/drawPricing'
import { canDo, inviteError, lastOwnerError, type ShopPermission, type StoreRole } from '@/domain/team'
import { MAX_BULK_ROWS } from '@/domain/bulkUpload'
import { MAX_OPEN_DISCOUNTS, bestPrice, discountActive, discountErrors, normalizeCode, type Discount, type ListingSale } from '@/domain/discounts'
import { DUPLICATE_CAC_TEXT, STORE_APPLICATION_ERROR_TEXT, normalizeCac, storeAccountBlocker, validateStoreApplication } from '@/domain/storeApplications'
import { REVIEWS_SHOWN_FROM, averageRating, canReview, hideReasonError, replyError, reviewError, reviewerName } from '@/domain/reviews'
import { shopPickupErrorText, shopPickupErrors, type ShopPickup } from '@/domain/shopPickup'
import { DEFAULT_AREA, DELIVERY_AREAS, areaFromText, nearestArea, checkoutDeliveryFees, deliveryPriceError, placeholderPricing, sizeExtraError, type DeliveryPricing } from '@/domain/deliveryFees'
import { APOLOGY_CREDIT_KOBO, FAILURE_CHARGE_KOBO, REFUSAL_REASONS, SUSPEND_AFTER_FAILURES, collectionFailError, photosError } from '@/domain/deliveryChecks'
import { CONFIRM_HOURS, addConfirmTime, confirmDeadline, confirmOverdue, confirmReminderDue, needsConfirming } from '@/domain/orderConfirm'
import { canCancelOrder, cancelError, stockAfterCancel } from '@/domain/orderCancel'
import { canControlProduct, repriceNeedsReview, statusAfterStock, stockChangeError } from '@/domain/productControls'
import { closingReminderSent, pickupReminderDue } from '@/domain/storeNotifications'
import type { PayoutLineView } from './types'
import { MIN_REFERENCE_LENGTH, PAYOUT_ACCOUNT_HOLD_HOURS, accountNumberError, accountPayable, markPaidError, maskAccountNumber, payoutsFor, type PayoutAccount, type PayoutLine } from '@/domain/payouts'
import { newRejection, REJECTION_ERROR_TEXT, rejectionError, resentCautionFee } from '@/domain/rejection'
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
import { checkPin, isDeliveryPin, newDeliveryPin, type PinState } from '@/domain/delivery'
import { COLLECT_WARNING_MINUTES, MAX_RIDER_JOBS, collectBy, collectionOverdue, takeJobError } from '@/domain/riderLimits'
import { DEFAULT_STUCK_LIMITS, assignJobError, claimStage, dispatchStuck, orderStage } from '@/domain/dispatch'
import { incidentNoteError, resolveIncidentError, sellerStillPaid, type IncidentOutcome, type IncidentType } from '@/domain/incidents'
import { STATS_DAYS, canRateDelivery, ratingError, riderPerformance, riderStats, type DeliveryRating, type TimedJob } from '@/domain/deliveryRatings'
import { canTakeYet, takeTooSoonError, windowError, windowOpens, windowTimes } from '@/domain/deliveryWindows'
import { tripRoomError } from '@/domain/trips'
import { feeGroupOf, largestSize, tripAlreadyPaid } from '@/domain/feeGroups'
import { riderAreasError, riderJobAlertAllowed } from '@/domain/riderAlerts'
import { counterCodeError, counterReminderDue, counterReturnDue } from '@/domain/counter'
import { NEW_RIDER_JOBS, NEW_RIDER_MAX_KOBO, RIDER_APPLICATION_ERROR_TEXT, newRiderLimitError, riderAccountBlocker, validateRiderApplication } from '@/domain/riderApplications'
import { CHOOSE_WITHIN_HOURS, attemptError, redeliveryWindowError } from '@/domain/deliveryAttempts'
import { deliveryMessageError, firstName } from '@/domain/deliveryChat'
import { attemptPayError, pairPayError, payableNow, placeholderRiderPay, riderPayError, tripPay, type EarningKind, type RiderEarning, type RiderPayRates } from '@/domain/riderPay'
import { newProductCode } from '@/domain/productCode'
import { MAX_SAVED_ADDRESSES, SAVED_ADDRESS_ERROR_TEXT, sortAddresses, validateSavedAddress, type SavedAddress, type SavedAddressInput } from '@/domain/addresses'
import { CART_ERROR_TEXT, CHECKOUT_ERROR_TEXT, cartError, checkoutTotalKobo, isCar, isWonPrize, lineAmountKobo, validateCheckout } from '@/domain/cart'
import { ORDER_ERROR_TEXT, PRODUCT_ERROR_TEXT, MIN_PRODUCT_PRICE_KOBO, clampQuantity, quantityError, saleEconomics, takeStock, validateProduct } from '@/domain/orders'
import { MAX_MESSAGES_PER_MINUTE, messageError } from '@/domain/messages'
import { fillDays, lagosDay } from '@/domain/metrics'
import { BOOST_DEFAULTS, BOOST_ERROR_TEXT, DEFAULT_BOOST_PACKAGES, boostEndsAt, boostWindow, boostsUnlocked, canBoost } from '@/domain/boosts'
import { SELLER_APPLICATION_ERROR_TEXT, normalizeNin, validateSellerApplication } from '@/domain/sellers'
import type { CancelReason, Category, DrawResult, GeoPoint, Kobo, NotificationKind, PackageSize, PickupPoint, LedgerEntry, Listing, ListingStatus, Merchant, Order, Ticket, UnsoldPolicy, User } from '@/domain/types'
import {
  ApiError,
  type DrawMartApi,
  type DrawResultView,
  type ListingFilter,
  type ListingView,
  type NewListingInput,
  type WalletView,
  type NewPickupInput,
  type DeliveryJob,
  type CounterItem,
  type AdminRider,
  type DispatchBoard,
  type DispatchJob,
  type RiderPerformanceRow,
  type OpenIncident,
  type RiderApplicationView,
  type RiderFleet,
  type NotificationView,
  type PickupItemInput,
  type SavedPickupView,
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

const STORAGE_KEY = 'drawmart:mock-db:v56' // bump when seed data or the Db shape changes
const SESSION_KEY = 'drawmart:mock-session:v2'
/** buyer@drawmart.test, and whoever uses the API with nobody signed in (the tests). */
const ME = 'u-me'
const MY_MERCHANT = 'm-ikeja'
const CROWD = 'u-crowd'
/** seller@drawmart.test, an ID-verified individual seller, and their shop. */
const TOLU = 'u-tolu'
const TOLU_SHOP = 'm-tolu'
const DAY = 24 * 60 * 60 * 1000

/** The PIN and who's carrying it stay out of the order everyone else sees. */
type MockOrder = Order & { pin: string; riderId: string | null; pinState: PinState; paidCashKobo: Kobo; paidCreditKobo: Kobo; paidFeeCashKobo: Kobo; paidFeeCreditKobo: Kobo; checkoutId: string; confirmRemindedAt: string | null; riderTakenAt?: string | null; counterRemindedAt?: string | null; counterOutAt?: string | null; windowAlertedAt?: string | null }

interface MockIncident {
  id: string
  orderId: string | null
  claimId: string | null
  riderId: string
  type: IncidentType
  note: string | null
  photo: string | null
  location: GeoPoint | null
  createdAt: string
  resolvedAt: string | null
  outcome: IncidentOutcome | null
}

/** A rider's open report pauses the job (incidents.ts). */
const openIncident = (db: Db, job: { orderId?: string; claimId?: string }) =>
  db.incidents.find((i) => !i.resolvedAt && (job.orderId ? i.orderId === job.orderId : i.claimId === job.claimId))

interface Db {
  users: User[]
  merchants: Merchant[]
  listings: Listing[]
  /** Server-side secrets. Never returned before the draw. */
  seeds: Record<string, string>
  /** Reference of the purchase that sold the last ticket, kept for the draw. */
  closingRefs: Record<string, string>
  notifications: { id: string; userId: string; kind: NotificationKind; listingId: string | null; area?: string | null; createdAt: string; read: boolean; celebrated: boolean }[]
  /** riderAlerts.ts: areas each rider wants new jobs from. */
  riderAreas: Record<string, string[]>
  tickets: Ticket[]
  ledger: LedgerEntry[]
  results: DrawResult[]
  pendingLimits: Record<string, { amountKobo: number; effectiveAt: string }>
  orders: MockOrder[]
  /** Each buyer's saved delivery addresses, oldest first. */
  addresses: Record<string, SavedAddress[]>
  /** Listing ids in each buyer's cart, oldest first. */
  carts: Record<string, string[]>
  checkTickets: Record<string, { code: string; videoRequired: boolean; issuedAt: string }>
  listingChecks: Record<string, { code: string | null; videoKey: string | null; serial: string | null; proofKey: string | null }>
  /** The rest of each claim, by claim id: never sent to the buyer or seller. */
  claimDetails: Record<string, { riderId: string | null; takenAt?: string | null; openedAt?: string; pickedUpAt?: string; address: string; location: GeoPoint; phone: string; tripKobo: Kobo; sellerShareKobo: Kobo }>
  shopPickups: Record<string, ShopPickup>
  excusedFailures: string[]
  deliveryPricing: DeliveryPricing
  /** riderPay.ts. */
  riderPayRates: RiderPayRates
  riderEarnings: (RiderEarning & { riderId: string; sourceKey: string; paidBy: string | null })[]
  riderPayoutAccounts: Record<string, PayoutAccount>
  /** deliveryChat.ts: riders' photos, and buyer ↔ rider chats. */
  riderPhotos: Record<string, string>
  deliveryMessages: { id: string; orderId: string; riderId: string; sender: 'buyer' | 'rider'; body: string; createdAt: string }[]
  priceReviews: { listingId: string; newPriceKobo: Kobo; requestedAt: string }[]
  /** By buyer, then listing. Anything not in here is one. */
  cartQuantities: Record<string, Record<string, number>>
  pushPreferences: Record<string, Partial<PushPreferences>>
  savedAlertsSent: { userId: string; savedListingId: string; kind: SavedAlertKind; at: string }[]
  pushSubscriptions: (PushSubscriptionKeys & { userId: string })[]
  payouts: (PayoutLine & { merchantId: string })[]
  payoutAccounts: Record<string, PayoutAccount>
  winnerStories: { id: string; userId: string; listingId: string; firstName: string | null; status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; consentVersion: number; consentAt: string; withdrawnAt: string | null }[]
  winnerConsentLog: { userId: string; listingId: string; event: 'given' | 'withdrawn'; consentVersion: number; at: string }[]
  /** Listing ids each buyer has saved, newest first. */
  saved: Record<string, string[]>
  /** Buyers' applications to sell, by user id. */
  sellerApplications: Record<string, SellerApplicationView>
  /** Individual sellers' own shops: user id → merchant id. */
  sellerShops: Record<string, string>
  /** Businesses' applications for a store, by user id. */
  storeApplications: Record<string, StoreApplicationView>
  /** riderApplications.ts. Approved applicants' accounts become delivery accounts (riderAccounts), like storeAccounts. */
  riderSignupsOpen: boolean
  riderApplications: Record<string, RiderApplicationView>
  riderAccounts: Record<string, true>
  /** deliveryRatings.ts, by order id. Only ever read back as the buyer's own, or as totals. */
  deliveryRatings: Record<string, DeliveryRating & { riderId: string; buyerId: string }>
  /** incidents.ts. */
  incidents: MockIncident[]
  riderFleets: RiderFleet[]
  riderTrust: Record<string, { fleetId: string | null; trusted: boolean }>
  /** Buyer accounts an approved application turned into a store's: user id → store id. */
  storeAccounts: Record<string, string>
  /** Shops' chats with DrawMart, by shop id. */
  supportThreads: Record<string, { lastMessageAt: string; shopReadAt: string; staffReadAt: string; resolvedAt: string | null }>
  supportMessages: (SupportMessage & { merchantId: string })[]
  /** Sellers' saved chat answers, by shop id, oldest first. */
  quickReplies: Record<string, QuickReply[]>
  discounts: (Discount & { merchantId: string })[]
  /** One use of a code per buyer. */
  discountRedemptions: { discountId: string; userId: string }[]
  /** Spot checks a bulk upload picked, by shop id: its next listings need a video. */
  owedChecks: Record<string, number>
  /** Roles of people on a store's team who aren't its demo account, by user id. A store's demo account is its owner unless changed here. */
  storeRoles: Record<string, { merchantId: string; role: StoreRole }>
  storeInvites: { id: string; merchantId: string; email: string; role: StoreRole; createdAt: string; acceptedAt: string | null; revokedAt: string | null }[]
  storeActivity: { id: string; merchantId: string; who: string; action: string; listingId: string | null; at: string }[]
  /** Not stored: the time the current call runs at, set by tx(). */
  clock?: number
  /** Not stored: the buyer the current call acts for, set by tx(). */
  viewer?: string
  conversations: MockConversation[]
  messages: ChatMessage[]
  /** Opt-in call numbers by merchant id. */
  callPhones: Record<string, string>
  /** Items each store has saved to send later, by merchant id. */
  savedPickups: Record<string, SavedPickupView>
  /** One per visitor per listing per Lagos day. */
  views: { listingId: string; visitor: string; day: string }[]
  boosts: (Omit<BoostView, 'productCode' | 'listingTitle' | 'merchantName'> & { merchantId: string })[]
  boostSettings: BoostSettings
  reviews: MockReview[]
}

interface MockReview {
  id: string
  orderId: string
  userId: string
  merchantId: string
  listingId: string
  rating: number
  sellerComment: string
  productComment: string
  reply: string | null
  repliedAt: string | null
  hiddenAt: string | null
  hiddenReason: string | null
  createdAt: string
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
  { id: MY_MERCHANT, kind: 'store', name: 'Ikeja Partner Store', area: 'Ikeja', cacNumber: 'RC [NUMBER]', verified: true, verifiedAt: '2026-03-02T09:00:00.000Z' },
  { id: 'm-lekki', kind: 'store', name: 'Lekki Partner Store', area: 'Lekki', cacNumber: 'RC [NUMBER]', verified: true, verifiedAt: '2026-03-02T09:00:00.000Z' },
  { id: 'm-surulere', kind: 'store', name: 'Surulere Partner Store', area: 'Surulere', cacNumber: 'RC [NUMBER]', verified: true, verifiedAt: '2026-03-02T09:00:00.000Z' },
  { id: 'm-yaba', kind: 'store', name: 'Yaba Partner Store', area: 'Yaba', cacNumber: 'RC [NUMBER]', verified: true, verifiedAt: '2026-03-02T09:00:00.000Z' },
  { id: 'm-vi', kind: 'store', name: 'Victoria Island Partner Dealer', area: 'Victoria Island', cacNumber: 'RC [NUMBER]', verified: true, verifiedAt: '2026-03-02T09:00:00.000Z' },
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

/** Sample locations, the same as public.pickup_points. */
const PICKUP_POINTS: PickupPoint[] = [
  { id: 'ikeja', name: 'DrawMart Ikeja', area: 'Ikeja', address: '12 Allen Avenue, Ikeja', hours: 'Mon–Sat, 9am–6pm', location: { lat: 6.6018, lng: 3.3515 } },
  { id: 'lekki', name: 'DrawMart Lekki', area: 'Lekki', address: '5 Admiralty Way, Lekki Phase 1', hours: 'Mon–Sat, 10am–7pm', location: { lat: 6.4478, lng: 3.4723 } },
  { id: 'surulere', name: 'DrawMart Surulere', area: 'Surulere', address: '20 Adeniran Ogunsanya Street, Surulere', hours: 'Mon–Sat, 9am–6pm', location: { lat: 6.4969, lng: 3.3528 } },
  { id: 'vi', name: 'DrawMart Victoria Island', area: 'Victoria Island', address: '10 Adeola Odeku Street, Victoria Island', hours: 'Mon–Fri, 9am–6pm', location: { lat: 6.4281, lng: 3.4219 } },
  { id: 'yaba', name: 'DrawMart Yaba', area: 'Yaba', address: '48 Herbert Macaulay Way, Yaba', hours: 'Mon–Sat, 9am–6pm', location: { lat: 6.5095, lng: 3.3711 } },
]

const SEED_LISTINGS: SeedListing[] = [
  // A tiny draw, so testers can be sure of winning and try the won-item flow.
  {
    merchantId: 'm-yaba', title: 'JBL Go speaker, 2-ticket test draw', category: 'Electronics', images: img('jbl-charge.jpg'),
    description: 'A tiny draw for trying the whole flow: buy both tickets and you’re sure to win.',
    price: 20_000, ticket: 10_000, sold: 0, closesInHours: 720,
  },
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
    merchantId: 'm-vi', title: 'Mercedes-AMG GLE 63 S Coupé 2025', category: 'Cars', images: img('mercedes-amg-gle-63-s-coupe.jpg'),
    description: 'Foreign-used, inspected, papers complete. Registration in the winner’s name.',
    price: 210_000_000, ticket: 50_000, sold: 1_130, closesInHours: 480,
  },
  {
    merchantId: 'm-vi', title: 'Mercedes-AMG G 63 2025', category: 'Cars', images: img('MercedesG-wagon.jpg'),
    description: 'Brand new with full dealer history. Registration in the winner’s name.',
    price: 330_000_000, ticket: 50_000, sold: 540, closesInHours: 600,
  },
  {
    merchantId: 'm-yaba', title: '5kVA inverter + battery', category: 'Home', images: img('inverter-and-batteries.jpg'),
    description: 'Inverter with two batteries, installed by the store.',
    price: 1_800_000, ticket: 6_000, sold: 122, closesInHours: 96,
  },
  {
    merchantId: 'm-lekki', title: 'Samsung Galaxy S26, 256GB', category: 'Phones', images: img('samsung-galaxy-s-series.jpg'),
    description: 'Brand new and sealed, with local warranty.',
    price: 1_350_000, ticket: 2_500, sold: 120, closesInHours: 72,
  },
  {
    merchantId: 'm-yaba', title: 'Google Pixel 10 Pro, 256GB', category: 'Phones', images: img('google-pixel-pro.jpg'),
    description: 'Brand new, unlocked, with a one-year warranty.',
    price: 1_500_000, ticket: 5_000, sold: 60, closesInHours: 120, unsold: 'extend_once',
  },
  {
    merchantId: 'm-surulere', title: 'Tecno Phantom V Fold 2', category: 'Phones', images: img('foldable-phones.jpg'),
    description: 'Brand new foldable with charger and case.',
    price: 950_000, ticket: 2_000, sold: 300, closesInHours: 30,
  },
  {
    merchantId: 'm-yaba', title: 'PlayStation 5 Pro bundle', category: 'Electronics', images: img('playstation-5-home.jpg'),
    description: 'Console, two controllers and three games.',
    price: 1_200_000, ticket: 2_000, sold: 410, closesInHours: 20,
  },
  {
    merchantId: 'm-surulere', title: 'Sony 65-inch Bravia 7', category: 'Electronics', images: img('sony-bravia.jpg'),
    description: '4K mini-LED TV. Delivery and wall mounting included.',
    price: 1_650_000, ticket: 5_000, sold: 90, closesInHours: 150, unsold: 'convert_to_sale', fallback: 1_700_000,
  },
  {
    merchantId: MY_MERCHANT, title: 'Apple Watch Ultra 3', category: 'Electronics', images: img('apple-watch-ultra.jpg'),
    description: 'Titanium, GPS + cellular, brand new.',
    price: 1_050_000, ticket: 2_500, sold: 200, closesInHours: 60,
  },
  {
    merchantId: 'm-yaba', title: '10kVA solar system, installed', category: 'Home', images: img('rooftop-solar.jpg'),
    description: 'Inverter, lithium batteries and 12 panels, installed by the store.',
    price: 6_500_000, ticket: 10_000, sold: 230, closesInHours: 400, unsold: 'extend_once',
  },
  {
    merchantId: 'm-lekki', title: 'Samsung 2-door fridge, 450L', category: 'Home', images: img('side-by-side-fridge.jpg'),
    description: 'Frost-free, inverter compressor, brand new.',
    price: 1_100_000, ticket: 2_500, sold: 150, closesInHours: 90,
  },
  {
    merchantId: 'm-surulere', title: 'LG front-load washer, 9kg', category: 'Home', images: img('lg-front-load-washer.jpg'),
    description: 'Inverter direct drive, brand new with warranty.',
    price: 780_000, ticket: 2_000, sold: 80, closesInHours: 110, unsold: 'convert_to_sale', fallback: 800_000,
  },
  {
    merchantId: 'm-vi', title: 'Lexus RX 350 2023', category: 'Cars', images: img('lexus-rx-2023.jpg'),
    description: 'Foreign-used, inspected, papers complete. Registration in the winner’s name.',
    price: 95_000_000, ticket: 20_000, sold: 1_500, closesInHours: 500, unsold: 'extend_once',
  },
  {
    merchantId: 'm-vi', title: 'Honda Accord 2022', category: 'Cars', images: img('honda-accord.jpg'),
    description: 'Foreign-used, low mileage, inspected.',
    price: 38_000_000, ticket: 10_000, sold: 900, closesInHours: 350,
  },
  {
    merchantId: 'm-lekki', title: 'Rolex Datejust 41', category: 'Fashion', images: img('rolex-datejust-41.jpg'),
    description: 'Brand new with box and papers.',
    price: 18_000_000, ticket: 10_000, sold: 420, closesInHours: 300,
  },
  {
    merchantId: MY_MERCHANT, title: 'Louis Vuitton Keepall 50', category: 'Fashion', images: img('louis-vuitton-monogram-bags.jpg'),
    description: 'Authentic, with receipt and dust bag.',
    price: 4_200_000, ticket: 5_000, sold: 260, closesInHours: 180, unsold: 'convert_to_sale', fallback: 4_000_000,
  },
  {
    merchantId: 'm-yaba', title: 'Air Jordan 1 bundle, 3 pairs', category: 'Fashion', images: img('air-jordan-1.jpg'),
    description: 'Three colourways, any size from 40 to 46.',
    price: 650_000, ticket: 1_000, sold: 380, closesInHours: 40,
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
  },  {
    merchantId: MY_MERCHANT, title: 'AirPods Pro 3', category: 'Electronics', images: img('airpods-pro.jpg'),
    description: 'Brand new and sealed.', price: 420_000, status: 'for_sale',
  },
  {
    merchantId: MY_MERCHANT, title: 'Samsung Galaxy Watch 8', category: 'Electronics', images: img('samsung-galaxy-watch.jpg'),
    description: 'Brand new, 44mm, with charger.', price: 380_000, status: 'for_sale',
  },
  {
    merchantId: MY_MERCHANT, title: 'UK-used iPhone 18 Pro Max, 256GB', category: 'Phones', images: img('iphone18pmBlack.jpg'),
    description: 'UK-used, battery health 96%. Comes with a 3-month store warranty.', price: 2_150_000, status: 'for_sale',
  },
  {
    merchantId: 'm-lekki', title: 'Samsung Galaxy S26 Ultra, 1TB', category: 'Phones', images: img('samsungS26Ultra.jpg'),
    description: 'Brand new and sealed, with S Pen.', price: 2_450_000, status: 'for_sale',
  },
  {
    merchantId: 'm-lekki', title: 'Dyson V15 cordless vacuum', category: 'Home', images: img('dyson-cordless-vacuum.jpg'),
    description: 'Brand new with all attachments.', price: 1_250_000, status: 'for_sale',
  },
  {
    merchantId: 'm-lekki', title: 'Gucci horsebit loafers', category: 'Fashion', images: img('leather-loafer.jpg'),
    description: 'Authentic, sizes 41 to 45.', price: 1_100_000, status: 'for_sale',
  },
  {
    merchantId: 'm-surulere', title: 'LG UHD 55-inch smart TV', category: 'Electronics', images: img('LG55inchSmartTv.jpg'),
    description: 'With wall bracket. Delivery anywhere in Lagos.', price: 690_000, status: 'for_sale',
  },
  {
    merchantId: 'm-surulere', title: 'Hisense 1.5HP inverter AC', category: 'Home', images: img('split-air-conditioner.jpg'),
    description: 'Installation in Lagos included.', price: 520_000, status: 'for_sale',
  },
  {
    merchantId: 'm-surulere', title: 'Office desk and chair set', category: 'Home', images: [],
    description: 'Solid wood desk with an ergonomic mesh chair.', price: 350_000, status: 'for_sale',
  },
  {
    merchantId: 'm-yaba', title: 'MacBook Air 13-inch, M4', category: 'Electronics', images: img('macbook-air.jpg'),
    description: '16GB, 512GB SSD, brand new.', price: 1_650_000, status: 'for_sale',
  },
  {
    merchantId: 'm-yaba', title: 'HP LaserJet Pro printer', category: 'Electronics', images: img('hp-laserjet.jpg'),
    description: 'Wireless, prints and scans.', price: 285_000, status: 'for_sale',
  },
  {
    merchantId: 'm-yaba', title: 'JBL Charge 6 speaker', category: 'Electronics', images: img('jbl-charge.jpg'),
    description: 'Waterproof Bluetooth speaker, brand new.', price: 240_000, status: 'for_sale',
  },
  {
    merchantId: 'm-yaba', title: 'Ankara fabric bundle, 5 × 6 yards', category: 'Fashion', images: img('ankara-fabric.jpg'),
    description: 'Assorted prints, 100% cotton.', price: 85_000, status: 'for_sale',
  },
  {
    merchantId: 'm-vi', title: 'Toyota Camry 2018, Nigerian-used', category: 'Cars', images: img('toyota-camry-2018-1.jpg', 'toyota-camry-2018-2.jpg', 'toyota-camry-2018-3.jpg'),
    description: 'One owner, inspected, papers complete. View at our VI showroom.', price: 13_500_000, status: 'for_sale',
  },
  {
    merchantId: 'm-vi', title: 'Mercedes-Benz GLE 350 2021', category: 'Cars', images: img('mercedes-gle-350-1.jpg', 'mercedes-gle-350-2.jpg', 'mercedes-gle-350-3.jpg'),
    description: 'Foreign-used, full service history.', price: 78_000_000, status: 'for_sale',
  },
  {
    merchantId: 'm-vi', title: 'Front and rear dashcam', category: 'Electronics', images: img('dashcam.jpg'),
    description: 'Installed while you wait at our VI showroom.', price: 120_000, status: 'for_sale',
  },
  {
    merchantId: TOLU_SHOP, title: 'PS5 Slim, barely used', category: 'Electronics', images: img('playstation-5-black.jpg'),
    description: 'With two controllers. Pickup in Yaba or delivery.', price: 650_000, status: 'for_sale',
  },
  {
    merchantId: TOLU_SHOP, title: 'iPad 10th gen, 64GB', category: 'Electronics', images: img('ipad-10th-gen.jpg'),
    description: 'Like new, with case and charger.', price: 420_000, status: 'for_sale',
  },
  {
    merchantId: TOLU_SHOP, title: 'Nintendo Switch 2', category: 'Electronics', images: img('nintendo-switch-2.jpg'),
    description: 'Sealed. Bought abroad.', price: 520_000, status: 'pending_review',
  },
  {
    merchantId: 'm-lekki', title: 'Samsung soundbar Q800', category: 'Electronics', images: img('samsung-soundbar.jpg'),
    description: 'With wireless subwoofer.', price: 560_000, status: 'pending_review',
  },
]

function productListing(input: NewProductInput & { merchantId: string; status: ListingStatus }, at: number): Listing {
  return {
    id: uid('L'), productCode: newProductCode(), kind: 'product', merchantId: input.merchantId, title: input.title.trim(), description: input.description.trim(), category: input.category,
    images: input.images ?? [], priceKobo: input.priceKobo, ticketPriceKobo: 0, buyerTicketPriceKobo: 0, ticketCount: 0, ticketsSold: 0, stock: input.stock ?? 1, packageSize: input.packageSize ?? null,
    feeMode: 'seller', feeBps: platformFeeBps(input.priceKobo), unsoldPolicy: 'refund', fallbackPriceKobo: null, durationDays: 0, extended: false,
    status: input.status, handover: null, cautionFee: { amountKobo: 0, status: 'none' }, commitment: '', createdAt: iso(at), closesAt: iso(at), boostedUntil: null, soldOutAt: null, drawAt: null, pickupBatchId: null,
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
    productCode: newProductCode(),
    kind: 'raffle',
    stock: 1,
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
      location: null,
      contactPhone: '0803 000 0000',
      date: addDays(localDate(new Date(now)), status === 'pending_review' ? 2 : -3),
      slot: 'morning',
    },
    cautionFee: settleCautionFee({ amountKobo: cautionFeeFor(s.category), status: 'held' }, status),
    commitment: await commitmentFor(seed),
    createdAt: iso(now - 2 * DAY),
    closesAt: iso(now + s.closesInHours * 60 * 60 * 1000),
    boostedUntil: null,
    soldOutAt: null,
    drawAt: null,
    pickupBatchId: null,
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

const DEMO_BUYERS = DEMO_ACCOUNTS.filter((a) => a.role === 'buyer')
const WELCOME_KOBO = nairaToKobo(25_000)

/** seller@drawmart.test already passed the ID check and has a shop. */
function seedSellerShop(db: Db, now: number) {
  db.merchants.push({ id: TOLU_SHOP, kind: 'individual', name: 'Tolu’s Gadgets', area: 'Yaba', cacNumber: '', verified: true, verifiedAt: '2026-09-14T09:00:00.000Z' })
  db.sellerShops[TOLU] = TOLU_SHOP
  const at = iso(now - 10 * DAY)
  db.sellerApplications[TOLU] = {
    id: uid('S'), status: 'approved', shopName: 'Tolu’s Gadgets', legalName: 'Toluwani Adebayo', nin: '12345678901', phone: '0803 123 4567',
    address: '12 Herbert Macaulay Way, Yaba', area: 'Yaba', idPhotoUrl: null, selfieUrl: null, reviewNote: null, createdAt: at, updatedAt: at, reviewedAt: at,
  }
}

async function freshDb(): Promise<Db> {
  const now = Date.now()
  const db: Db = {
    users: [
      ...DEMO_BUYERS.map((a) => ({ id: a.mockId, displayName: a.name, state: 'Lagos', weeklyLimitKobo: RULES.defaultWeeklyLimitKobo, ageVerified: true, phone: null })),
      { id: CROWD, displayName: 'Other buyers', state: 'Lagos', weeklyLimitKobo: Number.MAX_SAFE_INTEGER, ageVerified: true, phone: null },
    ],
    merchants: MERCHANTS.map((x) => ({ ...x })),
    listings: [],
    seeds: {},
    closingRefs: {},
    notifications: [],
    tickets: [],
    // Every buyer starts with the same test money (welcome_credit_kobo on Supabase).
    ledger: DEMO_BUYERS.map((a) => ({ id: uid('E'), userId: a.mockId, kind: 'topup' as const, cashKobo: WELCOME_KOBO, creditKobo: 0, memo: 'Welcome top-up (test money)', createdAt: iso(now - DAY) })),
    results: [],
    pendingLimits: {},
    orders: [],
    carts: {},
    checkTickets: {},
    listingChecks: {},
    claimDetails: {},
    reviews: [],
    excusedFailures: [],
    // The demo shops already have somewhere to collect from, near the middle of their area.
    shopPickups: Object.fromEntries(MERCHANTS.map((m) => {
      const a = DELIVERY_AREAS.find((x) => x.id === areaFromText(m.area))!
      return [m.id, { address: `12 Market Road, ${m.area}, Lagos`, location: { lat: a.lat, lng: a.lng }, contactPhone: '0803 000 0000' }]
    })),
    deliveryPricing: placeholderPricing(),
    riderPayRates: placeholderRiderPay(placeholderPricing()),
    riderEarnings: [],
    riderPayoutAccounts: {},
    riderPhotos: {},
    deliveryMessages: [],
    priceReviews: [],
    cartQuantities: {},
    saved: {},
    pushPreferences: {},
    riderAreas: {},
    savedAlertsSent: [],
    pushSubscriptions: [],
    payouts: [],
    payoutAccounts: {},
    winnerStories: [],
    winnerConsentLog: [],
    addresses: {},
    sellerApplications: {},
    sellerShops: {},
    storeApplications: {},
    riderSignupsOpen: false,
    riderApplications: {},
    riderAccounts: {},
    deliveryRatings: {},
    incidents: [],
    riderFleets: [],
    // The demo rider has a track record, so demos can carry anything.
    riderTrust: { 'u-rider': { fleetId: null, trusted: true } },
    storeAccounts: {},
    supportThreads: {},
    supportMessages: [],
    quickReplies: {},
    discounts: [],
    discountRedemptions: [],
    owedChecks: {},
    storeRoles: {},
    storeInvites: [],
    storeActivity: [],
    conversations: [],
    messages: [],
    callPhones: { 'm-surulere': '0803 000 1234' },
    views: [],
    savedPickups: {},
    boosts: [],
    // The demo never reaches the real threshold, so boosts start switched on.
    boostSettings: { minActiveBuyers: BOOST_DEFAULTS.minActiveBuyers, forcedOn: true, maxActive: BOOST_DEFAULTS.maxActiveBoosts },
  }
  seedSellerShop(db, now)
  for (const p of [...SEED_PRODUCTS, ...catalogProducts(MY_MERCHANT)]) {
    db.listings.push({ ...productListing({ ...p, priceKobo: nairaToKobo(p.price) }, now - DAY), status: p.status })
  }
  for (const s of [...SEED_LISTINGS, ...catalogDraws(MY_MERCHANT)]) {
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
    { merchantId: 'm-vi', title: 'Toyota Camry 2018', description: 'Foreign-used, inspected, papers complete.', category: 'Cars', images: img('toyota-camry-2018-1.jpg', 'toyota-camry-2018-2.jpg', 'toyota-camry-2018-3.jpg'), price: 14_000_000, ticket: 10_000, sold: 0, closesInHours: 1 },
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

/** A month of made-up visits to every listing, so each seller's insights have something in them. */
function seedViews(db: Db, now: number) {
  // Fewer on the long catalogue: every visit is a row, and all this has to fit in localStorage.
  const catalog = new Set([...catalogDraws(MY_MERCHANT), ...catalogProducts(MY_MERCHANT)].map((l) => l.title))
  for (const l of db.listings) {
    if (!['live', 'for_sale', 'drawn'].includes(l.status)) continue
    const popularity = catalog.has(l.title) ? 1 : 2 + Math.random() * 10
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
  chat(phone, 'u-chidi', [['buyer', 'Is the Glacier colour still available? Can I see it in person in Ikeja?', 30]], true)
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
  for (const userId of participants(db, listing)) notify(db, userId, userId === winner.userId ? 'draw_won' : 'draw_lost', listing.id, at)
  notifyShop(db, listing.merchantId, 'store_winner_picked', listing.id, at)
}

/** Everyone holding a ticket, leaving out the demo's stand-in for other buyers. */
function participants(db: Db, listing: Listing): Set<string> {
  return new Set(db.tickets.filter((t) => t.listingId === listing.id && t.userId !== CROWD).map((t) => t.userId))
}

function notify(db: Db, userId: string, kind: NotificationKind, listingId: string | null, at: string, area: string | null = null) {
  db.notifications.push({ id: uid('N'), userId, kind, listingId, area, createdAt: at, read: false, celebrated: false })
}

/** A job has reached the pool: riderAlerts.ts decides who hears (private.alert_riders). Not the rider who just let it go. */
function alertRiders(db: Db, kind: 'rider_new_job' | 'rider_new_return', listingId: string, area: string | null, except: string | null, now: number) {
  for (const r of riderIds(db).filter((id) => id !== except).map((mockId) => ({ mockId }))) {
    const prefs = db.pushPreferences[r.mockId]
    const allowed = riderJobAlertAllowed({
      enabled: (kind === 'rider_new_job' ? prefs?.riderNewJobs : prefs?.riderReturns) !== false,
      areas: db.riderAreas[r.mockId] ?? [],
      jobArea: area,
      held: riderJobsHeld(db, r.mockId),
      sentLastHour: db.notifications.filter((n) => n.userId === r.mockId && (n.kind === 'rider_new_job' || n.kind === 'rider_new_return') && Date.parse(n.createdAt) > now - 3_600_000).length,
    })
    if (allowed) notify(db, r.mockId, kind, listingId, iso(now), area)
  }
}
const orderArea = (db: Db, o: MockOrder) => (o.handledBy === 'drawmart' ? null : sellerAreaOf(db.merchants.find((m) => m.id === o.merchantId)!))
/** A job for a later day's window is announced on its day (deliveryWindows.ts), in processDeadlines. */
const alertNewJob = (db: Db, o: MockOrder, except: string | null, now: number) =>
  (o.status !== 'dispatched' || canTakeYet(o.windowStart ?? null, now)) &&
  alertRiders(db, 'rider_new_job', o.listingId, o.atCounterAt && o.pickupPoint ? nearestArea(o.pickupPoint.location, DELIVERY_AREAS) : orderArea(db, o), except, now)
/** Going back to the seller from a pickup counter, not yet handed to a rider. */
const waitingAtCounter = (o: MockOrder) => o.returnState === 'returning' && !!o.atCounterAt && !o.counterOutAt
const alertNewReturn = (db: Db, o: MockOrder, except: string | null, now: number) => alertRiders(db, 'rider_new_return', o.listingId, nearestArea(db.claimDetails[o.claim!.id].location, DELIVERY_AREAS), except, now)
const notifiedSince = (db: Db, userId: string, kind: NotificationKind, listingId: string, since: string) => db.notifications.some((n) => n.userId === userId && n.kind === kind && n.listingId === listingId && n.createdAt >= since)

/** Everyone running this shop: its store account (whose id is the shop's), or an individual seller. */
function notifyShop(db: Db, merchantId: string, kind: NotificationKind, listingId: string | null, at: string) {
  notify(db, merchantId, kind, listingId, at)
  for (const [userId, shop] of Object.entries(db.sellerShops)) if (shop === merchantId) notify(db, userId, kind, listingId, at)
}

/** savedAlerts.ts savedAlertAllowed decides; this sends it, pointing at `target` (a relist's new listing). */
function alertSaved(db: Db, userId: string, savedListingId: string, target: Listing, kind: SavedAlertKind, now: number) {
  const user = db.users.find((u) => u.id === userId)
  if (!user || target.merchantId === db.sellerShops[userId]) return
  const allowed = savedAlertAllowed({
    kind,
    enabled: db.pushPreferences[userId]?.savedItems !== false,
    alreadySent: db.savedAlertsSent.some((a) => a.userId === userId && a.savedListingId === savedListingId && a.kind === kind),
    sentToday: db.savedAlertsSent.filter((a) => a.userId === userId && sameLagosDay(Date.parse(a.at), now)).length,
    weeklyRoomKobo: user.weeklyLimitKobo - spentInLastWeek(db.ledger.filter((e) => e.userId === userId), new Date(now)),
    ticketPriceKobo: target.buyerTicketPriceKobo,
  })
  if (!allowed) return
  db.savedAlertsSent.push({ userId, savedListingId, kind, at: iso(now) })
  notify(db, userId, kind, target.id, iso(now))
}

const saversOf = (db: Db, listingId: string) => Object.entries(db.saved).filter(([, ids]) => ids.includes(listingId)).map(([userId]) => userId)

/** A listing has just become visible: does it bring back something a buyer saved? */
function alertRelists(db: Db, fresh: Listing, now: number) {
  for (const saved of db.listings) {
    if (!isRelistOf(fresh, saved)) continue
    for (const userId of saversOf(db, saved.id)) alertSaved(db, userId, saved.id, fresh, relistAlertKind(fresh.status), now)
  }
}

/** The last ticket has sold: sales stop and everyone hears when the winner comes. */
function closeTicketSales(db: Db, listing: Listing, closingRef: string, now: number) {
  listing.status = 'sold_out'
  listing.soldOutAt = iso(now)
  listing.drawAt = announcementDate(now, listing.closesAt)
  db.closingRefs[listing.id] = closingRef
  for (const userId of participants(db, listing)) notify(db, userId, 'draw_sold_out', listing.id, iso(now))
  notifyShop(db, listing.merchantId, 'store_draw_sold_out', listing.id, iso(now))
}

async function runDueDraws(db: Db, now: number) {
  for (const l of db.listings) {
    if (l.status === 'sold_out' && l.drawAt && Date.parse(l.drawAt) <= now) await runDraw(db, l, db.closingRefs[l.id], iso(now))
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
/** deliveryChecks.ts: the seller's charge, the buyer's apology, and suspension if it keeps happening. */
function penaliseSeller(db: Db, o: MockOrder, nowMs: number) {
  const at = iso(nowMs)
  // incidents.ts: something happened after the rider collected it, so it isn't the seller's to pay for.
  if (o.collectedAt && db.incidents.some((i) => i.orderId === o.id && i.createdAt >= o.collectedAt!)) {
    db.excusedFailures.push(o.id)
    db.ledger.push({ id: uid('E'), userId: o.buyerId, kind: 'store_credit', cashKobo: 0, creditKobo: APOLOGY_CREDIT_KOBO, memo: 'Sorry about your order', listingId: o.listingId, createdAt: at })
    return
  }
  db.payouts.push({ id: uid('Y'), merchantId: o.merchantId, listingId: o.listingId, orderId: o.id, kind: 'charge', amountKobo: -FAILURE_CHARGE_KOBO, status: 'due', createdAt: at, dueAt: at, paidAt: null, reference: null, paidTo: null })
  db.ledger.push({ id: uid('E'), userId: o.buyerId, kind: 'store_credit', cashKobo: 0, creditKobo: APOLOGY_CREDIT_KOBO, memo: 'Sorry about your order', listingId: o.listingId, createdAt: at })
  notifyShop(db, o.merchantId, 'store_order_failed', o.listingId, at)
  const since = iso(nowMs - 30 * DAY)
  const failures = db.orders.filter((x) => x.merchantId === o.merchantId && !db.excusedFailures.includes(x.id) && (((x.cancelReason === 'failed_check' || x.cancelReason === 'refused_wrong' || x.cancelReason === 'refused_damaged') && x.cancelledAt! >= since) || (x.claim?.kind === 'fault' && !!x.refundedAt && x.refundedAt >= since)))
  const shop = db.merchants.find((m) => m.id === o.merchantId)!
  if (failures.length >= SUSPEND_AFTER_FAILURES && !shop.suspendedAt) {
    shop.suspendedAt = at
    for (const l of db.listings) if (l.merchantId === shop.id && l.kind === 'product' && l.status === 'for_sale') l.status = 'paused'
    notifyShop(db, shop.id, 'store_suspended', null, at)
  }
}

/** Refunds the buyer and puts the stock right, for whoever has been allowed to cancel. */
function cancelOrderNow(db: Db, o: MockOrder, reason: CancelReason, note: string, nowMs: number) {
  const l = db.listings.find((x) => x.id === o.listingId)!
  const at = iso(nowMs)
  Object.assign(o, { status: 'cancelled', cancelledAt: at, cancelReason: reason, cancelNote: note.trim() || null })
  db.payouts = db.payouts.filter((p) => !(p.orderId === o.id && p.status === 'waiting'))
  db.ledger.push({ id: uid('E'), userId: o.buyerId, kind: 'order_refund', cashKobo: o.paidCashKobo, creditKobo: o.paidCreditKobo, memo: `Refund · ${l.title}`, listingId: l.id, createdAt: at })
  // One fee covers everything from this seller in this checkout: it moves to what's still coming, or comes back with the last.
  // Not collected from a counter: the trip happened, so the fee stays paid.
  if (o.deliveryFeeKobo > 0 && reason !== 'not_collected' && reason !== 'not_delivered') {
    const other = db.orders.find((x) => x.checkoutId === o.checkoutId && x.merchantId === o.merchantId && x.id !== o.id && x.status !== 'cancelled' && !x.isPrize)
    if (other) {
      other.deliveryFeeKobo += o.deliveryFeeKobo
      other.paidFeeCashKobo += o.paidFeeCashKobo
      other.paidFeeCreditKobo += o.paidFeeCreditKobo
      o.deliveryFeeKobo = 0
    } else {
      db.ledger.push({ id: uid('E'), userId: o.buyerId, kind: 'order_refund', cashKobo: o.paidFeeCashKobo, creditKobo: o.paidFeeCreditKobo, memo: `Delivery refund · ${l.title}`, listingId: l.id, createdAt: at })
    }
  }
  const was = l.status
  Object.assign(l, stockAfterCancel(reason, l, o.quantity))
  if (was === 'sold' && l.status === 'for_sale') for (const userId of saversOf(db, l.id)) alertSaved(db, userId, l.id, l, 'saved_back_on_sale', nowMs)
  notify(db, o.buyerId, 'order_cancelled', l.id, at)
}

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
    if (l.status === 'for_sale') for (const userId of saversOf(db, l.id)) alertSaved(db, userId, l.id, l, 'saved_back_on_sale', now)
  }
  for (const [userId, ids] of Object.entries(db.saved)) {
    for (const id of ids) {
      const l = db.listings.find((x) => x.id === id)
      if (l?.status === 'live' && isClosingSoon(l.closesAt, now)) alertSaved(db, userId, l.id, l, 'saved_closing_soon', now)
    }
  }
  // Store reminders (storeNotifications.ts).
  const sentFor = (l: Listing, kind: NotificationKind) => db.notifications.filter((n) => n.listingId === l.id && n.kind === kind).map((n) => n.createdAt)
  for (const l of db.listings) {
    if (l.status === 'live' && l.kind === 'raffle' && isClosingSoon(l.closesAt, now) && !closingReminderSent(l.closesAt, sentFor(l, 'store_draw_closing'))) {
      notifyShop(db, l.merchantId, 'store_draw_closing', l.id, iso(now))
    }
    if (l.status === 'pending_review' && l.handover && pickupReminderDue(l.handover.date, now) && !sentFor(l, 'store_pickup_tomorrow').some((at) => Date.parse(at) > now - DAY)) {
      notifyShop(db, l.merchantId, 'store_pickup_tomorrow', l.id, iso(now))
    }
  }
  for (const o of db.orders) {
    if (confirmOverdue(o, now)) {
      cancelOrderNow(db, o, 'not_confirmed', '', now)
      notifyShop(db, o.merchantId, 'store_order_expired', o.listingId, iso(now))
    } else if (o.status === 'paid' && o.readyBy && Date.parse(o.readyBy) <= now) {
      cancelOrderNow(db, o, 'not_sent', '', now)
      notifyShop(db, o.merchantId, 'store_order_expired', o.listingId, iso(now))
    } else if (!o.confirmRemindedAt && confirmReminderDue(o, now)) {
      o.confirmRemindedAt = iso(now)
      notifyShop(db, o.merchantId, 'store_order_confirm_soon', o.listingId, iso(now))
    }
  }
  // Rider reminders (riderAlerts.ts, private.rider_reminders), then jobs not collected in time go back to the pool (riderLimits.ts).
  const remindAt = (takenAt: string) => Date.parse(collectBy(takenAt)) - COLLECT_WARNING_MINUTES * 60_000 <= now
  for (const o of db.orders) {
    if (o.status === 'dispatched' && o.riderId && !o.collectedAt && o.riderTakenAt && remindAt(o.riderTakenAt) && !notifiedSince(db, o.riderId, 'rider_collect_soon', o.listingId, o.riderTakenAt)) notify(db, o.riderId, 'rider_collect_soon', o.listingId, iso(now))
    const d = o.claim?.status === 'awaiting_pickup' ? db.claimDetails[o.claim.id] : null
    if (d?.riderId && d.takenAt && remindAt(d.takenAt) && !notifiedSince(db, d.riderId, 'rider_collect_soon', o.listingId, d.takenAt)) notify(db, d.riderId, 'rider_collect_soon', o.listingId, iso(now))
    const lock = o.pinState.lockedUntil
    if (o.status === 'dispatched' && o.riderId && !o.atCounterAt && lock && Date.parse(lock) <= now && Date.parse(lock) > now - 3_600_000 && !notifiedSince(db, o.riderId, 'rider_pin_unlocked', o.listingId, lock)) notify(db, o.riderId, 'rider_pin_unlocked', o.listingId, iso(now))
  }
  // No new time chosen after a failed attempt (deliveryAttempts.ts).
  for (const o of db.orders) {
    if (o.status === 'dispatched' && !o.pausedAt && o.failedAttempts === 1 && !o.redeliveryChoice && o.lastFailedAt && Date.parse(o.lastFailedAt) + CHOOSE_WITHIN_HOURS * 3_600_000 <= now) returnUndelivered(db, o, now)
  }
  for (const o of db.orders) {
    if (o.status !== 'dispatched' || o.riderId || o.atCounterAt || !o.windowStart || o.windowAlertedAt || !canTakeYet(o.windowStart, now)) continue
    if (o.dispatchedAt && Date.parse(o.dispatchedAt) >= Date.parse(windowOpens(o.windowStart))) continue
    o.windowAlertedAt = iso(now)
    changed = true
    alertNewJob(db, o, null, now)
  }
  for (const o of db.orders) {
    if (o.status !== 'dispatched' || !o.atCounterAt) continue
    if (!o.counterRemindedAt && counterReminderDue(o.atCounterAt, now)) {
      o.counterRemindedAt = iso(now)
      notify(db, o.buyerId, 'order_collect_reminder', o.listingId, iso(now))
    }
    // Won items stay until they're collected.
    if (!o.isPrize && counterReturnDue(o.atCounterAt, now)) {
      cancelOrderNow(db, o, 'not_collected', '', now)
      Object.assign(o, { returnState: 'returning', riderId: null, riderTakenAt: null })
      notifyShop(db, o.merchantId, 'store_order_uncollected', o.listingId, iso(now))
      alertNewJob(db, o, null, now)
    }
  }
  for (const o of db.orders) {
    if (o.status === 'dispatched' && !o.pausedAt && o.riderId && !o.collectedAt && o.riderTakenAt && collectionOverdue(collectBy(o.riderTakenAt), now)) {
      const was = o.riderId
      Object.assign(o, { riderId: null, riderTakenAt: null, collectionPhotos: null })
      notify(db, was, 'rider_job_released', o.listingId, iso(now))
      alertNewJob(db, o, was, now)
    }
    const d = o.claim?.status === 'awaiting_pickup' ? db.claimDetails[o.claim.id] : null
    if (d?.riderId && d.takenAt && !openIncident(db, { claimId: o.claim!.id }) && collectionOverdue(collectBy(d.takenAt), now)) {
      const was = d.riderId
      Object.assign(d, { riderId: null, takenAt: null })
      notify(db, was, 'rider_job_released', o.listingId, iso(now))
      alertNewReturn(db, o, was, now)
    }
  }
  return changed
}

/** Back to the seller with the rider: refunded the price, not delivery, and not the seller's fault. */
function returnUndelivered(db: Db, o: MockOrder, now: number) {
  cancelOrderNow(db, o, 'not_delivered', '', now)
  Object.assign(o, { returnState: 'returning', arrivedAt: null })
  notifyShop(db, o.merchantId, 'store_order_undelivered', o.listingId, iso(now))
}

/** One earning at today's rates, once per job (private.earn). */
function earn(db: Db, riderId: string | null, kind: EarningKind, sourceKey: string, o: MockOrder, from: string | null, to: string | null, now: number) {
  if (!riderId || db.riderEarnings.some((e) => e.sourceKey === sourceKey && e.kind === kind)) return
  const l = db.listings.find((x) => x.id === o.listingId)!
  // feeGroups.ts: an order's trip pays once, at its largest package (private.trip_paid, trip_size). Not a buyer's return.
  const forOrder = sourceKey.split(':')[0] === o.id
  if (forOrder) {
    const paid = db.riderEarnings.flatMap((e) => {
      const s = db.orders.find((x) => x.id === e.sourceKey.split(':')[0])
      return s && s.id !== o.id && e.riderId === riderId && onTripWith(s, o) ? [{ feeGroup: feeGroup(s), riderId, takenAt: s.riderTakenAt ?? null, kind: e.kind, at: e.earnedAt }] : []
    })
    if (tripAlreadyPaid(paid, { feeGroup: feeGroup(o), riderId, takenAt: o.riderTakenAt ?? null, kind, at: iso(now) })) return
  }
  const [a, b] = [from ?? to ?? DEFAULT_AREA, to ?? from ?? DEFAULT_AREA]
  const amountKobo = kind === 'failed_attempt' ? db.riderPayRates.attemptKobo : tripPay(db.riderPayRates, a, b, forOrder ? tripSize(db, o) : packageSizeOf(l))
  if (amountKobo <= 0) return
  db.riderEarnings.push({
    id: uid('R'), riderId, sourceKey, kind, amountKobo, productCode: l.productCode, listingTitle: l.title, fromArea: kind === 'failed_attempt' ? null : a, toArea: kind === 'failed_attempt' ? null : b,
    earnedAt: iso(now), paidAt: null, reference: null, paidTo: null, paidBy: null,
  })
}
const sellerArea = (db: Db, o: MockOrder) => sellerAreaOf(db.merchants.find((m) => m.id === o.merchantId)!)
const buyerArea = (o: MockOrder) => (o.delivery.location ? nearestArea(o.delivery.location, DELIVERY_AREAS) : o.delivery.address ? areaFromText(o.delivery.address) : null)
const pointArea = (o: MockOrder) => (o.pickupPoint ? nearestArea(o.pickupPoint.location, DELIVERY_AREAS) : null)

/** Where a job goes from and to, and what it pays, as private.earn will work it out (jobPool.ts). */
function poolPay(db: Db, o: MockOrder, fromArea: string | null, toArea: string | null, postedAt: string | null, paySize?: PackageSize) {
  const size = packageSizeOf(db.listings.find((l) => l.id === o.listingId)!)
  return { fromArea, toArea, size, payKobo: tripPay(db.riderPayRates, fromArea ?? toArea ?? DEFAULT_AREA, toArea ?? fromArea ?? DEFAULT_AREA, paySize ?? size), postedAt }
}
function poolFields(db: Db, o: MockOrder) {
  // What the trip pays, once for its fee group.
  if (o.returnState === 'returning') return poolPay(db, o, o.atCounterAt ? pointArea(o) : buyerArea(o), sellerArea(db, o), o.cancelledAt ?? o.dispatchedAt, tripSize(db, o))
  return poolPay(db, o, o.handledBy === 'drawmart' ? null : sellerArea(db, o), o.fulfilment === 'pickup' ? pointArea(o) : buyerArea(o), o.dispatchedAt, tripSize(db, o))
}

/** Everything a rider is holding: deliveries, refused items going back, and returns (private.rider_jobs_held). */
function riderJobsHeld(db: Db, riderId: string): number {
  // Orders sharing one delivery fee are one job.
  const orders = new Set(db.orders.filter((o) => o.riderId === riderId && ((o.status === 'dispatched' && !o.atCounterAt) || o.returnState === 'returning')).map(feeGroup))
  return orders.size + db.orders.filter((o) => o.claim && (o.claim.status === 'awaiting_pickup' || o.claim.status === 'returning') && db.claimDetails[o.claim.id]?.riderId === riderId).length
}

/** feeGroups.ts: orders sharing one delivery fee (private.fee_group). */
const feeGroup = (o: MockOrder) => feeGroupOf({ id: o.id, checkoutId: o.checkoutId ?? null, merchantId: o.merchantId, isPrize: o.isPrize })
/** On one trip with o: taken with it, or in the pool, the ready ones that would be (private.on_trip_with). */
const onTripWith = (s: MockOrder, o: MockOrder) =>
  s.id === o.id ||
  (feeGroup(s) === feeGroup(o) &&
    (o.riderId ? s.riderId === o.riderId && s.riderTakenAt === o.riderTakenAt : !s.riderId && s.status === 'dispatched' && !s.atCounterAt && o.status === 'dispatched' && !o.atCounterAt))
const tripSize = (db: Db, o: MockOrder) => largestSize(db.orders.filter((s) => onTripWith(s, o)).map((s) => packageSizeOf(db.listings.find((l) => l.id === s.listingId)!)))

/** payouts.ts payoutsFor decides; this records it. A line only ever moves forward. */
function syncPayouts(db: Db, now: number) {
  for (const d of payoutsFor(db.listings, db.orders, now)) {
    if (d.amountKobo <= 0) continue
    let line = db.payouts.find((p) => p.kind === d.kind && (d.orderId ? p.orderId === d.orderId : p.listingId === d.listingId))
    if (!line) {
      line = { id: uid('Y'), merchantId: d.merchantId, listingId: d.listingId, orderId: d.orderId, kind: d.kind, amountKobo: d.amountKobo, status: 'waiting', createdAt: iso(now), dueAt: null, paidAt: null, reference: null, paidTo: null }
      db.payouts.push(line)
    }
    if (d.due && line.status === 'waiting') Object.assign(line, { status: 'due', dueAt: iso(now) })
  }
}

/** A shared pickup's one fee follows all its draws (listing.ts settlePickupFee). */
function settlePickups(db: Db) {
  const batches = new Map<string, Listing[]>()
  for (const l of db.listings) if (l.pickupBatchId) batches.set(l.pickupBatchId, [...(batches.get(l.pickupBatchId) ?? []), l])
  for (const members of batches.values()) {
    const status = settlePickupFee(members.map((l) => l.status))
    for (const l of members) l.cautionFee = { ...l.cautionFee, status }
  }
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
  const me = db.viewer ?? ME
  const l = db.listings.find((x) => x.id === r.listingId)!
  const myNumbers = db.tickets.filter((t) => t.listingId === l.id && t.userId === me).map((t) => t.number)
  const myCreditKobo = db.ledger.filter((e) => e.userId === me && e.kind === 'store_credit' && e.listingId === l.id).reduce((s, e) => s + e.creditKobo, 0)
  return { ...r, productCode: l.productCode, listingTitle: l.title, listingImage: l.images[0] ?? null, ticketCount: l.ticketCount, iWon: r.winnerUserId === me, myNumbers, myCreditKobo }
}

/**
 * `full` is for the listing's own store and for admins. Buyers never see the
 * store's pickup address or phone number.
 */
/** discounts.ts: what a product costs now with a running sale and, if given, a code. */
function unitPrice(db: Db, l: Listing, codeId: string | null) {
  const t = db.clock ?? Date.now()
  const usable = db.discounts.filter((d) => d.listingIds.includes(l.id) && (d.kind === 'sale' || d.id === codeId) && discountActive(d, t))
  return l.kind === 'product' ? bestPrice(l.priceKobo, usable) : { unitKobo: l.priceKobo, discountId: null }
}

function listingSale(db: Db, l: Listing): ListingSale | null {
  const best = unitPrice(db, l, null)
  const d = db.discounts.find((x) => x.id === best.discountId)
  return d ? { priceKobo: best.unitKobo, percentOff: d.percentOff, amountOffKobo: d.amountOffKobo, endsAt: d.endsAt } : null
}

/** A CAC number only shows if the store chose to (shopProfile.ts). */
const publicMerchant = (m: Merchant): Merchant => ({ ...m, cacNumber: m.showCac ? m.cacNumber : '' })

function listingView(db: Db, l: Listing, audience: 'buyer' | 'full' = 'buyer'): ListingView {
  const merchant = db.merchants.find((m) => m.id === l.merchantId)!
  const myNumbers = db.tickets.filter((t) => t.listingId === l.id && t.userId === (db.viewer ?? ME)).map((t) => t.number)
  const r = db.results.find((x) => x.listingId === l.id)
  return { ...l, sale: listingSale(db, l), merchant: publicMerchant(merchant), handover: audience === 'full' ? l.handover : null, rejection: audience === 'full' ? l.rejection : null, pendingPriceKobo: audience === 'full' ? (db.priceReviews.find((r) => r.listingId === l.id)?.newPriceKobo ?? null) : null, myNumbers, result: r ? resultView(db, r) : null }
}

function conversationView(db: Db, c: MockConversation, me: ChatSide): ConversationView {
  const l = db.listings.find((x) => x.id === c.listingId)!
  const msgs = db.messages.filter((m) => m.conversationId === c.id)
  const last = msgs[msgs.length - 1]
  const readAt = me === 'buyer' ? c.buyerReadAt : c.sellerReadAt
  return {
    id: c.id, listingId: l.id, productCode: l.productCode, listingTitle: l.title, listingImage: l.images[0] ?? null, category: l.category,
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
  const tickets = l.kind === 'raffle' && (l.status === 'live' || l.status === 'sold_out' || l.status === 'drawn') ? db.tickets.filter((t) => t.listingId === l.id && inRange(t.purchasedAt)) : []
  const orders = db.orders.filter((o) => o.listingId === l.id && !o.isPrize && o.status !== 'cancelled' && inRange(o.createdAt))
  return {
    views: views.length,
    visitors: new Set(views.map((v) => v.visitor)).size,
    chats: db.conversations.filter((c) => c.listingId === l.id && inRange(c.lastMessageAt)).length,
    units: tickets.length + orders.reduce((n, o) => n + o.quantity, 0),
    // Demo crowd buyers count once per purchase.
    buyers: new Set(tickets.map((t) => (t.userId === CROWD ? t.purchaseId : t.userId))).size + new Set(orders.map((o) => o.buyerId)).size,
    salesKobo: tickets.length * l.buyerTicketPriceKobo + orders.reduce((s, o) => s + o.priceKobo, 0),
  }
}

/** `forBuyer`: the buyer's own screens, the only place a PIN may go. */
/** reviews.ts: a first name, never the account. */
function reviewView(db: Db, r: MockReview): ReviewView {
  const l = db.listings.find((x) => x.id === r.listingId)!
  const name = reviewerName(db.users.find((u) => u.id === r.userId)?.displayName ?? '')
  return { id: r.id, rating: r.rating, sellerComment: r.sellerComment, productComment: r.productComment, reply: r.reply, repliedAt: r.repliedAt, createdAt: r.createdAt, hidden: !!r.hiddenAt, name, listingId: r.listingId, listingTitle: l.title, productCode: l.productCode }
}

/** A store's team on the mock: its demo account(s), and anyone who joined by invite. */
function mockTeam(db: Db, merchantId: string): { userId: string; role: StoreRole }[] {
  const owners = DEMO_ACCOUNTS.filter((a) => a.role === 'store' && a.mockId === merchantId).map((a) => a.mockId)
  const invited = Object.entries(db.storeRoles).filter(([id, r]) => r.merchantId === merchantId && !owners.includes(id)).map(([id]) => id)
  return [...owners, ...invited].map((userId) => ({ userId, role: db.storeRoles[userId]?.role ?? 'owner' }))
}

type StoreSnapshot = { listings: Map<string, { status: string; revision: number; price: number; stock: number }>; orders: Map<string, { status: string; confirmedAt: string | null }> }

function storeSnapshot(db: Db, merchantId: string): StoreSnapshot {
  return {
    listings: new Map(db.listings.filter((l) => l.merchantId === merchantId).map((l) => [l.id, { status: l.status, revision: l.revision ?? 0, price: l.priceKobo, stock: l.stock }])),
    orders: new Map(db.orders.filter((o) => o.merchantId === merchantId).map((o) => [o.id, { status: o.status, confirmedAt: o.confirmedAt }])),
  }
}

/** Mirrors the listings and orders activity triggers: what one of the store's people changed. */
function logStoreActivity(db: Db, actor: { merchantId: string; name: string }, before: StoreSnapshot) {
  const at = new Date(db.clock ?? Date.now()).toISOString()
  const add = (action: string, listingId: string) => db.storeActivity.push({ id: `A-${db.storeActivity.length + 1}-${listingId}`, merchantId: actor.merchantId, who: actor.name, action, listingId, at })
  for (const l of db.listings.filter((x) => x.merchantId === actor.merchantId)) {
    const was = before.listings.get(l.id)
    if (!was) add('listed', l.id)
    else if (l.status === 'withdrawn' && was.status !== 'withdrawn') add('withdrew', l.id)
    else if (l.status === 'paused' && was.status !== 'paused') add('paused', l.id)
    else if (was.status === 'paused' && l.status === 'for_sale') add('resumed', l.id)
    else if ((l.revision ?? 0) > was.revision) add('edited', l.id)
    else if (l.priceKobo !== was.price) add('repriced', l.id)
    else if (l.stock !== was.stock) add('restocked', l.id)
  }
  for (const o of db.orders.filter((x) => x.merchantId === actor.merchantId)) {
    const was = before.orders.get(o.id)
    if (!was) continue
    if (o.confirmedAt && !was.confirmedAt) add('confirmed', o.listingId)
    else if (o.status === 'dispatched' && was.status !== 'dispatched') add('dispatched', o.listingId)
    else if (o.status === 'cancelled' && was.status !== 'cancelled') add('cancelled', o.listingId)
  }
}

/** storeApplications.ts storeAccountBlocker, for a mock account. */
function accountFacts(db: Db, userId: string) {
  const individual = db.sellerApplications[userId]
  return {
    isBuyer: !db.storeAccounts[userId] && !db.riderAccounts[userId] && db.users.some((u) => u.id === userId),
    sellsAsIndividual: !!db.sellerShops[userId] || (!!individual && individual.status !== 'rejected'),
    hasBought: db.tickets.some((t) => t.userId === userId) || db.orders.some((o) => o.buyerId === userId),
  }
}

/** Every rider: the demo ones (not counter staff), and accounts approved to ride. */
/** private.rider_done_jobs: handed to the buyer or a counter, in the last 30 days (riderStats filters by date). */
const riderDoneJobs = (db: Db, riderId: string): TimedJob[] =>
  db.orders
    .filter((o) => o.riderId === riderId && !o.returnState && (o.atCounterAt ?? o.deliveredAt))
    .map((o) => ({ collectedAt: o.collectedAt, doneAt: (o.atCounterAt ?? o.deliveredAt)!, windowEnd: o.windowEnd ?? null, redeliverAt: o.redeliveryChoice === 'redeliver' ? o.redeliverAt : null }))
const ratingsOf = (db: Db, riderId: string) => Object.values(db.deliveryRatings).filter((r) => r.riderId === riderId)
const riderIds = (db: Db) => [...DEMO_ACCOUNTS.filter((a) => a.role === 'delivery' && !a.pickupPointId).map((a) => a.mockId), ...Object.keys(db.riderAccounts)]
const riderName = (db: Db, id: string) => db.riderApplications[id]?.fullName ?? DEMO_ACCOUNTS.find((a) => a.mockId === id)?.name ?? 'Rider'
const riderCompleted = (db: Db, id: string) => db.orders.filter((o) => o.riderId === id && (o.status === 'delivered' || !!o.atCounterAt)).length
const riderTrusted = (db: Db, id: string) => {
  const t = db.riderTrust[id]
  return !!t?.trusted || !!db.riderFleets.find((f) => f.id === t?.fleetId)?.trusted
}
/** riderApplications.ts newRiderLimitError, for this rider and order. */
const riderLimit = (db: Db, id: string, o: MockOrder) => newRiderLimitError({ completed: riderCompleted(db, id), trusted: riderTrusted(db, id), orderKobo: o.priceKobo, isPrize: o.isPrize })
/** The same, for everything that comes with it (private.group_limit). */
const groupLimit = (db: Db, id: string, o: MockOrder) => {
  const trip = db.orders.filter((s) => onTripWith(s, o))
  return newRiderLimitError({ completed: riderCompleted(db, id), trusted: riderTrusted(db, id), orderKobo: trip.reduce((n, s) => n + s.priceKobo, 0), isPrize: trip.some((s) => s.isPrize) })
}

/** Open from collection until it's delivered, handed in, or goes back (private.delivery_chat_open). */
const chatOpen = (o: MockOrder) => o.status === 'dispatched' && o.fulfilment === 'delivery' && !!o.riderId && !!o.collectedAt && !o.atCounterAt
const riderCard = (db: Db, riderId: string) => ({ firstName: firstName(riderName(db, riderId)), photo: db.riderPhotos[riderId] ?? null })

function orderView(db: Db, order: MockOrder, forBuyer = false): OrderView {
  const { pin, riderId: _riderId, pinState: _pinState, paidCashKobo: _cash, paidCreditKobo: _credit, paidFeeCashKobo: _feeCash, paidFeeCreditKobo: _feeCredit, checkoutId: _checkoutId, confirmRemindedAt: _reminded, riderTakenAt: _taken, counterRemindedAt: _counterReminded, counterOutAt: _counterOut, windowAlertedAt: _alerted, ...o } = order
  const l = db.listings.find((x) => x.id === o.listingId)!
  const merchant = db.merchants.find((m) => m.id === o.merchantId)!
  const r = db.reviews.find((x) => x.orderId === o.id)
  const review = r ? { id: r.id, rating: r.rating, sellerComment: r.sellerComment, productComment: r.productComment, reply: r.reply, repliedAt: r.repliedAt, hidden: !!r.hiddenAt, createdAt: r.createdAt } : null
  const rated = forBuyer ? db.deliveryRatings[o.id] : undefined
  return { ...o, review, deliveryRating: rated ? { good: rated.good, reasons: rated.reasons, ratedAt: rated.ratedAt } : null, rider: forBuyer && chatOpen(order) ? riderCard(db, order.riderId!) : null, deliveryPin: forBuyer && o.status !== 'delivered' && o.status !== 'cancelled' ? pin : null, productCode: l.productCode, listingTitle: l.title, listingImage: l.images[0] ?? null, category: l.category, merchantName: merchant.name }
}

// -------------------------------------------------------------------- API

/**
 * Proof videos and receipts live only in memory, as they'd quickly fill localStorage.
 * They're gone after a reload; the record of what was sent isn't.
 */
const checkFiles = new Map<string, string>()

/**
 * A bulk upload's photos, in memory for the same reason: 50 products' worth would fill
 * localStorage. They show for the rest of the session and are blank after a reload.
 */
function keepBulkPhoto(src: string): string {
  if (!src.startsWith('data:') || typeof URL.createObjectURL !== 'function') return src
  const [head, body] = src.split(',')
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg' }))
}
function keepCheckFile(file: Blob | string | null): string | null {
  if (!file) return null
  const key = `check-${checkFiles.size + 1}-${Date.now()}`
  checkFiles.set(key, typeof file === 'string' ? file : typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '')
  return key
}

export interface MockOptions {
  store?: KeyValueStore
  /** Stores show proof on their first listings, then on spot checks. Tests turn these off. */
  listingChecks?: { firstListings: number; spotPercent: number }
  latencyMs?: number
  now?: () => number
  pushPublicKey?: string | null
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
      db.viewer = buyer()
      const t = now()
      db.clock = t
      processDeadlines(db, t)
      applyPendingLimits(db, t)
      await runDueDraws(db, t)
      settlePickups(db)
      syncPayouts(db, now()) // time alone can make a payout due
      const actor = teamMember(db)
      const before = actor ? storeSnapshot(db, actor.merchantId) : null
      const out = await fn(db)
      if (actor && before) logStoreActivity(db, actor, before)
      settlePickups(db)
      syncPayouts(db, now())
      delete db.viewer
      delete db.clock
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
    getSession: async () => {
      const s = readSession()
      // An approved store application: the account is now the store's.
      const db = s?.role === 'buyer' ? await load() : null
      const shop = db?.storeAccounts[s!.userId]
      if (s && db?.riderAccounts[s.userId]) {
        const next: AuthSession = { userId: s.userId, email: s.email, role: 'delivery' }
        store.setItem(SESSION_KEY, JSON.stringify(next))
        return next
      }
      if (!s || !shop) return s
      const next: AuthSession = { userId: shop, email: s.email, role: 'store' }
      store.setItem(SESSION_KEY, JSON.stringify(next))
      return next
    },
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
      // Stores sign in as their store: userId is the store id on the mock.
      const db = a.role === 'buyer' ? await load() : null
      const shop = db?.storeAccounts[a.mockId]
      setSession(shop ? { userId: shop, email: a.email, role: 'store' } : db?.riderAccounts[a.mockId] ? { userId: a.mockId, email: a.email, role: 'delivery' } : { userId: a.mockId, email: a.email, role: a.role })
    },
    async signOut() {
      setSession(null)
    },
  }

  /** The buyer the call acts for: whoever is signed in, or buyer@ when nobody is. */
  function buyer(): string {
    const s = readSession()
    return s?.role === 'buyer' ? s.userId : ME
  }
  const me = (db: Db) => db.users.find((u) => u.id === buyer())!
  /** Whose notifications and devices these are: a store's own, or a buyer's. */
  const inbox = () => (readSession()?.role === 'store' || readSession()?.role === 'delivery' ? readSession()!.userId : buyer())
  const hasInbox = () => { const role = readSession()?.role; return !role || role === 'buyer' || role === 'store' || role === 'delivery' }
  const addressesOf = (db: Db) => sortAddresses(db.addresses[buyer()] ?? [])
  const makeDefault = (list: SavedAddress[], id: string) => {
    for (const a of list) a.isDefault = a.id === id
  }
  /** The pickup location a counter account works at (counter.ts). */
  const counterPoint = () => (readSession()?.role === 'delivery' ? (DEMO_ACCOUNTS.find((a) => a.mockId === readSession()!.userId)?.pickupPointId ?? null) : null)
  function counter(): string {
    rider()
    const point = counterPoint()
    if (!point) throw new ApiError('forbidden', 'Only pickup counter staff can do this.')
    return point
  }
  /** The buyer, or the rider carrying it: nobody else has this chat. */
  function chatParty(db: Db, orderId: string): { o: MockOrder; me: 'buyer' | 'rider' } {
    const s = readSession()
    const o = db.orders.find((x) => x.id === orderId)
    const me = !o ? null : s?.role === 'delivery' ? (o.riderId === s.userId ? 'rider' : null) : o.buyerId === buyer() && (!s || s.role === 'buyer') ? 'buyer' : null
    if (!o || !me) throw new ApiError('not_found', 'That order doesn’t exist.')
    return { o, me }
  }
  /** The order this rider is at the door with (private.door_order). */
  function doorOrder(db: Db, orderId: string): MockOrder {
    const o = db.orders.find((x) => x.id === orderId && x.riderId === rider() && x.status === 'dispatched' && x.collectedAt)
    if (!o) throw new ApiError('invalid_input', 'Only deliveries you’re carrying can be marked.')
    if (o.fulfilment !== 'delivery') throw new ApiError('invalid_input', 'Hand pickup orders to the counter staff.')
    if (o.isPrize) throw new ApiError('invalid_input', 'Won items can’t be marked as not delivered. Contact DrawMart.')
    if (o.failedAttempts === 1 && o.redeliveryChoice !== 'redeliver') throw new ApiError('invalid_input', 'The buyer hasn’t chosen a new time yet.')
    return o
  }
  /** take_delivery: within the job limit and the new-rider limits. */
  function takeOne(db: Db, me: string, orderId: string) {
    if (counterPoint()) throw new ApiError('forbidden', 'Counter staff don’t take deliveries.')
    const full = takeJobError(riderJobsHeld(db, me))
    if (full) throw new ApiError('invalid_input', full)
    const limited = db.orders.find((x) => x.id === orderId)
    const limit = limited && groupLimit(db, me, limited)
    if (limit) throw new ApiError('invalid_input', limit)
    const o = db.orders.find((x) => x.id === orderId && !x.riderId && ((x.status === 'dispatched' && !x.atCounterAt) || waitingAtCounter(x)))
    if (!o) throw new ApiError('invalid_input', 'Another rider has taken this delivery.')
    takeGroup(db, me, o)
  }
  /** private.take_group: the order and every one ready on the same fee, in the same place. */
  function takeGroup(db: Db, riderId: string, o: MockOrder) {
    const tooSoon = o.status === 'dispatched' ? takeTooSoonError(o.windowStart ?? null, now()) : null
    if (tooSoon) throw new ApiError('invalid_input', tooSoon)
    const at = iso(now())
    const same = (x: MockOrder) => (waitingAtCounter(o) ? waitingAtCounter(x) : x.status === 'dispatched' && !x.atCounterAt)
    for (const x of db.orders.filter((x) => x.id === o.id || (feeGroup(x) === feeGroup(o) && !x.riderId && same(x)))) {
      Object.assign(x, { riderId, riderTakenAt: at })
      if (x.isPrize) x.collectedAt = at
    }
  }
  /** Admins, or nobody signed in (the demo). */
  function requireAdmin() {
    const role = readSession()?.role
    if (role && role !== 'admin') throw new ApiError('forbidden', 'Only admins can do this.')
  }
  /** A rider paid through the app: not counter staff. */
  function payee(): string {
    const me = rider()
    if (counterPoint()) throw new ApiError('forbidden', 'Only sellers can add a bank account.')
    return me
  }
  function rider(): string {
    const s = readSession()
    if (s?.role !== 'delivery') throw new ApiError('forbidden', 'Only delivery accounts can do this.')
    return s.userId
  }
  /** The shop whose side of chats the signed-in user sees, if any. */
  const myShop = (db: Db): string | null => {
    const role = readSession()?.role
    if (role === undefined) return MY_MERCHANT
    if (role === 'store') return readSession()!.userId
    return role === 'buyer' ? (db.sellerShops[buyer()] ?? null) : null
  }
  /** As buyer if the signed-in user is the demo buyer; otherwise as the shop. */
  const sideIn = (db: Db, c: MockConversation): ChatSide | null => {
    const role = readSession()?.role
    if ((role === 'buyer' || role === undefined) && c.buyerId === buyer()) return 'buyer'
    if (c.merchantId === myShop(db)) return 'seller'
    return null
  }
  /** Who on a store's team is signed in, if anyone (team.ts). Demo store accounts sign in as their store. */
  function teamMember(db: Db): { userId: string; merchantId: string; role: StoreRole; name: string } | null {
    const s = readSession()
    if (s?.role !== 'store') return null
    const account = DEMO_ACCOUNTS.find((a) => a.email === s.email)
    if (!account) return null
    return { userId: account.mockId, merchantId: s.userId, role: db.storeRoles[account.mockId]?.role ?? 'owner', name: account.name }
  }
  /** private.require_shop_permission. Individual sellers own their shop. */
  function requireShopPermission(db: Db, perm: ShopPermission) {
    const m = teamMember(db)
    if (m && !canDo(m.role, perm)) throw new ApiError('forbidden', perm === 'bank' || perm === 'team' ? 'Only the store’s owner can do this.' : 'Your role in this store doesn’t include this. Ask the owner.')
  }
  /** A code this buyer can use now, or why not (discounts.ts). */
  function usableCode(db: Db, code: string) {
    const d = db.discounts.find((x) => x.kind === 'code' && x.code === normalizeCode(code))
    if (!d || Date.parse(d.startsAt) > now()) throw new ApiError('invalid_input', 'That code isn’t valid.')
    if (d.endedAt || Date.parse(d.endsAt) <= now()) throw new ApiError('invalid_input', 'That code has ended.')
    if (d.maxUses !== null && d.uses >= d.maxUses) throw new ApiError('invalid_input', 'That code has been used up.')
    if (db.discountRedemptions.some((r) => r.discountId === d.id && r.userId === buyer())) throw new ApiError('invalid_input', 'You’ve already used that code.')
    return d
  }
  /** Buyers who bought a ticket or an item in the last 30 days. */
  const activeBuyerCount = (db: Db) => {
    const monthAgo = iso(now() - 30 * DAY)
    return new Set(db.ledger.filter((e) => (e.kind === 'ticket_purchase' || e.kind === 'order_payment') && e.createdAt > monthAgo).map((e) => e.userId)).size
  }
  /** Checks and adds one message (messages.ts messageError, MAX_MESSAGES_PER_MINUTE). */
  function postMessage(db: Db, c: MockConversation, side: ChatSide, body: string): ChatMessage {
    const problem = messageError(body)
    if (problem) throw new ApiError('invalid_input', problem)
    const minuteAgo = iso(now() - 60_000)
    if (db.messages.filter((m) => m.conversationId === c.id && m.sender === side && m.createdAt > minuteAgo).length >= MAX_MESSAGES_PER_MINUTE)
      throw new ApiError('invalid_input', 'You’re sending messages very fast. Wait a moment.')
    const at = iso(now())
    const msg: ChatMessage = { id: uid('X'), conversationId: c.id, sender: side, body: body.trim(), createdAt: at }
    db.messages.push(msg)
    if (side === 'buyer' && !db.notifications.some((n) => n.kind === 'store_new_message' && n.listingId === c.listingId && !n.read)) {
      notifyShop(db, getListingOr404(db, c.listingId).merchantId, 'store_new_message', c.listingId, at)
    }
    c.lastMessageAt = at
    if (side === 'buyer') c.buyerReadAt = at
    else c.sellerReadAt = at
    return msg
  }
  const conversationOr404 = (db: Db, id: string) => {
    const c = db.conversations.find((x) => x.id === id)
    const side = c ? sideIn(db, c) : null
    if (!c || !side) throw new ApiError('not_found', 'That conversation doesn’t exist.')
    return { c, side }
  }
  /** The shop being managed: the demo buyer's own once approved, otherwise the demo store. */
  const shopId = (db: Db) => {
    const s = readSession()
    if (s?.role === 'store') return s.userId
    if (s?.role !== 'buyer') return MY_MERCHANT
    const shop = db.sellerShops[s.userId]
    if (!shop) throw new ApiError('forbidden', 'Get verified as a seller to list products.')
    return shop
  }
  /** This store's saved items, unless they've expired. */
  function savedPickupOf(db: Db): SavedPickupView | null {
    const shop = shopId(db)
    const saved = db.savedPickups[shop]
    if (saved && Date.parse(saved.expiresAt) <= now()) delete db.savedPickups[shop]
    return db.savedPickups[shop] ?? null
  }

  /** Checks one draw item and adds it for review, with its own pickup booking and fee. */
  const raffleProblems = (input: NewListingInput) => [
    ...validateListingEconomics(input).map((e) => LISTING_ERROR_TEXT[e]),
    ...validateListingTerms(input).map((e) => LISTING_TERMS_ERROR_TEXT[e]),
    ...validateHandover(input.handover, localDate(new Date(now()))).map((e) => HANDOVER_ERROR_TEXT[e]),
  ]

  async function addRaffle(db: Db, input: NewListingInput): Promise<Listing> {
    if (readSession()?.role === 'buyer') throw new ApiError('forbidden', 'Only registered stores can run raffle draws.')
    if (db.merchants.find((m) => m.id === shopId(db))?.suspendedAt) throw new ApiError('forbidden', 'Your shop is suspended. Contact DrawMart.')
    const problems = raffleProblems(input)
    if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
    // DrawMart sets the fee from the item's value; the store never chooses it.
    const feeBps = platformFeeBps(input.priceKobo)
    const econ = computeListingEconomics({ ...input, feeBps })
    const seed = createSeed()
    const id = uid('L')
    db.seeds[id] = seed
    const at = now()
    const listing: Listing = {
      id, productCode: newProductCode(), kind: 'raffle', merchantId: shopId(db), title: input.title.trim(), description: input.description.trim(), category: input.category, images: input.images ?? [],
      priceKobo: input.priceKobo, ticketPriceKobo: input.ticketPriceKobo, buyerTicketPriceKobo: econ.buyerTicketKobo,
      ticketCount: econ.ticketCount, ticketsSold: 0, stock: 1, feeMode: input.feeMode, feeBps,
      unsoldPolicy: input.unsoldPolicy, fallbackPriceKobo: input.unsoldPolicy === 'convert_to_sale' ? input.fallbackPriceKobo! : null,
      durationDays: input.durationDays, extended: false, status: 'pending_review',
      handover: { ...input.handover, address: input.handover.address.trim(), method: handoverMethodFor(input.category) },
      // In test mode the fee is recorded, not charged. A real backend takes it before booking the pickup.
      cautionFee: { amountKobo: cautionFeeFor(input.category), status: 'held' },
      commitment: await commitmentFor(seed), createdAt: iso(at), closesAt: iso(at + input.durationDays * DAY), boostedUntil: null, soldOutAt: null, drawAt: null, pickupBatchId: null,
    }
    db.listings.push(listing)
    return listing
  }

  /** Stands in for the bank's lookup. Numbers starting 000 aren't found, to try that path. */
  const mockAccountName = (bankCode: string, accountNumber: string) => {
    const problem = accountNumberError(accountNumber)
    if (problem) throw new ApiError('invalid_input', problem)
    if (!bankCode) throw new ApiError('invalid_input', 'Pick a bank from the list.')
    if (accountNumber.startsWith('000')) throw new ApiError('invalid_input', 'We couldn’t find that account. Check the bank and number.')
    return `TEST ACCOUNT ${accountNumber.slice(-4)}`
  }

  const payoutView = (db: Db, p: Db['payouts'][number]): PayoutLineView => {
    const l = getListingOr404(db, p.listingId)
    return { ...p, listingTitle: l.title, productCode: l.productCode }
  }

  /** Tells anyone who saved it if it's now cheaper (savedAlerts.ts priceDropped). */
  function applyPrice(db: Db, l: Listing, priceKobo: Kobo) {
    const dropped = l.status === 'for_sale' && priceKobo < l.priceKobo
    l.priceKobo = priceKobo
    l.feeBps = platformFeeBps(priceKobo)
    if (dropped) for (const userId of saversOf(db, l.id)) alertSaved(db, userId, l.id, l, 'saved_price_drop', now())
  }

  const checkSettings = opts.listingChecks ?? { firstListings: 5, spotPercent: 10 }
  // listingChecks.ts: individuals always; stores for their first listings, or when the code came with a spot check.
  const videoRequired = (db: Db, shop: Merchant) =>
    shop.kind === 'individual' || db.listings.filter((l) => l.merchantId === shop.id && l.kind === 'product').length < checkSettings.firstListings || !!db.checkTickets[shop.id]?.videoRequired || (db.owedChecks[shop.id] ?? 0) > 0
  const newSellerProgress = (db: Db, shop: Merchant) => ({
    individual: shop.kind === 'individual',
    deliveries: db.orders.filter((o) => o.merchantId === shop.id && o.status === 'delivered' && !o.refundedAt && !o.isPrize).length,
    live: db.listings.filter((l) => l.merchantId === shop.id && (l.status === 'pending_review' || l.status === 'for_sale' || l.status === 'paused')).length,
  })
  const limitFor = (db: Db, l: Listing, priceKobo: Kobo) => {
    const shop = db.merchants.find((m) => m.id === l.merchantId)!
    return newSellerLimitError({ ...newSellerProgress(db, shop), priceKobo, adding: 0 })
  }

  const ownListing = (db: Db, id: string) => {
    const l = getListingOr404(db, id)
    if (l.merchantId !== shopId(db)) throw new ApiError('not_found', 'That listing doesn’t exist.')
    return l
  }

  /** Checks new details like a new listing, then saves them. The caller sets the status. */
  function setListingDetails(db: Db, l: Listing, input: NewListingInput | NewProductInput) {
    const details = { title: input.title.trim(), description: input.description.trim(), category: input.category, images: input.images ?? [], priceKobo: input.priceKobo }
    if (l.kind === 'product') {
      const problems = validateProduct(input).map((e) => PRODUCT_ERROR_TEXT[e])
      if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
      const limit = limitFor(db, l, input.priceKobo)
      if (limit) throw new ApiError('invalid_input', limit)
      Object.assign(l, details, { stock: (input as NewProductInput).stock ?? l.stock, packageSize: (input as NewProductInput).packageSize ?? l.packageSize ?? null, feeBps: platformFeeBps(input.priceKobo), closesAt: iso(now()) })
      return
    }
    const raffle = input as NewListingInput
    const problems = raffleProblems(raffle)
    if (l.pickupBatchId && handoverMethodFor(input.category) === 'inspection') problems.push(PICKUP_ERROR_TEXT.cars_not_allowed)
    if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
    const feeBps = platformFeeBps(input.priceKobo)
    const econ = computeListingEconomics({ ...raffle, feeBps })
    const amountKobo = resentCautionFee(l.cautionFee.amountKobo, input.category)
    Object.assign(l, details, {
      ticketPriceKobo: raffle.ticketPriceKobo, buyerTicketPriceKobo: econ.buyerTicketKobo, ticketCount: econ.ticketCount,
      feeMode: raffle.feeMode, feeBps, unsoldPolicy: raffle.unsoldPolicy,
      fallbackPriceKobo: raffle.unsoldPolicy === 'convert_to_sale' ? raffle.fallbackPriceKobo! : null,
      durationDays: raffle.durationDays, closesAt: iso(now() + raffle.durationDays * DAY),
      handover: { ...raffle.handover, address: raffle.handover.address.trim(), method: handoverMethodFor(input.category) },
      cautionFee: { ...l.cautionFee, amountKobo },
    })
    // Every item in a shared pickup shows the same fee.
    for (const m of db.listings) if (l.pickupBatchId && m.pickupBatchId === l.pickupBatchId) m.cautionFee = { ...m.cautionFee, amountKobo }
  }

  const getListingOr404 = (db: Db, id: string) => {
    const l = db.listings.find((x) => x.id === id)
    if (!l) throw new ApiError('not_found', 'That listing doesn’t exist.')
    return l
  }

  return {
    testMode: true,
    pushPublicKey: opts.pushPublicKey ?? null,
    auth,

    getCurrentUser: () => tx((db) => ({ ...me(db) })),

    updateProfile: (patch) =>
      tx((db) => {
        const phone = patch.phone?.trim()
        if (phone && !isNigerianMobile(phone)) throw new ApiError('invalid_input', 'Enter a Nigerian mobile number, e.g. 0803 123 4567.')
        const name = patch.displayName?.trim()
        Object.assign(me(db), {
          ...(patch.state !== undefined ? { state: patch.state } : {}),
          ...(name ? { displayName: name } : {}),
          ...(patch.phone !== undefined ? { phone: phone || null } : {}),
        })
        return { ...me(db) }
      }),

    listAddresses: () => tx((db) => addressesOf(db)),

    saveAddress: (input: SavedAddressInput) =>
      tx((db) => {
        if (readSession() && readSession()!.role !== 'buyer') throw new ApiError('forbidden', 'Only buyer accounts save delivery addresses.')
        const problems = validateSavedAddress(input).map((e) => SAVED_ADDRESS_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const list = (db.addresses[buyer()] ??= [])
        const fields = { label: input.label.trim(), address: input.address.trim(), location: input.location!, contactPhone: input.contactPhone.trim() }
        if (input.id) {
          const a = list.find((x) => x.id === input.id)
          if (!a) throw new ApiError('not_found', 'That address doesn’t exist.')
          Object.assign(a, fields)
          if (input.makeDefault) makeDefault(list, a.id)
        } else {
          if (list.length >= MAX_SAVED_ADDRESSES) throw new ApiError('invalid_input', `You can save up to ${MAX_SAVED_ADDRESSES} addresses. Remove one to add another.`)
          const a: SavedAddress = { id: uid('A'), ...fields, isDefault: list.length === 0 }
          list.push(a)
          if (input.makeDefault) makeDefault(list, a.id)
        }
        return addressesOf(db)
      }),

    setDefaultAddress: (id) =>
      tx((db) => {
        const list = db.addresses[buyer()] ?? []
        if (!list.some((a) => a.id === id)) throw new ApiError('not_found', 'That address doesn’t exist.')
        makeDefault(list, id)
        return addressesOf(db)
      }),

    deleteAddress: (id) =>
      tx((db) => {
        const list = (db.addresses[buyer()] ?? []).filter((a) => a.id !== id)
        if (list.length && !list.some((a) => a.isDefault)) list[0].isDefault = true
        db.addresses[buyer()] = list
        return addressesOf(db)
      }),

    listListings: (filter: ListingFilter = {}) =>
      tx((db) => {
        const statuses = filter.status ?? ['live']
        return db.listings
          .filter((l) => statuses.includes(l.status) && (!filter.category || l.category === filter.category) && (!filter.merchantId || l.merchantId === filter.merchantId))
          .map((l) => listingView(db, l))
          .sort((a, b) => {
            if (a.status !== b.status) return a.status === 'live' ? -1 : 1
            const share = (l: { ticketsSold: number; ticketCount: number }) => (l.ticketCount ? l.ticketsSold / l.ticketCount : 0)
            return share(b) - share(a)
          })
      }),

    getListing: (id) => tx((db) => listingView(db, getListingOr404(db, id))),

    buyTickets: (listingId, quantity) =>
      tx(async (db) => {
        const user = me(db)
        const listing = getListingOr404(db, listingId)
        const mine = db.ledger.filter((e) => e.userId === buyer())
        const balance = balanceFromLedger(mine)
        const held = db.tickets.filter((t) => t.listingId === listingId && t.userId === buyer()).length
        const err = checkPurchase({ user, listing, quantity, ticketsAlreadyHeld: held, balance, spentThisWeekKobo: spentInLastWeek(mine, new Date(now())) })
        if (err) throw new ApiError(err, PURCHASE_ERROR_TEXT[err])

        const costKobo = quantity * listing.buyerTicketPriceKobo
        const { fromCash, fromCredit } = splitPayment(costKobo, balance)
        const purchaseId = `P-${randomHex(3).toUpperCase()}`
        const at = iso(now())
        const numbers: number[] = []
        const soldBefore = listing.ticketsSold
        for (let i = 0; i < quantity; i++) {
          listing.ticketsSold += 1
          numbers.push(listing.ticketsSold)
          db.tickets.push({ id: uid('T'), listingId, userId: buyer(), number: listing.ticketsSold, purchaseId, purchasedAt: at })
        }
        db.ledger.push({
          id: uid('E'), userId: buyer(), kind: 'ticket_purchase', cashKobo: -fromCash, creditKobo: -fromCredit,
          memo: `${quantity} ${quantity === 1 ? 'ticket' : 'tickets'} · ${listing.title}`, listingId, createdAt: at,
        })
        const soldOut = listing.ticketsSold === listing.ticketCount
        if (soldOut) closeTicketSales(db, listing, purchaseId, now())
        if (crossedAlmostSold(soldBefore, listing.ticketsSold, listing.ticketCount)) {
          for (const userId of saversOf(db, listing.id)) alertSaved(db, userId, listing.id, listing, 'saved_almost_sold', now())
        }
        return { purchaseId, numbers, costKobo, soldOut, drawAt: listing.drawAt }
      }),

    listMyListings: () =>
      tx((db) => {
        const ids = new Set(db.tickets.filter((t) => t.userId === buyer()).map((t) => t.listingId))
        return db.listings.filter((l) => ids.has(l.id)).map((l) => listingView(db, l))
      }),

    listResults: () =>
      tx((db) => db.results.map((r) => resultView(db, r)).sort((a, b) => b.drawnAt.localeCompare(a.drawnAt))),

    listCart: () =>
      tx((db) =>
        (db.carts[buyer()] ?? []).map((id) => {
          const listing = listingView(db, getListingOr404(db, id))
          const wanted = db.cartQuantities[buyer()]?.[id] ?? 1
          const quantity = clampQuantity(listing, wanted)
          return { listing, quantity, wanted, amountKobo: lineAmountKobo(listing, quantity) }
        }),
      ),

    addToCart: (listingId, quantity = 1) =>
      tx((db) => {
        const l = getListingOr404(db, listingId)
        if (readSession() && readSession()!.role !== 'buyer') throw new ApiError('forbidden', 'Only buyer accounts have a cart.')
        if (l.merchantId === db.sellerShops[buyer()]) throw new ApiError('forbidden', 'You can’t buy your own item.')
        const problem = cartError(listingView(db, l))
        if (problem) throw new ApiError('invalid_input', CART_ERROR_TEXT[problem])
        if (l.status !== 'for_sale' && db.orders.some((o) => o.listingId === l.id && o.buyerId === buyer())) throw new ApiError('invalid_input', 'You’ve already arranged this item.')
        const tooMany = quantityError(l, quantity)
        if (tooMany) throw new ApiError('invalid_input', tooMany)
        ;(db.cartQuantities[buyer()] ??= {})[l.id] = quantity
        const cart = (db.carts[buyer()] ??= [])
        if (!cart.includes(l.id)) cart.push(l.id)
      }),

    removeFromCart: (listingId) =>
      tx((db) => {
        db.carts[buyer()] = (db.carts[buyer()] ?? []).filter((id) => id !== listingId)
      }),

    getPushPreferences: () => tx((db) => ({ ...DEFAULT_PUSH_PREFERENCES, ...db.pushPreferences[inbox()] })),

    setPushPreference: (category, enabled) =>
      tx((db) => {
        if (!hasInbox()) throw new ApiError('forbidden', 'Only buyer, store and delivery accounts have this setting.')
        if (!Object.keys(DEFAULT_PUSH_PREFERENCES).includes(category)) throw new ApiError('invalid_input', 'That isn’t a kind of notification.')
        db.pushPreferences[inbox()] = { ...DEFAULT_PUSH_PREFERENCES, ...db.pushPreferences[inbox()], [category]: enabled }
      }),

    savePushSubscription: (subscription) =>
      tx((db) => {
        if (!hasInbox()) throw new ApiError('forbidden', 'Only buyer, store and delivery accounts have this setting.')
        if (!pushSubscriptionValid(subscription)) throw new ApiError('invalid_input', 'This device’s notification details don’t look right.')
        db.pushSubscriptions = db.pushSubscriptions.filter((s) => s.endpoint !== subscription.endpoint)
        db.pushSubscriptions.push({ ...subscription, userId: inbox() })
      }),

    deletePushSubscription: (endpoint) =>
      tx((db) => {
        db.pushSubscriptions = db.pushSubscriptions.filter((s) => !(s.endpoint === endpoint && s.userId === inbox()))
      }),

    listWinnersWall: () =>
      tx((db) =>
        db.winnerStories
          .filter((s) => s.status === 'approved')
          .flatMap((s) => {
            const r = db.results.find((x) => x.listingId === s.listingId)
            const l = db.listings.find((x) => x.id === s.listingId)
            return r && l ? [{ id: s.id, firstName: s.firstName!, listingId: l.id, productCode: l.productCode, listingTitle: l.title, listingImage: l.images[0] ?? null, category: l.category, winningNumber: r.winningNumber, ticketCount: l.ticketCount, drawnAt: r.drawnAt }] : []
          })
          .sort((a, b) => b.drawnAt.localeCompare(a.drawnAt))
          .slice(0, 60),
      ),

    listMyWinnerStories: () =>
      tx((db) =>
        db.winnerStories.flatMap((s) =>
          s.userId === buyer() && s.status !== 'withdrawn'
            ? [{ listingId: s.listingId, listingTitle: getListingOr404(db, s.listingId).title, firstName: s.firstName!, status: s.status, consentAt: s.consentAt }]
            : [],
        ),
      ),

    shareWinnerStory: ({ listingId, firstName, consent }) =>
      tx((db) => {
        if (readSession() && readSession()!.role !== 'buyer') throw new ApiError('forbidden', 'Only buyer accounts have wins to share.')
        const problem = winnerStoryError({ firstName, consent })
        if (problem) throw new ApiError('invalid_input', WINNER_STORY_ERROR_TEXT[problem])
        if (!db.results.some((r) => r.listingId === listingId && r.winnerUserId === buyer())) throw new ApiError('forbidden', 'Only the winner of a draw can share it.')
        const at = iso(now())
        const existing = db.winnerStories.find((s) => s.userId === buyer() && s.listingId === listingId)
        const fields = { firstName: firstName.trim(), status: 'pending' as const, consentVersion: WINNER_CONSENT_VERSION, consentAt: at, withdrawnAt: null }
        if (existing) Object.assign(existing, fields)
        else db.winnerStories.push({ id: uid('W'), userId: buyer(), listingId, ...fields })
        db.winnerConsentLog.push({ userId: buyer(), listingId, event: 'given', consentVersion: WINNER_CONSENT_VERSION, at })
      }),

    withdrawWinnerStory: (listingId) =>
      tx((db) => {
        const s = db.winnerStories.find((x) => x.userId === buyer() && x.listingId === listingId && x.status !== 'withdrawn')
        if (!s) return
        const at = iso(now())
        Object.assign(s, { status: 'withdrawn', firstName: null, withdrawnAt: at })
        db.winnerConsentLog.push({ userId: buyer(), listingId, event: 'withdrawn', consentVersion: s.consentVersion, at })
      }),

    listPendingWinnerStories: () =>
      tx((db) => {
        if (readSession() && readSession()!.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
        return db.winnerStories.flatMap((s) => {
          if (s.status !== 'pending') return []
          const l = getListingOr404(db, s.listingId)
          return [{ id: s.id, firstName: s.firstName!, listingId: l.id, productCode: l.productCode, listingTitle: l.title, consentAt: s.consentAt }]
        })
      }),

    reviewWinnerStory: (id, approve) =>
      tx((db) => {
        if (readSession() && readSession()!.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
        const s = db.winnerStories.find((x) => x.id === id && x.status === 'pending')
        if (!s) throw new ApiError('invalid_input', 'That story is no longer waiting for review. The winner may have withdrawn it.')
        s.status = approve ? 'approved' : 'rejected'
      }),

    listSavedIds: () => tx((db) => db.saved[buyer()] ?? []),

    listSavedListings: () =>
      tx((db) =>
        (db.saved[buyer()] ?? []).flatMap((id) => {
          const l = db.listings.find((x) => x.id === id)
          return l && canSaveListing(l.status) ? [listingView(db, l)] : []
        }),
      ),

    saveListing: (listingId) =>
      tx((db) => {
        const l = getListingOr404(db, listingId)
        if (readSession() && readSession()!.role !== 'buyer') throw new ApiError('forbidden', 'Only buyer accounts can save items.')
        if (!canSaveListing(l.status)) throw new ApiError('not_found', 'That item doesn’t exist.')
        const saved = (db.saved[buyer()] ??= [])
        if (!saved.includes(l.id)) saved.unshift(l.id)
      }),

    unsaveListing: (listingId) =>
      tx((db) => {
        db.saved[buyer()] = (db.saved[buyer()] ?? []).filter((id) => id !== listingId)
      }),

    listPickupPoints: () => tx(() => PICKUP_POINTS),

    checkout: ({ listingIds, quantities = {}, expectedTotalKobo, code, window: chosenWindow, ...details }) =>
      tx((db) => {
        const codeDiscount = code?.trim() ? usableCode(db, code) : null
        const codePrices: Record<string, Kobo> = {}
        if (!listingIds.length) throw new ApiError('invalid_input', 'Your cart is empty.')
        if (new Set(listingIds).size !== listingIds.length) throw new ApiError('not_found', 'One of those items no longer exists.')
        const listings = listingIds.map((id) => getListingOr404(db, id))
        const views = listings.map((l) => listingView(db, l))
        const problems = validateCheckout(details, views.some(isCar)).map((e) => CHECKOUT_ERROR_TEXT[e])
        if (chosenWindow) problems.push(details.fulfilment === 'delivery' ? windowError(chosenWindow, now()) ?? '' : 'Delivery windows are only for delivery.')
        if (chosenWindow && views.some(isCar)) problems.push('Cars are arranged with the dealer, so there’s no delivery window.')
        const times = chosenWindow ? windowTimes(chosenWindow) : null
        if (problems.some(Boolean)) throw new ApiError('invalid_input', problems.filter(Boolean).join(' '))
        for (const v of views) {
          if (v.merchantId === db.sellerShops[buyer()]) throw new ApiError('forbidden', 'You can’t buy your own item.')
          if (lineAmountKobo(v) === null) throw new ApiError('not_for_sale', `${v.title} isn’t for sale any more.`)
          const tooMany = quantityError(v, quantities[v.id] ?? 1)
          if (tooMany) throw new ApiError('invalid_input', tooMany)
          if (isCar(v) && views.length > 1) throw new ApiError('invalid_input', 'Cars are arranged on their own, not with other items.')
          if (isWonPrize(v) && db.orders.some((o) => o.listingId === v.id)) throw new ApiError('invalid_input', `${v.title} has already been arranged.`)
        }
        const to = details.fulfilment === 'pickup' ? PICKUP_POINTS.find((p) => p.id === details.pickupPointId)?.location : details.delivery.location
        if (codeDiscount)
          for (const l of listings) if (l.status === 'for_sale' && codeDiscount.listingIds.includes(l.id)) codePrices[l.id] = unitPrice(db, l, codeDiscount.id).unitKobo
        const fees = to ? checkoutDeliveryFees(views, to, db.deliveryPricing) : []
        const grandTotal = checkoutTotalKobo(views, (v) => quantities[v.id] ?? 1, codePrices) + fees.reduce((n, f) => n + f.feeKobo, 0)
        if (expectedTotalKobo !== undefined && expectedTotalKobo !== grandTotal) throw new ApiError('invalid_input', 'A price has just changed. Check the new total.')
        const mine = db.ledger.filter((e) => e.userId === buyer())
        let balance = balanceFromLedger(mine)
        if (balance.cashKobo + balance.creditKobo < grandTotal) throw new ApiError('insufficient_funds', ORDER_ERROR_TEXT.insufficient_funds)

        const at = iso(now())
        const pickup = details.fulfilment === 'pickup'
        const pickupPoint = pickup ? (PICKUP_POINTS.find((p) => p.id === details.pickupPointId) ?? null) : null
        if (pickup && !pickupPoint) throw new ApiError('invalid_input', CHECKOUT_ERROR_TEXT.pickup_point_required)
        const checkoutId = uid('C')
        let codeUsed = false
        const unpaid = new Map(fees.map((f) => [f.merchantId, f.feeKobo]))
        const orders = listings.map((l, i) => {
          const v = views[i]
          const prize = isWonPrize(v)
          const quantity = quantities[v.id] ?? 1
          const price = lineAmountKobo(v, quantity, codePrices)!
          const used = prize || l.kind !== 'product' ? null : unitPrice(db, l, codeDiscount?.id ?? null)
          if (used?.discountId && used.discountId === codeDiscount?.id) codeUsed = true
          let paid = { fromCash: 0, fromCredit: 0 }
          let paidFee = { fromCash: 0, fromCredit: 0 }
          const deliveryFeeKobo = prize ? 0 : (unpaid.get(l.merchantId) ?? 0)
          if (!prize) unpaid.delete(l.merchantId)
          if (!prize) {
            const pay = splitPayment(price, balance)
            paid = pay
            balance = { cashKobo: balance.cashKobo - pay.fromCash, creditKobo: balance.creditKobo - pay.fromCredit }
            db.ledger.push({ id: uid('E'), userId: buyer(), kind: 'order_payment', cashKobo: -pay.fromCash, creditKobo: -pay.fromCredit, memo: `Bought · ${l.title}${quantity > 1 ? ` × ${quantity}` : ''}`, listingId: l.id, createdAt: at })
            if (deliveryFeeKobo > 0) {
              paidFee = splitPayment(deliveryFeeKobo, balance)
              balance = { cashKobo: balance.cashKobo - paidFee.fromCash, creditKobo: balance.creditKobo - paidFee.fromCredit }
              db.ledger.push({ id: uid('E'), userId: buyer(), kind: 'delivery_fee', cashKobo: -paidFee.fromCash, creditKobo: -paidFee.fromCredit, memo: `Delivery · ${l.title}`, listingId: l.id, createdAt: at })
            }
            const taken = takeStock(l.stock, quantity)
            l.stock = taken.stock
            if (taken.soldOut) l.status = 'sold'
          }
          const order: MockOrder = {
            pin: newDeliveryPin(), riderId: null, pinState: { attempts: 0, lockedUntil: null }, paidCashKobo: paid.fromCash, paidCreditKobo: paid.fromCredit, paidFeeCashKobo: paidFee.fromCash, paidFeeCreditKobo: paidFee.fromCredit, checkoutId, deliveryFeeKobo,
            cancelledAt: null, cancelReason: null, cancelNote: null, confirmRemindedAt: null, atCounterAt: null, arrivedAt: null, failedAttempts: 0, lastFailedAt: null, redeliveryChoice: null, redeliverAt: null,
            confirmBy: prize ? null : confirmDeadline(now()), confirmedAt: null, confirmPhoto: null, windowStart: times?.start ?? null, windowEnd: times?.end ?? null,
            refundedAt: null, claim: null, readyBy: null, collectedAt: null, collectionPhotos: null, collectionProblems: null, refusalPhoto: null, returnState: null, returnedAt: null,
            discountKobo: used ? quantity * l.priceKobo - price : 0,
            id: uid('O'), listingId: l.id, buyerId: buyer(), merchantId: l.merchantId, quantity, priceKobo: price, feeKobo: prize ? 0 : saleEconomics(price, l.feeBps).feeKobo,
            delivery: pickup ? { address: '', location: null, contactPhone: details.delivery.contactPhone.trim() } : { address: details.delivery.address.trim(), location: details.delivery.location, contactPhone: details.delivery.contactPhone.trim() },
            fulfilment: details.fulfilment, pickupPoint, isPrize: prize, handledBy: prize && !isCar(l) ? 'drawmart' : 'store',
            status: 'paid', createdAt: at, dispatchedAt: null, deliveredAt: null,
          }
          db.orders.push(order)
          if (order.handledBy === 'store') notifyShop(db, order.merchantId, 'store_new_order', order.listingId, at)
          return orderView(db, order, true)
        })
        if (codeDiscount) {
          if (!codeUsed) throw new ApiError('invalid_input', 'That code isn’t for anything you’re buying.')
          codeDiscount.uses += 1
          db.discountRedemptions.push({ discountId: codeDiscount.id, userId: buyer() })
        }
        db.carts[buyer()] = (db.carts[buyer()] ?? []).filter((id) => !listingIds.includes(id))
        return orders
      }),

    listMyOrders: () =>
      tx((db) => db.orders.filter((o) => o.buyerId === buyer()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => orderView(db, o, true))),

    getRiderAreas: () => tx((db) => db.riderAreas[rider()] ?? []),

    setRiderAreas: (areas) =>
      tx((db) => {
        const me = rider()
        const problem = riderAreasError(areas)
        if (problem) throw new ApiError('invalid_input', problem)
        db.riderAreas[me] = [...areas]
      }),

    listDeliveryJobs: () =>
      tx((db): DeliveryJob[] => {
        const me = rider()
        return db.orders
          .filter((o) => (o.status === 'dispatched' && !o.riderId && !o.atCounterAt) || (waitingAtCounter(o) && !o.riderId) || (o.riderId === me && (o.status === 'dispatched' || o.status === 'delivered' || o.returnState === 'returning')))
          .sort((a, b) => (b.deliveredAt ?? '9').localeCompare(a.deliveredAt ?? '9') || (a.dispatchedAt ?? '').localeCompare(b.dispatchedAt ?? ''))
          .map((o) => {
            const l = db.listings.find((x) => x.id === o.listingId)!
            const merchant = db.merchants.find((m) => m.id === o.merchantId)!
            const carrying = o.riderId === me && o.status === 'dispatched' && !!o.collectedAt && !o.atCounterAt
            return {
              id: o.id, quantity: o.quantity, confirmPhoto: o.confirmPhoto, collected: !!o.collectedAt, returning: o.returnState === 'returning', productCode: l.productCode, listingTitle: l.title, listingImage: l.images[0] ?? null, category: l.category, fulfilment: o.fulfilment, status: o.status,
              dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt, mine: !!o.riderId,
              collectKey: waitingAtCounter(o) ? `point:${o.pickupPoint?.id}` : o.handledBy === 'drawmart' ? 'drawmart' : `shop:${o.merchantId}`,
              feeGroup: feeGroup(o),
              collectBy: o.riderId === me && o.status === 'dispatched' && !o.collectedAt && o.riderTakenAt ? collectBy(o.riderTakenAt) : null,
              atCounterAt: o.status === 'dispatched' || o.status === 'delivered' ? o.atCounterAt : null, waitingAtCounter: waitingAtCounter(o),
              arrivedAt: o.arrivedAt ?? null, failedAttempts: o.failedAttempts, awaitingBuyer: o.status === 'dispatched' && o.failedAttempts === 1 && !o.redeliveryChoice,
              redeliverAt: o.redeliveryChoice === 'redeliver' ? o.redeliverAt : null,
              windowStart: o.windowStart ?? null, windowEnd: o.windowEnd ?? null,
              ...poolFields(db, o),
              locked: !o.riderId && !!riderLimit(db, me, o),
              collectFrom: o.handledBy === 'drawmart' ? { name: 'DrawMart escrow', area: 'Lagos' } : { name: merchant.name, area: merchant.area, ...(o.riderId === me && ((o.status === 'dispatched' && !o.collectedAt) || o.returnState === 'returning') ? db.shopPickups[o.merchantId] : {}) },
              pickupPoint: o.pickupPoint,
              dropOff: carrying ? { buyerName: db.users.find((u) => u.id === o.buyerId)?.displayName ?? 'Buyer', address: o.delivery.address, location: o.delivery.location, contactPhone: o.delivery.contactPhone } : null,
              pinLockedUntil: o.status === 'dispatched' && o.pinState.lockedUntil && Date.parse(o.pinState.lockedUntil) > now() ? o.pinState.lockedUntil : null,
            }
          })
      }),

    takeDelivery: (orderId) => tx((db) => takeOne(db, rider(), orderId)),

    takeDeliveries: (orderIds) =>
      tx((db) => {
        const me = rider()
        if (orderIds.length < 2 || new Set(orderIds).size !== orderIds.length) throw new ApiError('invalid_input', 'Choose two or more different jobs.')
        const groups = new Set(db.orders.filter((x) => orderIds.includes(x.id)).map(feeGroup))
        const room = tripRoomError(riderJobsHeld(db, me), groups.size)
        if (room) throw new ApiError('invalid_input', room)
        // All or none, like take_deliveries: a failure part-way leaves the stored data as it was.
        for (const id of orderIds) if (db.orders.find((x) => x.id === id)?.riderId !== me) takeOne(db, me, id)
      }),

    releaseDelivery: (orderId) =>
      tx((db) => {
        const me = rider()
        const back = db.orders.find((x) => x.id === orderId && x.riderId === me && waitingAtCounter(x))
        if (back) {
          for (const x of db.orders.filter((x) => feeGroup(x) === feeGroup(back) && x.riderId === me && waitingAtCounter(x))) Object.assign(x, { riderId: null, riderTakenAt: null })
          return
        }
        const o = db.orders.find((x) => x.id === orderId && x.status === 'dispatched' && x.riderId === me && !x.atCounterAt)
        if (!o) throw new ApiError('invalid_input', 'Only deliveries you’re carrying can be handed back.')
        // The whole group goes back together.
        for (const x of db.orders.filter((x) => feeGroup(x) === feeGroup(o) && x.riderId === me && x.status === 'dispatched' && !x.atCounterAt)) {
          Object.assign(x, { riderId: null, riderTakenAt: null, collectedAt: null, collectionPhotos: null })
        }
        alertNewJob(db, o, me, now())
      }),

    confirmDelivery: (orderId, pin) =>
      tx((db) => {
        const me = rider()
        if (db.orders.some((x) => x.id === orderId && x.riderId === me && x.fulfilment === 'pickup')) throw new ApiError('invalid_input', 'Hand pickup orders to the counter staff. They complete them with the buyer.')
        const o = db.orders.find((x) => x.id === orderId && x.status === 'dispatched' && x.riderId === me && x.collectedAt)
        if (!o) throw new ApiError('invalid_input', 'Only deliveries you’re carrying can be confirmed.')
        if (!isDeliveryPin(pin)) throw new ApiError('invalid_input', 'Enter the buyer’s 6-digit PIN.')
        const { result, state } = checkPin(o.pin, pin, o.pinState, now())
        o.pinState = state
        if (result.confirmed) {
          o.status = 'delivered'
          o.deliveredAt = iso(now())
          earn(db, me, 'delivery', o.id, o, sellerArea(db, o), buyerArea(o), now())
        }
        return result
      }),

    getRiderProfile: () => tx((db) => riderCard(db, rider())),

    getRiderLevel: () =>
      tx((db) => {
        const me = rider()
        return { completed: riderCompleted(db, me), trusted: riderTrusted(db, me), jobsToUnlock: NEW_RIDER_JOBS, maxKobo: NEW_RIDER_MAX_KOBO }
      }),

    getRiderSignupsOpen: () => tx((db) => db.riderSignupsOpen),

    getMyRiderApplication: () => tx((db) => db.riderApplications[buyer()] ?? null),

    submitRiderApplication: (input) =>
      tx((db) => {
        const me = buyer()
        if (!db.riderSignupsOpen) throw new ApiError('invalid_input', 'Rider sign-up isn’t open yet.')
        const facts = accountFacts(db, me)
        const blocker = riderAccountBlocker({ ...facts, appliedAsStore: !!db.storeApplications[me] && db.storeApplications[me].status !== 'rejected' })
        if (blocker) throw new ApiError('invalid_input', blocker)
        const prev = db.riderApplications[me]
        if (prev?.status === 'pending') throw new ApiError('invalid_input', 'Your application is already being reviewed.')
        if (prev?.status === 'approved') throw new ApiError('invalid_input', 'You’re already approved.')
        const problems = validateRiderApplication(input).map((e) => RIDER_APPLICATION_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const at = iso(now())
        db.riderApplications[me] = {
          id: prev?.id ?? uid('A'), status: 'pending', fullName: input.fullName.trim(), nin: input.nin.trim(), phone: input.phone.trim(), address: input.address.trim(), area: input.area,
          vehicle: input.vehicle, plate: input.vehicle === 'bicycle' ? null : input.plate.toUpperCase().replace(/[\s-]/g, ''), guarantorName: input.guarantorName.trim(), guarantorPhone: input.guarantorPhone.trim(),
          guarantorRelationship: input.guarantorRelationship.trim(), idPhotoUrl: input.idPhoto, selfieUrl: input.selfiePhoto, reviewNote: null, createdAt: prev?.createdAt ?? at, updatedAt: at, reviewedAt: null,
        }
        return db.riderApplications[me]
      }),

    setRiderSignupsOpen: (open) =>
      tx((db) => {
        requireAdmin()
        db.riderSignupsOpen = open
      }),

    listRiderApplications: () =>
      tx((db) => {
        requireAdmin()
        return Object.values(db.riderApplications).filter((a) => a.status === 'pending').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      }),

    approveRiderApplication: (applicationId) =>
      tx((db) => {
        requireAdmin()
        const [userId, a] = Object.entries(db.riderApplications).find(([, x]) => x.id === applicationId) ?? []
        if (!userId || !a || a.status !== 'pending') throw new ApiError('invalid_input', 'Only applications waiting for review can be approved.')
        if (riderAccountBlocker({ ...accountFacts(db, userId), appliedAsStore: false }))
          throw new ApiError('invalid_input', 'This account has bought or sold on DrawMart since applying, so it can’t become a rider’s. Ask them to apply from a new account.')
        db.riderAccounts[userId] = true
        delete db.carts[userId]
        delete db.saved[userId]
        Object.assign(a, { status: 'approved', reviewedAt: iso(now()) })
        notify(db, userId, 'rider_approved', null, iso(now()))
      }),

    rejectRiderApplication: (applicationId, note) =>
      tx((db) => {
        requireAdmin()
        if (note.trim().length < 5) throw new ApiError('invalid_input', 'Tell the applicant what to fix.')
        const a = Object.values(db.riderApplications).find((x) => x.id === applicationId)
        if (!a || a.status !== 'pending') throw new ApiError('invalid_input', 'Only applications waiting for review can be rejected.')
        Object.assign(a, { status: 'rejected', reviewNote: note.trim(), reviewedAt: iso(now()) })
      }),

    listRiderFleets: () =>
      tx((db) => {
        requireAdmin()
        return [...db.riderFleets].sort((a, b) => a.name.localeCompare(b.name))
      }),

    createRiderFleet: (name, contactPhone) =>
      tx((db) => {
        requireAdmin()
        if (name.trim().length < 2) throw new ApiError('invalid_input', 'Enter the fleet’s name.')
        if (!isNigerianMobile(contactPhone)) throw new ApiError('invalid_input', 'Enter a Nigerian mobile number, e.g. 0803 123 4567.')
        db.riderFleets.push({ id: uid('F'), name: name.trim(), contactPhone: contactPhone.trim(), trusted: false })
      }),

    setFleetTrusted: (fleetId, trusted) =>
      tx((db) => {
        requireAdmin()
        const f = db.riderFleets.find((x) => x.id === fleetId)
        if (!f) throw new ApiError('not_found', 'That fleet doesn’t exist.')
        f.trusted = trusted
      }),

    listRiders: () =>
      tx((db): AdminRider[] => {
        requireAdmin()
        return riderIds(db)
          .map((id) => ({ id, name: riderName(db, id), photo: db.riderPhotos[id] ?? null, fleetId: db.riderTrust[id]?.fleetId ?? null, trusted: !!db.riderTrust[id]?.trusted, completed: riderCompleted(db, id), holding: riderJobsHeld(db, id), joinedAt: db.riderApplications[id]?.reviewedAt ?? '2026-10-01T00:00:00.000Z' }))
          .sort((a, b) => a.name.localeCompare(b.name))
      }),

    reportIncident: (kind, id, type, at) =>
      tx((db) => {
        const me = rider()
        const o = kind === 'delivery' ? db.orders.find((x) => x.id === id && x.riderId === me && ((x.status === 'dispatched' && !x.atCounterAt) || x.returnState === 'returning')) : undefined
        const claimed = kind === 'return' ? db.orders.find((x) => x.claim?.id === id && db.claimDetails[id]?.riderId === me && (x.claim.status === 'awaiting_pickup' || x.claim.status === 'returning')) : undefined
        if (!o && !claimed) throw new ApiError('invalid_input', 'You can only report a problem on a job you have.')
        const open = openIncident(db, o ? { orderId: id } : { claimId: id })
        if (open) return open.id
        const incident: MockIncident = { id: uid('I'), orderId: o ? id : null, claimId: o ? null : id, riderId: me, type, note: null, photo: null, location: at, createdAt: iso(now()), resolvedAt: null, outcome: null }
        db.incidents.push(incident)
        if (o) o.pausedAt = incident.createdAt
        return incident.id
      }),

    addIncidentDetails: (incidentId, d) =>
      tx((db) => {
        const i = db.incidents.find((x) => x.id === incidentId && x.riderId === rider() && !x.resolvedAt)
        if (!i) throw new ApiError('invalid_input', 'That report has been closed. Call DrawMart if you need help.')
        const problem = incidentNoteError(d.note ?? '')
        if (problem) throw new ApiError('invalid_input', problem)
        Object.assign(i, { note: d.note?.trim() || i.note, photo: d.photo ?? i.photo, location: d.at ?? i.location })
      }),

    getMyOpenIncidents: () =>
      tx((db) => {
        const me = rider()
        return Object.fromEntries(db.incidents.filter((i) => i.riderId === me && !i.resolvedAt).map((i) => [(i.orderId ?? i.claimId)!, { id: i.id, type: i.type, createdAt: i.createdAt }]))
      }),

    listOpenIncidents: () =>
      tx((db): OpenIncident[] => {
        requireAdmin()
        return db.incidents
          .filter((i) => !i.resolvedAt)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((i) => {
            const o = db.orders.find((x) => (i.orderId ? x.id === i.orderId : x.claim?.id === i.claimId))!
            const l = getListingOr404(db, o.listingId)
            return {
              id: i.id, kind: i.orderId ? 'delivery' : 'return', orderId: o.id, type: i.type, createdAt: i.createdAt, note: i.note, photo: i.photo, location: i.location,
              productCode: l.productCode, listingTitle: l.title, isPrize: o.isPrize, orderStatus: o.status, collected: !!o.collectedAt,
              rider: { id: i.riderId, name: riderName(db, i.riderId), phone: db.riderApplications[i.riderId]?.phone ?? db.users.find((u) => u.id === i.riderId)?.phone ?? null },
            }
          })
      }),

    resolveIncident: (incidentId, outcome, note) =>
      tx((db) => {
        requireAdmin()
        const i = db.incidents.find((x) => x.id === incidentId && !x.resolvedAt)
        if (!i) throw new ApiError('not_found', 'That incident is already closed.')
        const o = db.orders.find((x) => (i.orderId ? x.id === i.orderId : x.claim?.id === i.claimId))!
        const problem = resolveIncidentError(outcome, { kind: i.orderId ? 'delivery' : 'return', isPrize: o.isPrize, status: o.status })
        if (problem) throw new ApiError('invalid_input', problem)
        const at = now()
        if (outcome === 'refund') {
          cancelOrderNow(db, o, 'incident', note, at)
          // incidents.ts sellerStillPaid: it left the seller as it should.
          if (sellerStillPaid(!!o.collectedAt) && o.priceKobo - o.feeKobo > 0 && !db.payouts.some((p) => p.orderId === o.id && p.kind === 'sale'))
            db.payouts.push({ id: uid('Y'), merchantId: o.merchantId, listingId: o.listingId, orderId: o.id, kind: 'sale', amountKobo: o.priceKobo - o.feeKobo, status: 'due', createdAt: iso(at), dueAt: iso(at), paidAt: null, reference: null, paidTo: null })
        }
        Object.assign(i, { resolvedAt: iso(at), outcome })
        // Not yet collected: a fresh collection window, for the whole trip.
        if (i.orderId && o.status === 'dispatched' && o.riderId && !o.collectedAt) {
          const was = o.riderTakenAt
          for (const x of db.orders) if (x.riderId === o.riderId && x.riderTakenAt === was && x.status === 'dispatched' && !x.collectedAt) x.riderTakenAt = iso(at)
        }
        if (i.claimId && o.claim?.status === 'awaiting_pickup' && db.claimDetails[i.claimId]) db.claimDetails[i.claimId].takenAt = iso(at)
        if (i.orderId) o.pausedAt = null
      }),

    rateDelivery: (orderId, good, reasons) =>
      tx((db) => {
        const me = buyer()
        const o = db.orders.find((x) => x.id === orderId && x.buyerId === me)
        const l = o && db.listings.find((x) => x.id === o.listingId)
        if (!o || !l || !o.riderId || !canRateDelivery({ ...o, category: l.category }, now())) throw new ApiError('invalid_input', 'You can rate a delivery to your door for 7 days after it arrives.')
        const problem = ratingError(good, reasons)
        if (problem) throw new ApiError('invalid_input', problem)
        db.deliveryRatings[o.id] = { riderId: o.riderId, buyerId: me, good, reasons: [...reasons], ratedAt: iso(now()) }
      }),

    getMyRiderStats: () =>
      tx((db) => {
        const me = rider()
        return riderStats(riderDoneJobs(db, me), ratingsOf(db, me), now())
      }),

    getRiderPerformance: () =>
      tx((db): RiderPerformanceRow[] => {
        requireAdmin()
        const at = now()
        return riderIds(db)
          .map((id) => {
            const ratings = ratingsOf(db, id)
            const recentDowns = Object.entries(db.deliveryRatings)
              .filter(([, r]) => r.riderId === id && !r.good && Date.parse(r.ratedAt) > at - STATS_DAYS * DAY)
              .sort(([, a], [, b]) => b.ratedAt.localeCompare(a.ratedAt))
              .slice(0, 5)
              .map(([orderId, r]) => ({ orderId, productCode: getListingOr404(db, db.orders.find((o) => o.id === orderId)!.listingId).productCode, ratedAt: r.ratedAt, reasons: r.reasons }))
            const name = riderName(db, id)
            return { ...riderPerformance(riderDoneJobs(db, id), ratings, at), name, rider: { id, name, phone: db.riderApplications[id]?.phone ?? db.users.find((u) => u.id === id)?.phone ?? null }, recentDowns }
          })
          .sort((a, b) => a.name.localeCompare(b.name))
      }),

    getDispatchBoard: () =>
      tx((db): DispatchBoard => {
        requireAdmin()
        const at = now()
        const riderOf = (id: string | null | undefined) => (id ? { id, name: riderName(db, id), phone: db.riderApplications[id]?.phone ?? db.users.find((u) => u.id === id)?.phone ?? null } : null)
        const jobs = db.orders.flatMap((o): DispatchJob[] => {
          const l = getListingOr404(db, o.listingId)
          const shop = db.merchants.find((m) => m.id === o.merchantId)!
          const common = { orderId: o.id, productCode: l.productCode, listingTitle: l.title, listingImage: l.images[0] ?? null, shopName: o.handledBy === 'drawmart' ? 'DrawMart escrow' : shop.name, isPrize: o.isPrize, fulfilment: o.fulfilment }
          const out: DispatchJob[] = []
          const st = orderStage({ status: o.status, hasRider: !!o.riderId, riderTakenAt: o.riderTakenAt ?? null, dispatchedAt: o.dispatchedAt, collectedAt: o.collectedAt, atCounterAt: o.atCounterAt, counterOutAt: o.counterOutAt ?? null, returnState: o.returnState, failedAttempts: o.failedAttempts, lastFailedAt: o.lastFailedAt, cancelledAt: o.cancelledAt, windowStart: o.windowStart })
          if (st) {
            const { fromArea, toArea } = poolFields(db, o)
            out.push({
              ...common, kind: 'delivery', id: o.id, ...st, stuck: dispatchStuck(st.stage, st.since, at), fromArea, toArea, pickupPointName: o.pickupPoint?.name ?? null,
              failedAttempts: o.failedAttempts, awaitingBuyer: o.status === 'dispatched' && o.failedAttempts === 1 && !o.redeliveryChoice, redeliverAt: o.redeliveryChoice === 'redeliver' ? o.redeliverAt : null, windowStart: o.windowStart ?? null, windowEnd: o.windowEnd ?? null, rider: riderOf(o.riderId),
            })
          }
          const d = o.claim ? db.claimDetails[o.claim.id] : undefined
          const cs = o.claim && d ? claimStage({ status: o.claim.status, hasRider: !!d.riderId, riderTakenAt: d.takenAt ?? null, openedAt: d.openedAt ?? null, pickedUpAt: d.pickedUpAt ?? null }) : null
          if (o.claim && d && cs) {
            out.push({
              ...common, kind: 'return', id: o.claim.id, ...cs, stuck: dispatchStuck(cs.stage, cs.since, at), fromArea: nearestArea(d.location, DELIVERY_AREAS), toArea: sellerArea(db, o), pickupPointName: null,
              failedAttempts: 0, awaitingBuyer: false, redeliverAt: null, windowStart: null, windowEnd: null, rider: riderOf(d.riderId),
            })
          }
          return out
        })
        // Stuck first, then the longest waiting (private.dispatch_board).
        jobs.sort((a, b) => Number(b.stuck) - Number(a.stuck) || (a.since ?? '~').localeCompare(b.since ?? '~'))
        return { ...DEFAULT_STUCK_LIMITS, maxJobs: MAX_RIDER_JOBS, jobs }
      }),

    assignJob: (kind, id, riderId) =>
      tx((db) => {
        requireAdmin()
        if (!riderIds(db).includes(riderId)) throw new ApiError('not_found', 'That rider doesn’t exist.')
        const full = assignJobError(riderJobsHeld(db, riderId))
        if (full) throw new ApiError('invalid_input', full)
        const o =
          kind === 'delivery'
            ? db.orders.find((x) => x.id === id && !x.riderId && ((x.status === 'dispatched' && !x.atCounterAt) || waitingAtCounter(x)))
            : db.orders.find((x) => x.claim?.id === id && x.claim.status === 'awaiting_pickup' && !db.claimDetails[id]?.riderId)
        const limit = o && (kind === 'delivery' ? groupLimit(db, riderId, o) : riderLimit(db, riderId, o))
        if (limit) throw new ApiError('invalid_input', `This rider is new. ${limit}`)
        if (!o) throw new ApiError('invalid_input', `Only ${kind === 'delivery' ? 'jobs' : 'returns'} waiting in the pool can be assigned. A rider may have just taken it.`)
        if (kind === 'delivery') {
          takeGroup(db, riderId, o)
        } else {
          Object.assign(db.claimDetails[id], { riderId, takenAt: iso(now()) })
        }
        notify(db, riderId, 'rider_job_assigned', o.listingId, iso(now()))
      }),

    unassignJob: (kind, id) =>
      tx((db) => {
        requireAdmin()
        if (kind === 'delivery') {
          const o = db.orders.find((x) => x.id === id && x.riderId && ((x.status === 'dispatched' && !x.atCounterAt && !x.collectedAt) || waitingAtCounter(x)))
          if (!o?.riderId) throw new ApiError('invalid_input', 'Only jobs the rider hasn’t collected yet can be taken back.')
          const was = o.riderId
          const trip = db.orders.filter((x) => onTripWith(x, o) && ((x.status === 'dispatched' && !x.atCounterAt && !x.collectedAt) || waitingAtCounter(x)))
          for (const x of trip) Object.assign(x, { riderId: null, riderTakenAt: null, collectionPhotos: null })
          notify(db, was, 'rider_job_taken_back', o.listingId, iso(now()))
          alertNewJob(db, o, was, now())
        } else {
          const o = db.orders.find((x) => x.claim?.id === id && x.claim.status === 'awaiting_pickup')
          const was = db.claimDetails[id]?.riderId
          if (!o || !was) throw new ApiError('invalid_input', 'Only returns the rider hasn’t collected yet can be taken back.')
          Object.assign(db.claimDetails[id], { riderId: null, takenAt: null })
          notify(db, was, 'rider_job_taken_back', o.listingId, iso(now()))
          alertNewReturn(db, o, was, now())
        }
      }),

    setRiderFleet: (riderId, fleetId) =>
      tx((db) => {
        requireAdmin()
        if (!riderIds(db).includes(riderId)) throw new ApiError('not_found', 'That rider doesn’t exist.')
        if (fleetId && !db.riderFleets.some((f) => f.id === fleetId)) throw new ApiError('not_found', 'That fleet doesn’t exist.')
        db.riderTrust[riderId] = { trusted: db.riderTrust[riderId]?.trusted ?? false, fleetId }
      }),

    setRiderTrusted: (riderId, trusted) =>
      tx((db) => {
        requireAdmin()
        if (!riderIds(db).includes(riderId)) throw new ApiError('not_found', 'That rider doesn’t exist.')
        db.riderTrust[riderId] = { fleetId: db.riderTrust[riderId]?.fleetId ?? null, trusted }
      }),

    setRiderPhoto: (photo) =>
      tx((db) => {
        const me = rider()
        if (!/^(https:\/\/|\/assets\/|data:image\/)/.test(photo)) throw new ApiError('invalid_input', 'Take a photo of yourself.')
        db.riderPhotos[me] = photo
      }),

    getDeliveryChat: (orderId) =>
      tx((db) => {
        const { o, me } = chatParty(db, orderId)
        if (!chatOpen(o)) return { open: false, me, rider: null, messages: [] }
        return {
          open: true,
          me,
          rider: riderCard(db, o.riderId!),
          messages: db.deliveryMessages.filter((m) => m.orderId === o.id && m.riderId === o.riderId).map(({ id, sender, body, createdAt }) => ({ id, sender, body, createdAt })),
        }
      }),

    sendDeliveryMessage: (orderId, body) =>
      tx((db) => {
        const { o, me } = chatParty(db, orderId)
        if (!chatOpen(o)) throw new ApiError('invalid_input', 'This chat has closed.')
        const problem = deliveryMessageError(body)
        if (problem) throw new ApiError('invalid_input', problem)
        const recent = db.deliveryMessages.filter((m) => m.orderId === o.id && m.sender === me && Date.parse(m.createdAt) > now() - 60_000).length
        if (recent >= MAX_MESSAGES_PER_MINUTE) throw new ApiError('invalid_input', 'You’re sending messages too quickly. Wait a moment.')
        db.deliveryMessages.push({ id: uid('D'), orderId: o.id, riderId: o.riderId!, sender: me, body: body.trim(), createdAt: iso(now()) })
      }),

    markArrived: (orderId) =>
      tx((db) => {
        const o = doorOrder(db, orderId)
        o.arrivedAt ??= iso(now())
        return o.arrivedAt
      }),

    failDeliveryAttempt: (orderId, photo, at) =>
      tx((db) => {
        const o = doorOrder(db, orderId)
        const problem = attemptError({ arrivedAt: o.arrivedAt ?? null, nowMs: now(), photos: [photo], at, dropOff: o.delivery.location }) ?? photosError([photo])
        if (problem) throw new ApiError('invalid_input', problem)
        earn(db, rider(), 'failed_attempt', `${o.id}:${o.failedAttempts}`, o, null, null, now())
        if (o.failedAttempts === 0) {
          Object.assign(o, { failedAttempts: 1, lastFailedAt: iso(now()), arrivedAt: null, redeliveryChoice: null, redeliverAt: null })
          notify(db, o.buyerId, 'order_delivery_failed', o.listingId, iso(now()))
        } else {
          Object.assign(o, { failedAttempts: 2, lastFailedAt: iso(now()) })
          returnUndelivered(db, o, now())
        }
      }),

    chooseRedelivery: (orderId, choice) =>
      tx((db) => {
        const o = db.orders.find((x) => x.id === orderId && x.buyerId === buyer())
        if (!o) throw new ApiError('not_found', 'That order doesn’t exist.')
        if (o.status !== 'dispatched' || o.failedAttempts !== 1 || o.redeliveryChoice) throw new ApiError('invalid_input', 'This order doesn’t need a new time.')
        if (Date.parse(o.lastFailedAt!) + CHOOSE_WITHIN_HOURS * 3_600_000 <= now()) throw new ApiError('invalid_input', 'The time to choose has passed.')
        if ('pickupPointId' in choice) {
          const point = PICKUP_POINTS.find((pp) => pp.id === choice.pickupPointId)
          if (!point) throw new ApiError('invalid_input', 'Choose a pickup location.')
          Object.assign(o, { fulfilment: 'pickup', pickupPoint: point, delivery: { ...o.delivery, address: '', location: null }, redeliveryChoice: 'pickup' })
        } else {
          const problem = redeliveryWindowError(choice.windowStart, o.lastFailedAt!, now())
          if (problem) throw new ApiError('invalid_input', problem)
          Object.assign(o, { redeliveryChoice: 'redeliver', redeliverAt: new Date(choice.windowStart).toISOString() })
        }
        if (o.riderId) notify(db, o.riderId, 'rider_redelivery_chosen', o.listingId, iso(now()))
      }),

    getRiderPayRates: () =>
      tx((db) => {
        requireAdmin()
        return db.riderPayRates
      }),

    setRiderPay: (areaA, areaB, payKobo) =>
      tx((db) => {
        requireAdmin()
        const [a, b] = areaA <= areaB ? [areaA, areaB] : [areaB, areaA]
        const row = db.riderPayRates.pays.find((p) => p.areaA === a && p.areaB === b)
        if (!row) throw new ApiError('not_found', 'That area doesn’t exist.')
        const problem = pairPayError(db.deliveryPricing, a, b, payKobo)
        if (problem) throw new ApiError('invalid_input', problem)
        row.payKobo = payKobo
      }),

    setRiderSizeExtra: (size, extraKobo) =>
      tx((db) => {
        requireAdmin()
        const problem = riderPayError(extraKobo, db.deliveryPricing.sizeExtras[size])
        if (problem) throw new ApiError('invalid_input', problem)
        db.riderPayRates.sizeExtras[size] = extraKobo
      }),

    setRiderAttemptPay: (payKobo) =>
      tx((db) => {
        requireAdmin()
        const problem = attemptPayError(payKobo)
        if (problem) throw new ApiError('invalid_input', problem)
        db.riderPayRates.attemptKobo = payKobo
      }),

    listMyEarnings: () =>
      tx((db): RiderEarning[] => {
        const me = rider()
        return db.riderEarnings
          .filter((e) => e.riderId === me)
          .sort((a, b) => b.earnedAt.localeCompare(a.earnedAt))
          .map(({ riderId: _r, sourceKey: _s, paidBy: _p, ...e }) => e)
      }),

    listRiderPayDue: () =>
      tx((db) => {
        requireAdmin()
        const due = payableNow(db.riderEarnings, now()) as typeof db.riderEarnings
        return [...new Set(due.map((e) => e.riderId))].map((riderId) => ({
          riderId,
          riderName: riderName(db, riderId),
          account: db.riderPayoutAccounts[riderId] ?? null,
          lines: due.filter((e) => e.riderId === riderId).sort((a, b) => a.earnedAt.localeCompare(b.earnedAt)).map(({ riderId: _r, sourceKey: _s, paidBy: _p, ...e }) => e),
        }))
      }),

    markRiderPaid: (riderId, reference) =>
      tx((db) => {
        requireAdmin()
        const lines = (payableNow(db.riderEarnings, now()) as typeof db.riderEarnings).filter((e) => e.riderId === riderId)
        if (!lines.length) throw new ApiError('invalid_input', 'This rider has nothing due from finished weeks.')
        const a = db.riderPayoutAccounts[riderId]
        if (!a) throw new ApiError('invalid_input', 'This rider hasn’t added a bank account yet.')
        if (!accountPayable(a, now())) throw new ApiError('invalid_input', 'This rider changed their bank account recently, so pay is on hold.')
        if (reference.trim().length < MIN_REFERENCE_LENGTH) throw new ApiError('invalid_input', 'Enter the transfer’s reference.')
        for (const e of lines) Object.assign(e, { paidAt: iso(now()), reference: reference.trim(), paidTo: `${a.bankName} ${maskAccountNumber(a.accountNumber)}`, paidBy: readSession()!.userId })
        notify(db, riderId, 'rider_paid', null, iso(now()))
      }),

    getMyCounter: () =>
      tx(() => {
        rider()
        const point = counterPoint()
        return point ? (PICKUP_POINTS.find((pp) => pp.id === point) ?? null) : null
      }),

    listCounterItems: () =>
      tx((db): CounterItem[] => {
        const point = counter()
        return db.orders
          .filter((o) => o.fulfilment === 'pickup' && o.pickupPoint?.id === point && ((o.status === 'dispatched' && (o.atCounterAt || (o.riderId && o.collectedAt))) || waitingAtCounter(o)))
          .sort((a, b) => (a.atCounterAt ?? '').localeCompare(b.atCounterAt ?? '') || (a.dispatchedAt ?? '').localeCompare(b.dispatchedAt ?? ''))
          .map((o) => {
            const l = db.listings.find((x) => x.id === o.listingId)!
            const shelf = !!o.atCounterAt && o.status === 'dispatched'
            return {
              id: o.id, productCode: l.productCode, listingTitle: l.title, listingImage: l.images[0] ?? null, category: l.category, quantity: o.quantity,
              stage: !o.atCounterAt ? 'incoming' : shelf ? 'shelf' : 'send_back', atCounterAt: o.atCounterAt,
              buyerName: shelf ? (db.users.find((u) => u.id === o.buyerId)?.displayName ?? 'Buyer') : null,
              isPrize: o.isPrize, riderAssigned: !!o.riderId,
              pinLockedUntil: o.status === 'dispatched' && o.pinState.lockedUntil && Date.parse(o.pinState.lockedUntil) > now() ? o.pinState.lockedUntil : null,
            }
          })
      }),

    receiveAtCounter: (orderId, productCode) =>
      tx((db) => {
        const point = counter()
        const o = db.orders.find((x) => x.id === orderId && x.fulfilment === 'pickup' && x.pickupPoint?.id === point)
        if (!o) throw new ApiError('not_found', 'That order isn’t coming to this counter.')
        if (o.status !== 'dispatched' || !o.riderId || !o.collectedAt || o.atCounterAt) throw new ApiError('invalid_input', 'Only items a rider has brought can be taken in.')
        const problem = counterCodeError(productCode, db.listings.find((l) => l.id === o.listingId)!.productCode)
        if (problem) throw new ApiError('invalid_input', problem)
        o.atCounterAt = iso(now())
        notify(db, o.buyerId, 'order_ready_to_collect', o.listingId, iso(now()))
        earn(db, o.riderId, 'delivery', o.id, o, sellerArea(db, o), pointArea(o), now())
      }),

    counterHandOver: (orderId, pin) =>
      tx((db) => {
        const point = counter()
        const o = db.orders.find((x) => x.id === orderId && x.pickupPoint?.id === point && x.status === 'dispatched' && x.atCounterAt)
        if (!o) throw new ApiError('invalid_input', 'Only items on your shelf can be handed over.')
        if (!isDeliveryPin(pin)) throw new ApiError('invalid_input', 'Enter the buyer’s 6-digit PIN.')
        const { result, state } = checkPin(o.pin, pin, o.pinState, now())
        o.pinState = state
        if (result.confirmed) {
          o.status = 'delivered'
          o.deliveredAt = iso(now())
        }
        return result
      }),

    releaseToRider: (orderId) =>
      tx((db) => {
        const point = counter()
        const o = db.orders.find((x) => x.id === orderId && x.pickupPoint?.id === point && waitingAtCounter(x) && x.riderId)
        if (!o) throw new ApiError('invalid_input', 'Only items a rider has taken to send back can be handed over.')
        o.counterOutAt = iso(now())
      }),

    listNotifications: () =>
      tx((db): NotificationView[] =>
        db.notifications
          .filter((n) => n.userId === inbox())
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((n) => {
            const l = n.listingId ? getListingOr404(db, n.listingId) : null
            return {
              id: n.id, kind: n.kind, listingId: n.listingId ?? '', listingTitle: l?.title ?? '', listingImage: l?.images[0] ?? null, listingCategory: l?.category ?? 'Phones', drawAt: l?.drawAt ?? null,
              winningNumber: db.results.find((r) => r.listingId === n.listingId)?.winningNumber ?? null, area: n.area ?? null, createdAt: n.createdAt, read: n.read, celebrated: n.celebrated,
            }
          }),
      ),

    markNotificationsRead: () =>
      tx((db) => {
        for (const n of db.notifications) if (n.userId === inbox()) n.read = true
      }),

    markWinCelebrated: (listingId) =>
      tx((db) => {
        for (const n of db.notifications) if (n.userId === buyer() && n.listingId === listingId && (n.kind === 'draw_won' || n.kind === 'draw_lost')) n.celebrated = true
      }),

    getWallet: () =>
      tx((db): WalletView => {
        const mine = db.ledger.filter((e) => e.userId === buyer())
        return {
          balance: balanceFromLedger(mine),
          entries: [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          spentThisWeekKobo: spentInLastWeek(mine, new Date(now())),
          weeklyLimitKobo: me(db).weeklyLimitKobo,
          pendingLimit: db.pendingLimits[buyer()] ?? null,
          pendingDeposits: [], // the mock has no payment provider
        }
      }),

    topUp: (amountKobo) =>
      tx((db) => {
        const problem = topUpError(amountKobo)
        if (problem) throw new ApiError('invalid_input', problem)
        db.ledger.push({ id: uid('E'), userId: buyer(), kind: 'topup', cashKobo: amountKobo, creditKobo: 0, memo: 'Wallet top-up (test money)', createdAt: iso(now()) })
      }),

    setWeeklyLimit: (amountKobo) =>
      tx((db) => {
        if (!Number.isInteger(amountKobo) || amountKobo <= 0) throw new ApiError('invalid_input', 'Enter a limit.')
        const u = me(db)
        if (amountKobo <= u.weeklyLimitKobo) {
          u.weeklyLimitKobo = amountKobo // lowering is instant
          delete db.pendingLimits[buyer()]
        } else {
          db.pendingLimits[buyer()] = { amountKobo, effectiveAt: iso(now() + RULES.limitIncreaseDelayHours * 60 * 60 * 1000) }
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
        requireShopPermission(db, 'shop')
        const listing = await addRaffle(db, input)
        return listingView(db, listing, 'full')
      }),

    createListingBatch: ({ items, handover }: NewPickupInput) =>
      tx(async (db) => {
        requireShopPermission(db, 'shop')
        const problems = validatePickup(items.map((i) => i.category)).map((e) => PICKUP_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const added = db.listings.length
        try {
          const batchId = uid('B')
          const fee = pickupCautionFee(items.map((i) => i.category))
          const listings: Listing[] = []
          for (const item of items) {
            const l = await addRaffle(db, { ...item, handover })
            l.pickupBatchId = batchId
            l.cautionFee = { amountKobo: fee, status: 'held' }
            listings.push(l)
          }
          return listings.map((l) => listingView(db, l, 'full'))
        } catch (e) {
          db.listings.length = added // all or none
          throw e
        }
      }),

    getSavedPickup: () => tx((db) => savedPickupOf(db)),

    savePickupItems: (items: PickupItemInput[]) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        if (readSession()?.role === 'buyer') throw new ApiError('forbidden', 'Only store accounts can save draw items.')
        const shop = shopId(db)
        if (items.length === 0) {
          delete db.savedPickups[shop]
          return null
        }
        if (items.length > RULES.maxPickupItems) throw new ApiError('invalid_input', PICKUP_ERROR_TEXT.too_many_items)
        if (items.some((i) => i.category === 'Cars')) throw new ApiError('invalid_input', 'Cars are inspected where they are, so they can’t be saved to a pickup. List them on their own.')
        const current = savedPickupOf(db)
        const saved = { items, savedAt: current?.savedAt ?? iso(now()), expiresAt: current?.expiresAt ?? savedPickupExpiry(now()) }
        db.savedPickups[shop] = saved
        return saved
      }),

    updateListing: (id, input) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const l = ownListing(db, id)
        if (l.status !== 'pending_review') throw new ApiError('invalid_input', 'Only listings in review can be edited.')
        if (!canChangeInReview(l, lagosDay(now()))) throw new ApiError('invalid_input', 'Your pickup or inspection day has arrived, so this can’t be changed now.')
        setListingDetails(db, l, input)
        l.revision = (l.revision ?? 0) + 1
        return listingView(db, l, 'full')
      }),

    withdrawListing: (id) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const l = ownListing(db, id)
        if (l.status !== 'pending_review') throw new ApiError('invalid_input', 'Only listings in review can be withdrawn.')
        if (!canChangeInReview(l, lagosDay(now()))) throw new ApiError('invalid_input', 'Your pickup or inspection day has arrived, so this can’t be withdrawn now.')
        const others = l.pickupBatchId ? db.listings.filter((m) => m.pickupBatchId === l.pickupBatchId && m.id !== l.id) : null
        const { withdrawn, remainingKobo } = withdrawalFees(l.cautionFee, !!l.wasRejected, others?.map((m) => m.category) ?? null)
        if (remainingKobo !== null) for (const m of others ?? []) m.cautionFee = { ...m.cautionFee, amountKobo: remainingKobo }
        Object.assign(l, { status: 'withdrawn', cautionFee: withdrawn, pickupBatchId: null })
      }),

    pauseListing: (id) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const l = ownListing(db, id)
        if (l.kind !== 'product' || l.status !== 'for_sale') throw new ApiError('invalid_input', 'Only products on sale can be paused.')
        l.status = 'paused'
      }),

    resumeListing: (id) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const l = ownListing(db, id)
        if (db.merchants.find((m) => m.id === l.merchantId)?.suspendedAt) throw new ApiError('forbidden', 'Your shop is suspended. Contact DrawMart.')
        if (l.status !== 'paused') throw new ApiError('invalid_input', 'Only paused products can be resumed.')
        const limit = limitFor(db, l, l.priceKobo)
        if (limit) throw new ApiError('invalid_input', limit)
        l.status = l.stock > 0 ? 'for_sale' : 'sold'
      }),

    changeStock: (id, change) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const l = ownListing(db, id)
        if (!canControlProduct(l)) throw new ApiError('invalid_input', 'Only products on sale, paused or sold out can change stock.')
        const problem = stockChangeError(l.stock, change)
        if (problem) throw new ApiError('invalid_input', problem)
        const was = l.status
        l.stock += change
        l.status = statusAfterStock(l.status, l.stock)
        if (was === 'sold' && l.status === 'for_sale') for (const userId of saversOf(db, l.id)) alertSaved(db, userId, l.id, l, 'saved_back_on_sale', now())
      }),

    changePrice: (id, priceKobo) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const l = ownListing(db, id)
        if (!canControlProduct(l)) throw new ApiError('invalid_input', 'Only products on sale, paused or sold out can change price.')
        if (!Number.isInteger(priceKobo) || priceKobo < MIN_PRODUCT_PRICE_KOBO) throw new ApiError('invalid_input', PRODUCT_ERROR_TEXT.price_too_low)
        const limit = limitFor(db, l, priceKobo)
        if (limit) throw new ApiError('invalid_input', limit)
        db.priceReviews = db.priceReviews.filter((r) => r.listingId !== l.id)
        if (repriceNeedsReview(priceKobo, l.reviewedPriceKobo ?? l.priceKobo)) {
          db.priceReviews.push({ listingId: l.id, newPriceKobo: priceKobo, requestedAt: iso(now()) })
          return true
        }
        applyPrice(db, l, priceKobo)
        return false
      }),

    listPriceReviews: () =>
      tx((db) => db.priceReviews.map((r) => ({ listing: listingView(db, getListingOr404(db, r.listingId), 'full'), newPriceKobo: r.newPriceKobo, requestedAt: r.requestedAt }))),

    reviewPriceChange: (id, newPriceKobo, approve) =>
      tx((db) => {
        const r = db.priceReviews.find((x) => x.listingId === id)
        if (!r) throw new ApiError('invalid_input', 'That price change has already been dealt with.')
        if (r.newPriceKobo !== newPriceKobo) throw new ApiError('invalid_input', 'The seller just changed this price. Check it again.')
        db.priceReviews = db.priceReviews.filter((x) => x !== r)
        const l = getListingOr404(db, id)
        if (approve) {
          applyPrice(db, l, newPriceKobo)
          l.reviewedPriceKobo = newPriceKobo
        }
        notifyShop(db, l.merchantId, approve ? 'store_price_approved' : 'store_price_rejected', l.id, iso(now()))
      }),

    resubmitListing: (id, input) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const l = ownListing(db, id)
        if (l.status !== 'rejected') throw new ApiError('invalid_input', 'Only rejected listings can be sent again.')
        setListingDetails(db, l, input)
        if (l.kind === 'raffle') l.cautionFee = { ...l.cautionFee, status: 'held' } // settlePickups has the last word on a shared pickup
        l.status = 'pending_review'
        l.rejection = null
        l.revision = (l.revision ?? 0) + 1
        return listingView(db, l, 'full')
      }),

    createProduct: (input: NewProductInput) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        if (db.merchants.find((m) => m.id === shopId(db))?.suspendedAt) throw new ApiError('forbidden', 'Your shop is suspended. Contact DrawMart.')
        const problems = validateProduct(input).map((e) => PRODUCT_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const shop = db.merchants.find((m) => m.id === shopId(db))!
        const ticket = db.checkTickets[shop.id]
        const check = input.check
        const proof = proofErrors({
          videoRequired: videoRequired(db, shop), individual: shop.kind === 'individual', hasVideo: !!check?.video, hasProof: !!check?.proof,
          category: input.category, priceKobo: input.priceKobo, serial: check?.serial ?? '',
        })
        if (videoRequired(db, shop) && check?.video && check.code !== ticket?.code) proof.unshift('Get a new code and record the video again.')
        if (proof.length) throw new ApiError('invalid_input', proof.join(' '))
        const limit = newSellerLimitError({ ...newSellerProgress(db, shop), priceKobo: input.priceKobo, adding: 1 })
        if (limit) throw new ApiError('invalid_input', limit)
        const { check: _check, ...details } = input
        const listing = productListing({ ...details, merchantId: shop.id, status: 'pending_review' }, now())
        db.listings.push(listing)
        db.listingChecks[listing.id] = { code: check?.code ?? null, videoKey: keepCheckFile(check?.video ?? null), serial: check?.serial?.trim() || null, proofKey: keepCheckFile(check?.proof ?? null) }
        delete db.checkTickets[shop.id]
        if (check?.video && db.owedChecks[shop.id]) db.owedChecks[shop.id] -= 1
        return listingView(db, listing, 'full')
      }),

    getMyStoreRole: () =>
      tx((db) => {
        const m = teamMember(db)
        if (m) return m.role
        return readSession()?.role === 'buyer' && db.sellerShops[buyer()] ? 'owner' : null
      }),

    getStoreTeam: () =>
      tx((db) => {
        const me = teamMember(db)
        if (!me) throw new ApiError('forbidden', 'Teams are for stores.')
        requireShopPermission(db, 'team')
        const owners = DEMO_ACCOUNTS.filter((a) => a.role === 'store' && a.mockId === me.merchantId)
        const invited = Object.entries(db.storeRoles).filter(([id, r]) => r.merchantId === me.merchantId && !owners.some((o) => o.mockId === id))
        const member = (userId: string) => {
          const a = DEMO_ACCOUNTS.find((x) => x.mockId === userId)!
          return { userId, name: a.name, email: a.email, role: db.storeRoles[userId]?.role ?? ('owner' as StoreRole), you: userId === me.userId, since: '2026-03-02T09:00:00.000Z' }
        }
        return {
          members: [...owners.map((o) => member(o.mockId)), ...invited.map(([id]) => member(id))],
          invites: db.storeInvites.filter((i) => i.merchantId === me.merchantId && !i.acceptedAt && !i.revokedAt).map(({ id, email, role, createdAt }) => ({ id, email, role, createdAt })),
        }
      }),

    inviteStoreMember: (email, role) =>
      tx((db) => {
        const me = teamMember(db)
        if (!me) throw new ApiError('forbidden', 'Teams are for stores.')
        requireShopPermission(db, 'team')
        const problem = inviteError(email, role)
        if (problem) throw new ApiError('invalid_input', problem)
        const address = email.trim().toLowerCase()
        const onTeam = (userId: string) => (db.storeRoles[userId]?.merchantId ?? (DEMO_ACCOUNTS.find((a) => a.mockId === userId)?.role === 'store' ? userId : null)) === me.merchantId
        if (DEMO_ACCOUNTS.some((a) => a.email === address && onTeam(a.mockId))) throw new ApiError('invalid_input', 'They’re already on your team.')
        const pending = db.storeInvites.find((i) => i.merchantId === me.merchantId && i.email === address && !i.acceptedAt && !i.revokedAt)
        if (pending) {
          pending.role = role
          return
        }
        db.storeInvites.push({ id: uid('T'), merchantId: me.merchantId, email: address, role, createdAt: iso(now()), acceptedAt: null, revokedAt: null })
      }),

    revokeStoreInvite: (id) =>
      tx((db) => {
        const me = teamMember(db)
        requireShopPermission(db, 'team')
        const i = db.storeInvites.find((x) => x.id === id && x.merchantId === me?.merchantId && !x.acceptedAt && !x.revokedAt)
        if (!i) throw new ApiError('not_found', 'That invite doesn’t exist.')
        i.revokedAt = iso(now())
      }),

    setStoreMemberRole: (userId, role) =>
      tx((db) => {
        const me = teamMember(db)
        if (!me) throw new ApiError('forbidden', 'Teams are for stores.')
        requireShopPermission(db, 'team')
        const team = mockTeam(db, me.merchantId)
        if (!team.some((m) => m.userId === userId)) throw new ApiError('not_found', 'They’re not on your team.')
        const problem = lastOwnerError(team, userId, role)
        if (problem) throw new ApiError('invalid_input', problem)
        db.storeRoles[userId] = { merchantId: me.merchantId, role }
      }),

    removeStoreMember: (userId) =>
      tx((db) => {
        const me = teamMember(db)
        if (!me) throw new ApiError('forbidden', 'Teams are for stores.')
        requireShopPermission(db, 'team')
        const team = mockTeam(db, me.merchantId)
        if (!team.some((m) => m.userId === userId)) throw new ApiError('not_found', 'They’re not on your team.')
        const problem = lastOwnerError(team, userId, null)
        if (problem) throw new ApiError('invalid_input', problem)
        if (!db.storeAccounts[userId]) throw new ApiError('invalid_input', 'The demo account a store was set up with can’t be removed.')
        delete db.storeAccounts[userId]
        delete db.storeRoles[userId]
      }),

    listStoreActivity: () =>
      tx((db) => {
        const me = teamMember(db)
        if (!me) throw new ApiError('forbidden', 'Teams are for stores.')
        requireShopPermission(db, 'team')
        return db.storeActivity
          .filter((a) => a.merchantId === me.merchantId)
          .slice(-100)
          .reverse()
          .map((a) => {
            const l = a.listingId ? db.listings.find((x) => x.id === a.listingId) : undefined
            return { id: a.id, at: a.at, who: a.who, action: a.action, listingTitle: l?.title ?? null, productCode: l?.productCode ?? null }
          })
      }),

    listMyStoreInvites: () =>
      tx((db) => {
        const s = readSession()
        if (s?.role !== 'buyer' || !s.email) return []
        return db.storeInvites
          .filter((i) => i.email === s.email && !i.acceptedAt && !i.revokedAt)
          .map((i) => ({ id: i.id, storeName: db.merchants.find((m) => m.id === i.merchantId)!.name, role: i.role, createdAt: i.createdAt }))
      }),

    acceptStoreInvite: (id) =>
      tx((db) => {
        const s = readSession()
        const i = db.storeInvites.find((x) => x.id === id && !x.acceptedAt && !x.revokedAt)
        if (!s || s.role !== 'buyer' || !i || i.email !== s.email) throw new ApiError('not_found', 'That invite doesn’t exist, or it’s for another email address.')
        const blocker = storeAccountBlocker(accountFacts(db, s.userId))
        if (blocker) throw new ApiError('invalid_input', blocker)
        db.storeAccounts[s.userId] = i.merchantId
        db.storeRoles[s.userId] = { merchantId: i.merchantId, role: i.role }
        delete db.carts[s.userId]
        delete db.saved[s.userId]
        i.acceptedAt = iso(now())
      }),

    createProductsBulk: (items, onProgress) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const shop = db.merchants.find((m) => m.id === readSession()?.userId && readSession()?.role === 'store')
        if (!shop) throw new ApiError('forbidden', 'Bulk upload is for stores. Add your items one at a time.')
        if (shop.suspendedAt) throw new ApiError('forbidden', 'Your shop is suspended. Contact DrawMart.')
        if (!items.length) throw new ApiError('invalid_input', 'Add at least one product.')
        if (items.length > MAX_BULK_ROWS) throw new ApiError('invalid_input', `Upload up to ${MAX_BULK_ROWS} products at a time.`)
        if (videoRequired(db, shop)) throw new ApiError('invalid_input', 'Your next listing needs a short video. Add it with the form, then upload the rest.')
        const picked = new Set(items.map((_, i) => i).filter(() => Math.random() * 100 < checkSettings.spotPercent))
        const errors: string[] = []
        items.forEach((item, i) => {
          if (picked.has(i)) return
          const problems = validateProduct(item).map((e) => PRODUCT_ERROR_TEXT[e])
          const serial = serialError(item.category, item.priceKobo, item.check?.serial ?? '')
          if (serial) problems.push(serial)
          if ((item.images?.length ?? 0) > 4) problems.push('Upload up to 4 photos.')
          if (problems.length) errors.push(`Row ${i + 2}: ${problems.join(' ')}`)
        })
        if (errors.length) throw new ApiError('invalid_input', errors.join(' '))
        items.forEach((item, i) => {
          if (picked.has(i)) return
          const { check, ...details } = item
          const listing = productListing({ ...details, images: (details.images ?? []).map(keepBulkPhoto), merchantId: shop.id, status: 'pending_review' }, now())
          db.listings.push(listing)
          db.listingChecks[listing.id] = { code: null, videoKey: null, serial: check?.serial?.trim() || null, proofKey: null }
        })
        if (picked.size) db.owedChecks[shop.id] = (db.owedChecks[shop.id] ?? 0) + picked.size
        const photos = items.reduce((n, i) => n + (i.images?.length ?? 0), 0)
        onProgress?.(photos, photos)
        return { created: items.length - picked.size, checkTitles: [...picked].map((i) => items[i].title.trim()) }
      }),

    listPayouts: () =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        return db.payouts.filter((p) => p.merchantId === shopId(db)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => payoutView(db, p))
      }),

    getPayoutAccount: () =>
      tx((db) => {
        if (readSession()?.role === 'delivery') return db.riderPayoutAccounts[payee()] ?? null
        requireShopPermission(db, 'bank')
        return db.payoutAccounts[shopId(db)] ?? null
      }),

    listBanks: () => tx(() => [{ code: '044', name: 'Access Bank' }, { code: '058', name: 'GTBank' }, { code: '057', name: 'Zenith Bank' }]),

    lookupBankAccount: (bankCode, accountNumber) =>
      tx((db) => {
        if (readSession()?.role === 'delivery') {
          payee()
          return { accountName: mockAccountName(bankCode, accountNumber) }
        }
        requireShopPermission(db, 'bank')
        shopId(db)
        return { accountName: mockAccountName(bankCode, accountNumber) }
      }),

    savePayoutAccount: (bankCode, accountNumber) =>
      tx((db) => {
        if (readSession()?.role === 'delivery') {
          const me = payee()
          const old = db.riderPayoutAccounts[me]
          if (old?.bankCode === bankCode && old.accountNumber === accountNumber) return
          const bankName = { '044': 'Access Bank', '058': 'GTBank', '057': 'Zenith Bank' }[bankCode]
          if (!bankName) throw new ApiError('invalid_input', 'Pick a bank from the list.')
          const at = now()
          db.riderPayoutAccounts[me] = { bankCode, bankName, accountNumber, accountName: mockAccountName(bankCode, accountNumber), confirmedAt: iso(at), payableFrom: iso(old ? at + PAYOUT_ACCOUNT_HOLD_HOURS * 3_600_000 : at) }
          if (old) notify(db, me, 'rider_bank_changed', null, iso(at))
          return
        }
        requireShopPermission(db, 'bank')
        const shop = shopId(db)
        const accountName = mockAccountName(bankCode, accountNumber)
        const old = db.payoutAccounts[shop]
        if (old?.bankCode === bankCode && old.accountNumber === accountNumber) return
        const at = now()
        const bankName = { '044': 'Access Bank', '058': 'GTBank', '057': 'Zenith Bank' }[bankCode]
        if (!bankName) throw new ApiError('invalid_input', 'Pick a bank from the list.')
        db.payoutAccounts[shop] = { bankCode, bankName, accountNumber, accountName, confirmedAt: iso(at), payableFrom: iso(old ? at + PAYOUT_ACCOUNT_HOLD_HOURS * 3_600_000 : at) }
        if (old) notifyShop(db, shop, 'store_bank_changed', null, iso(at))
      }),

    listDuePayouts: () =>
      tx((db) => {
        const due = db.payouts.filter((p) => p.status === 'due').sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
        return [...new Set(due.map((p) => p.merchantId))].map((merchantId) => ({
          merchantId,
          merchantName: db.merchants.find((m) => m.id === merchantId)!.name,
          account: db.payoutAccounts[merchantId] ?? null,
          lines: due.filter((p) => p.merchantId === merchantId).map((p) => payoutView(db, p)),
        }))
      }),

    markPayoutsPaid: (ids, reference) =>
      tx((db) => {
        const lines = db.payouts.filter((p) => ids.includes(p.id))
        const merchants = new Set(lines.map((p) => p.merchantId))
        if (lines.length !== ids.length) throw new ApiError('invalid_input', 'Only payouts that are due can be marked paid.')
        if (merchants.size > 1) throw new ApiError('invalid_input', 'Mark one seller’s payouts at a time.')
        const [merchantId] = merchants
        const account = merchantId ? db.payoutAccounts[merchantId] ?? null : null
        const problem = markPaidError(lines, account, reference, now())
        if (problem) throw new ApiError('invalid_input', problem)
        const at = iso(now())
        for (const p of lines) Object.assign(p, { status: 'paid', paidAt: at, reference: reference.trim(), paidTo: `${account!.bankName} ${maskAccountNumber(account!.accountNumber)}` })
        notifyShop(db, merchantId, 'store_payout_sent', null, at)
      }),

    listMerchantOrders: () =>
      tx((db) => db.orders.filter((o) => o.merchantId === shopId(db) && o.handledBy === 'store').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => orderView(db, o))),

    getDeliveryPricing: () => tx((db) => db.deliveryPricing),

    setDeliveryPrice: (areaA, areaB, priceKobo) =>
      tx((db) => {
        const problem = deliveryPriceError(priceKobo)
        if (problem) throw new ApiError('invalid_input', problem)
        const [a, b] = areaA <= areaB ? [areaA, areaB] : [areaB, areaA]
        if (priceKobo < (db.riderPayRates.pays.find((p) => p.areaA === a && p.areaB === b)?.payKobo ?? 0)) throw new ApiError('invalid_input', 'That’s less than the rider is paid for this trip. Lower the rider pay first.')
        const row = db.deliveryPricing.prices.find((p) => p.areaA === a && p.areaB === b)
        if (!row) throw new ApiError('not_found', 'That area doesn’t exist.')
        row.priceKobo = priceKobo
      }),

    setDeliverySizeExtra: (size, extraKobo) =>
      tx((db) => {
        const problem = sizeExtraError(extraKobo)
        if (problem) throw new ApiError('invalid_input', problem)
        if (extraKobo < db.riderPayRates.sizeExtras[size]) throw new ApiError('invalid_input', 'That’s less than the rider is paid for this size. Lower the rider pay first.')
        db.deliveryPricing.sizeExtras[size] = extraKobo
      }),

    openClaim: (orderId, input) =>
      tx((db) => {
        const o = db.orders.find((x) => x.id === orderId && x.buyerId === buyer())
        if (!o) throw new ApiError('not_found', 'That order doesn’t exist.')
        const l = getListingOr404(db, o.listingId)
        if (o.isPrize || l.category === 'Cars') throw new ApiError('invalid_input', 'Won items and cars can’t be returned here. Contact DrawMart.')
        if (!canClaim({ ...o, category: l.category }, now())) throw new ApiError('invalid_input', 'You can report a problem or return an item for 48 hours after delivery.')
        if (o.claim) throw new ApiError('invalid_input', 'You’ve already reported this order.')
        const problem = claimError(input.kind, input.description, input.photos)
        if (problem) throw new ApiError('invalid_input', problem)
        const address = input.address?.trim() || o.delivery.address
        const location = input.location ?? o.delivery.location
        const phone = input.phone?.trim() || o.delivery.contactPhone
        if (address.length < 10 || !location || locationError(location)) throw new ApiError('invalid_input', 'Pin where a rider can collect it.')
        if (!isNigerianMobile(phone)) throw new ApiError('invalid_input', 'Enter a Nigerian mobile number, e.g. 0803 123 4567.')
        const shop = db.merchants.find((m) => m.id === o.merchantId)!
        const change = input.kind === 'change_of_mind'
        const fee = change ? returnFeeKobo(o.priceKobo, o.quantity) : 0
        const trip = change ? deliveryFeeKobo(db.deliveryPricing, sellerAreaOf(shop), location, packageSizeOf(l)) : 0
        const id = uid('Q')
        o.claim = { id, kind: input.kind, status: change ? 'awaiting_pickup' : 'open', description: input.description.trim(), photos: input.photos, returnFeeKobo: fee, reviewNote: null }
        db.claimDetails[id] = { riderId: null, openedAt: iso(now()), address, location, phone, tripKobo: trip, sellerShareKobo: sellerShareOfReturnFee(fee, trip) }
        if (change) alertNewReturn(db, o, null, now())
        notifyShop(db, o.merchantId, 'store_order_claim', o.listingId, iso(now()))
      }),

    contestFailure: (orderId, note) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const o = db.orders.find((x) => x.id === orderId && x.merchantId === shopId(db))
        if (!o) throw new ApiError('not_found', 'That order doesn’t exist.')
        if (!canContest(o, now())) throw new ApiError('invalid_input', 'You can contest a failed check or a refusal for 7 days.')
        if (o.claim) throw new ApiError('invalid_input', 'You’ve already contested this.')
        const problem = contestError(note)
        if (problem) throw new ApiError('invalid_input', problem)
        o.claim = { id: uid('Q'), kind: 'contest', status: 'open', description: note.trim(), photos: [], returnFeeKobo: 0, reviewNote: null }
      }),

    listOpenClaims: () =>
      tx((db) =>
        db.orders.filter((o) => o.claim?.status === 'open').map((o) => {
          const l = getListingOr404(db, o.listingId)
          return {
            id: o.claim!.id, kind: o.claim!.kind, description: o.claim!.description, photos: o.claim!.photos, createdAt: o.createdAt, orderId: o.id, productCode: l.productCode, listingTitle: l.title,
            listingImage: l.images[0] ?? null, priceKobo: o.priceKobo, merchantName: db.merchants.find((m) => m.id === o.merchantId)!.name, confirmPhoto: o.confirmPhoto,
            collectionPhotos: o.collectionPhotos ?? [], refusalPhoto: o.refusalPhoto, cancelReason: o.cancelReason,
          }
        }),
      ),

    reviewClaim: (claimId, approve, note) =>
      tx((db) => {
        const o = db.orders.find((x) => x.claim?.id === claimId)
        if (!o?.claim || o.claim.status !== 'open') throw new ApiError('invalid_input', 'That’s already been dealt with.')
        if (!approve && note.trim().length < 5) throw new ApiError('invalid_input', 'Say why, so they understand.')
        const contest = o.claim.kind === 'contest'
        o.claim.status = !approve ? 'declined' : contest ? 'upheld' : 'awaiting_pickup'
        if (o.claim.status === 'awaiting_pickup') alertNewReturn(db, o, null, now())
        o.claim.reviewNote = note.trim() || null
        if (contest) {
          if (approve) {
            db.excusedFailures.push(o.id)
            const charge = db.payouts.find((p) => p.orderId === o.id && p.kind === 'charge')
            if (charge?.status === 'due') db.payouts = db.payouts.filter((p) => p !== charge)
            else db.payouts.push({ id: uid('Y'), merchantId: o.merchantId, listingId: o.listingId, orderId: o.id, kind: 'charge_refund', amountKobo: FAILURE_CHARGE_KOBO, status: 'due', createdAt: iso(now()), dueAt: iso(now()), paidAt: null, reference: null, paidTo: null })
          }
          notifyShop(db, o.merchantId, 'store_order_claim', o.listingId, iso(now()))
        } else {
          notify(db, o.buyerId, 'order_claim_update', o.listingId, iso(now()))
        }
      }),

    listReturnJobs: () =>
      tx((db): ReturnJob[] => {
        const me = rider()
        return db.orders.flatMap((o) => {
          if (!o.claim) return []
          const d = db.claimDetails[o.claim.id]
          if (!d || !((o.claim.status === 'awaiting_pickup' && !d.riderId) || (d.riderId === me && (o.claim.status === 'awaiting_pickup' || o.claim.status === 'returning')))) return []
          const l = getListingOr404(db, o.listingId)
          const shop = db.merchants.find((m) => m.id === o.merchantId)!
          return [{
            id: o.claim.id, kind: o.claim.kind, status: o.claim.status, mine: !!d.riderId,
            collectBy: d.riderId === me && o.claim.status === 'awaiting_pickup' && d.takenAt ? collectBy(d.takenAt) : null,
            ...poolPay(db, o, nearestArea(d.location, DELIVERY_AREAS), sellerArea(db, o), d.openedAt ?? null),
            locked: !d.riderId && !!riderLimit(db, me, o),
            productCode: l.productCode, listingTitle: l.title, listingImage: l.images[0] ?? null, quantity: o.quantity, category: l.category,
            returnTo: { name: shop.name, area: shop.area, ...(d.riderId === me && o.claim.status === 'returning' ? db.shopPickups[o.merchantId] : {}) },
            pickupFrom: d.riderId === me && o.claim.status === 'awaiting_pickup' ? { buyerName: db.users.find((u) => u.id === o.buyerId)?.displayName ?? 'Buyer', address: d.address, location: d.location, contactPhone: d.phone } : null,
          }]
        })
      }),

    takeReturn: (claimId) =>
      tx((db) => {
        const o = db.orders.find((x) => x.claim?.id === claimId && x.claim.status === 'awaiting_pickup')
        const full = takeJobError(riderJobsHeld(db, rider()))
        if (full) throw new ApiError('invalid_input', full)
        const limit = o && riderLimit(db, rider(), o)
        if (limit) throw new ApiError('invalid_input', limit)
        if (!o || db.claimDetails[claimId].riderId) throw new ApiError('invalid_input', 'Another rider has taken this return.')
        Object.assign(db.claimDetails[claimId], { riderId: rider(), takenAt: iso(now()) })
      }),

    releaseReturn: (claimId) =>
      tx((db) => {
        const o = db.orders.find((x) => x.claim?.id === claimId && x.claim.status === 'awaiting_pickup')
        if (!o || db.claimDetails[claimId].riderId !== rider()) throw new ApiError('invalid_input', 'Only returns you haven’t collected can be handed back.')
        Object.assign(db.claimDetails[claimId], { riderId: null, takenAt: null })
        alertNewReturn(db, o, rider(), now())
      }),

    passReturnPickup: (claimId, photos) =>
      tx((db) => {
        const problem = photosError(photos)
        if (problem) throw new ApiError('invalid_input', problem)
        const o = db.orders.find((x) => x.claim?.id === claimId && x.claim.status === 'awaiting_pickup')
        if (!o?.claim || db.claimDetails[claimId].riderId !== rider()) throw new ApiError('invalid_input', 'Only returns you’re collecting can be checked.')
        const at = iso(now())
        o.claim.status = 'returning'
        db.claimDetails[claimId].pickedUpAt = at
        o.refundedAt = at
        db.payouts = db.payouts.filter((p) => !(p.orderId === o.id && p.kind === 'sale' && p.status === 'waiting'))
        const title = getListingOr404(db, o.listingId).title
        if (o.claim.kind === 'fault') {
          db.ledger.push({ id: uid('E'), userId: o.buyerId, kind: 'order_refund', cashKobo: o.paidCashKobo + o.paidFeeCashKobo, creditKobo: o.paidCreditKobo + o.paidFeeCreditKobo, memo: `Refund · ${title}`, listingId: o.listingId, createdAt: at })
          penaliseSeller(db, o, now())
        } else {
          const back = returnRefundSplit({ cashKobo: o.paidCashKobo, creditKobo: o.paidCreditKobo }, o.claim.returnFeeKobo)
          db.ledger.push({ id: uid('E'), userId: o.buyerId, kind: 'order_refund', ...back, memo: `Return · ${title}`, listingId: o.listingId, createdAt: at })
        }
        notify(db, o.buyerId, 'order_claim_update', o.listingId, at)
      }),

    failReturnPickup: (claimId, note) =>
      tx((db) => {
        const o = db.orders.find((x) => x.claim?.id === claimId && x.claim.status === 'awaiting_pickup')
        if (!o?.claim || db.claimDetails[claimId].riderId !== rider()) throw new ApiError('invalid_input', 'Only returns you’re collecting can be checked.')
        if (note.trim().length < 5) throw new ApiError('invalid_input', 'Say what’s wrong.')
        o.claim.status = 'pickup_failed'
        o.claim.reviewNote = note.trim()
        notify(db, o.buyerId, 'order_claim_update', o.listingId, iso(now()))
      }),

    finishReturn: (claimId, photo) =>
      tx((db) => {
        const problem = photosError([photo])
        if (problem) throw new ApiError('invalid_input', problem)
        const o = db.orders.find((x) => x.claim?.id === claimId && x.claim.status === 'returning')
        if (!o?.claim || db.claimDetails[claimId].riderId !== rider()) throw new ApiError('invalid_input', 'Only returns you’re carrying can be finished.')
        const at = iso(now())
        o.claim.status = 'returned'
        earn(db, rider(), 'return', claimId, o, nearestArea(db.claimDetails[claimId].location, DELIVERY_AREAS), sellerArea(db, o), now())
        if (o.claim.kind === 'change_of_mind') {
          const l = getListingOr404(db, o.listingId)
          l.stock += o.quantity
          if (l.status === 'sold') l.status = 'for_sale'
          const share = db.claimDetails[claimId].sellerShareKobo
          if (share > 0) db.payouts.push({ id: uid('Y'), merchantId: o.merchantId, listingId: o.listingId, orderId: o.id, kind: 'return_fee', amountKobo: share, status: 'due', createdAt: at, dueAt: at, paidAt: null, reference: null, paidTo: null })
        }
        notifyShop(db, o.merchantId, 'store_order_claim', o.listingId, at)
      }),

    getListingCheckPlan: () =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const shop = db.merchants.find((m) => m.id === shopId(db))!
        let ticket = db.checkTickets[shop.id]
        if (!ticket || Date.parse(ticket.issuedAt) < now() - DAY) {
          ticket = { code: newCheckCode(), videoRequired: Math.random() * 100 < checkSettings.spotPercent, issuedAt: iso(now()) }
          db.checkTickets[shop.id] = ticket
        }
        const progress = newSellerProgress(db, shop)
        return {
          code: ticket.code,
          videoRequired: videoRequired(db, shop),
          individual: shop.kind === 'individual',
          newSeller: progress.individual && progress.deliveries < NEW_SELLER.deliveriesNeeded ? { deliveries: progress.deliveries, live: progress.live } : null,
        }
      }),

    getListingCheck: (listingId) =>
      tx((db) => {
        const c = db.listingChecks[listingId]
        return c ? { code: c.code, hasVideo: !!c.videoKey, serial: c.serial, videoUrl: c.videoKey ? (checkFiles.get(c.videoKey) ?? null) : null, proofUrl: c.proofKey ? (checkFiles.get(c.proofKey) ?? null) : null } : null
      }),

    listDiscounts: () =>
      tx((db) => {
        const shop = myShop(db)
        return db.discounts
          .filter((d) => d.merchantId === shop)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(({ merchantId: _shop, ...d }) => d)
      }),

    createDiscount: (input) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const shop = myShop(db)
        if (!shop) throw new ApiError('forbidden', 'Only sellers can run discounts.')
        const ids = [...new Set(input.listingIds)]
        const mine = ids.map((id) => db.listings.find((l) => l.id === id))
        if (mine.some((l) => !l || l.merchantId !== shop || l.kind !== 'product' || !['for_sale', 'paused', 'pending_review'].includes(l.status)))
          throw new ApiError('invalid_input', 'Discounts are only for your own products, never draws.')
        const problems = discountErrors({ ...input, listingIds: ids }, Object.fromEntries(mine.map((l) => [l!.id, l!.priceKobo])))
        const code = input.kind === 'code' ? normalizeCode(input.code) : null
        if (code && db.discounts.some((d) => d.code === code)) problems.push('That code is taken. Try another.')
        if (Date.parse(input.endsAt) <= now()) problems.push('The end has to be in the future.')
        if (db.discounts.filter((d) => d.merchantId === shop && !d.endedAt && Date.parse(d.endsAt) > now()).length >= MAX_OPEN_DISCOUNTS)
          problems.push('You can have up to 20 discounts running or waiting to start. End one first.')
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        db.discounts.push({
          id: uid('D'), merchantId: shop, kind: input.kind, percentOff: input.percentOff, amountOffKobo: input.amountOffKobo, code, maxUses: input.kind === 'code' ? input.maxUses : null,
          uses: 0, startsAt: input.startsAt, endsAt: input.endsAt, endedAt: null, listingIds: ids, createdAt: iso(now()),
        })
      }),

    endDiscount: (id) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const d = db.discounts.find((x) => x.id === id && x.merchantId === myShop(db) && !x.endedAt)
        if (!d) throw new ApiError('not_found', 'That discount doesn’t exist or has already ended.')
        d.endedAt = iso(now())
      }),

    checkDiscountCode: (code, listingIds) =>
      tx((db) => {
        const d = usableCode(db, code)
        const prices: Record<string, Kobo> = {}
        for (const id of listingIds) {
          const l = db.listings.find((x) => x.id === id)
          if (l && l.kind === 'product' && l.status === 'for_sale' && d.listingIds.includes(l.id)) prices[l.id] = unitPrice(db, l, d.id).unitKobo
        }
        if (!Object.keys(prices).length) throw new ApiError('invalid_input', 'That code isn’t for anything you’re buying.')
        return { code: d.code!, prices }
      }),

    getDrawPriceStats: (category, band) =>
      tx((db) => {
        const role = readSession()?.role
        if (role && role !== 'store' && role !== 'admin') throw new ApiError('forbidden', 'Only stores run draws.')
        return pricingStats(db.listings.filter((l) => l.kind === 'raffle'), category, band)
      }),

    listQuickReplies: () =>
      tx((db) => {
        const shop = myShop(db)
        return shop ? [...(db.quickReplies[shop] ?? [])] : []
      }),

    saveQuickReply: ({ id, body }) =>
      tx((db) => {
        const shop = myShop(db)
        if (!shop) throw new ApiError('forbidden', 'Only sellers have quick replies.')
        const list = (db.quickReplies[shop] ??= [])
        const problem = quickReplyError(body, id ? list.length - 1 : list.length)
        if (problem) throw new ApiError('invalid_input', problem)
        if (id) {
          const r = list.find((x) => x.id === id)
          if (!r) throw new ApiError('not_found', 'That reply doesn’t exist.')
          r.body = body.trim()
        } else list.push({ id: uid('Q'), body: body.trim() })
      }),

    deleteQuickReply: (id) =>
      tx((db) => {
        const shop = myShop(db)
        const list = shop ? (db.quickReplies[shop] ?? []) : []
        if (!list.some((r) => r.id === id)) throw new ApiError('not_found', 'That reply doesn’t exist.')
        db.quickReplies[shop!] = list.filter((r) => r.id !== id)
      }),

    getSupportThread: () =>
      tx((db) => {
        const shop = myShop(db)
        if (!shop) throw new ApiError('forbidden', 'Only sellers can write to DrawMart here.')
        const t = db.supportThreads[shop]
        const messages = db.supportMessages.filter((m) => m.merchantId === shop).map(({ merchantId: _shop, ...m }) => m)
        return { messages, unread: messages.filter((m) => m.sender === 'drawmart' && (!t || m.createdAt > t.shopReadAt)).length }
      }),

    sendSupportMessage: (body) =>
      tx((db) => {
        const shop = myShop(db)
        if (!shop) throw new ApiError('forbidden', 'Only sellers can write to DrawMart here.')
        const problem = messageError(body)
        if (problem) throw new ApiError('invalid_input', problem)
        const minuteAgo = iso(now() - 60_000)
        if (db.supportMessages.filter((m) => m.merchantId === shop && m.sender === 'shop' && m.createdAt > minuteAgo).length >= MAX_MESSAGES_PER_MINUTE)
          throw new ApiError('invalid_input', 'You’re sending messages very fast. Wait a moment.')
        const at = iso(now())
        db.supportMessages.push({ id: uid('H'), merchantId: shop, sender: 'shop', body: body.trim(), createdAt: at })
        db.supportThreads[shop] = { staffReadAt: db.supportThreads[shop]?.staffReadAt ?? '1970-01-01T00:00:00.000Z', lastMessageAt: at, shopReadAt: at, resolvedAt: null }
      }),

    markSupportRead: (merchantId) =>
      tx((db) => {
        if (merchantId) {
          if (readSession()?.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
          if (db.supportThreads[merchantId]) db.supportThreads[merchantId].staffReadAt = iso(now())
          return
        }
        const shop = myShop(db)
        if (shop && db.supportThreads[shop]) db.supportThreads[shop].shopReadAt = iso(now())
      }),

    listSupportThreads: () =>
      tx((db) => {
        if (readSession()?.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
        return Object.entries(db.supportThreads)
          .map(([merchantId, t]) => {
            const messages = db.supportMessages.filter((m) => m.merchantId === merchantId)
            const last = messages[messages.length - 1]
            const shop = db.merchants.find((m) => m.id === merchantId)!
            return {
              merchantId, merchantName: shop.name, kind: shop.kind, lastMessageAt: t.lastMessageAt, lastMessage: last.body.slice(0, 140), lastSender: last.sender,
              unread: messages.filter((m) => m.sender === 'shop' && m.createdAt > t.staffReadAt).length, resolved: !!t.resolvedAt,
            }
          })
          .sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || b.lastMessageAt.localeCompare(a.lastMessageAt))
      }),

    getSupportMessages: (merchantId) =>
      tx((db) => {
        if (readSession()?.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
        return db.supportMessages.filter((m) => m.merchantId === merchantId).map(({ merchantId: _shop, ...m }) => m)
      }),

    replySupport: (merchantId, body) =>
      tx((db) => {
        if (readSession()?.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
        const t = db.supportThreads[merchantId]
        if (!t) throw new ApiError('not_found', 'That chat doesn’t exist.')
        const problem = messageError(body)
        if (problem) throw new ApiError('invalid_input', problem)
        const at = iso(now())
        db.supportMessages.push({ id: uid('H'), merchantId, sender: 'drawmart', body: body.trim(), createdAt: at })
        Object.assign(t, { lastMessageAt: at, staffReadAt: at })
        notifyShop(db, merchantId, 'store_support_reply', null, at)
      }),

    setSupportResolved: (merchantId, resolved) =>
      tx((db) => {
        if (readSession()?.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
        const t = db.supportThreads[merchantId]
        if (!t) throw new ApiError('not_found', 'That chat doesn’t exist.')
        t.resolvedAt = resolved ? iso(now()) : null
      }),

    submitReview: (orderId, input) =>
      tx((db) => {
        const o = db.orders.find((x) => x.id === orderId && x.buyerId === buyer())
        if (!o) throw new ApiError('not_found', 'That order doesn’t exist.')
        if (o.isPrize) throw new ApiError('invalid_input', 'Won items are delivered by DrawMart, so they aren’t reviewed here.')
        if (o.status !== 'delivered' || !o.deliveredAt) throw new ApiError('invalid_input', 'You can review an order once it’s delivered.')
        if (!canReview(o, now())) throw new ApiError('invalid_input', 'Reviews close 30 days after delivery.')
        const problem = reviewError(input)
        if (problem) throw new ApiError('invalid_input', problem)
        const fields = { rating: input.rating, sellerComment: input.sellerComment.trim(), productComment: input.productComment.trim() }
        const r = db.reviews.find((x) => x.orderId === o.id)
        if (r) {
          if (r.reply !== null) throw new ApiError('invalid_input', 'The seller has replied, so this review can’t be changed.')
          if (r.hiddenAt) throw new ApiError('invalid_input', 'DrawMart has hidden this review, so it can’t be changed.')
          Object.assign(r, fields)
          return
        }
        db.reviews.push({ id: uid('V'), orderId: o.id, userId: o.buyerId, merchantId: o.merchantId, listingId: o.listingId, ...fields, reply: null, repliedAt: null, hiddenAt: null, hiddenReason: null, createdAt: iso(now()) })
        notifyShop(db, o.merchantId, 'store_new_review', o.listingId, iso(now()))
      }),

    replyToReview: (reviewId, reply) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const shop = readSession() ? myShop(db) : null
        const r = db.reviews.find((x) => x.id === reviewId && x.merchantId === shop)
        if (!r) throw new ApiError('not_found', 'That review doesn’t exist.')
        if (r.reply !== null) throw new ApiError('invalid_input', 'You’ve already replied to this review.')
        if (r.hiddenAt) throw new ApiError('invalid_input', 'DrawMart has hidden this review.')
        const problem = replyError(reply)
        if (problem) throw new ApiError('invalid_input', problem)
        Object.assign(r, { reply: reply.trim(), repliedAt: iso(now()) })
        notify(db, r.userId, 'review_reply', r.listingId, iso(now()))
      }),

    getShopReviews: (merchantId, listingId) =>
      tx((db) => {
        const role = readSession()?.role
        const insider = role === 'admin' || (!!role && myShop(db) === merchantId)
        const visible = db.reviews.filter((r) => r.merchantId === merchantId && !r.hiddenAt)
        const open = visible.length >= REVIEWS_SHOWN_FROM || insider
        const list = db.reviews
          .filter((r) => r.merchantId === merchantId && (!listingId || r.listingId === listingId) && (!r.hiddenAt || insider))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 50)
        return {
          count: visible.length,
          shown: visible.length >= REVIEWS_SHOWN_FROM,
          average: open ? averageRating(visible.map((r) => r.rating)) : null,
          breakdown: open ? [5, 4, 3, 2, 1].map((s) => visible.filter((r) => r.rating === s).length) : null,
          listingCount: listingId ? visible.filter((r) => r.listingId === listingId).length : null,
          reviews: open ? list.map((r) => reviewView(db, r)) : [],
        }
      }),

    listAdminReviews: () =>
      tx((db) => {
        if (readSession()?.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
        return [...db.reviews]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 200)
          .map((r) => ({ ...reviewView(db, r), merchantName: db.merchants.find((m) => m.id === r.merchantId)!.name, hiddenReason: r.hiddenReason }))
      }),

    setReviewHidden: (reviewId, hidden, reason) =>
      tx((db) => {
        if (readSession()?.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
        if (hidden) {
          const problem = hideReasonError(reason)
          if (problem) throw new ApiError('invalid_input', problem)
        }
        const r = db.reviews.find((x) => x.id === reviewId)
        if (!r) throw new ApiError('not_found', 'That review doesn’t exist.')
        Object.assign(r, hidden ? { hiddenAt: r.hiddenAt ?? iso(now()), hiddenReason: reason.trim() } : { hiddenAt: null, hiddenReason: null })
      }),

    getShop: (merchantId) =>
      tx((db) => {
        const m = db.merchants.find((x) => x.id === merchantId)
        if (!m) throw new ApiError('not_found', 'That shop doesn’t exist.')
        return publicMerchant(m)
      }),

    updateShopProfile: (input) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const m = db.merchants.find((x) => x.id === shopId(db))!
        const problems = shopProfileErrors(input, m.kind)
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        Object.assign(m, {
          about: input.about.trim() || null, openingHours: input.openingHours.trim() || null, shopNote: input.shopNote.trim() || null,
          publicPhone: input.publicPhone.trim() || null, logoUrl: input.logoUrl, coverUrl: input.coverUrl, showCac: input.showCac,
        })
      }),

    getMerchantCacNumber: (merchantId) =>
      tx((db) => {
        const role = readSession()?.role
        if (!role || (role !== 'admin' && merchantId !== shopId(db))) throw new ApiError('forbidden', 'Only the shop and DrawMart can see this.')
        return db.merchants.find((m) => m.id === merchantId)?.cacNumber ?? ''
      }),

    getShopPickup: () => tx((db) => db.shopPickups[shopId(db)] ?? null),

    saveShopPickup: (input) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const errors = shopPickupErrors(input)
        if (errors.length) throw new ApiError('invalid_input', shopPickupErrorText(errors))
        const shop = shopId(db)
        db.shopPickups[shop] = { address: input.address.trim(), location: input.location, contactPhone: input.contactPhone.trim() }
        db.merchants.find((m) => m.id === shop)!.deliveryArea = nearestArea(input.location, db.deliveryPricing.areas)
      }),

    setShopDeliveryArea: (area) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        if (!db.deliveryPricing.areas.some((a) => a.id === area)) throw new ApiError('invalid_input', 'Pick an area.')
        db.merchants.find((m) => m.id === shopId(db))!.deliveryArea = area
      }),

    passCollection: (orderId, photos) =>
      tx((db) => {
        const problem = photosError(photos)
        if (problem) throw new ApiError('invalid_input', problem)
        const me = rider()
        const o = db.orders.find((x) => x.id === orderId && x.riderId === me && x.status === 'dispatched' && !x.collectedAt)
        if (!o) throw new ApiError('invalid_input', 'Only deliveries you’re about to collect can be checked.')
        o.collectedAt = iso(now())
        o.collectionPhotos = photos
      }),

    failCollection: (orderId, problems, note, photos) =>
      tx((db) => {
        const me = rider()
        const o = db.orders.find((x) => x.id === orderId && x.riderId === me && x.status === 'dispatched' && !x.collectedAt)
        if (!o) throw new ApiError('invalid_input', 'Only deliveries you’re about to collect can be checked.')
        if (o.isPrize) throw new ApiError('invalid_input', 'Won items aren’t checked here. Contact DrawMart.')
        const problem = collectionFailError(problems, photos)
        if (problem) throw new ApiError('invalid_input', problem)
        cancelOrderNow(db, o, 'failed_check', note, now())
        o.collectionProblems = problems
        o.collectionPhotos = photos
        penaliseSeller(db, o, now())
      }),

    refuseDelivery: (orderId, pin, reason, note, photo) =>
      tx((db) => {
        const me = rider()
        if (db.orders.some((x) => x.id === orderId && x.riderId === me && x.fulfilment === 'pickup')) throw new ApiError('invalid_input', 'Hand pickup orders to the counter staff. They complete them with the buyer.')
        const o = db.orders.find((x) => x.id === orderId && x.status === 'dispatched' && x.riderId === me && x.collectedAt)
        if (!o) throw new ApiError('invalid_input', 'Only deliveries you’re carrying can be refused.')
        if (o.isPrize) throw new ApiError('invalid_input', 'Won items can’t be refused here. Contact DrawMart.')
        if (!REFUSAL_REASONS.includes(reason)) throw new ApiError('invalid_input', 'Pick why it’s being refused.')
        if (!isDeliveryPin(pin)) throw new ApiError('invalid_input', 'Enter the buyer’s 6-digit PIN.')
        const problem = photosError([photo])
        if (problem) throw new ApiError('invalid_input', problem)
        const { result, state } = checkPin(o.pin, pin, o.pinState, now())
        o.pinState = state
        if (result.confirmed) {
          cancelOrderNow(db, o, reason, note, now())
          o.refusalPhoto = photo
          o.returnState = 'returning'
          penaliseSeller(db, o, now())
          earn(db, me, 'delivery', o.id, o, sellerArea(db, o), buyerArea(o), now())
        }
        return result
      }),

    completeReturn: (orderId, photo) =>
      tx((db) => {
        const problem = photosError([photo])
        if (problem) throw new ApiError('invalid_input', problem)
        const me = rider()
        const o = db.orders.find((x) => x.id === orderId && x.riderId === me && x.returnState === 'returning' && !waitingAtCounter(x))
        if (!o) throw new ApiError('invalid_input', 'Only items you’re taking back can be returned.')
        o.returnState = 'returned'
        o.returnedAt = iso(now())
        earn(db, me, 'return', o.id, o, o.atCounterAt ? pointArea(o) : buyerArea(o), sellerArea(db, o), now())
      }),

    liftSuspension: (merchantId) =>
      tx((db) => {
        const shop = db.merchants.find((m) => m.id === merchantId)
        if (!shop?.suspendedAt) throw new ApiError('invalid_input', 'This seller isn’t suspended.')
        shop.suspendedAt = null
      }),

    sellerConfirmOrder: (orderId, photo) =>
      tx((db) => {
        const o = db.orders.find((x) => x.id === orderId && x.handledBy === 'store' && x.merchantId === shopId(db))
        if (!o) throw new ApiError('not_found', 'That order doesn’t exist.')
        if (o.status !== 'paid' || !o.confirmBy) throw new ApiError('invalid_input', 'This order doesn’t need confirming.')
        if (!/^(https:\/\/|\/assets\/|data:image\/)/.test(photo)) throw new ApiError('invalid_input', 'Add a photo of the item.')
        o.confirmedAt = iso(now())
        o.confirmPhoto = photo
        o.readyBy ??= new Date(addConfirmTime(now(), CONFIRM_HOURS)).toISOString()
      }),

    cancelOrder: (orderId, reason, note) =>
      tx((db) => {
        requireShopPermission(db, 'shop')
        const o = db.orders.find((x) => x.id === orderId && x.handledBy === 'store' && x.merchantId === shopId(db))
        if (!o) throw new ApiError('not_found', 'That order doesn’t exist.')
        const problem = cancelError({ reason, note })
        if (problem) throw new ApiError('invalid_input', problem)
        if (o.isPrize) throw new ApiError('invalid_input', 'Won items can’t be cancelled here. Contact DrawMart.')
        if (!canCancelOrder(o)) throw new ApiError('invalid_input', 'Only orders that aren’t ready for a rider yet can be cancelled.')
        cancelOrderNow(db, o, reason, note, now())
      }),

    listCancelRates: () =>
      tx((db) => {
        const since = iso(now() - 30 * DAY)
        const recent = db.orders.filter((o) => !o.isPrize && o.createdAt >= since)
        return db.merchants.flatMap((m) => {
          const mine = recent.filter((o) => o.merchantId === m.id)
          const failed = mine.filter((o) => o.cancelReason === 'failed_check' || o.cancelReason === 'refused_wrong' || o.cancelReason === 'refused_damaged').length
          return mine.length || m.suspendedAt ? [{ merchantId: m.id, merchantName: m.name, orders: mine.length, cancelled: mine.filter((o) => o.status === 'cancelled' && o.cancelReason !== 'not_collected' && o.cancelReason !== 'not_delivered' && o.cancelReason !== 'incident').length, failed, suspended: !!m.suspendedAt }] : []
        })
      }),

    dispatchOrder: (orderId) =>
      tx((db) => {
        const admin = readSession()?.role === 'admin'
        const o = db.orders.find((x) => x.id === orderId && x.status === 'paid' && (x.handledBy === 'drawmart' ? admin : !admin && x.merchantId === shopId(db)))
        if (!o) throw new ApiError('invalid_input', 'Only paid orders you send yourself can be marked as sent.')
        if (needsConfirming(o)) throw new ApiError('invalid_input', 'Confirm it with a photo first.')
        if (o.handledBy === 'store' && !db.shopPickups[o.merchantId]) throw new ApiError('invalid_input', 'Add where riders collect from first.')
        o.status = 'dispatched'
        o.dispatchedAt = iso(now())
        // feeGroups.ts: joins the rider taking the rest of its group, if they haven't collected yet (private.join_rider_on_ready).
        const s = o.isPrize ? undefined : db.orders.filter((x) => x.id !== o.id && feeGroup(x) === feeGroup(o) && x.status === 'dispatched' && x.riderId && !x.atCounterAt).sort((a, b) => (a.riderTakenAt ?? '').localeCompare(b.riderTakenAt ?? ''))[0]
        if (s?.riderId && !db.orders.some((x) => onTripWith(x, s) && x.collectedAt)) {
          Object.assign(o, { riderId: s.riderId, riderTakenAt: s.riderTakenAt })
          notify(db, s.riderId, 'rider_job_added', o.listingId, iso(now()))
          return
        }
        alertNewJob(db, o, null, now())
      }),

    sendFirstMessage: (listingId, body) =>
      tx((db) => {
        const l = getListingOr404(db, listingId)
        if (readSession() && readSession()!.role !== 'buyer') throw new ApiError('forbidden', 'Only buyer accounts can message sellers.')
        if (l.kind !== 'product') throw new ApiError('invalid_input', 'Raffle items are held and checked by DrawMart, so there’s no seller chat.')
        if (l.status !== 'for_sale' && l.status !== 'sold') throw new ApiError('not_found', 'That item isn’t on sale.')
        if (l.merchantId === db.sellerShops[buyer()]) throw new ApiError('invalid_input', 'This is your own item.')
        // Check the text before creating anything.
        const problem = messageError(body)
        if (problem) throw new ApiError('invalid_input', problem)
        let c = db.conversations.find((x) => x.listingId === l.id && x.buyerId === buyer())
        if (!c) {
          const at = iso(now())
          c = { id: uid('C'), listingId: l.id, buyerId: buyer(), merchantId: l.merchantId, lastMessageAt: at, buyerReadAt: at, sellerReadAt: iso(0) }
          db.conversations.push(c)
        }
        postMessage(db, c, 'buyer', body)
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
        return postMessage(db, c, side, body)
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
        if (!l || !['live', 'sold_out', 'drawn', 'refunded', 'for_sale', 'sold'].includes(l.status)) return
        const role = readSession()?.role
        if (role && l.merchantId === myShop(db)) return // a seller looking at their own item
        const visitor = role ? `u:${readSession()!.userId}` : /^[A-Za-z0-9-]{8,64}$/.test(visitorId) ? `v:${visitorId}` : null
        if (!visitor) return
        const day = lagosDay(now())
        if (!db.views.some((v) => v.listingId === l.id && v.visitor === visitor && v.day === day)) db.views.push({ listingId: l.id, visitor, day })
      }),

    getMerchantMetrics: (days) =>
      tx((db): MerchantMetricsView => {
        requireShopPermission(db, 'shop')
        const shop = readSession() ? myShop(db) : null
        if (!shop) throw new ApiError('forbidden', 'Only sellers have insights.')
        const range = fillDays([], days, lagosDay(now()))
        const from = range[0].date
        const daily = new Map(range.map((d) => [d.date, { ...d }]))
        const today = range[range.length - 1].date
        const listings = db.listings
          .filter((l) => l.merchantId === shop && l.status !== 'rejected' && l.status !== 'withdrawn')
          .map((l): ListingMetrics => {
            for (const d of range) {
              const day = statsBetween(db, l, d.date, d.date)
              daily.get(d.date)!.views += day.views
              daily.get(d.date)!.salesKobo += day.salesKobo
            }
            return { listingId: l.id, productCode: l.productCode, title: l.title, image: l.images[0] ?? null, category: l.category, kind: l.kind, status: l.status, ...statsBetween(db, l, from, today) }
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
        requireShopPermission(db, 'shop')
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
            productCode: db.listings.find((l) => l.id === b.listingId)?.productCode ?? '',
            listingTitle: db.listings.find((l) => l.id === b.listingId)?.title ?? '',
            merchantName: db.merchants.find((m) => m.id === merchantId)?.name ?? '',
          }))
      }),

    getBoostInsights: (boostId) =>
      tx((db): BoostInsightsView => {
        requireShopPermission(db, 'shop')
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
        requireShopPermission(db, 'shop')
        const shop = myShop(db)
        if (!shop) throw new ApiError('forbidden', 'Only sellers can share a call number.')
        if (!phone?.trim()) {
          delete db.callPhones[shop]
          return
        }
        if (!isNigerianMobile(phone)) throw new ApiError('invalid_input', 'Enter a Nigerian mobile number, e.g. 0803 123 4567.')
        db.callPhones[shop] = phone.trim()
      }),

    getMySellerApplication: () => tx((db) => db.sellerApplications[buyer()] ?? null),

    submitSellerApplication: (input) =>
      tx((db) => {
        const prev = db.sellerApplications[buyer()]
        if (prev?.status === 'pending') throw new ApiError('invalid_input', 'Your application is already being reviewed.')
        if (prev?.status === 'approved') throw new ApiError('invalid_input', 'You’re already a verified seller.')
        const problems = validateSellerApplication(input).map((e) => SELLER_APPLICATION_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const at = iso(now())
        db.sellerApplications[buyer()] = {
          id: prev?.id ?? uid('S'), status: 'pending', shopName: input.shopName.trim(), legalName: input.legalName.trim(), nin: normalizeNin(input.nin),
          phone: input.phone.trim(), address: input.address.trim(), area: input.area.trim(), idPhotoUrl: input.idPhoto, selfieUrl: input.selfie,
          reviewNote: null, createdAt: prev?.createdAt ?? at, updatedAt: at, reviewedAt: null,
        }
        return db.sellerApplications[buyer()]
      }),

    getMyStoreApplication: () => tx((db) => db.storeApplications[buyer()] ?? null),

    submitStoreApplication: (input) =>
      tx((db) => {
        const me = buyer()
        const blocker = storeAccountBlocker(accountFacts(db, me))
        if (blocker) throw new ApiError('invalid_input', blocker)
        const prev = db.storeApplications[me]
        if (prev?.status === 'pending') throw new ApiError('invalid_input', 'Your application is already being reviewed.')
        if (prev?.status === 'approved') throw new ApiError('invalid_input', 'Your store is already approved.')
        const problems = validateStoreApplication(input).map((e) => STORE_APPLICATION_ERROR_TEXT[e])
        if (problems.length) throw new ApiError('invalid_input', problems.join(' '))
        const cac = normalizeCac(input.cacNumber)!
        if (db.merchants.some((m) => m.cacNumber === cac)) throw new ApiError('invalid_input', DUPLICATE_CAC_TEXT)
        const at = iso(now())
        db.storeApplications[me] = {
          id: prev?.id ?? uid('B'), status: 'pending', businessName: input.businessName.trim(), cacNumber: cac, directorName: input.directorName.trim(),
          phone: input.phone.trim(), address: input.address.trim(), area: input.area.trim(), certificateUrl: input.certificatePhoto, directorIdUrl: input.directorIdPhoto,
          reviewNote: null, createdAt: prev?.createdAt ?? at, updatedAt: at, reviewedAt: null,
        }
        return db.storeApplications[me]
      }),

    listStoreApplications: () =>
      tx((db) => Object.values(db.storeApplications).filter((a) => a.status === 'pending').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))),

    approveStoreApplication: (applicationId) =>
      tx((db) => {
        if (readSession() && readSession()!.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
        const [userId, a] = Object.entries(db.storeApplications).find(([, x]) => x.id === applicationId) ?? []
        if (!userId || !a || a.status !== 'pending') throw new ApiError('invalid_input', 'Only applications waiting for review can be approved.')
        if (storeAccountBlocker(accountFacts(db, userId)))
          throw new ApiError('invalid_input', 'This account has bought or sold on DrawMart since applying, so it can’t become a store. Ask them to apply from a new account.')
        if (db.merchants.some((m) => m.cacNumber === a.cacNumber)) throw new ApiError('invalid_input', 'A store with this CAC number is already on DrawMart.')
        const at = iso(now())
        const shop: Merchant = { id: uid('M'), kind: 'store', name: a.businessName, area: a.area, cacNumber: a.cacNumber, verified: true, verifiedAt: at }
        db.merchants.push(shop)
        db.storeAccounts[userId] = shop.id
        delete db.carts[userId]
        delete db.saved[userId]
        Object.assign(a, { status: 'approved', reviewedAt: at })
        notify(db, shop.id, 'store_approved', null, at)
      }),

    rejectStoreApplication: (applicationId, note) =>
      tx((db) => {
        if (readSession() && readSession()!.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
        if (note.trim().length < 5) throw new ApiError('invalid_input', 'Tell the applicant what to fix.')
        const a = Object.values(db.storeApplications).find((x) => x.id === applicationId)
        if (!a || a.status !== 'pending') throw new ApiError('invalid_input', 'Only applications waiting for review can be rejected.')
        Object.assign(a, { status: 'rejected', reviewNote: note.trim(), reviewedAt: iso(now()) })
      }),

    listSellerApplications: () =>
      tx((db) => Object.values(db.sellerApplications).filter((a) => a.status === 'pending').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))),

    approveSeller: (applicationId) =>
      tx((db) => {
        const [userId, a] = Object.entries(db.sellerApplications).find(([, x]) => x.id === applicationId) ?? []
        if (!userId || !a || a.status !== 'pending') throw new ApiError('invalid_input', 'Only applications waiting for review can be approved.')
        const shop: Merchant = { id: uid('M'), kind: 'individual', name: a.shopName, area: a.area, cacNumber: '', verified: true, verifiedAt: iso(now()) }
        db.merchants.push(shop)
        db.sellerShops[userId] = shop.id
        Object.assign(a, { status: 'approved', reviewedAt: iso(now()) })
      }),

    rejectSeller: (applicationId, note) =>
      tx((db) => {
        const a = Object.values(db.sellerApplications).find((x) => x.id === applicationId)
        if (note.trim().length < 5) throw new ApiError('invalid_input', 'Tell the applicant what to fix.')
        if (!a || a.id !== applicationId || a.status !== 'pending') throw new ApiError('invalid_input', 'Only applications waiting for review can be rejected.')
        Object.assign(a, { status: 'rejected', reviewNote: note.trim(), reviewedAt: iso(now()) })
      }),

    listPrizeOrders: () =>
      tx((db) => db.orders.filter((o) => o.handledBy === 'drawmart').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => orderView(db, o))),

    listPendingListings: () =>
      tx((db) => db.listings.filter((l) => l.status === 'pending_review').map((l) => listingView(db, l, 'full'))),

    approveListing: (id, revision) =>
      tx((db) => {
        const l = getListingOr404(db, id)
        if (l.status !== 'pending_review') throw new ApiError('invalid_input', 'Only listings in review can be approved.')
        if (db.merchants.find((m) => m.id === l.merchantId)?.suspendedAt) throw new ApiError('invalid_input', 'This seller is suspended. Lift it first.')
        const limit = l.kind === 'product' ? limitFor(db, l, l.priceKobo) : null
        if (limit) throw new ApiError('invalid_input', limit)
        if (revision !== undefined && revision !== (l.revision ?? 0)) throw new ApiError('invalid_input', 'The store just changed this listing. Check it again.')
        l.wasRejected = false
        l.reviewedPriceKobo = l.priceKobo
        notifyShop(db, l.merchantId, 'store_listing_approved', l.id, iso(now()))
        if (l.kind === 'product') {
          l.status = 'for_sale' // products skip the draw
          alertRelists(db, l, now())
          return
        }
        l.status = 'live'
        l.liveAt = iso(now())
        l.closesAt = iso(now() + l.durationDays * DAY) // the clock starts when it goes live
        alertRelists(db, l, now())
      }),

    rejectListing: (id, reason, note) =>
      tx((db) => {
        const l = getListingOr404(db, id)
        if (l.status !== 'pending_review') throw new ApiError('invalid_input', 'Only listings in review can be rejected.')
        const problem = rejectionError(l.kind, { reason, note })
        if (problem) throw new ApiError('invalid_input', REJECTION_ERROR_TEXT[problem])
        l.status = 'rejected'
        notifyShop(db, l.merchantId, 'store_listing_rejected', l.id, iso(now()))
        l.rejection = newRejection(reason, note)
        l.wasRejected = true
        l.cautionFee = settleCautionFee(l.cautionFee, 'rejected')
      }),

    demoSellOut: (listingId) =>
      tx(async (db) => {
        const l = getListingOr404(db, listingId)
        if (l.status !== 'live') throw new ApiError('not_live', PURCHASE_ERROR_TEXT.not_live)
        const at = iso(now())
        const ref = crowdBuys(db, l, l.ticketCount - l.ticketsSold, at)
        closeTicketSales(db, l, ref, now())
      }),

    demoRunDraw: (listingId) =>
      tx(async (db) => {
        const l = getListingOr404(db, listingId)
        if (l.status !== 'sold_out') throw new ApiError('invalid_input', 'Only sold-out draws can be announced.')
        l.drawAt = iso(now())
        await runDueDraws(db, now())
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

    resetTestData: async () => {
      if (readSession()?.role !== 'admin') throw new ApiError('forbidden', 'Admins only.')
      await queue
      store.removeItem(STORAGE_KEY) // the next call rebuilds the sample data
    },
  }
}
