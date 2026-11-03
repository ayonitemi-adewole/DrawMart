/**
 * The job pool, made clearer: each job shows the area it's collected in and the
 * area it's going to (never an address), the package size, roughly how far, and
 * what it pays at today's rates (riderPay.ts, worked out by the server the same way
 * as the earning). Riders filter by area and sort by newest, pay, or nearest to
 * where they are. Their location is only used on the device, never sent or stored.
 * Whatever the sort, jobs with a delivery window today come first and ones for a later
 * day last (deliveryWindows.ts).
 */
import { DELIVERY_AREAS } from './deliveryFees'
import { metresBetween } from './deliveryAttempts'
import { windowRank } from './deliveryWindows'
import type { GeoPoint, Kobo, PackageSize } from './types'

export interface PoolJob {
  fromArea: string | null
  toArea: string | null
  size: PackageSize
  payKobo: Kobo
  /** For newest first. */
  postedAt: string | null
  /** The buyer's delivery window. Returns have none. */
  windowStart?: string | null
  windowEnd?: string | null
}

export type PoolSort = 'newest' | 'pay' | 'nearest'

const centre = (area: string | null) => DELIVERY_AREAS.find((a) => a.id === area) ?? null

/** Between the two areas' centres, so only a rough guide. Null if either is unknown. */
export function areaDistanceKm(from: string | null, to: string | null): number | null {
  const a = centre(from)
  const b = centre(to)
  return a && b ? metresBetween(a, b) / 1000 : null
}

/** "Within Ikeja", "~12 km", or nothing when it can't be told. */
export function distanceText(from: string | null, to: string | null): string | null {
  const km = areaDistanceKm(from, to)
  if (km === null) return null
  return km < 3 ? 'Same area' : `~${Math.round(km)} km`
}

export const jobInArea = (j: Pick<PoolJob, 'fromArea' | 'toArea'>, area: string | null) => !area || j.fromArea === area || j.toArea === area

/** How far the collection point's area is from here. Unknown areas go last. */
const fromHere = (j: Pick<PoolJob, 'fromArea'>, here: GeoPoint) => {
  const c = centre(j.fromArea)
  return c ? metresBetween(here, c) : Number.POSITIVE_INFINITY
}

export function sortPool<T extends PoolJob>(jobs: readonly T[], sort: PoolSort, here: GeoPoint | null, nowMs: number): T[] {
  const newest = (a: T, b: T) => (b.postedAt ?? '').localeCompare(a.postedAt ?? '')
  const chosen =
    sort === 'pay' ? (a: T, b: T) => b.payKobo - a.payKobo || newest(a, b)
    : sort === 'nearest' && here ? (a: T, b: T) => fromHere(a, here) - fromHere(b, here) || newest(a, b)
    : newest
  const rank = (j: T) => windowRank(j.windowStart ?? null, nowMs)
  // Within a day's windows, the soonest first.
  const soonest = (a: T, b: T) => (rank(a) === 1 ? 0 : (a.windowStart ?? '').localeCompare(b.windowStart ?? ''))
  return [...jobs].sort((a, b) => rank(a) - rank(b) || soonest(a, b) || chosen(a, b))
}
