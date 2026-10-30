import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, type RefObject } from 'react'
import { LAGOS_CENTER } from '@/domain/location'
import type { GeoPoint } from '@/domain/types'

export interface LocationMapHandle {
  goTo(p: GeoPoint): void
}

/**
 * The Leaflet map behind AddressPicker. The pin is fixed in the middle and the
 * map moves under it, which is easier on a phone than dragging a marker.
 * Loaded on demand, because Leaflet is only needed on these screens.
 */
export default function LocationMap({
  start,
  handle,
  onMove,
  onZoom,
}: {
  start: GeoPoint | null
  handle: RefObject<LocationMapHandle | null>
  /** The spot under the pin, whenever the map has moved to a new one. */
  onMove: (p: GeoPoint) => void
  onZoom: (zoom: number) => void
}) {
  const el = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onMove, onZoom })
  callbacks.current = { onMove, onZoom }
  const initial = useRef(start)

  useEffect(() => {
    if (!el.current) return
    const from = initial.current
    const map = L.map(el.current, {
      // Zooming stays centred on the pin, so it can't move the spot by accident.
      scrollWheelZoom: 'center',
      touchZoom: 'center',
      doubleClickZoom: 'center',
    }).setView(from ? [from.lat, from.lng] : [LAGOS_CENTER.lat, LAGOS_CENTER.lng], from ? 17 : 12)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map)

    let last = map.getCenter()
    map.on('moveend', () => {
      const center = map.getCenter()
      if (center.distanceTo(last) < 1) return // a resize or zoom, not a new spot
      last = center
      callbacks.current.onMove({ lat: center.lat, lng: center.lng })
    })
    map.on('zoomend', () => callbacks.current.onZoom(map.getZoom()))
    callbacks.current.onZoom(map.getZoom())

    handle.current = { goTo: (p) => map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17)) }

    // Sheets animate in, so the map's size can change after it's created.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => map.invalidateSize())
    resize?.observe(el.current)
    return () => {
      resize?.disconnect()
      handle.current = null
      map.remove()
    }
  }, [handle])

  return <div ref={el} className="size-full" />
}
