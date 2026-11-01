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
}

/** What the buyer is told. */
export const CANCEL_REASON_FOR_BUYER: Record<CancelReason, string> = {
  out_of_stock: 'The seller ran out of stock.',
  damaged: 'The seller found it was damaged or faulty.',
  cant_send: 'The seller couldn’t send it.',
  other: 'The seller cancelled it.',
  not_confirmed: 'The seller didn’t confirm it in time.',
}

/** What it does to the listing's stock, so a seller doesn't have to fix it afterwards. */
export const CANCEL_STOCK_TEXT: Record<CancelReason, string> = {
  out_of_stock: 'The listing will show as sold out until you restock.',
  damaged: 'This one won’t go back into your stock.',
  cant_send: 'It goes back into your stock.',
  other: 'It goes back into your stock.',
  not_confirmed: 'It goes back into your stock, and the product is paused.',
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
  const stock = reason === 'out_of_stock' ? 0 : reason === 'damaged' ? l.stock : l.stock + quantity
  // A seller who isn't responding shouldn't get the next order too.
  if (reason === 'not_confirmed' && l.kind === 'product' && (l.status === 'for_sale' || l.status === 'sold')) return { stock, status: 'paused' }
  return { stock, status: statusAfterStock(l.status, stock) }
}

/** A few cancellations can be bad luck, so it takes 3 and at least 1 in 10 orders. */
export const CANCEL_FLAG_MIN = 3
export const CANCEL_FLAG_PERCENT = 10

export function cancelRateFlagged(orders: number, cancelled: number): boolean {
  return cancelled >= CANCEL_FLAG_MIN && cancelled * 100 >= orders * CANCEL_FLAG_PERCENT
}
