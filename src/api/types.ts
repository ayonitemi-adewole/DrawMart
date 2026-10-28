/**
 * The contract between the UI and whatever backend we pick.
 *
 * The UI only ever talks to `DrawMartApi`. Today it is backed by an in-browser
 * mock (src/api/mock.ts); later a real implementation (Supabase, NestJS, …)
 * implements the same interface and nothing in src/pages has to change.
 */
import type { HandoverDetails } from '@/domain/listing'
import type { PurchaseError } from '@/domain/rules'
import type {
  Category,
  DrawResult,
  FeeMode,
  Handover,
  Kobo,
  LedgerEntry,
  Listing,
  ListingStatus,
  Merchant,
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
}

export interface PurchaseReceipt {
  purchaseId: string
  numbers: number[]
  costKobo: Kobo
  /** True if this purchase sold the last ticket and the draw has run. */
  drawn: boolean
}

export interface NewListingInput {
  title: string
  description: string
  category: Category
  /** Optional photo URLs; escrow adds its own photos at check-in. */
  images?: string[]
  priceKobo: Kobo
  ticketPriceKobo: Kobo
  feeMode: FeeMode
  feeBps: number
  /** Days on sale once approved, RULES.minDurationDays..maxDurationDays. */
  durationDays: number
  unsoldPolicy: UnsoldPolicy
  /** Required when unsoldPolicy is 'convert_to_sale'. */
  fallbackPriceKobo?: Kobo
  /** Where and when to collect or inspect the item. The method follows from the category. */
  handover: HandoverDetails
}

export interface ListingFilter {
  category?: Category
  status?: ListingStatus[]
}

export type ApiErrorCode = PurchaseError | 'not_found' | 'invalid_input' | 'forbidden'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  constructor(code: ApiErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiError'
  }
}

export interface DrawMartApi {
  /** True while running against the in-browser mock with fake money. */
  readonly testMode: boolean

  // Session
  getCurrentUser(): Promise<User>
  updateProfile(patch: Partial<Pick<User, 'state' | 'displayName'>>): Promise<User>

  // Buyer
  listListings(filter?: ListingFilter): Promise<ListingView[]>
  getListing(id: string): Promise<ListingView>
  buyTickets(listingId: string, quantity: number): Promise<PurchaseReceipt>
  listMyListings(): Promise<ListingView[]>
  listResults(): Promise<DrawResultView[]>

  // Wallet
  getWallet(): Promise<WalletView>
  topUp(amountKobo: Kobo): Promise<void>
  setWeeklyLimit(amountKobo: Kobo): Promise<void>

  // Merchant
  getMyMerchant(): Promise<Merchant>
  listMerchantListings(): Promise<ListingView[]>
  /** Charges the caution fee for the category and queues the listing for pickup/inspection and review. */
  createListing(input: NewListingInput): Promise<ListingView>

  // Admin
  listPendingListings(): Promise<ListingView[]>
  approveListing(id: string): Promise<void>
  rejectListing(id: string): Promise<void>

  // Demo-only helpers (no-ops / errors in production)
  demoSellOut(listingId: string): Promise<void>
  demoExpire(listingId: string): Promise<void>
  demoReset(): Promise<void>
}
