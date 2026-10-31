import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { GeoPoint } from '@/domain/types'

const PIN = `<span class="block text-hot drop-shadow-md"><svg viewBox="0 0 24 24" width="38" height="38" fill="currentColor" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3" fill="white"/></svg></span>`

/**
 * A map showing one fixed spot, for whoever is going there. Choosing a spot is
 * LocationMap. Loaded on demand, because Leaflet is only needed on these screens.
 */
export default function RouteMap({ point, label }: { point: GeoPoint; label: string }) {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!el.current) return
    const map = L.map(el.current).setView([point.lat, point.lng], 16)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map)
    L.marker([point.lat, point.lng], { icon: L.divIcon({ className: '', html: PIN, iconSize: [38, 38], iconAnchor: [19, 36] }), interactive: false, keyboard: false }).addTo(map)

    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => map.invalidateSize())
    resize?.observe(el.current)
    return () => {
      resize?.disconnect()
      map.remove()
    }
  }, [point.lat, point.lng])

  return <div ref={el} role="img" aria-label={label} className="size-full" />
}
