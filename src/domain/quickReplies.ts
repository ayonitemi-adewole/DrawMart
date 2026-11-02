/**
 * Saved answers a seller can drop into a chat with a tap. Mirrored in
 * supabase/migrations/…_quick_replies.sql.
 */
export const MAX_QUICK_REPLIES = 20
export const QUICK_REPLY_MAX = 500

/** Offered to a seller who hasn't saved any yet. Nothing here may ask a buyer to pay outside DrawMart. */
export const SUGGESTED_QUICK_REPLIES = [
  'Yes, it’s available. You can order it on DrawMart.',
  'DrawMart’s riders deliver it. You’ll see the delivery fee at checkout.',
  'Sorry, that one has sold out.',
  'Thanks for your order! I’ll get it ready for the rider.',
] as const

/** `count` is how many the seller has, not counting the one being changed. */
export function quickReplyError(body: string, count: number): string | null {
  const text = body.trim()
  if (!text) return 'Write the reply first.'
  if (text.length > QUICK_REPLY_MAX) return `Keep it to ${QUICK_REPLY_MAX} characters.`
  if (count >= MAX_QUICK_REPLIES) return `You can save up to ${MAX_QUICK_REPLIES}. Delete one first.`
  return null
}
