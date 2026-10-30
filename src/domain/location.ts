/**
 * Pinned locations for deliveries and pickups: an address alone often isn't
 * enough for a rider in Lagos. Mirrored in private.location_error in
 * supabase/migrations/…_pinned_locations.sql.
 */
import type { GeoPoint } from './types'

/** Where the map opens before anything is pinned. */
export const LAGOS_CENTER: GeoPoint = { lat: 6.5244, lng: 3.3792 }

/** Lagos State, roughly: Badagry to Epe, the coast to Ikorodu. */
export const SERVICE_AREA = { south: 6.35, north: 6.75, west: 2.7, east: 4.35 }

export function isInServiceArea(p: GeoPoint): boolean {
  return p.lat >= SERVICE_AREA.south && p.lat <= SERVICE_AREA.north && p.lng >= SERVICE_AREA.west && p.lng <= SERVICE_AREA.east
}

export type LocationError = 'location_required' | 'outside_service_area'

export function locationError(p: GeoPoint | null | undefined): LocationError | null {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return 'location_required'
  return isInServiceArea(p) ? null : 'outside_service_area'
}

export const LOCATION_ERROR_TEXT: Record<LocationError, string> = {
  location_required: 'Pin the exact spot on the map.',
  outside_service_area: 'That pin is outside Lagos, where we operate for now.',
}

/** Directions for a rider: opens the phone's maps app. */
export function directionsUrl(p: GeoPoint): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
}

/** About 10cm: more would be false precision. */
export function roundPoint(p: GeoPoint): GeoPoint {
  return { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 }
}
