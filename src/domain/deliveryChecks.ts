/**
 * The rider's check before leaving the seller, and the buyer's at the door.
 * Mirrored in supabase/migrations/…_delivery_checks.sql.
 */
import type { CollectionProblem, Kobo, RefusalReason } from './types'

/** All must be true for the item to leave the seller. */
export const COLLECTION_CHECKS = ['It’s the item in the photos', 'The quantity is right', 'No visible damage', 'It powers on, if it has power'] as const

export const COLLECTION_PROBLEMS: readonly CollectionProblem[] = ['wrong_item', 'wrong_quantity', 'damaged', 'wont_power_on', 'no_item']

export const COLLECTION_PROBLEM_TEXT: Record<CollectionProblem, string> = {
  wrong_item: 'It’s not the item in the photos',
  wrong_quantity: 'The quantity is wrong',
  damaged: 'It’s damaged',
  wont_power_on: 'It won’t power on',
  no_item: 'The seller didn’t have it',
}

export const REFUSAL_REASONS: readonly RefusalReason[] = ['refused_wrong', 'refused_damaged']
export const REFUSAL_TEXT: Record<RefusalReason, string> = { refused_wrong: 'It’s the wrong item', refused_damaged: 'It’s damaged' }

/** What a failed order costs the seller: the wasted trip and the buyer's apology. Placeholders. */
export const FAILURE_CHARGE_KOBO: Kobo = 250_000
export const APOLOGY_CREDIT_KOBO: Kobo = 50_000
/** In 30 days. */
export const SUSPEND_AFTER_FAILURES = 3
export const MAX_DELIVERY_PHOTOS = 3

export function photosError(photos: readonly string[]): string | null {
  return photos.length >= 1 && photos.length <= MAX_DELIVERY_PHOTOS && photos.every((p) => /^(https:\/\/|\/assets\/|data:image\/)/.test(p)) ? null : `Add 1 to ${MAX_DELIVERY_PHOTOS} photos.`
}

/** Without an item there's nothing to photograph; anything else needs proof. */
export function collectionFailError(problems: readonly CollectionProblem[], photos: readonly string[]): string | null {
  if (!problems.length || problems.some((p) => !COLLECTION_PROBLEMS.includes(p))) return 'Pick what’s wrong.'
  if (problems.length === 1 && problems[0] === 'no_item' && photos.length === 0) return null
  return photosError(photos)
}
