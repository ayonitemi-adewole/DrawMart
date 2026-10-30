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

export interface Merchant {
  id: string
  kind: MerchantKind
  name: string
  area: string // e.g. "Ikeja"
  /** Empty for individual sellers. */
  cacNumber: string
  verified: boolean
}

export interface Listing {
  id: string
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
  feeMode: FeeMode
  feeBps: number // platform fee in basis points (1000 = 10%)
  unsoldPolicy: UnsoldPolicy
  /** Regular price once a `convert_to_sale` draw ends unsold; null otherwise. */
  fallbackPriceKobo: Kobo | null
  /** Days tickets are on sale, counted from approval. */
  durationDays: number
  extended: boolean
  status: ListingStatus
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

/** paid → the store dispatches it → the buyer confirms it arrived. */
export type OrderStatus = 'paid' | 'dispatched' | 'delivered'

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

export type NotificationKind = 'draw_sold_out' | 'draw_won' | 'draw_lost'

export interface User {
  id: string
  displayName: string
  state: string // Nigerian state of residence; only licensed states may buy tickets
  weeklyLimitKobo: Kobo
  ageVerified: boolean
}

export interface WalletBalance {
  cashKobo: Kobo
  creditKobo: Kobo
}
