/**
 * A seller confirms each order with a fresh photo before it can go to a rider.
 * Mirrored in supabase/migrations/…_seller_confirms_order.sql.
 */
import type { ISODate, Order } from './types'

export const CONFIRM_HOURS = 12
/** How long before the deadline a seller gets a reminder. */
export const CONFIRM_REMINDER_HOURS = 3
const HOUR = 3_600_000
const DAY = 24 * HOUR
/** The clock only runs between these hours, Lagos time. Lagos is always UTC+1. */
export const CONFIRM_DAY_STARTS = 9
export const CONFIRM_DAY_ENDS = 22
const LAGOS_OFFSET = HOUR

/** Adds time that only counts during the seller's day, so nothing runs out overnight. */
export function addConfirmTime(fromMs: number, hours: number): number {
  let left = hours * HOUR
  let local = fromMs + LAGOS_OFFSET
  for (;;) {
    const day = Math.floor(local / DAY) * DAY
    const open = day + CONFIRM_DAY_STARTS * HOUR
    const close = day + CONFIRM_DAY_ENDS * HOUR
    if (local < open) local = open
    if (local >= close) {
      local = day + DAY + CONFIRM_DAY_STARTS * HOUR
      continue
    }
    if (close - local >= left) return local + left - LAGOS_OFFSET
    left -= close - local
    local = day + DAY + CONFIRM_DAY_STARTS * HOUR
  }
}

type Confirmable = Pick<Order, 'status' | 'confirmBy' | 'confirmedAt'>

export function confirmDeadline(orderedAtMs: number): ISODate {
  return new Date(addConfirmTime(orderedAtMs, CONFIRM_HOURS)).toISOString()
}

/** Won items and orders from before this rule have no deadline. */
export function needsConfirming(o: Confirmable): boolean {
  return o.status === 'paid' && !!o.confirmBy && !o.confirmedAt
}

export function confirmOverdue(o: Confirmable, nowMs: number): boolean {
  return needsConfirming(o) && Date.parse(o.confirmBy!) <= nowMs
}

export function confirmReminderDue(o: Confirmable, nowMs: number): boolean {
  if (!needsConfirming(o)) return false
  const deadline = Date.parse(o.confirmBy!)
  return deadline > nowMs && deadline <= addConfirmTime(nowMs, CONFIRM_REMINDER_HOURS)
}
