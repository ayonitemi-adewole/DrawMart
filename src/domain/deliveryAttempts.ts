/**
 * A buyer who isn't there. The rider says they've arrived, calls, waits
 * ATTEMPT_WAIT_MINUTES, and records a failed attempt with a photo and the phone's
 * location, which must be near the drop-off pin. The rider keeps the item. The buyer
 * then has CHOOSE_WITHIN_HOURS to pick a new delivery window or a pickup location;
 * DrawMart pays for the second trip. A second failed attempt, or no choice in time,
 * sends it back to the seller and refunds the price but not delivery, since the
 * trips happened. Won items can't be failed here. Mirrored in
 * public.fail_delivery_attempt, public.choose_redelivery and private.redelivery_deadlines.
 */
import type { GeoPoint } from './types'

const HOUR = 3_600_000
const LAGOS_OFFSET_HOURS = 1
export const ATTEMPT_WAIT_MINUTES = 10
export const MAX_ATTEMPT_DISTANCE_M = 500
export const CHOOSE_WITHIN_HOURS = 24
/** How far ahead of the failed attempt a new window can be. */
export const REDELIVER_WITHIN_HOURS = 48
/** Two-hour windows, by their Lagos start hour. */
export const REDELIVERY_WINDOW_STARTS = [9, 11, 13, 15, 17] as const
export const REDELIVERY_WINDOW_HOURS = 2
/** The soonest a new window can start, so a rider can get there. */
export const REDELIVERY_NOTICE_HOURS = 1

/** Close enough for a few hundred metres in Lagos. */
export function metresBetween(a: GeoPoint, b: GeoPoint): number {
  const toRad = Math.PI / 180
  const x = (b.lng - a.lng) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad)
  const y = (b.lat - a.lat) * toRad
  return Math.sqrt(x * x + y * y) * 6_371_000
}

/** When the rider can record a failed attempt, having arrived at arrivedAt. */
export const canFailFrom = (arrivedAt: string) => new Date(Date.parse(arrivedAt) + ATTEMPT_WAIT_MINUTES * 60_000).toISOString()

export function attemptError(a: { arrivedAt: string | null; nowMs: number; photos: string[]; at: GeoPoint | null; dropOff: GeoPoint | null }): string | null {
  if (!a.arrivedAt) return 'Say you’ve arrived first, then call the buyer.'
  if (Date.parse(canFailFrom(a.arrivedAt)) > a.nowMs) return `Wait ${ATTEMPT_WAIT_MINUTES} minutes after arriving, and call the buyer.`
  if (a.photos.length !== 1) return 'Take a photo of where you are.'
  if (!a.at) return 'Share your location, so we know you were there.'
  if (a.dropOff && metresBetween(a.at, a.dropOff) > MAX_ATTEMPT_DISTANCE_M) return 'You need to be at the buyer’s address to record this.'
  return null
}

/** The buyer's deadline to choose, from the failed attempt. */
export const chooseBy = (failedAt: string) => new Date(Date.parse(failedAt) + CHOOSE_WITHIN_HOURS * HOUR).toISOString()

/** Window starts the buyer can pick, soonest first. */
export function redeliveryWindows(failedAt: string, nowMs: number): string[] {
  const from = nowMs + REDELIVERY_NOTICE_HOURS * HOUR
  const until = Date.parse(failedAt) + REDELIVER_WITHIN_HOURS * HOUR
  const day = Math.floor((nowMs + LAGOS_OFFSET_HOURS * HOUR) / (24 * HOUR)) * 24 * HOUR - LAGOS_OFFSET_HOURS * HOUR
  const out: string[] = []
  for (let d = 0; d <= 3; d++)
    for (const h of REDELIVERY_WINDOW_STARTS) {
      const start = day + d * 24 * HOUR + h * HOUR
      if (start >= from && start <= until) out.push(new Date(start).toISOString())
    }
  return out
}

export function redeliveryWindowError(start: string, failedAt: string, nowMs: number): string | null {
  return redeliveryWindows(failedAt, nowMs).includes(new Date(start).toISOString()) ? null : 'Pick one of the times shown.'
}

export const windowEnd = (start: string) => new Date(Date.parse(start) + REDELIVERY_WINDOW_HOURS * HOUR).toISOString()
