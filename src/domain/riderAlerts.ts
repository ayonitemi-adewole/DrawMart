import { DELIVERY_AREAS } from './deliveryFees'
import { MAX_RIDER_JOBS } from './riderLimits'

/**
 * Alerts for riders, in the app and as push. A new job or return goes to riders
 * whose areas include where it's collected (none chosen means all of Lagos), who
 * have room for another job and haven't switched them off, and at most
 * RIDER_JOB_ALERTS_PER_HOUR an hour, so a busy hour doesn't mean dozens. A rider's
 * own jobs get a reminder before they go back to the pool, word when one has, and
 * when a paused PIN can be tried again. A lock screen only ever shows the item type
 * and the area: never an address, a name or a PIN. Mirrored in private.alert_riders.
 */
export const RIDER_JOB_ALERTS_PER_HOUR = 4

export interface RiderJobAlert {
  /** The rider's switch for this kind (new jobs or returns). */
  enabled: boolean
  /** Areas the rider chose. Empty means everywhere. */
  areas: readonly string[]
  /** Where it's collected. Null when that isn't a seller's area (won items, from DrawMart). */
  jobArea: string | null
  held: number
  maxJobs?: number
  /** New-job and return alerts in the last hour. */
  sentLastHour: number
}

export function riderJobAlertAllowed(a: RiderJobAlert): boolean {
  return (
    a.enabled &&
    (a.jobArea === null || a.areas.length === 0 || a.areas.includes(a.jobArea)) &&
    a.held < (a.maxJobs ?? MAX_RIDER_JOBS) &&
    a.sentLastHour < RIDER_JOB_ALERTS_PER_HOUR
  )
}

export function riderAreasError(areas: readonly string[]): string | null {
  if (areas.some((id) => !DELIVERY_AREAS.some((a) => a.id === id))) return 'That isn’t one of our delivery areas.'
  if (new Set(areas).size !== areas.length) return 'Each area only once.'
  return null
}

export const areaName = (id: string | null) => DELIVERY_AREAS.find((a) => a.id === id)?.name ?? 'Lagos'
