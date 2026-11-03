import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { GeoPoint } from '@/domain/types'

const HOME = `<span class="block text-hot drop-shadow-md"><svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3" fill="white"/></svg></span>`
const RIDER = `<span class="block size-5 rounded-full border-[3px] border-white bg-brand shadow-lg"></span>`

/**
 * The buyer's own pin and where their rider is, moving as new positions arrive
 * (riderLocation.ts). Loaded on demand, like RouteMap.
 */
export default function TrackingMap({ rider, home, label }: { rider: GeoPoint; home: GeoPoint; label: string }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(m)
    L.marker([home.lat, home.lng], { icon: L.divIcon({ className: '', html: HOME, iconSize: [34, 34], iconAnchor: [17, 32] }), interactive: false, keyboard: false }).addTo(m)
    map.current = m
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => m.invalidateSize())
    resize?.observe(el.current)
    return () => {
      resize?.disconnect()
      m.remove()
      map.current = null
      marker.current = null
    }
  }, [home.lat, home.lng])

  // Moves the rider without rebuilding the map, and keeps both in view.
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!marker.current) marker.current = L.marker([rider.lat, rider.lng], { icon: L.divIcon({ className: '', html: RIDER, iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false, keyboard: false }).addTo(m)
    else marker.current.setLatLng([rider.lat, rider.lng])
    m.fitBounds(L.latLngBounds([rider.lat, rider.lng], [home.lat, home.lng]), { padding: [40, 40], maxZoom: 16 })
  }, [rider.lat, rider.lng, home.lat, home.lng])

  return <div ref={el} role="img" aria-label={label} className="size-full" />
}
