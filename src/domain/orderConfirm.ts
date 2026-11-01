/**
 * A seller confirms each order with a fresh photo before it can go to a rider.
 * Mirrored in supabase/migrations/…_seller_confirms_order.sql.
 */
import type { ISODate, Order } from './types'

export const CONFIRM_HOURS = 12
/** How long before the deadline a seller gets a reminder. */
export const CONFIRM_REMINDER_HOURS = 3
const HOUR = 3_600_000

type Confirmable = Pick<Order, 'status' | 'confirmBy' | 'confirmedAt'>

export function confirmDeadline(orderedAtMs: number): ISODate {
  return new Date(orderedAtMs + CONFIRM_HOURS * HOUR).toISOString()
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
  const left = Date.parse(o.confirmBy!) - nowMs
  return left > 0 && left <= CONFIRM_REMINDER_HOURS * HOUR
}
