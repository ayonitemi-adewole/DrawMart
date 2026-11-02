/**
 * What a buyer can do after delivery, and what it costs. Mirrored in
 * supabase/migrations/…_claims_and_returns.sql.
 */
import { photosError } from './deliveryChecks'
import { nairaToKobo } from './money'
import type { Category, ClaimKind, ClaimStatus, Kobo, Order } from './types'

export const CLAIM_WINDOW_HOURS = 48
export const CONTEST_WINDOW_DAYS = 7
const HOUR = 3_600_000

/** A sale's payout waits this long after delivery. */
export function claimWindowOpen(deliveredAt: string | null, nowMs: number): boolean {
  return !!deliveredAt && Date.parse(deliveredAt) + CLAIM_WINDOW_HOURS * HOUR > nowMs
}

export function canClaim(o: Pick<Order, 'status' | 'isPrize' | 'deliveredAt'> & { category: Category }, nowMs: number): boolean {
  return o.status === 'delivered' && !o.isPrize && o.category !== 'Cars' && claimWindowOpen(o.deliveredAt, nowMs)
}

export function canContest(o: Pick<Order, 'cancelReason' | 'cancelledAt'>, nowMs: number): boolean {
  if (o.cancelReason !== 'failed_check' && o.cancelReason !== 'refused_wrong' && o.cancelReason !== 'refused_damaged') return false
  return !!o.cancelledAt && Date.parse(o.cancelledAt) + CONTEST_WINDOW_DAYS * 24 * HOUR > nowMs
}

/** 30% under ₦100,000, 20% to ₦499,999, 10% from ₦500,000. The band goes by what one costs. */
export function returnFeePercent(unitPriceKobo: Kobo): number {
  return unitPriceKobo < nairaToKobo(100_000) ? 30 : unitPriceKobo < nairaToKobo(500_000) ? 20 : 10
}

export function returnFeeKobo(priceKobo: Kobo, quantity: number): Kobo {
  return Math.floor((priceKobo * returnFeePercent(Math.floor(priceKobo / quantity))) / 100)
}

/** The fee pays for the return trip first, then DrawMart and the seller each get half of what's left. */
export function sellerShareOfReturnFee(feeKobo: Kobo, tripKobo: Kobo): Kobo {
  return Math.floor(Math.max(feeKobo - tripKobo, 0) / 2)
}

/** The fee comes off cash first, so store credit goes back as store credit where it can. */
export function returnRefundSplit(paid: { cashKobo: Kobo; creditKobo: Kobo }, feeKobo: Kobo): { cashKobo: Kobo; creditKobo: Kobo } {
  return { cashKobo: Math.max(paid.cashKobo - feeKobo, 0), creditKobo: paid.creditKobo - Math.max(feeKobo - paid.cashKobo, 0) }
}

export function claimError(kind: ClaimKind | null, description: string, photos: readonly string[]): string | null {
  if (kind !== 'fault' && kind !== 'change_of_mind') return 'Pick what’s happened.'
  if (description.trim().length > 500) return 'Keep it to 500 characters.'
  if (kind === 'change_of_mind') return null
  return description.trim().length < 10 ? 'Say what’s wrong, in a few words.' : photosError(photos)
}

export function contestError(note: string): string | null {
  const n = note.trim().length
  return n >= 10 && n <= 500 ? null : 'Say what happened, in 10 to 500 characters.'
}

/** A claim still being dealt with holds the seller's money. */
export const CLAIM_HOLDS_PAYOUT: readonly ClaimStatus[] = ['open', 'awaiting_pickup', 'returning']

export function claimStatusText(kind: ClaimKind, status: ClaimStatus, audience: 'buyer' | 'seller'): { title: string; body: string } {
  const buyer = audience === 'buyer'
  switch (status) {
    case 'open':
      return kind === 'contest'
        ? { title: 'You’ve contested this', body: 'DrawMart is looking at it.' }
        : { title: buyer ? 'We’re looking at this' : 'A buyer reported a fault', body: buyer ? 'DrawMart will decide soon. You’ll get a notification.' : 'DrawMart is looking at it. Your payout waits until then.' }
    case 'declined':
      return { title: kind === 'contest' ? 'Your contest wasn’t upheld' : buyer ? 'We couldn’t accept this' : 'The fault report was turned down', body: buyer || kind === 'contest' ? 'See the reason below.' : 'Your payout goes ahead as usual.' }
    case 'upheld':
      return { title: 'Your contest was upheld', body: 'The charge has been taken back, and this doesn’t count against your shop.' }
    case 'awaiting_pickup':
      return { title: buyer ? 'A rider will collect it' : 'This is being returned', body: buyer ? 'Keep it as it was. You’re refunded when the rider has it.' : 'Your payout waits until it’s settled.' }
    case 'returning':
      return { title: buyer ? 'Refunded' : 'A rider is bringing it back', body: buyer ? 'Your money is back in your wallet.' : 'The buyer has been refunded.' }
    case 'returned':
      return { title: buyer ? 'Returned and refunded' : 'It’s back with you', body: buyer ? 'Your money is back in your wallet.' : kind === 'change_of_mind' ? 'It’s back in your stock. Check it before you sell it again.' : 'It isn’t back in your stock.' }
    case 'pickup_failed':
      return { title: buyer ? 'The rider couldn’t take it back' : 'The return didn’t go ahead', body: buyer ? 'It wasn’t as you described, so you haven’t been refunded. See the reason below.' : 'Your payout goes ahead as usual.' }
  }
}
