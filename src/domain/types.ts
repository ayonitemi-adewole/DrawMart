/**
 * Core domain types. All money is integer kobo (₦1 = 100 kobo) so we never
 * hit floating-point errors, and so amounts map 1:1 onto payment gateways.
 */

export type Kobo = number
export type ISODate = string

export type Category = 'Phones' | 'Electronics' | 'Home' | 'Food' | 'Cars' | 'Fashion'
export const CATEGORIES: Category[] = ['Phones', 'Electronics', 'Home', 'Food', 'Cars', 'Fashion']

/** Who carries the platform fee. */
export type FeeMode = 'seller' | 'buyer' | 'split'

/** What happens if a draw hasn't sold out by its deadline. */
export type UnsoldPolicy = 'refund' | 'extend_once'

export type ListingStatus =
  | 'pending_review' // submitted by a merchant, waiting for admin + escrow check
  | 'live' // tickets on sale
  | 'drawn' // sold out, winner picked
  | 'refunded' // deadline passed without selling out, buyers refunded
  | 'rejected'

export interface Merchant {
  id: string
  name: string
  area: string // e.g. "Ikeja"
  cacNumber: string
  verified: boolean
}

export interface Listing {
  id: string
  merchantId: string
  title: string
  description: string
  category: Category
  priceKobo: Kobo // what the merchant asked for the item
  ticketPriceKobo: Kobo // base ticket price before any buyer-side fee
  buyerTicketPriceKobo: Kobo // what a buyer actually pays per ticket
  ticketCount: number
  ticketsSold: number
  feeMode: FeeMode
  feeBps: number // platform fee in basis points (1000 = 10%)
  unsoldPolicy: UnsoldPolicy
  durationDays: number
  extended: boolean
  status: ListingStatus
  /** SHA-256 of the secret draw seed, published before any ticket is sold. */
  commitment: string
  createdAt: ISODate
  closesAt: ISODate
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
