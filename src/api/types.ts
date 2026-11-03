/**
 * The contract between the UI and whatever backend we pick.
 *
 * The UI only ever talks to `DrawMartApi`. Today it is backed by an in-browser
 * mock (src/api/mock.ts); later a real implementation (Supabase, NestJS, …)
 * implements the same interface and nothing in src/pages has to change.
 */
import type { HandoverDetails } from '@/domain/listing'
import type { PinResult } from '@/domain/delivery'
import type { SavedAddress, SavedAddressInput } from '@/domain/addresses'
import type { CheckoutDetails } from '@/domain/cart'
import type { DeliveryWindow } from '@/domain/deliveryWindows'
import type { IncidentOutcome, IncidentType } from '@/domain/incidents'
import type { DeliveryRating, DeliveryRatingReason, RiderPerformance, RiderStats } from '@/domain/deliveryRatings'
import type { DeliveryPricing } from '@/domain/deliveryFees'
import type { ShopPickup } from '@/domain/shopPickup'
import type { ShopProfileInput } from '@/domain/shopProfile'
import type { ReviewInput } from '@/domain/reviews'
import type { PricingStats } from '@/domain/drawPricing'
import type { DispatchStage } from '@/domain/dispatch'
import type { CodeCheck, Discount, DiscountInput, ListingSale } from '@/domain/discounts'
import type { StoreRole } from '@/domain/team'
import type { PayoutAccount, PayoutLine } from '@/domain/payouts'
import type { RiderEarning, RiderPayRates } from '@/domain/riderPay'
import type { NotificationPreference, PushPreferences, PushSubscriptionKeys } from '@/domain/push'
import type { OrderError } from '@/domain/orders'
import type { PurchaseError } from '@/domain/rules'
import type { BoostPackage, BoostWindow } from '@/domain/boosts'
import type { DayMetrics, ListingMetricsInput, MetricRange } from '@/domain/metrics'
import type { SellerApplicationInput, SellerApplicationStatus } from '@/domain/sellers'
import type { StoreApplicationInput, StoreApplicationStatus } from '@/domain/storeApplications'
import type { RiderApplicationInput, RiderApplicationStatus, VehicleType } from '@/domain/riderApplications'
import type {
  CancelReason,
  Category,
  ClaimKind,
  ClaimStatus,
  CollectionProblem,
  RefusalReason,
  PackageSize,
  RejectionReason,
  DrawResult,
  FeeMode,
  Handover,
  Kobo,
  LedgerEntry,
  ListingKind,
  Listing,
  ListingStatus,
  Merchant,
  NotificationKind,
  PickupPoint,
  Order,
  GeoPoint,
  OrderStatus,
  Fulfilment,
  UnsoldPolicy,
  User,
  WalletBalance,
} from '@/domain/types'

export interface DrawResultView extends DrawResult {
  productCode: string
  listingTitle: string
  /** Cover photo of the listing, if it has one. */
  listingImage: string | null
  ticketCount: number
  iWon: boolean
  myNumbers: number[]
  /** Consolation credit the current user got from this draw, if any. */
  myCreditKobo: Kobo
}

export interface ListingView extends Omit<Listing, 'handover'> {
  /** A store's sale running now (discounts.ts). Products only. */
  sale?: ListingSale | null
  /** Only for its own seller and admins: a new price waiting for review. */
  pendingPriceKobo?: Kobo | null
  /** Pickup/inspection booking. Only sent to the listing's store and admins; null for buyers. */
  handover: Handover | null
  merchant: Merchant
  myNumbers: number[]
  result: DrawResultView | null
}

export interface WalletView {
  balance: WalletBalance
  entries: LedgerEntry[] // newest first
  spentThisWeekKobo: Kobo
  weeklyLimitKobo: Kobo
  pendingLimit: { amountKobo: Kobo; effectiveAt: string } | null
  /** Paid top-ups the payment provider hasn't confirmed yet (e.g. a bank transfer on its way). */
  pendingDeposits: PendingDeposit[]
}

export interface PendingDeposit {
  txRef: string
  amountKobo: Kobo
  createdAt: string
}

/** Where a top-up ended up. 'cancelled': the buyer closed the checkout without paying. */
export type DepositStatus = 'successful' | 'pending' | 'failed' | 'cancelled'

export interface PurchaseReceipt {
  purchaseId: string
  numbers: number[]
  costKobo: Kobo
  /** True if this purchase sold the last ticket. The winner comes later, on `drawAt`. */
  soldOut: boolean
  drawAt: string | null
}

export interface NewListingInput {
  title: string
  description: string
  category: Category
  /** Optional photo URLs; escrow adds its own photos at check-in. */
  images?: string[]
  priceKobo: Kobo
  ticketPriceKobo: Kobo
  /** Who carries the platform fee. The rate itself is set by DrawMart from the price (platformFeeBps). */
  feeMode: FeeMode
  /** Days on sale once approved, RULES.minDurationDays..maxDurationDays. */
  durationDays: number
  unsoldPolicy: UnsoldPolicy
  /** Required when unsoldPolicy is 'convert_to_sale'. */
  fallbackPriceKobo?: Kobo
  /** Where and when to collect or inspect the item. The method follows from the category. */
  handover: HandoverDetails
}

/** Several draw items in one pickup, for one caution fee (the highest among them). */
export interface NewPickupInput {
  items: PickupItemInput[]
  handover: HandoverDetails
}

/** A draw item before its pickup is booked. */
export type PickupItemInput = Omit<NewListingInput, 'handover'>

/** Items a store has saved to send later. Gone after `expiresAt`. */
export interface SavedPickupView {
  items: PickupItemInput[]
  savedAt: string
  expiresAt: string
}

/** A regular product: sold outright at `priceKobo`, after admin review. No tickets, escrow or caution fee. */
export interface NewProductInput {
  title: string
  description: string
  category: Category
  images?: string[]
  /** How many they have. Left out by older callers: one. */
  stock?: number
  /** Left out by older callers: the usual size for its category. */
  packageSize?: PackageSize
  /** Proof the seller has it (listingChecks.ts). */
  check?: ListingProofInput
  /** The platform fee follows from this (platformFeeBps) and comes out of the seller's payout. */
  priceKobo: Kobo
}

/** Someone on a store's team (team.ts). Only the owner sees the team. */
export interface TeamMember {
  userId: string
  name: string
  email: string
  role: StoreRole
  you: boolean
  since: string
}

export interface StoreTeam {
  members: TeamMember[]
  /** Not accepted yet. */
  invites: { id: string; email: string; role: StoreRole; createdAt: string }[]
}

/** An invite to this account's email, from a store. */
export interface IncomingStoreInvite {
  id: string
  storeName: string
  role: StoreRole
  createdAt: string
}

/** Who did what in a store (team.ts ACTIVITY_TEXT). */
export interface StoreActivityEntry {
  id: string
  at: string
  who: string
  action: string
  listingTitle: string | null
  productCode: string | null
}

/** What a bulk upload did (bulkUpload.ts). */
export interface BulkUploadResult {
  created: number
  /** Picked for a spot check: not created. The store adds each with the form and a video. */
  checkTitles: string[]
}

export type SupportSender = 'shop' | 'drawmart'

/** A seller's saved chat answer (quickReplies.ts). Only the shop sees them. */
export interface QuickReply {
  id: string
  body: string
}

/** A message between a shop and DrawMart's team. Never says which admin wrote it. */
export interface SupportMessage {
  id: string
  sender: SupportSender
  body: string
  createdAt: string
}

/** The shop's own chat with DrawMart. */
export interface SupportThreadView {
  messages: SupportMessage[]
  /** DrawMart's replies the shop hasn't read. */
  unread: number
}

/** A chat in the admins' support inbox. */
export interface SupportThreadSummary {
  merchantId: string
  merchantName: string
  kind: Merchant['kind']
  lastMessageAt: string
  lastMessage: string
  lastSender: SupportSender
  /** The shop's messages no admin has read. */
  unread: number
  resolved: boolean
}

/** The buyer's review of an order, as the buyer and the shop see it. */
export interface OrderReview {
  id: string
  rating: number
  sellerComment: string
  productComment: string
  reply: string | null
  repliedAt: string | null
  hidden: boolean
  createdAt: string
}

/** A review as the public sees it: a first name, never the account. */
export interface ReviewView {
  id: string
  rating: number
  sellerComment: string
  productComment: string
  reply: string | null
  repliedAt: string | null
  createdAt: string
  /** First name only (reviews.ts reviewerName). */
  name: string
  listingId: string
  listingTitle: string
  productCode: string
  /** Hidden by DrawMart. Only the shop and admins get these. */
  hidden: boolean
}

export interface ShopReviews {
  /** Reviews that aren't hidden. */
  count: number
  /** Whether the public sees the rating yet (REVIEWS_SHOWN_FROM). */
  shown: boolean
  /** Null for the public until shown. The shop and admins always get it. */
  average: number | null
  /** How many gave 5 stars, 4, … down to 1. */
  breakdown: number[] | null
  /** Reviews of the one listing asked about. */
  listingCount: number | null
  /** The latest, newest first: of that listing if one was asked about. */
  reviews: ReviewView[]
}

export interface AdminReviewView extends ReviewView {
  merchantName: string
  hiddenReason: string | null
}

export interface OrderView extends Order {
  /** The buyer's review. Only the buyer, the shop and admins get it. */
  review: OrderReview | null
  productCode: string
  listingTitle: string
  listingImage: string | null
  category: Category
  merchantName: string
  /** What the buyer gives the rider on delivery. Only ever sent to the buyer, until it's delivered. */
  deliveryPin: string | null
  /** Who's bringing it: only to the buyer, only while a rider has it on the way (deliveryChat.ts). */
  rider?: RiderCard | null
  /** The buyer's own rating of the delivery (deliveryRatings.ts). Only the buyer gets it. */
  deliveryRating?: DeliveryRating | null
}

/** All a buyer learns about their rider. Never a phone number. */
export interface RiderCard {
  firstName: string
  photo: string | null
}

export interface DeliveryChatMessage {
  id: string
  sender: 'buyer' | 'rider'
  body: string
  createdAt: string
}

/** A chat between a buyer and the rider carrying their order, open until it arrives. */
export interface DeliveryChatView {
  open: boolean
  me: 'buyer' | 'rider'
  rider: RiderCard | null
  messages: DeliveryChatMessage[]
}

/** An order as a delivery account sees it. */
export interface DeliveryJob {
  id: string
  productCode: string
  listingTitle: string
  quantity: number
  /** The seller's photo, to compare with what's handed over. */
  confirmPhoto: string | null
  /** The rider has checked it and left with it. Won items count from the moment they're taken. */
  collected: boolean
  /** Refused at the door: going back to the seller. */
  returning: boolean
  listingImage: string | null
  category: Category
  fulfilment: Fulfilment
  status: OrderStatus
  dispatchedAt: string | null
  deliveredAt: string | null
  /** This rider has taken it. The rest are in the pool for anyone to take. */
  mine: boolean
  /** Where it's collected, so jobs from one place can go on one trip (trips.ts): 'shop:<id>', 'point:<id>' or 'drawmart'. */
  collectKey: string
  /** Orders sharing one delivery fee travel together and pay once (feeGroups.ts). payKobo is for the whole trip. */
  feeGroup: string
  /** Areas only, never an address (jobPool.ts). Null where it isn't known, e.g. DrawMart's escrow. */
  fromArea: string | null
  toArea: string | null
  size: PackageSize
  /** What it pays at today's rates, as the earning will be worked out. */
  payKobo: Kobo
  postedAt: string | null
  /** A new rider can't take this yet (riderApplications.ts newRiderLimitError). */
  locked: boolean
  /** A pickup order counter staff have taken in: the rider's job is done. */
  atCounterAt: string | null
  /** An uncollected item going back to the seller, still at the counter until staff hand it over. */
  waitingAtCounter: boolean
  /** The rider said they're at the door: the wait before a failed attempt (deliveryAttempts.ts). */
  arrivedAt: string | null
  failedAttempts: number
  /** Failed once: the rider keeps it while the buyer picks a new time or a pickup location. */
  awaitingBuyer: boolean
  /** The new window's start, once the buyer has picked one. */
  redeliverAt: string | null
  /** The buyer's delivery window. It can't be taken before 7am that day (deliveryWindows.ts canTakeYet). */
  windowStart: string | null
  windowEnd: string | null
  /** Taken but not yet collected: back to the pool at this time (riderLimits.ts). */
  collectBy: string | null
  /** The address and number only reach the rider on the way there, or taking a refused item back. */
  collectFrom: { name: string; area: string; address?: string; location?: GeoPoint; contactPhone?: string }
  pickupPoint: PickupPoint | null
  /** Only for the rider carrying it, once it's passed the check. Never in the pool, and gone once delivered. */
  dropOff: { buyerName: string; address: string; location: GeoPoint | null; contactPhone: string } | null
  pinLockedUntil: string | null
}

/** A rider with pay due from finished weeks, for admins (riderPay.ts). */
export interface RiderPayDue {
  riderId: string
  riderName: string
  account: PayoutAccount | null
  lines: RiderEarning[]
}

/** An order as counter staff see it (counter.ts). The buyer's name only once it's on the shelf. */
export interface CounterItem {
  id: string
  productCode: string
  listingTitle: string
  listingImage: string | null
  category: Category
  quantity: number
  /** On its way with a rider, waiting for its buyer, or going back to the seller. */
  stage: 'incoming' | 'shelf' | 'send_back'
  atCounterAt: string | null
  buyerName: string | null
  /** Won items stay until they're collected. */
  isPrize: boolean
  /** Send back: a rider has taken the job. */
  riderAssigned: boolean
  pinLockedUntil: string | null
}

/** Someone's request to ride. Only the applicant and admins ever see it. */
export interface RiderApplicationView {
  id: string
  status: RiderApplicationStatus
  fullName: string
  nin: string
  phone: string
  address: string
  area: string
  vehicle: VehicleType
  plate: string | null
  guarantorName: string
  guarantorPhone: string
  guarantorRelationship: string
  /** Short-lived signed URLs on Supabase. */
  idPhotoUrl: string | null
  selfieUrl: string | null
  reviewNote: string | null
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
}

/** A group of riders, e.g. a partner company's. Admins only. */
export interface RiderFleet {
  id: string
  name: string
  contactPhone: string
  /** Its riders skip the new-rider limits. */
  trusted: boolean
}

export interface AdminRider {
  id: string
  name: string
  photo: string | null
  fleetId: string | null
  trusted: boolean
  completed: number
  holding: number
  joinedAt: string
}

/** One active job on the admin dispatch board (dispatch.ts). Areas only, never an address. */
export interface DispatchJob {
  /** An order going to a buyer, a pickup location, or back to its seller; or a buyer's return. */
  kind: DispatchJobKind
  /** The order's id for a delivery, the claim's for a return. */
  id: string
  orderId: string
  stage: DispatchStage
  /** When it reached this stage. */
  since: string | null
  stuck: boolean
  productCode: string
  listingTitle: string
  listingImage: string | null
  shopName: string
  fromArea: string | null
  toArea: string | null
  isPrize: boolean
  fulfilment: Fulfilment
  pickupPointName: string | null
  failedAttempts: number
  /** Failed once: waiting for the buyer to choose a new time or a pickup location. */
  awaitingBuyer: boolean
  redeliverAt: string | null
  /** The buyer's delivery window, if they chose one. */
  windowStart: string | null
  windowEnd: string | null
  /** Who has it, with a number admins can call. */
  rider: { id: string; name: string; phone: string | null } | null
}

export type DispatchJobKind = 'delivery' | 'return'

/** An incident a rider reported, still open, for admins (incidents.ts). */
export interface OpenIncident {
  id: string
  kind: DispatchJobKind
  orderId: string
  type: IncidentType
  createdAt: string
  note: string | null
  photo: string | null
  location: GeoPoint | null
  productCode: string
  listingTitle: string
  isPrize: boolean
  orderStatus: OrderStatus
  collected: boolean
  rider: { id: string; name: string; phone: string | null } | null
}

/** A rider's own open report on a job. */
export interface MyIncident {
  id: string
  type: IncidentType
  createdAt: string
}

/** A rider's last STATS_DAYS, for admins (deliveryRatings.ts). Ratings never say who gave them. */
export interface RiderPerformanceRow extends RiderPerformance {
  name: string
  rider: { id: string; name: string; phone: string | null }
  /** The latest thumbs down, to look into. */
  recentDowns: { orderId: string; productCode: string; ratedAt: string; reasons: DeliveryRatingReason[] }[]
}

export interface DispatchBoard {
  /** app_settings: when a job counts as stuck (dispatch.ts). */
  waitingHours: number
  carryingHours: number
  /** The most jobs a rider can hold. */
  maxJobs: number
  /** Stuck first, then the longest waiting. */
  jobs: DispatchJob[]
}

/** A rider's own standing: what's still locked for a new rider. */
export interface RiderLevel {
  completed: number
  trusted: boolean
  jobsToUnlock: number
  maxKobo: Kobo
}

/** A business's request for a store. Only the applicant and admins ever see it. */
export interface StoreApplicationView {
  id: string
  status: StoreApplicationStatus
  businessName: string
  /** Normalised, e.g. "RC 1234567". */
  cacNumber: string
  directorName: string
  phone: string
  address: string
  area: string
  /** Viewable image URLs (short-lived signed URLs on Supabase). */
  certificateUrl: string | null
  directorIdUrl: string | null
  reviewNote: string | null
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
}

/** An individual's request to sell. Only the applicant and admins ever see it. */
export interface SellerApplicationView {
  id: string
  status: SellerApplicationStatus
  shopName: string
  legalName: string
  nin: string
  phone: string
  address: string
  area: string
  /** Viewable image URLs (short-lived signed URLs on Supabase). */
  idPhotoUrl: string | null
  selfieUrl: string | null
  /** Why it was rejected. */
  reviewNote: string | null
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
}

/** Which side of a conversation someone is on. */
export type ChatSide = 'buyer' | 'seller'

export interface ConversationView {
  id: string
  listingId: string
  productCode: string
  listingTitle: string
  listingImage: string | null
  category: Category
  priceKobo: Kobo
  listingStatus: ListingStatus
  merchantName: string
  buyerName: string
  /** The signed-in user's side. An individual seller can be on either side in different chats. */
  me: ChatSide
  lastMessage: { body: string; sender: ChatSide; createdAt: string } | null
  /** Messages from the other side since you last read the chat. */
  unread: number
  /** The seller's opt-in call number. Only ever sent to the buyer. */
  callPhone: string | null
  updatedAt: string
}

export interface ChatMessage {
  id: string
  conversationId: string
  sender: ChatSide
  body: string
  createdAt: string
}

/** One listing's views and sales over the chosen range. */
export interface ListingMetrics extends ListingMetricsInput {
  listingId: string
  productCode: string
  title: string
  image: string | null
  category: Category
  kind: ListingKind
  status: ListingStatus
}

export interface MerchantMetricsView {
  days: MetricRange
  /** Most viewed first. */
  listings: ListingMetrics[]
  /** One entry per day, oldest first, gaps filled with zeros. */
  daily: DayMetrics[]
}

export interface BoostStatus {
  /** Enough active buyers, or an admin switched boosts on. */
  unlocked: boolean
  /** Boosts that can still start right now, app-wide. */
  slotsLeft: number
  packages: BoostPackage[]
  /** Only for admins. */
  admin: BoostSettings & { activeBuyers: number } | null
}

export interface BoostSettings {
  /** Buyers active in the last 30 days needed to unlock boosts. */
  minActiveBuyers: number
  forcedOn: boolean
  /** Boosts running at once, app-wide. */
  maxActive: number
}

export interface BoostView {
  id: string
  /** Payment reference, to ask the provider again while it's pending. */
  txRef: string
  listingId: string
  productCode: string
  listingTitle: string
  merchantName: string
  days: number
  priceKobo: Kobo
  status: 'pending' | 'paid' | 'failed' | 'cancelled'
  startsAt: string | null
  endsAt: string | null
  createdAt: string
}

/** A boost's results so far, against the same number of days before it. */
export interface BoostInsightsView {
  window: BoostWindow
  before: ListingMetricsInput
  during: ListingMetricsInput
  /** From the first "before" day to the last boosted day, oldest first. */
  daily: DayMetrics[]
}

/** A payout line with what the seller needs to recognise it. */
export interface PayoutLineView extends PayoutLine {
  listingTitle: string
  productCode: string
}

export interface BankOption {
  code: string
  name: string
}

/** One seller's due payouts, for an admin to send. */
export interface DuePayoutGroup {
  merchantId: string
  merchantName: string
  account: PayoutAccount | null
  lines: PayoutLineView[]
}

export interface NotificationView {
  id: string
  kind: NotificationKind
  listingId: string
  listingTitle: string
  listingImage: string | null
  listingCategory: Category
  /** When a sold-out draw's winner is announced. */
  drawAt: string | null
  winningNumber: number | null
  /** A rider's alert: the delivery area it's collected in. Never an address. */
  area: string | null
  createdAt: string
  read: boolean
  /** A win the buyer has been greeted with. Separate from read: opening the bell isn't the pop-up. */
  celebrated: boolean
}

/** Never carries a user id: it's public, and wins aren't otherwise tied to accounts. */
export interface WinnerWallEntry {
  id: string
  firstName: string
  listingId: string
  productCode: string
  listingTitle: string
  listingImage: string | null
  category: Category
  winningNumber: number
  ticketCount: number
  drawnAt: string
}

export interface MyWinnerStory {
  listingId: string
  listingTitle: string
  firstName: string
  status: 'pending' | 'approved' | 'rejected'
  consentAt: string
}

export interface PendingWinnerStory {
  id: string
  firstName: string
  listingId: string
  productCode: string
  listingTitle: string
  consentAt: string
}

/** One item in a buyer's cart. */
export interface CartLine {
  listing: ListingView
  /** What the quantity costs today (0 for a won item); null if it's no longer available. */
  amountKobo: Kobo | null
  /** What can be bought now. Below `wanted` if stock has run low since it was added. */
  quantity: number
  wanted: number
}

export interface ListingProofInput {
  code: string
  video?: Blob | null
  serial?: string
  /** A photo of a receipt, as a data URL. */
  proof?: string | null
}

export interface ListingCheckPlan {
  code: string
  videoRequired: boolean
  individual: boolean
  /** Only for new individual sellers, with their progress towards the limits ending. */
  newSeller: { deliveries: number; live: number } | null
}

/** Only for the seller and admins. */
export interface ListingCheckView {
  code: string | null
  /** A video was sent, whether or not this link still works. */
  hasVideo: boolean
  videoUrl: string | null
  serial: string | null
  proofUrl: string | null
}

export interface ClaimInput {
  kind: ClaimKind
  description: string
  photos: string[]
  /** Only when the order has no delivery address to collect from. */
  address?: string
  location?: GeoPoint | null
  phone?: string
}

export interface ClaimReview {
  id: string
  kind: ClaimKind
  description: string
  photos: string[]
  createdAt: string
  orderId: string
  productCode: string
  listingTitle: string
  listingImage: string | null
  priceKobo: Kobo
  merchantName: string
  confirmPhoto: string | null
  collectionPhotos: string[]
  refusalPhoto: string | null
  cancelReason: CancelReason | null
}

export interface ReturnJob {
  id: string
  kind: ClaimKind
  status: ClaimStatus
  mine: boolean
  /** Areas only, never an address (jobPool.ts). Null where it isn't known, e.g. DrawMart's escrow. */
  fromArea: string | null
  toArea: string | null
  size: PackageSize
  /** What it pays at today's rates, as the earning will be worked out. */
  payKobo: Kobo
  postedAt: string | null
  /** A new rider can't take this yet (riderApplications.ts newRiderLimitError). */
  locked: boolean
  /** Taken but not yet collected from the buyer: back to the pool at this time (riderLimits.ts). */
  collectBy: string | null
  productCode: string
  listingTitle: string
  listingImage: string | null
  quantity: number
  category: Category
  /** Details only for the rider carrying it back. */
  returnTo: { name: string; area: string; address?: string; location?: GeoPoint; contactPhone?: string }
  /** Only for the rider on the way to collect it. */
  pickupFrom: { buyerName: string; address: string; location: GeoPoint; contactPhone: string } | null
}

export interface CancelRateView {
  merchantId: string
  merchantName: string
  orders: number
  cancelled: number
  /** Of those, failed checks and refusals. */
  failed: number
  suspended: boolean
}

export interface PriceReviewView {
  listing: ListingView
  newPriceKobo: Kobo
  requestedAt: string
}

export interface CheckoutInput extends CheckoutDetails {
  listingIds: string[]
  /** By listing id. A listing not in here is one. */
  quantities?: Record<string, number>
  /** The total the buyer saw: it's refused if a price has changed since. */
  expectedTotalKobo?: Kobo
  /** A store's discount code (discounts.ts). */
  code?: string
  /** A delivery window (deliveryWindows.ts). None: as soon as it's ready. Delivery only. */
  window?: DeliveryWindow | null
}

export interface ListingFilter {
  category?: Category
  status?: ListingStatus[]
  merchantId?: string
}

export type ApiErrorCode = PurchaseError | OrderError | 'not_found' | 'invalid_input' | 'forbidden'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  constructor(code: ApiErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiError'
  }
}

/** Buyer, store and admin are separate apps; every account belongs to exactly one. */
export type AccountRole = 'buyer' | 'store' | 'admin' | 'delivery'

export interface AuthSession {
  userId: string
  email: string | null
  role: AccountRole
}

/** A ready-made account the sign-in page can fill in (the mock, or a local database). */
export interface DemoAccount {
  email: string
  password: string
  role: AccountRole
  name: string
  /** The mock's user id (buyers) or store id (stores). */
  mockId: string
  /** Shown under the name, e.g. "ID-verified seller". */
  note?: string
  /** Counter staff: the pickup location they work at. */
  pickupPointId?: string
}

export interface AuthAdapter {
  /** False when the backend can't send email (the mock): only demo accounts work. */
  readonly emailLinks: boolean
  readonly demoAccounts: readonly DemoAccount[]
  getSession(): Promise<AuthSession | null>
  /** Calls back on sign-in and sign-out. Returns an unsubscribe function. */
  onChange(callback: (session: AuthSession | null) => void): () => void
  /** Emails a one-time sign-in link that returns to `redirectTo`. Creates the account on first use. */
  sendSignInLink(email: string, redirectTo: string): Promise<void>
  /** For accounts that have a password, e.g. the local demo accounts. */
  signInWithPassword(email: string, password: string): Promise<void>
  signOut(): Promise<void>
}

/**
 * Real top-ups through a payment provider. Absent when top-ups are instant
 * test money (the mock, or no provider configured); use `topUp` then.
 */
export interface PaymentsAdapter {
  /** Shown to buyers, e.g. "Flutterwave". */
  readonly provider: string
  /** Opens the provider's checkout and resolves once the buyer finishes or leaves. */
  deposit(amountKobo: Kobo): Promise<DepositStatus>
  /** Asks the provider again about a pending deposit. */
  checkDeposit(txRef: string): Promise<DepositStatus>
}

export interface DrawMartApi {
  /** True while no real money moves: test top-ups, demo controls and the test banner. */
  readonly testMode: boolean
  readonly auth: AuthAdapter
  /** Present when top-ups go through a payment provider. */
  readonly payments?: PaymentsAdapter
  /** What this device signs up for push notifications with. Null when they aren't set up. */
  readonly pushPublicKey: string | null

  // Session
  getCurrentUser(): Promise<User>
  updateProfile(patch: Partial<Pick<User, 'state' | 'displayName' | 'phone'>>): Promise<User>

  // Saved delivery addresses
  /** The buyer's own, default first. */
  listAddresses(): Promise<SavedAddress[]>
  /** Adds one, or updates it when `id` is set. The first saved becomes the default. */
  saveAddress(input: SavedAddressInput): Promise<SavedAddress[]>
  setDefaultAddress(id: string): Promise<SavedAddress[]>
  /** Removing the default hands it to the oldest one left. Orders keep their own copy. */
  deleteAddress(id: string): Promise<SavedAddress[]>

  // Buyer
  listListings(filter?: ListingFilter): Promise<ListingView[]>
  getListing(id: string): Promise<ListingView>
  /** Counts a listing page view for seller insights. `visitorId` identifies a signed-out browser; at most one view per visitor per day counts. */
  recordListingView(listingId: string, visitorId: string): Promise<void>
  buyTickets(listingId: string, quantity: number): Promise<PurchaseReceipt>
  listMyListings(): Promise<ListingView[]>
  listResults(): Promise<DrawResultView[]>
  listCart(): Promise<CartLine[]>
  /** Regular products and draws the buyer has won. Never cars. If it's already there, this sets its quantity. */
  addToCart(listingId: string, quantity?: number): Promise<void>
  removeFromCart(listingId: string): Promise<void>
  /** Which kinds of push notification this buyer wants. Everything's on until they say otherwise. */
  getPushPreferences(): Promise<PushPreferences>
  setPushPreference(category: NotificationPreference, enabled: boolean): Promise<void>
  /** Only the browsers' own push services. Sending is Supabase only: the mock just keeps the record. */
  savePushSubscription(subscription: PushSubscriptionKeys): Promise<void>
  /** Your own device only. Fine if it's already gone. */
  deletePushSubscription(endpoint: string): Promise<void>
  /** Public: winners who chose to be shown and were approved. First name only. */
  listWinnersWall(): Promise<WinnerWallEntry[]>
  /** This buyer's own stories, not counting any withdrawn. */
  listMyWinnerStories(): Promise<MyWinnerStory[]>
  /** The winner of the draw only. Goes back for review every time. */
  shareWinnerStory(input: { listingId: string; firstName: string; consent: boolean }): Promise<void>
  /** Takes it off the wall and removes the name. Fine if there's nothing to withdraw. */
  withdrawWinnerStory(listingId: string): Promise<void>
  listPendingWinnerStories(): Promise<PendingWinnerStory[]>
  reviewWinnerStory(id: string, approve: boolean): Promise<void>
  /** This buyer's saved items, newest first. Only they can read them. */
  listSavedListings(): Promise<ListingView[]>
  listSavedIds(): Promise<string[]>
  saveListing(listingId: string): Promise<void>
  unsaveListing(listingId: string): Promise<void>
  listPickupPoints(): Promise<PickupPoint[]>
  /**
   * Orders items on sale and won items together, paid from the wallet (store
   * credit first), all or none, and takes them out of the cart. A car goes on its own.
   */
  checkout(input: CheckoutInput): Promise<OrderView[]>
  listMyOrders(): Promise<OrderView[]>

  /** Views and sales of the signed-in shop's listings (store or individual seller). */
  getMerchantMetrics(days: MetricRange): Promise<MerchantMetricsView>

  // Boosts: sellers pay to show a listing first, marked Sponsored
  getBoostStatus(): Promise<BoostStatus>
  /** Pays for a boost (Flutterwave checkout, or pretend money in test mode) and starts it once paid. */
  buyBoost(listingId: string, packageId: string): Promise<DepositStatus>
  /** The shop's own boosts; every boost for admins. Newest first. */
  listBoosts(): Promise<BoostView[]>
  setBoostSettings(settings: BoostSettings): Promise<void>
  /** Views, chats and sales during a paid boost, and the same number of days before it. */
  getBoostInsights(boostId: string): Promise<BoostInsightsView>

  // Messages: buyer ↔ seller chat about a regular product
  /**
   * A buyer's message about a product. Creates the conversation if this is the
   * first one: a chat only exists once something is said, so sellers never
   * see empty ones. Later messages use sendMessage.
   */
  sendFirstMessage(listingId: string, body: string): Promise<ConversationView>
  /** Every conversation the signed-in user is in, on either side, newest first. */
  listConversations(): Promise<ConversationView[]>
  listMessages(conversationId: string): Promise<ChatMessage[]>
  sendMessage(conversationId: string, body: string): Promise<ChatMessage>
  markConversationRead(conversationId: string): Promise<void>
  /** The signed-in seller's opt-in call number (null: calls off). */
  getCallPhone(): Promise<string | null>
  setCallPhone(phone: string | null): Promise<void>

  // Individual sellers (buyer accounts that sell regular products)
  getMySellerApplication(): Promise<SellerApplicationView | null>
  /** A business applying for a store, from the account that will become the store's. */
  /** Whether rider sign-up is open. Anyone can ask. */
  getRiderSignupsOpen(): Promise<boolean>
  getMyRiderApplication(): Promise<RiderApplicationView | null>
  submitRiderApplication(input: RiderApplicationInput): Promise<RiderApplicationView>
  getMyStoreApplication(): Promise<StoreApplicationView | null>
  submitStoreApplication(input: StoreApplicationInput): Promise<StoreApplicationView>
  /** Uploads the ID photos and queues the application for an admin. Also used to resubmit after a rejection. */
  submitSellerApplication(input: SellerApplicationInput): Promise<SellerApplicationView>

  // Notifications
  /** Newest first. */
  listNotifications(): Promise<NotificationView[]>
  markNotificationsRead(): Promise<void>
  /** The pop-up for this win has been shown, so it won't show again on any device. */
  /** The buyer has seen how this draw turned out, won or lost. Once across devices. */
  markWinCelebrated(listingId: string): Promise<void>

  // Wallet
  getWallet(): Promise<WalletView>
  /** Instant test money. Errors outside test mode; real top-ups use `payments`. */
  topUp(amountKobo: Kobo): Promise<void>
  setWeeklyLimit(amountKobo: Kobo): Promise<void>

  // Merchant
  getMyMerchant(): Promise<Merchant>
  listMerchantListings(): Promise<ListingView[]>
  /** Charges the caution fee for the category and queues the listing for pickup/inspection and review. */
  createListing(input: NewListingInput): Promise<ListingView>
  /** Queues 2 or more items for one pickup and review, all or none. Cars can't share a pickup. */
  createListingBatch(input: NewPickupInput): Promise<ListingView[]>
  /** The store's saved items, or null if there are none or they've expired. */
  getSavedPickup(): Promise<SavedPickupView | null>
  /** Replaces the saved items; an empty list removes them. Edits don't extend the deadline. */
  savePickupItems(items: PickupItemInput[]): Promise<SavedPickupView | null>
  /** Queues a regular product for admin review. */
  /** Changes a listing that's still in review, up to its pickup or inspection day. */
  updateListing(id: string, input: NewListingInput | NewProductInput): Promise<ListingView>
  /** Hidden from browse and search, but kept, with its insights and chats. Products only. */
  pauseListing(id: string): Promise<void>
  resumeListing(id: string): Promise<void>
  /** Adds (or, if negative, removes) stock. Products only. */
  changeStock(id: string, change: number): Promise<void>
  /** Applies now, or waits for an admin if it's a big change (true). It keeps selling at the old price until then. */
  changePrice(id: string, priceKobo: Kobo): Promise<boolean>
  listPriceReviews(): Promise<PriceReviewView[]>
  /** `newPriceKobo` is the price the admin saw; it fails if the seller has changed it since. */
  reviewPriceChange(id: string, newPriceKobo: Kobo, approve: boolean): Promise<void>
  /** Takes back a listing that's still in review, up to its pickup or inspection day. */
  withdrawListing(id: string): Promise<void>
  /** Takes one of this store's rejected listings back to review with its fixed details. */
  resubmitListing(id: string, input: NewListingInput | NewProductInput): Promise<ListingView>
  createProduct(input: NewProductInput): Promise<ListingView>
  /** Orders for this store's items, with delivery details. */
  listMerchantOrders(): Promise<OrderView[]>
  listPayouts(): Promise<PayoutLineView[]>
  /** The seller's account, or a rider's own. */
  getPayoutAccount(): Promise<PayoutAccount | null>
  listBanks(): Promise<BankOption[]>
  /** Asks the bank whose account this is. Saves nothing. */
  lookupBankAccount(bankCode: string, accountNumber: string): Promise<{ accountName: string }>
  /** Looks the account up again on the server and saves it. A change holds payouts for a while. */
  savePayoutAccount(bankCode: string, accountNumber: string): Promise<void>
  /** Admin: what's due, per seller. */
  listDuePayouts(): Promise<DuePayoutGroup[]>
  /** Admin: after sending the transfer. One seller at a time. */
  markPayoutsPaid(ids: string[], reference: string): Promise<void>
  /** The store has sent the item. */
  dispatchOrder(orderId: string): Promise<void>
  /** A seller's fresh photo of the item, needed before a rider can take it. */
  sellerConfirmOrder(orderId: string, photo: string): Promise<void>
  /** Before it's ready for a rider. The buyer is refunded straight away, the way they paid. */
  cancelOrder(orderId: string, reason: CancelReason, note: string): Promise<void>
  /** The rider's check at the seller passed. */
  passCollection(orderId: string, photos: string[]): Promise<void>
  /** It didn't: the buyer is refunded with a small credit, and the seller is charged. */
  failCollection(orderId: string, problems: CollectionProblem[], note: string, photos: string[]): Promise<void>
  /** The buyer refused it at the door. Needs their PIN, so a rider can't claim it alone. */
  refuseDelivery(orderId: string, pin: string, reason: RefusalReason, note: string, photo: string): Promise<PinResult>
  /** A refused item is back with the seller. */
  completeReturn(orderId: string, photo: string): Promise<void>
  liftSuspension(merchantId: string): Promise<void>
  /** A fault report or a return, within 48 hours of delivery. Only needs an address if it was collected from a pickup location. */
  openClaim(orderId: string, input: ClaimInput): Promise<void>
  /** After a failed attempt: a new two-hour window, or a pickup location instead. */
  chooseRedelivery(orderId: string, choice: { windowStart: string } | { pickupPointId: string }): Promise<void>
  /** A seller who thinks a failed check or refusal was wrong. */
  contestFailure(orderId: string, note: string): Promise<void>
  /** Fault reports and contests waiting for an admin. */
  listOpenClaims(): Promise<ClaimReview[]>
  reviewClaim(claimId: string, approve: boolean, note: string): Promise<void>
  listReturnJobs(): Promise<ReturnJob[]>
  takeReturn(claimId: string): Promise<void>
  releaseReturn(claimId: string): Promise<void>
  /** The rider has it: this is when the buyer is refunded. */
  passReturnPickup(claimId: string, photos: string[]): Promise<void>
  failReturnPickup(claimId: string, note: string, photos: string[]): Promise<void>
  finishReturn(claimId: string, photo: string): Promise<void>
  /** Issues the code to show in the video, and says what the listing form must ask for. */
  getListingCheckPlan(): Promise<ListingCheckPlan>
  getListingCheck(listingId: string): Promise<ListingCheckView | null>
  /** What this account can do in its shop. Individual sellers own theirs; null without a shop. */
  getMyStoreRole(): Promise<StoreRole | null>
  /** Owners only. */
  getStoreTeam(): Promise<StoreTeam>
  inviteStoreMember(email: string, role: StoreRole): Promise<void>
  revokeStoreInvite(id: string): Promise<void>
  setStoreMemberRole(userId: string, role: StoreRole): Promise<void>
  /** Their account becomes a buyer account again. */
  removeStoreMember(userId: string): Promise<void>
  listStoreActivity(): Promise<StoreActivityEntry[]>
  /** For a buyer account: stores that invited its email. */
  listMyStoreInvites(): Promise<IncomingStoreInvite[]>
  /** The account becomes a store account on that store's team. */
  acceptStoreInvite(id: string): Promise<void>
  /** Stores only: up to 100 products, all or nothing. Photos go up first; `onProgress` counts them. */
  createProductsBulk(items: NewProductInput[], onProgress?: (done: number, total: number) => void): Promise<BulkUploadResult>
  /** The signed-in shop's discounts, newest first. */
  listDiscounts(): Promise<Discount[]>
  createDiscount(input: DiscountInput): Promise<void>
  /** Stops it now. Orders already placed keep their price. */
  endDiscount(id: string): Promise<void>
  /** What a code does to these items. Changes nothing. */
  checkDiscountCode(code: string, listingIds: string[]): Promise<CodeCheck>
  /** How finished draws did in this category and ticket band (drawPricing.ts). Stores and admins. */
  getDrawPriceStats(category: Category, band: number): Promise<PricingStats>
  /** The signed-in shop's saved chat answers, oldest first. */
  listQuickReplies(): Promise<QuickReply[]>
  /** Without an id it adds one; with one it changes it. */
  saveQuickReply(input: { id?: string; body: string }): Promise<void>
  deleteQuickReply(id: string): Promise<void>
  /** The signed-in shop's chat with DrawMart. */
  getSupportThread(): Promise<SupportThreadView>
  sendSupportMessage(body: string): Promise<void>
  /** No shop: the shop read its own chat. A shop: an admin read that one. */
  markSupportRead(merchantId?: string): Promise<void>
  listSupportThreads(): Promise<SupportThreadSummary[]>
  getSupportMessages(merchantId: string): Promise<SupportMessage[]>
  replySupport(merchantId: string, body: string): Promise<void>
  setSupportResolved(merchantId: string, resolved: boolean): Promise<void>
  /** After delivery (reviews.ts). Changes it if there's one already. */
  submitReview(orderId: string, input: ReviewInput): Promise<void>
  /** The shop's one reply. */
  replyToReview(reviewId: string, reply: string): Promise<void>
  getShopReviews(merchantId: string, listingId?: string): Promise<ShopReviews>
  listAdminReviews(): Promise<AdminReviewView[]>
  setReviewHidden(reviewId: string, hidden: boolean, reason: string): Promise<void>
  /** A shop's public page. */
  getShop(merchantId: string): Promise<Merchant>
  updateShopProfile(input: ShopProfileInput): Promise<void>
  /** The shop's own, or any for admins. */
  getMerchantCacNumber(merchantId: string): Promise<string>
  /** Where riders collect from this seller. Null until they've said. */
  getShopPickup(): Promise<ShopPickup | null>
  /** Also sets the shop's delivery area from the pin. */
  saveShopPickup(input: ShopPickup): Promise<void>
  /** What delivery costs, for checkout and the admin page. Public, since it's only prices. */
  getDeliveryPricing(): Promise<DeliveryPricing>
  setDeliveryPrice(areaA: string, areaB: string, priceKobo: Kobo): Promise<void>
  /** What riders are paid per trip, beside the delivery prices (riderPay.ts). */
  getRiderPayRates(): Promise<RiderPayRates>
  setRiderPay(areaA: string, areaB: string, payKobo: Kobo): Promise<void>
  setRiderSizeExtra(size: PackageSize, extraKobo: Kobo): Promise<void>
  setRiderAttemptPay(payKobo: Kobo): Promise<void>
  /** The signed-in rider's earnings, newest first. */
  listMyEarnings(): Promise<RiderEarning[]>
  listRiderPayDue(): Promise<RiderPayDue[]>
  /** Everything from finished weeks, sent by hand with this transfer reference. */
  markRiderPaid(riderId: string, reference: string): Promise<void>
  setDeliverySizeExtra(size: PackageSize, extraKobo: Kobo): Promise<void>
  /** Where this seller's items leave from. */
  setShopDeliveryArea(area: string): Promise<void>
  /** Each seller's orders and cancellations in the last 30 days. Admins only. */
  listCancelRates(): Promise<CancelRateView[]>

  // Admin
  listPendingListings(): Promise<ListingView[]>
  /** `revision` is the version the admin was looking at; it fails if the store has changed it since. */
  approveListing(id: string, revision?: number): Promise<void>
  /** Rejected listings go back to the store with this reason, to fix and send again. */
  rejectListing(id: string, reason: RejectionReason, note: string): Promise<void>
  /** Won items DrawMart sends from escrow, newest first. */
  listPrizeOrders(): Promise<OrderView[]>

  // Delivery accounts
  /** Areas this rider wants new jobs from. Empty means all of Lagos (riderAlerts.ts). */
  getRiderAreas(): Promise<string[]>
  setRiderAreas(areas: string[]): Promise<void>
  /** Orders ready to be taken, and this rider's own. */
  listDeliveryJobs(): Promise<DeliveryJob[]>
  takeDelivery(orderId: string): Promise<void>
  /** Several on one trip: all or none, within the job limit (trips.ts). */
  takeDeliveries(orderIds: string[]): Promise<void>
  /** Back in the pool. */
  releaseDelivery(orderId: string): Promise<void>
  /** The only way an order becomes delivered. A wrong PIN isn't an error: see the result. */
  confirmDelivery(orderId: string, pin: string): Promise<PinResult>
  getRiderLevel(): Promise<RiderLevel>
  /** The rider's own first name and photo, as buyers see them. */
  getRiderProfile(): Promise<RiderCard>
  /** A photo of the rider, from the camera. */
  setRiderPhoto(photo: string): Promise<void>
  /** For the buyer, or the rider carrying it. Empty once it's closed. */
  getDeliveryChat(orderId: string): Promise<DeliveryChatView>
  sendDeliveryMessage(orderId: string, body: string): Promise<void>
  /** The rider is at the door: starts the wait. Returns when it started. */
  markArrived(orderId: string): Promise<string>
  /** The buyer couldn't be reached, with a photo and where the rider is. */
  failDeliveryAttempt(orderId: string, photo: string, at: GeoPoint): Promise<void>
  /** The pickup location this account works at, or null for a rider. */
  getMyCounter(): Promise<PickupPoint | null>
  listCounterItems(): Promise<CounterItem[]>
  /** Counter staff take in a rider's item, checking its product ID. */
  receiveAtCounter(orderId: string, productCode: string): Promise<void>
  /** The buyer collects with their PIN. A wrong PIN isn't an error: see the result. */
  counterHandOver(orderId: string, pin: string): Promise<PinResult>
  /** An uncollected item leaves with the rider taking it back. */
  releaseToRider(orderId: string): Promise<void>
  /** Applications waiting for an ID check, oldest first. */
  listSellerApplications(): Promise<SellerApplicationView[]>
  listStoreApplications(): Promise<StoreApplicationView[]>
  /** Rider sign-up, for admins (riderApplications.ts). */
  setRiderSignupsOpen(open: boolean): Promise<void>
  listRiderApplications(): Promise<RiderApplicationView[]>
  /** Turns the applicant's account into a delivery account. */
  approveRiderApplication(applicationId: string): Promise<void>
  rejectRiderApplication(applicationId: string, note: string): Promise<void>
  listRiderFleets(): Promise<RiderFleet[]>
  createRiderFleet(name: string, contactPhone: string): Promise<void>
  setFleetTrusted(fleetId: string, trusted: boolean): Promise<void>
  listRiders(): Promise<AdminRider[]>
  setRiderFleet(riderId: string, fleetId: string | null): Promise<void>
  setRiderTrusted(riderId: string, trusted: boolean): Promise<void>
  /** Every active delivery and return, for admins (dispatch.ts). */
  getDispatchBoard(): Promise<DispatchBoard>
  /** One tap: the rider reports a problem on a job they have (incidents.ts). Pauses the job and tells admins. Returns the report's id. */
  reportIncident(kind: DispatchJobKind, id: string, type: IncidentType, at: GeoPoint | null): Promise<string>
  /** What can follow: a note, a photo (data URL or path) and where they are. */
  addIncidentDetails(incidentId: string, details: { note?: string; photo?: string; at?: GeoPoint | null }): Promise<void>
  /** The rider's open reports, by order or claim id. */
  getMyOpenIncidents(): Promise<Record<string, MyIncident>>
  /** Admins: open reports, oldest first. */
  listOpenIncidents(): Promise<OpenIncident[]>
  resolveIncident(incidentId: string, outcome: IncidentOutcome, note: string): Promise<void>
  /** The buyer rates a delivery to their door: thumbs up, or down with optional reasons (deliveryRatings.ts). Changeable for a week. */
  rateDelivery(orderId: string, good: boolean, reasons: DeliveryRatingReason[]): Promise<void>
  /** A rider's own last 30 days: totals only. */
  getMyRiderStats(): Promise<RiderStats>
  /** Every rider's last 30 days, for admins. */
  getRiderPerformance(): Promise<RiderPerformanceRow[]>
  /** A job waiting in the pool, to this rider, within their limits. */
  assignJob(kind: DispatchJobKind, id: string, riderId: string): Promise<void>
  /** Back in the pool. Only before the rider has collected it. */
  unassignJob(kind: DispatchJobKind, id: string): Promise<void>
  /** Creates the store and turns the applicant's account into its account. */
  approveStoreApplication(applicationId: string): Promise<void>
  rejectStoreApplication(applicationId: string, note: string): Promise<void>
  /** Creates the seller's shop. */
  approveSeller(applicationId: string): Promise<void>
  rejectSeller(applicationId: string, note: string): Promise<void>

  // Demo-only helpers (errors outside test mode; admins only on a real backend)
  /** Sells the remaining tickets. The winner still waits for the announcement date. */
  demoSellOut(listingId: string): Promise<void>
  /** Announces a sold-out draw's winner now instead of waiting. */
  demoRunDraw(listingId: string): Promise<void>
  demoExpire(listingId: string): Promise<void>
  /** Wipes all data. Only the in-browser mock can do this. */
  demoReset?(): Promise<void>
  /**
   * Admins, test mode only: puts every listing, ticket, order, payment, chat,
   * boost and view back to the sample data, and every buyer back to the
   * starting balance. Accounts are kept.
   */
  resetTestData(): Promise<void>
}
