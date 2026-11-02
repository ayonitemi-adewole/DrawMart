/**
 * Core domain types. All money is integer kobo (₦1 = 100 kobo) so we never
 * hit floating-point errors, and so amounts map 1:1 onto payment gateways.
 */

export type Kobo = number
export type ISODate = string

/** No perishables: items can sit in escrow for weeks before a draw ends. */
export type Category = 'Phones' | 'Electronics' | 'Home' | 'Cars' | 'Fashion'
export const CATEGORIES: Category[] = ['Phones', 'Electronics', 'Home', 'Cars', 'Fashion']

/** Who carries the platform fee. */
export type FeeMode = 'seller' | 'buyer' | 'split'

/**
 * What happens if a draw hasn't sold out by its deadline. Ticket buyers are
 * always refunded in the end; `convert_to_sale` then keeps the item on the
 * platform as a regular product at `fallbackPriceKobo`.
 */
export type UnsoldPolicy = 'refund' | 'extend_once' | 'convert_to_sale'

/**
 * A raffle sells numbered tickets and draws a winner. A product is a regular
 * item sold outright at a fixed price: no tickets, no escrow, no caution fee.
 */
export type ListingKind = 'raffle' | 'product'

export type ListingStatus =
  | 'pending_review' // submitted by a merchant, waiting for admin (+ escrow check for raffles)
  | 'live' // raffle: tickets on sale
  | 'sold_out' // raffle: last ticket sold, winner announced on drawAt
  | 'drawn' // raffle: winner picked and announced
  | 'refunded' // raffle: deadline passed without selling out, buyers refunded
  | 'for_sale' // on sale at a fixed price: an approved product, or a raffle that ended unsold
  | 'sold' // a fixed-price item was bought
  | 'rejected'
  | 'withdrawn' // the store took it back while it was in review
  | 'paused' // a product the seller has hidden for now: out of browse and search, but kept

/** How the item reaches DrawMart for checking: big items are inspected where they are. */
export type HandoverMethod = 'pickup' | 'inspection'
export type TimeSlot = 'morning' | 'afternoon'

export interface GeoPoint {
  lat: number
  lng: number
}

/** Where and when DrawMart collects (or inspects) the item. Private to the store and admins. */
export interface Handover {
  method: HandoverMethod
  address: string
  /** The exact spot pinned on the map. Null only on bookings made before pins existed. */
  location: GeoPoint | null
  contactPhone: string
  date: string // YYYY-MM-DD
  slot: TimeSlot
}

/**
 * Paid by the store when it submits a listing. Refunded with the payout if the
 * draw sells out; otherwise kept to cover pickup/return or the inspection visit.
 */
export interface CautionFee {
  amountKobo: Kobo
  /** 'none': regular products stay with the store, so there's no fee. */
  status: 'held' | 'refunded' | 'kept' | 'none'
}

/** A CAC-registered store, or an ID-verified individual (regular products only, never raffles). */
export type MerchantKind = 'store' | 'individual'

/** How big a product's package is, which affects its delivery fee (deliveryFees.ts). */
export type PackageSize = 'small' | 'medium' | 'large'

export interface Merchant {
  id: string
  kind: MerchantKind
  name: string
  area: string // e.g. "Ikeja"
  /** The delivery area its items leave from (deliveryFees.ts). */
  deliveryArea?: string | null
  /** Set after too many failed orders (deliveryChecks.ts). Its products are paused and it can't list. */
  suspendedAt?: ISODate | null
  /** Empty for individual sellers, and for any store that hasn't chosen to show it, except to itself and admins. */
  cacNumber: string
  verified: boolean
  verifiedAt?: ISODate | null
  /** The public profile (shopProfile.ts). */
  about?: string | null
  logoUrl?: string | null
  coverUrl?: string | null
  openingHours?: string | null
  shopNote?: string | null
  /** Only when the seller chose to show it. */
  publicPhone?: string | null
  showCac?: boolean
}

/** Why an admin turned a listing down (rejection.ts). */
export type RejectionReason = 'photos_unclear' | 'price_wrong' | 'item_not_allowed' | 'failed_escrow_check' | 'other'

export interface ListingRejection {
  reason: RejectionReason
  note: string | null
}

export interface Listing {
  id: string
  /** The ID people see, type and search for, e.g. PRD-7K3Q9X. Never changes. See domain/productCode.ts. */
  productCode: string
  kind: ListingKind
  merchantId: string
  title: string
  description: string
  category: Category
  /** Photo URLs, first is the cover. Empty until escrow photographs the item. */
  images: string[]
  priceKobo: Kobo // raffle: what the merchant asked for the item; product: the sale price
  ticketPriceKobo: Kobo // base ticket price before any buyer-side fee (0 for products)
  buyerTicketPriceKobo: Kobo // what a buyer actually pays per ticket (0 for products)
  ticketCount: number // 0 for products
  ticketsSold: number
  /** How many are left to buy at a fixed price. Draws are always one item. */
  stock: number
  feeMode: FeeMode
  feeBps: number // platform fee in basis points (1000 = 10%)
  unsoldPolicy: UnsoldPolicy
  /** Regular price once a `convert_to_sale` draw ends unsold; null otherwise. */
  fallbackPriceKobo: Kobo | null
  /** Days tickets are on sale, counted from approval. */
  durationDays: number
  extended: boolean
  status: ListingStatus
  /** Only while rejected, and only seen by its store and admins. Null on rows rejected before reasons existed. */
  rejection?: ListingRejection | null
  /** Null means the usual size for its category (deliveryFees.ts packageSizeOf). */
  packageSize?: PackageSize | null
  /** The price an admin last reviewed. A big change from this needs another review. */
  reviewedPriceKobo?: Kobo | null
  /** Counts changes while in review, so an admin only approves the version they saw. */
  revision?: number
  /** Rejected since it was last approved: withdrawing then doesn't get the caution fee back. */
  wasRejected?: boolean
  /** Raffles only: products stay with the store until they're sold. */
  handover: Handover | null
  cautionFee: CautionFee
  /** Set when this item shares a pickup, and one caution fee, with others. */
  pickupBatchId: string | null
  /** SHA-256 of the secret draw seed, published before any ticket is sold. Empty for products. */
  commitment: string
  createdAt: ISODate
  closesAt: ISODate
  /** Shown first, marked Sponsored, until then (a paid boost). */
  boostedUntil: ISODate | null
  /** When the last ticket sold. */
  soldOutAt: ISODate | null
  /** When a draw went on sale (drawPricing.ts). Not on older ones. */
  liveAt?: ISODate | null
  /** When a sold-out draw's winner is announced (draw.ts announcementDate). */
  drawAt: ISODate | null
}

export interface Ticket {
  id: string
  listingId: string
  userId: string
  number: number // 1..ticketCount
  purchaseId: string
  purchasedAt: ISODate
}

export interface DrawResult {
  listingId: string
  commitment: string
  seed: string // revealed only after the draw
  closingRef: string // reference of the final ticket purchase
  winningNumber: number
  winnerUserId: string
  drawnAt: ISODate
}

export type LedgerKind =
  | 'topup'
  | 'ticket_purchase'
  | 'refund'
  | 'store_credit' // consolation credit after losing a draw
  | 'order_payment' // bought a fixed-price item
  | 'order_refund' // a seller cancelled it; doesn't touch the weekly limit
  | 'delivery_fee' // what a buyer paid for delivery at checkout
  | 'adjustment'

/** Append-only wallet ledger. Balances are always derived, never stored. */
export interface LedgerEntry {
  id: string
  userId: string
  kind: LedgerKind
  cashKobo: Kobo // signed change to cash balance
  creditKobo: Kobo // signed change to store-credit balance
  memo: string
  listingId?: string
  createdAt: ISODate
}

/** paid → the seller has it ready for a rider → the rider confirms it with the buyer's PIN. */
export type OrderStatus = 'paid' | 'dispatched' | 'delivered' | 'cancelled'

export type ClaimKind = 'fault' | 'change_of_mind' | 'contest'
export type ClaimStatus = 'open' | 'declined' | 'upheld' | 'awaiting_pickup' | 'returning' | 'returned' | 'pickup_failed'

/** A buyer's fault report or return, or a seller contesting a failure (claims.ts). */
export interface OrderClaim {
  id: string
  kind: ClaimKind
  status: ClaimStatus
  description: string
  photos: string[]
  returnFeeKobo: Kobo
  reviewNote: string | null
}

/** Why a seller cancelled an order (orderCancel.ts). */
export type RefusalReason = 'refused_wrong' | 'refused_damaged'
export type CollectionProblem = 'wrong_item' | 'wrong_quantity' | 'damaged' | 'wont_power_on' | 'no_item'
export type CancelReason = 'out_of_stock' | 'damaged' | 'cant_send' | 'other' | 'not_confirmed' | 'not_sent' | 'failed_check' | 'not_collected' | 'not_delivered' | RefusalReason

/** Where the buyer wants a fixed-price item sent. Seen only by the buyer, the store and admins. */
export interface Delivery {
  address: string
  /** The exact spot pinned on the map. Null only on orders made before pins existed. */
  location: GeoPoint | null
  contactPhone: string
}

export type Fulfilment = 'delivery' | 'pickup'

/** A DrawMart location where buyers can collect their items. */
export interface PickupPoint {
  id: string
  name: string
  area: string
  address: string
  hours: string
  location: GeoPoint
}

/** One item bought from the wallet, or a won draw item on its way to the winner. */
export interface Order {
  id: string
  listingId: string
  buyerId: string
  merchantId: string
  priceKobo: Kobo
  /** Platform fee, taken from the store's payout. */
  feeKobo: Kobo
  /** How many. priceKobo and feeKobo are for all of them. */
  quantity: number
  /** What a store discount took off priceKobo (discounts.ts). Older orders don't have it. */
  discountKobo?: Kobo
  /** What the buyer paid for delivery. One fee covers everything from a seller in a checkout, so only one of those orders has it. Not part of the seller's payout. */
  deliveryFeeKobo: Kobo
  /** The seller must confirm by this, or it cancels (orderConfirm.ts). Null for won items and older orders. */
  confirmBy: ISODate | null
  confirmedAt: ISODate | null
  /** The seller's fresh photo of the item. */
  confirmPhoto: string | null
  /** Once confirmed, the seller must make it ready for a rider by this, or it cancels. */
  readyBy: ISODate | null
  /** The rider checked it against the listing and left with it. */
  collectedAt: ISODate | null
  collectionPhotos: string[] | null
  collectionProblems: CollectionProblem[] | null
  refusalPhoto: string | null
  /** Set when a return or fault was refunded. Status stays delivered. */
  refundedAt: ISODate | null
  claim: OrderClaim | null
  /** A refused item goes back to the seller. */
  returnState: 'returning' | 'returned' | null
  returnedAt: ISODate | null
  /** A pickup order counter staff have taken in: ready to collect (counter.ts). */
  atCounterAt: ISODate | null
  /** Times the rider couldn't reach the buyer (deliveryAttempts.ts). */
  failedAttempts: number
  lastFailedAt: ISODate | null
  /** What the buyer chose after a failed attempt. */
  redeliveryChoice: 'redeliver' | 'pickup' | null
  /** The start of the new two-hour window. */
  redeliverAt: ISODate | null
  cancelledAt: ISODate | null
  cancelReason: CancelReason | null
  cancelNote: string | null
  /** Pickup orders have an empty address and no pin, only the phone. */
  delivery: Delivery
  fulfilment: Fulfilment
  pickupPoint: PickupPoint | null
  /** Won in a draw, so free: the tickets paid for it. */
  isPrize: boolean
  /** Who sends it. Won items sit in DrawMart's escrow, except cars, which stay with the dealer. */
  handledBy: 'store' | 'drawmart'
  status: OrderStatus
  createdAt: ISODate
  dispatchedAt: ISODate | null
  deliveredAt: ISODate | null
}

export type NotificationKind =
  | 'store_new_review' | 'review_reply' | 'store_approved' | 'store_support_reply'
  | 'order_cancelled' | 'order_claim_update' | 'store_order_claim' | 'store_order_failed' | 'store_suspended' | 'store_order_confirm_soon' | 'store_order_expired' | 'store_price_approved' | 'store_price_rejected' | 'store_new_order' | 'store_listing_approved' | 'store_listing_rejected' | 'store_draw_sold_out'
  | 'store_winner_picked' | 'store_draw_closing' | 'store_pickup_tomorrow' | 'store_new_message'
  | 'store_payout_sent' | 'store_bank_changed'
  | 'order_ready_to_collect' | 'order_collect_reminder' | 'store_order_uncollected'
  | 'order_delivery_failed' | 'store_order_undelivered' | 'rider_redelivery_chosen'
  | 'rider_paid' | 'rider_bank_changed'
  | 'rider_new_job' | 'rider_new_return' | 'rider_collect_soon' | 'rider_job_released' | 'rider_pin_unlocked'
  | 'draw_sold_out' | 'draw_won' | 'draw_lost' | 'saved_almost_sold' | 'saved_closing_soon' | 'saved_relisted' | 'saved_back_on_sale' | 'saved_price_drop'

export interface User {
  id: string
  displayName: string
  state: string // Nigerian state of residence; only licensed states may buy tickets
  weeklyLimitKobo: Kobo
  ageVerified: boolean
  /** Contact phone on their account, suggested at checkout. */
  phone: string | null
}

export interface WalletBalance {
  cashKobo: Kobo
  creditKobo: Kobo
}
