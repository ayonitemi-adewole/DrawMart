/** Phone notifications. Mirrored in public.save_push_subscription and public.set_push_preference. */

export type PushCategory = 'wins' | 'drawResults' | 'orders' | 'messages'
export type PushPreferences = Record<PushCategory, boolean>

/** What a buyer can switch on and off. Everything starts on, once they've turned notifications on at all. */
export const PUSH_CATEGORIES: { value: PushCategory; label: string; sub: string }[] = [
  { value: 'wins', label: 'Wins', sub: 'When you win a draw' },
  { value: 'drawResults', label: 'Draw results', sub: 'When a draw you’re in sells out or has a result' },
  { value: 'orders', label: 'Orders', sub: 'When your order is sent and delivered' },
  { value: 'messages', label: 'Messages', sub: 'When a seller or buyer writes to you' },
]

export const DEFAULT_PUSH_PREFERENCES: PushPreferences = { wins: true, drawResults: true, orders: true, messages: true }

export interface PushSubscriptionKeys {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Only the browsers' own push services. Our server sends to whatever address is
 * stored here, so it mustn't be possible to point it anywhere else.
 */
const PUSH_ENDPOINT = /^https:\/\/(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]*\.?push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\/[!-~]+$/
const P256DH = /^[A-Za-z0-9_-]{80,100}$/
const AUTH = /^[A-Za-z0-9_-]{16,44}$/

export function pushSubscriptionValid(s: PushSubscriptionKeys): boolean {
  return s.endpoint.length <= 1000 && PUSH_ENDPOINT.test(s.endpoint) && P256DH.test(s.p256dh) && AUTH.test(s.auth)
}
