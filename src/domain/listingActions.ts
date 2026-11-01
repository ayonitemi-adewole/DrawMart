/**
 * What a store can do with a listing after sending it, and what a withdrawal
 * does to the caution fee. Mirrored in supabase/migrations/…_listing_actions.sql.
 */
import { pickupCautionFee } from './listing'
import type { CautionFee, Category, Kobo, Listing, ListingStatus } from './types'

const PUBLIC_STATUSES: readonly ListingStatus[] = ['live', 'sold_out', 'drawn', 'refunded', 'for_sale', 'sold']

/** Buyers can open these. Everything else 404s for them, so there's no live page to show. */
export function hasLivePage(status: ListingStatus): boolean {
  return PUBLIC_STATUSES.includes(status)
}

/**
 * Only in review, so no buyer has seen it and no ticket has sold. A draw also
 * locks on its pickup or inspection day, since the item may already be with us.
 */
export function canChangeInReview(l: Pick<Listing, 'status' | 'kind' | 'handover'>, today: string): boolean {
  if (l.status !== 'pending_review') return false
  return l.kind === 'product' || !l.handover || l.handover.date > today
}

/**
 * Where the fee ends up. `remaining` is the other items in its shared pickup,
 * or null if it isn't in one. Withdrawing refunds it, unless:
 * - the listing was rejected and resent, because that first pickup or visit may
 *   have cost us already, so resending then withdrawing can't get the fee back;
 * - the pickup's fee is already kept, because another of its draws ended badly.
 * A shared pickup only gives back what its fee drops by without this item.
 */
export function withdrawalFees(fee: CautionFee, wasRejected: boolean, remaining: readonly Category[] | null): { withdrawn: CautionFee; remainingKobo: Kobo | null } {
  if (fee.status === 'none') return { withdrawn: fee, remainingKobo: null }
  if (!remaining?.length) {
    return { withdrawn: { ...fee, status: wasRejected || fee.status === 'kept' ? 'kept' : 'refunded' }, remainingKobo: null }
  }
  if (wasRejected || fee.status !== 'held') return { withdrawn: { amountKobo: 0, status: 'none' }, remainingKobo: fee.amountKobo }
  const remainingKobo = Math.min(fee.amountKobo, pickupCautionFee(remaining))
  const back = fee.amountKobo - remainingKobo
  return { withdrawn: { amountKobo: back, status: back > 0 ? 'refunded' : 'none' }, remainingKobo }
}

