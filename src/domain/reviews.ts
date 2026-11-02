/**
 * Buyers rate the seller after delivery. Mirrored in supabase/migrations/…_reviews.sql.
 */
import type { Order } from './types'

export const REVIEW_WINDOW_DAYS = 30
/** A shop's rating and reviews only show once it has this many, so one buyer can't define a new seller. */
export const REVIEWS_SHOWN_FROM = 5
export const REVIEW_TEXT_MAX = 500
export const HIDE_REASON_MAX = 200
const DAY = 86_400_000

export interface ReviewInput {
  rating: number
  sellerComment: string
  productComment: string
}

/** Won items are delivered by DrawMart, so the store isn't rated on them. */
export function canReview(o: Pick<Order, 'status' | 'isPrize' | 'deliveredAt'>, nowMs: number): boolean {
  return o.status === 'delivered' && !o.isPrize && !!o.deliveredAt && Date.parse(o.deliveredAt) + REVIEW_WINDOW_DAYS * DAY > nowMs
}

/** A buyer can change their review until the seller replies or DrawMart hides it. */
export function canEditReview(o: Pick<Order, 'status' | 'isPrize' | 'deliveredAt'>, review: { reply: string | null; hidden: boolean }, nowMs: number): boolean {
  return canReview(o, nowMs) && review.reply === null && !review.hidden
}

export function reviewError(input: ReviewInput): string | null {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) return 'Pick a rating from 1 to 5 stars.'
  if (input.sellerComment.trim().length > REVIEW_TEXT_MAX || input.productComment.trim().length > REVIEW_TEXT_MAX) return `Keep each comment to ${REVIEW_TEXT_MAX} characters.`
  return null
}

export function replyError(reply: string): string | null {
  const t = reply.trim()
  if (!t) return 'Write a reply.'
  if (t.length > REVIEW_TEXT_MAX) return `Keep it to ${REVIEW_TEXT_MAX} characters.`
  return null
}

export function hideReasonError(reason: string): string | null {
  const t = reason.trim()
  if (t.length < 3) return 'Say why it’s hidden.'
  if (t.length > HIDE_REASON_MAX) return `Keep it to ${HIDE_REASON_MAX} characters.`
  return null
}

/** The first word of their name, or "A buyer" if that looks like an email or number. */
export function reviewerName(displayName: string): string {
  const first = displayName.trim().split(/[\s._]+/)[0] ?? ''
  if (!first || /[@\d]/.test(first)) return 'A buyer'
  const word = first.slice(0, 20)
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** To one decimal place, as the database rounds it. */
export function averageRating(ratings: readonly number[]): number | null {
  if (!ratings.length) return null
  return Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
}
