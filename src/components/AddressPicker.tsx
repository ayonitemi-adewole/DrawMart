import { useEffect, useRef, useState, type ComponentType, type ComponentProps } from 'react'
import { LOCATION_ERROR_TEXT, locationError, roundPoint } from '@/domain/location'
import type { GeoPoint } from '@/domain/types'
import { reverseGeocode, searchPlaces, type Place } from '@/lib/geocode'
import { MapPinIcon, SearchIcon } from './icons'
import type LocationMap from './LocationMap'
import type { LocationMapHandle } from './LocationMap'
import { Button, Field, Skeleton, cx, inputCls } from './ui'

/** Below this zoom, a pin could be a street or more away from the real spot. */
const PRECISE_ZOOM = 15

/**
 * Where something is: a live map to pin the exact spot, with place search and
 * "use my location", and the written address beside it. The address fills in
 * from the pin until the person types their own.
 */
export function AddressPicker({
  id,
  label,
  hint,
  placeholder,
  address,
  onAddress,
  location,
  onLocation,
  addressError,
  showPinError,
}: {
  id: string
  label: string
  hint?: string
  placeholder?: string
  address: string
  onAddress: (address: string) => void
  location: GeoPoint | null
  onLocation: (p: GeoPoint) => void
  addressError?: string
  /** Show "pin it" too, once they've tried to continue. Pins outside Lagos always show. */
  showPinError?: boolean
}) {
  const [Map, setMap] = useState<ComponentType<ComponentProps<typeof LocationMap>> | null>(null)
  const [mapFailed, setMapFailed] = useState(false)
  const handle = useRef<LocationMapHandle>(null)
  const [zoom, setZoom] = useState(17)
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // The address found for the pin, offered when they've typed their own.
  const [found, setFound] = useState<string | null>(null)
  const typed = useRef(address.trim().length > 0)
  const lookup = useRef<{ timer?: ReturnType<typeof setTimeout>; abort?: AbortController }>({})

  function loadMap() {
    setMapFailed(false)
    import('./LocationMap').then(
      (m) => setMap(() => m.default),
      () => setMapFailed(true),
    )
  }
  useEffect(loadMap, [])
  useEffect(() => {
    const current = lookup.current
    return () => {
      clearTimeout(current.timer)
      current.abort?.abort()
    }
  }, [])

  function onMove(p: GeoPoint) {
    const point = roundPoint(p)
    onLocation(point)
    setNotice(null)
    // Wait until the map settles: the lookup service allows one request a second.
    clearTimeout(lookup.current.timer)
    lookup.current.abort?.abort()
    lookup.current.timer = setTimeout(() => {
      const abort = new AbortController()
      lookup.current.abort = abort
      reverseGeocode(point, fetch, abort.signal).then(
        (text) => {
          if (!text) return
          if (typed.current) setFound(text)
          else onAddress(text)
        },
        () => undefined, // the pin is what matters; they can still type the address
      )
    }, 1000)
  }

  async function search() {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setNotice(null)
    try {
      const results = await searchPlaces(q)
      setPlaces(results)
      if (!results.length) setNotice(`Nothing found for “${q}” in Lagos. Try an area or street, or drag the map.`)
    } catch {
      setPlaces(null)
      setNotice('Search isn’t working right now. Drag the map to your spot instead.')
    } finally {
      setSearching(false)
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setNotice('This device can’t share its location. Search or drag the map instead.')
      return
    }
    setLocating(true)
    setNotice(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        handle.current?.goTo({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      (err) => {
        setLocating(false)
        setNotice(err.code === err.PERMISSION_DENIED ? 'Location access is off for this site. Search or drag the map instead.' : 'Couldn’t find your location. Search or drag the map instead.')
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  const pinError = locationError(location)
  const shownPinError = pinError === 'outside_service_area' || (pinError && showPinError) ? LOCATION_ERROR_TEXT[pinError] : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <MapPinIcon size={14} /> Pin the exact spot
        </span>
        <div className="flex gap-2">
          <label htmlFor={`${id}-search`} className="sr-only">
            Search for a place in Lagos
          </label>
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // This sits inside the checkout's form: Enter searches, it doesn't submit.
              if (e.key === 'Enter') {
                e.preventDefault()
                void search()
              }
            }}
            placeholder="Search an area or street in Lagos"
            className={cx(inputCls, 'min-w-0 flex-1')}
          />
          <Button type="button" variant="outline" className="min-h-11 shrink-0 px-3" aria-label="Search" loading={searching} onClick={() => void search()}>
            <SearchIcon size={18} />
          </Button>
        </div>
        {places?.length ? (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line" aria-label="Places found">
            {places.map((p) => (
              <li key={`${p.point.lat},${p.point.lng}`}>
                <button
                  type="button"
                  onClick={() => {
                    handle.current?.goTo(p.point)
                    setPlaces(null)
                  }}
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-sunken"
                >
                  <MapPinIcon size={14} className="shrink-0 text-brand" /> {p.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {/* isolate: Leaflet's own layers mustn't sit above the app's sticky headers. */}
        <div className="relative isolate h-64 overflow-hidden rounded-2xl border border-line bg-sunken">
          {Map ? (
            <Map start={location} handle={handle} onMove={onMove} onZoom={setZoom} />
          ) : mapFailed ? (
            <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted">
              The map couldn’t load. Check your connection.
              <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={loadMap}>
                Try again
              </Button>
            </div>
          ) : (
            <Skeleton className="size-full" />
          )}
          {Map ? (
            <>
              {/* The tip of the pin marks the centre of the map. */}
              <span className="pointer-events-none absolute top-1/2 left-1/2 z-[1000] -translate-x-1/2 -translate-y-full text-hot drop-shadow-md">
                <MapPinIcon size={38} strokeWidth={2.4} fill="currentColor" stroke="white" />
              </span>
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                className="absolute right-2 bottom-6 z-[1000] flex min-h-11 items-center gap-1.5 rounded-xl bg-surface px-3 text-xs font-bold text-ink shadow-lift disabled:opacity-60"
              >
                <MapPinIcon size={14} className="text-brand" /> {locating ? 'Finding you…' : 'Use my location'}
              </button>
            </>
          ) : null}
        </div>

        {shownPinError ? (
          <span className="text-xs font-semibold text-hot-ink" role="alert">
            {shownPinError}
          </span>
        ) : notice ? (
          <span className="text-xs text-muted" role="status">
            {notice}
          </span>
        ) : location && zoom < PRECISE_ZOOM ? (
          <span className="text-xs font-semibold text-ticket-ink">Zoom in and check the pin is exactly right.</span>
        ) : (
          <span className="text-xs text-subtle">{location ? 'Pinned. Drag the map to adjust.' : 'Drag the map until the pin sits on the exact spot.'}</span>
        )}
      </div>

      <Field label={label} htmlFor={id} error={addressError} hint={hint}>
        <textarea
          id={id}
          rows={2}
          autoComplete="street-address"
          value={address}
          onChange={(e) => {
            typed.current = e.target.value.trim().length > 0
            setFound(null)
            onAddress(e.target.value)
          }}
          placeholder={placeholder}
          className={cx(inputCls, 'min-h-20 py-3')}
        />
      </Field>
      {found && found !== address ? (
        <button
          type="button"
          onClick={() => {
            onAddress(found)
            typed.current = false
            setFound(null)
          }}
          className="-mt-2 flex min-h-11 w-fit items-center rounded-xl px-2 text-left text-xs font-bold text-brand hover:bg-brand-soft"
        >
          Use the pin’s address: {found}
        </button>
      ) : null}
    </div>
  )
}
