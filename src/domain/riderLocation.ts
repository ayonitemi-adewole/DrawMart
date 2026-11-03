/**
 * Live rider location, on the last leg only. A rider who opts in shares their phone's
 * position every SHARE_EVERY_SECONDS while carrying something to a buyer's door (the
 * same window as the delivery chat: collected, a delivery, not at a counter). Only the
 * latest point is kept, never a route, and it's deleted once they're carrying nothing.
 * The buyer of that order sees it, if it's under LOCATION_FRESH_MINUTES old, with a
 * rough arrival time. Mirrored in public.share_location, public.rider_location and
 * private.forget_rider_position.
 */
import { metresBetween } from './deliveryAttempts'
import type { GeoPoint } from './types'

export const SHARE_EVERY_SECONDS = 30
export const LOCATION_FRESH_MINUTES = 5
/** Motorbikes in Lagos traffic, roughly. */
export const RIDER_SPEED_KMH = 18
/** Roads aren't straight lines. */
export const ROAD_FACTOR = 1.4

/** A job the rider is taking to the buyer's door: the only time they share. */
export function carryingToBuyer(j: { mine: boolean; status: string; fulfilment: string; collected: boolean; atCounterAt: string | null; returning: boolean }): boolean {
  return j.mine && j.status === 'dispatched' && j.fulfilment === 'delivery' && j.collected && !j.atCounterAt && !j.returning
}

export const locationFresh = (updatedAt: string, nowMs: number) => nowMs - Date.parse(updatedAt) <= LOCATION_FRESH_MINUTES * 60_000

/** Minutes, rounded up to 5, at least 5. */
export function etaMinutes(from: GeoPoint, to: GeoPoint): number {
  const km = (metresBetween(from, to) * ROAD_FACTOR) / 1000
  return Math.max(5, Math.ceil(((km / RIDER_SPEED_KMH) * 60) / 5) * 5)
}

export function etaText(minutes: number): string {
  return minutes > 60 ? 'Over an hour away' : `About ${minutes} min away`
}

export function positionError(p: GeoPoint): string | null {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 ? null : 'That location doesn’t look right.'
}
