/**
 * Buyer ↔ seller chat about a regular product. Raffles have no chat: DrawMart
 * holds and checks those items itself.
 */

export const MAX_MESSAGE_LENGTH = 1000
/** Per person per conversation, so nobody can flood a chat. */
export const MAX_MESSAGES_PER_MINUTE = 20

export function messageError(body: string): string | null {
  const text = body.trim()
  if (!text) return 'Write a message first.'
  if (text.length > MAX_MESSAGE_LENGTH) return `Keep it under ${MAX_MESSAGE_LENGTH.toLocaleString('en-NG')} characters.`
  return null
}

/**
 * Messages that look like a request to pay outside DrawMart: a 10-digit
 * account number, or "transfer to / pay me directly"-style wording. The reader
 * sees a warning; the message is still delivered.
 */
export function asksForOffPlatformPayment(body: string): boolean {
  return /\b\d{10}\b/.test(body.replace(/[\s-]/g, ' ').replace(/(\d) (?=\d)/g, '$1')) ||
    /\b(account\s*(no|number|num)|acct|transfer (it )?to|send (the )?money|pay (me )?(directly|outside|cash)|bank details|opay|palmpay|moniepoint)\b/i.test(body)
}
