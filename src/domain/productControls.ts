/**
 * What a seller can do with a product once it's on sale: pause, change stock, change price.
 * Mirrored in supabase/migrations/…_product_controls.sql.
 */
import { MAX_STOCK } from './orders'
import type { Kobo, Listing, ListingStatus } from './types'

const CONTROLLABLE: readonly ListingStatus[] = ['for_sale', 'paused', 'sold']

/** Draws never get these: a draw that ended unsold sells its one item as it stands. */
export function canControlProduct(l: Pick<Listing, 'kind' | 'status'>): boolean {
  return l.kind === 'product' && CONTROLLABLE.includes(l.status)
}

export const REPRICE_REVIEW_PERCENT = 20

/** Measured from the price an admin last reviewed, so many small changes can't add up to a big one. */
export function repriceNeedsReview(newPriceKobo: Kobo, reviewedPriceKobo: Kobo): boolean {
  return Math.abs(newPriceKobo - reviewedPriceKobo) * 100 > reviewedPriceKobo * REPRICE_REVIEW_PERCENT
}

export function stockChangeError(stock: number, change: number): string | null {
  if (!Number.isInteger(change) || change === 0) return 'Enter how many to add or remove.'
  if (stock + change < 0) return 'You can’t remove more than you have in stock.'
  if (stock + change > MAX_STOCK) return `Stock can’t go above ${MAX_STOCK.toLocaleString('en-NG')}.`
  return null
}

/** Selling out and restocking follow the stock, but a pause only ends when the seller says. */
export function statusAfterStock(status: ListingStatus, stock: number): ListingStatus {
  if (status === 'for_sale' && stock === 0) return 'sold'
  if (status === 'sold' && stock > 0) return 'for_sale'
  return status
}
