/**
 * When a seller gets told about something that's due, rather than something that
 * just happened. Mirrored in private.store_reminders.
 */
import { addDays } from './listing'
import { lagosDay } from './metrics'
import type { ISODate, NotificationKind } from './types'

/** Reminders wait for the morning: a pickup isn't worth a notification at midnight. */
export const REMINDER_FROM_HOUR = 8

const lagosHour = (nowMs: number) => new Date(nowMs + 3_600_000).getUTCHours() // Lagos is UTC+1 all year

export function pickupReminderDue(handoverDate: string, nowMs: number): boolean {
  return handoverDate === addDays(lagosDay(nowMs), 1) && lagosHour(nowMs) >= REMINDER_FROM_HOUR
}

/**
 * One reminder per closing date. An extended draw has a new one, so anything sent
 * before the last 24 hours doesn't count.
 */
export function closingReminderSent(closesAt: ISODate, sentAt: readonly ISODate[]): boolean {
  const windowStart = Date.parse(closesAt) - 24 * 3_600_000
  return sentAt.some((at) => Date.parse(at) >= windowStart)
}

const SELLER_KINDS: readonly NotificationKind[] = [
  'store_new_order', 'store_listing_approved', 'store_listing_rejected', 'store_draw_sold_out',
  'store_winner_picked', 'store_draw_closing', 'store_pickup_tomorrow', 'store_new_message',
  'store_payout_sent', 'store_bank_changed', 'store_price_approved', 'store_price_rejected', 'store_order_confirm_soon', 'store_order_expired', 'store_order_failed', 'store_suspended', 'store_order_claim', 'store_new_review', 'store_approved', 'store_support_reply',
]

/** About something this account sells, rather than something it's buying. */
export function isSellerNotification(kind: NotificationKind): boolean {
  return SELLER_KINDS.includes(kind)
}
