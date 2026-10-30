/**
 * The contract between the UI and whatever backend we pick.
 *
 * The UI only ever talks to `DrawMartApi`. Today it is backed by an in-browser
 * mock (src/api/mock.ts); later a real implementation (Supabase, NestJS, …)
 * implements the same interface and nothing in src/pages has to change.
 */
import type { HandoverDetails } from '@/domain/listing'
import type { OrderError } from '@/domain/orders'
import type { PurchaseError } from '@/domain/rules'
import type { BoostPackage, BoostWindow } from '@/domain/boosts'
import type { DayMetrics, ListingMetricsInput, MetricRange } from '@/domain/metrics'
import type { SellerApplicationInput, SellerApplicationStatus } from '@/domain/sellers'
import type {
  Category,
  Delivery,
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
  Order,
  UnsoldPolicy,
  User,
  WalletBalance,
} from '@/domain/types'

export interface DrawResultView extends DrawResult {
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
  /** The platform fee follows from this (platformFeeBps) and comes out of the seller's payout. */
  priceKobo: Kobo
}

export interface OrderView extends Order {
  listingTitle: string
  listingImage: string | null
  category: Category
  merchantName: string
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

export interface NotificationView {
  id: string
  kind: NotificationKind
  listingId: string
  listingTitle: string
  /** When a sold-out draw's winner is announced. */
  drawAt: string | null
  winningNumber: number | null
  createdAt: string
  read: boolean
}

export interface ListingFilter {
  category?: Category
  status?: ListingStatus[]
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
export type AccountRole = 'buyer' | 'store' | 'admin'

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

  // Session
  getCurrentUser(): Promise<User>
  updateProfile(patch: Partial<Pick<User, 'state' | 'displayName'>>): Promise<User>

  // Buyer
  listListings(filter?: ListingFilter): Promise<ListingView[]>
  getListing(id: string): Promise<ListingView>
  /** Counts a listing page view for seller insights. `visitorId` identifies a signed-out browser; at most one view per visitor per day counts. */
  recordListingView(listingId: string, visitorId: string): Promise<void>
  buyTickets(listingId: string, quantity: number): Promise<PurchaseReceipt>
  listMyListings(): Promise<ListingView[]>
  listResults(): Promise<DrawResultView[]>
  /** Buys a 'for_sale' item from the wallet (store credit first). */
  buyNow(listingId: string, delivery: Delivery): Promise<OrderView>
  listMyOrders(): Promise<OrderView[]>
  /** The buyer confirms the item arrived. */
  confirmOrder(orderId: string): Promise<void>

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
  /** Uploads the ID photos and queues the application for an admin. Also used to resubmit after a rejection. */
  submitSellerApplication(input: SellerApplicationInput): Promise<SellerApplicationView>

  // Notifications
  /** Newest first. */
  listNotifications(): Promise<NotificationView[]>
  markNotificationsRead(): Promise<void>

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
  createProduct(input: NewProductInput): Promise<ListingView>
  /** Orders for this store's items, with delivery details. */
  listMerchantOrders(): Promise<OrderView[]>
  /** The store has sent the item. */
  dispatchOrder(orderId: string): Promise<void>

  // Admin
  listPendingListings(): Promise<ListingView[]>
  approveListing(id: string): Promise<void>
  rejectListing(id: string): Promise<void>
  /** Applications waiting for an ID check, oldest first. */
  listSellerApplications(): Promise<SellerApplicationView[]>
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
