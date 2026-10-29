import { applyBps } from './money'
import type { FeeMode, Kobo } from './types'

export interface ListingEconomicsInput {
  priceKobo: Kobo
  ticketPriceKobo: Kobo
  feeBps: number
  feeMode: FeeMode
}

export interface ListingEconomics {
  ticketCount: number
  /** What a buyer pays per ticket. */
  buyerTicketKobo: Kobo
  /** Total buyers pay when every ticket sells. */
  poolKobo: Kobo
  /** What the merchant receives after the winner confirms delivery. */
  sellerPayoutKobo: Kobo
  /** What the platform keeps (fee plus any rounding left in the pool). */
  platformKobo: Kobo
}

export const MIN_TICKET_KOBO = 100_00 // ₦100
export const MAX_TICKETS_PER_LISTING = 10_000
/** Platform fee bounds in basis points. The floor is 10%. */
export const MIN_FEE_BPS = 1000
export const MAX_FEE_BPS = 3000

/**
 * The platform fee is set by DrawMart from the item's value, never by the
 * seller: cheaper items pay a higher rate, pricier ones a lower one, never
 * below MIN_FEE_BPS. For raffles the value is the item price; for products,
 * the sale price. Mirrored in public.fee_tiers. Placeholder rates (see
 * docs/product-decisions.md).
 */
export const FEE_TIERS: readonly { fromKobo: Kobo; bps: number }[] = [
  { fromKobo: 0, bps: 1500 }, // under ₦50,000: 15%
  { fromKobo: 50_000_00, bps: 1300 }, // ₦50,000 – ₦499,999: 13%
  { fromKobo: 500_000_00, bps: 1150 }, // ₦500,000 – ₦4,999,999: 11.5%
  { fromKobo: 5_000_000_00, bps: MIN_FEE_BPS }, // ₦5,000,000 and up: 10%
]

export function platformFeeBps(priceKobo: Kobo): number {
  let bps = FEE_TIERS[0].bps
  for (const t of FEE_TIERS) if (priceKobo >= t.fromKobo) bps = t.bps
  return bps
}

/**
 * The money maths for a listing. Invariant: pool = sellerPayout + platform.
 *
 * - seller: buyers pay the ticket price; the fee comes out of the payout.
 * - buyer:  the fee is added to each ticket; the merchant gets the full price.
 * - split:  half on each side.
 *
 * Ticket count rounds up, so the pool always covers the price. Any surplus
 * from rounding stays with the platform.
 */
export function computeListingEconomics(input: ListingEconomicsInput): ListingEconomics {
  const { priceKobo, ticketPriceKobo, feeBps, feeMode } = input
  if (priceKobo <= 0 || ticketPriceKobo <= 0) {
    return { ticketCount: 0, buyerTicketKobo: 0, poolKobo: 0, sellerPayoutKobo: 0, platformKobo: 0 }
  }

  const ticketCount = Math.ceil(priceKobo / ticketPriceKobo)
  const buyerSideBps = feeMode === 'buyer' ? feeBps : feeMode === 'split' ? feeBps / 2 : 0
  const sellerSideBps = feeMode === 'seller' ? feeBps : feeMode === 'split' ? feeBps / 2 : 0

  const buyerTicketKobo = ticketPriceKobo + applyBps(ticketPriceKobo, buyerSideBps)
  const poolKobo = buyerTicketKobo * ticketCount
  const sellerPayoutKobo = priceKobo - applyBps(priceKobo, sellerSideBps)
  const platformKobo = poolKobo - sellerPayoutKobo

  return { ticketCount, buyerTicketKobo, poolKobo, sellerPayoutKobo, platformKobo }
}

export type ListingValidationError =
  | 'title_required'
  | 'price_required'
  | 'ticket_too_cheap'
  | 'ticket_above_price'
  | 'too_many_tickets'

/** The fee isn't checked: it's never the seller's input (platformFeeBps). */
export function validateListingEconomics(
  input: Omit<ListingEconomicsInput, 'feeBps'> & { title: string },
): ListingValidationError[] {
  const errors: ListingValidationError[] = []
  if (!input.title.trim()) errors.push('title_required')
  if (input.priceKobo <= 0) errors.push('price_required')
  if (input.ticketPriceKobo < MIN_TICKET_KOBO) errors.push('ticket_too_cheap')
  if (input.priceKobo > 0 && input.ticketPriceKobo > input.priceKobo) errors.push('ticket_above_price')
  if (input.priceKobo > 0 && input.ticketPriceKobo > 0 && Math.ceil(input.priceKobo / input.ticketPriceKobo) > MAX_TICKETS_PER_LISTING)
    errors.push('too_many_tickets')
  return errors
}

export const LISTING_ERROR_TEXT: Record<ListingValidationError, string> = {
  title_required: 'Give the item a name.',
  price_required: 'Enter your price.',
  ticket_too_cheap: 'Tickets must cost at least ₦100.',
  ticket_above_price: 'A ticket can’t cost more than the item.',
  too_many_tickets: `That would need more than ${MAX_TICKETS_PER_LISTING.toLocaleString('en-NG')} tickets. Raise the ticket price.`,
}
