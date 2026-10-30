/**
 * Place search and address lookup through OpenStreetMap's Nominatim. Its usage
 * policy allows at most one request a second and no search-as-you-type, so
 * search runs on submit and address lookups wait until the map stops moving.
 * Heavy production use needs a paid or self-hosted provider: only this file
 * and the tile URL in LocationMap.tsx would change.
 */
import { SERVICE_AREA } from '@/domain/location'
import type { GeoPoint } from '@/domain/types'

const BASE = 'https://nominatim.openstreetmap.org'

export interface Place {
  label: string
  point: GeoPoint
}

interface NominatimPlace {
  display_name?: string
  lat?: string
  lon?: string
}

/** "12 Allen Avenue, Ikeja, Lagos State, 100001, Nigeria" reads better without the last parts. */
export function shortenAddress(name: string): string {
  return name
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'Nigeria' && !/^\d{5,6}$/.test(s))
    .join(', ')
}

export async function searchPlaces(query: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<Place[]> {
  const { west, north, east, south } = SERVICE_AREA
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', countrycodes: 'ng', viewbox: `${west},${north},${east},${south}`, bounded: '1', 'accept-language': 'en' })
  const res = await fetchFn(`${BASE}/search?${params}`, { signal })
  if (!res.ok) throw new Error('Place search is unavailable right now.')
  const rows = (await res.json()) as NominatimPlace[]
  return rows.flatMap((r) => {
    const point = { lat: Number(r.lat), lng: Number(r.lon) }
    return r.display_name && Number.isFinite(point.lat) && Number.isFinite(point.lng) ? [{ label: shortenAddress(r.display_name), point }] : []
  })
}

/** The address at a point, or null if there isn't one. */
export async function reverseGeocode(p: GeoPoint, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<string | null> {
  const params = new URLSearchParams({ lat: String(p.lat), lon: String(p.lng), format: 'jsonv2', zoom: '18', 'accept-language': 'en' })
  const res = await fetchFn(`${BASE}/reverse?${params}`, { signal })
  if (!res.ok) return null
  const row = (await res.json()) as NominatimPlace
  return row.display_name ? shortenAddress(row.display_name) : null
}
