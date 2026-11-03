/**
 * Pickup counters. A rider brings a pickup order to its location, where counter
 * staff (delivery accounts linked to that location) check the product ID and take
 * it in: the rider's job is done and the buyer is told it's ready. The buyer
 * collects with their PIN, as at the door. A reminder after COUNTER_REMINDER_DAYS;
 * after COUNTER_RETURN_DAYS it goes back to the seller and the buyer is refunded,
 * less delivery, since that trip happened. Won items are only ever reminded.
 * Mirrored in public.receive_at_counter and private.counter_deadlines.
 */
import { sameProductCode } from './productCode'

const DAY = 86_400_000
export const COUNTER_REMINDER_DAYS = 7
export const COUNTER_RETURN_DAYS = 14

/** Whole days on the shelf so far: 0 on the day it arrived. */
export const daysOnShelf = (atCounterAt: string, nowMs: number) => Math.max(0, Math.floor((nowMs - Date.parse(atCounterAt)) / DAY))

/** After this, it goes back to the seller. */
export const collectFromCounterBy = (atCounterAt: string) => new Date(Date.parse(atCounterAt) + COUNTER_RETURN_DAYS * DAY).toISOString()

export const counterReminderDue = (atCounterAt: string, nowMs: number) => nowMs - Date.parse(atCounterAt) >= COUNTER_REMINDER_DAYS * DAY
export const counterReturnDue = (atCounterAt: string, nowMs: number) => nowMs - Date.parse(atCounterAt) >= COUNTER_RETURN_DAYS * DAY

/** The staff type the ID from the label, so it's the whole ID, however it's typed. */
export function counterCodeError(entered: string, productCode: string): string | null {
  if (!entered.trim()) return 'Type the product ID from the item.'
  return sameProductCode(productCode, entered) ? null : 'That product ID doesn’t match this order. Check the label.'
}
