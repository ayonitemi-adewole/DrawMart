/**
 * Why an admin turned a listing down, and what the store's caution fee does
 * when it fixes the listing and sends it again.
 * Mirrored in supabase/migrations/…_rejection_reasons.sql.
 */
import { cautionFeeFor, handoverMethodFor } from './listing'
import type { Category, Kobo, ListingKind, ListingRejection, RejectionReason } from './types'

export const REJECTION_REASONS: readonly RejectionReason[] = ['photos_unclear', 'price_wrong', 'item_not_allowed', 'failed_escrow_check', 'other']

export const REJECTION_NOTE_MIN = 5
export const REJECTION_NOTE_MAX = 300

const REASON_TEXT: Record<RejectionReason, string> = {
  photos_unclear: 'Photos are unclear',
  price_wrong: 'Price looks wrong',
  item_not_allowed: 'Item isn’t allowed',
  failed_escrow_check: 'Failed the escrow check',
  other: 'Something else',
}

/** Cars are inspected where they are, so they fail an inspection rather than escrow. */
export function rejectionReasonText(reason: RejectionReason, category: Category): string {
  if (reason === 'failed_escrow_check' && handoverMethodFor(category) === 'inspection') return 'Failed the inspection'
  return REASON_TEXT[reason]
}

/** Regular products stay with the seller, so there's no escrow check for them to fail. */
export function rejectionReasonsFor(kind: ListingKind): readonly RejectionReason[] {
  return kind === 'product' ? REJECTION_REASONS.filter((r) => r !== 'failed_escrow_check') : REJECTION_REASONS
}

export type RejectionError = 'reason_required' | 'note_required' | 'note_too_long'

export const REJECTION_ERROR_TEXT: Record<RejectionError, string> = {
  reason_required: 'Pick a reason.',
  note_required: 'Say what’s wrong, so the store can fix it.',
  note_too_long: `Keep the note to ${REJECTION_NOTE_MAX} characters.`,
}

/** "Other" means nothing without a note; the other reasons can stand alone. */
export function rejectionError(kind: ListingKind, input: { reason: RejectionReason | null; note: string }): RejectionError | null {
  const note = input.note.trim()
  if (!input.reason || !rejectionReasonsFor(kind).includes(input.reason)) return 'reason_required'
  if (note.length > REJECTION_NOTE_MAX) return 'note_too_long'
  if (input.reason === 'other' && note.length < REJECTION_NOTE_MIN) return 'note_required'
  return null
}

export function newRejection(reason: RejectionReason, note: string): ListingRejection {
  return { reason, note: note.trim() || null }
}

/**
 * The fee on a resent draw. It was paid when the listing was first sent, so
 * resending never charges it again; it only rises if the new category costs more.
 */
export function resentCautionFee(paidKobo: Kobo, category: Category): Kobo {
  return Math.max(paidKobo, cautionFeeFor(category))
}
