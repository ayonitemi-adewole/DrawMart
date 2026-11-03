/**
 * A seller cancelling an order they can't fulfil.
 * Mirrored in supabase/migrations/…_cancel_orders.sql.
 */
import { statusAfterStock } from './productControls'
import type { CancelReason, ListingKind, ListingStatus, Order } from './types'

/** What a seller can pick. `not_confirmed` only ever comes from the deadline. */
export const CANCEL_REASONS: readonly CancelReason[] = ['out_of_stock', 'damaged', 'cant_send', 'other']
export const CANCEL_NOTE_MIN = 5
export const CANCEL_NOTE_MAX = 300

/** What the seller picks. */
export const CANCEL_REASON_TEXT: Record<CancelReason, string> = {
  out_of_stock: 'It’s out of stock',
  damaged: 'It’s damaged or faulty',
  cant_send: 'I can’t send it right now',
  other: 'Something else',
  not_confirmed: 'You didn’t confirm it in time',
  not_sent: 'You didn’t make it ready in time',
  failed_check: 'It failed the rider’s check',
  refused_wrong: 'The buyer refused it: wrong item',
  refused_damaged: 'The buyer refused it: damaged',
  not_collected: 'The buyer didn’t collect it from the pickup location',
  not_delivered: 'The rider couldn’t reach the buyer',
  incident: 'Something happened on the way (DrawMart refunded the buyer)',
}

/** What the buyer is told. */
export const CANCEL_REASON_FOR_BUYER: Record<CancelReason, string> = {
  out_of_stock: 'The seller ran out of stock.',
  damaged: 'The seller found it was damaged or faulty.',
  cant_send: 'The seller couldn’t send it.',
  other: 'The seller cancelled it.',
  not_confirmed: 'The seller didn’t confirm it in time.',
  not_sent: 'The seller didn’t get it ready in time.',
  failed_check: 'Our rider checked it at the seller and it didn’t pass, so we didn’t send it.',
  refused_wrong: 'You refused it because it was the wrong item.',
  refused_damaged: 'You refused it because it was damaged.',
  not_collected: 'You didn’t collect it from the pickup location in time, so it’s going back to the seller. The delivery fee isn’t refunded.',
  not_delivered: 'Our rider couldn’t reach you, so it’s going back to the seller. The delivery fee isn’t refunded.',
  incident: 'Something happened on the way, so we’ve refunded you in full, delivery too. Sorry.',
}

/** What it does to the listing's stock, so a seller doesn't have to fix it afterwards. */
export const CANCEL_STOCK_TEXT: Record<CancelReason, string> = {
  out_of_stock: 'The listing will show as sold out until you restock.',
  damaged: 'This one won’t go back into your stock.',
  cant_send: 'It goes back into your stock.',
  other: 'It goes back into your stock.',
  not_confirmed: 'It goes back into your stock, and the product is paused.',
  not_sent: 'It goes back into your stock, and the product is paused.',
  failed_check: 'It doesn’t go back into your stock.',
  refused_wrong: 'It doesn’t go back into your stock.',
  refused_damaged: 'It doesn’t go back into your stock.',
  not_collected: 'It’s coming back to you. Add it to your stock again once you have it.',
  not_delivered: 'It’s coming back to you. Add it to your stock again once you have it.',
  incident: 'It doesn’t go back into your stock. If the rider had collected it, you’re still paid for it.',
}

export function cancelError(input: { reason: CancelReason | null; note: string }): string | null {
  const note = input.note.trim()
  if (!input.reason || !CANCEL_REASONS.includes(input.reason)) return 'Pick a reason.'
  if (note.length > CANCEL_NOTE_MAX) return `Keep the note to ${CANCEL_NOTE_MAX} characters.`
  if (input.reason === 'other' && note.length < CANCEL_NOTE_MIN) return 'Say why, so the buyer understands.'
  return null
}

export function canCancelOrder(o: Pick<Order, 'status' | 'isPrize' | 'handledBy'>): boolean {
  return o.status === 'paid' && !o.isPrize && o.handledBy === 'store'
}

export function stockAfterCancel(reason: CancelReason, l: { stock: number; status: ListingStatus; kind?: ListingKind }, quantity: number): { stock: number; status: ListingStatus } {
  const keeps = reason === 'damaged' || reason === 'failed_check' || reason === 'refused_wrong' || reason === 'refused_damaged' || reason === 'not_collected' || reason === 'not_delivered' || reason === 'incident'
  const stock = reason === 'out_of_stock' ? 0 : keeps ? l.stock : l.stock + quantity
  // A seller who isn't responding shouldn't get the next order too.
  if ((reason === 'not_confirmed' || reason === 'not_sent') && l.kind === 'product' && (l.status === 'for_sale' || l.status === 'sold')) return { stock, status: 'paused' }
  return { stock, status: statusAfterStock(l.status, stock) }
}

/** A few cancellations can be bad luck, so it takes 3 and at least 1 in 10 orders. */
export const CANCEL_FLAG_MIN = 3
export const CANCEL_FLAG_PERCENT = 10

export function cancelRateFlagged(orders: number, cancelled: number): boolean {
  return cancelled >= CANCEL_FLAG_MIN && cancelled * 100 >= orders * CANCEL_FLAG_PERCENT
}
