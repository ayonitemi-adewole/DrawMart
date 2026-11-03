import { useState } from 'react'
import { ClockIcon, NairaIcon, MapPinIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Segmented, cx, inputCls } from '@/components/ui'
import { DELIVERY_AREAS, PACKAGE_SIZE_TEXT } from '@/domain/deliveryFees'
import { windowRank, windowText } from '@/domain/deliveryWindows'
import { distanceText, jobInArea, sortPool, type PoolJob, type PoolSort } from '@/domain/jobPool'
import { formatNaira } from '@/domain/money'
import { areaName } from '@/domain/riderAlerts'
import type { GeoPoint } from '@/domain/types'

export interface PoolView {
  area: string | null
  sort: PoolSort
  here: GeoPoint | null
  apply: <T extends PoolJob>(jobs: readonly T[]) => T[]
}

/** The rider's filter and sort for the pool. Their location stays in this state only. */
export function usePoolView() {
  const toast = useToast()
  const [area, setArea] = useState<string | null>(null)
  const [sort, setSort] = useState<PoolSort>('newest')
  const [here, setHere] = useState<GeoPoint | null>(null)
  const [locating, setLocating] = useState(false)

  function choose(next: PoolSort) {
    if (next !== 'nearest' || here) return setSort(next)
    if (!navigator.geolocation) return toast('This device can’t share its location.', 'error')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setSort('nearest')
      },
      (err) => {
        setLocating(false)
        toast(err.code === err.PERMISSION_DENIED ? 'Turn on location for this site to sort by nearest.' : 'Couldn’t find your location. Try again.', 'error')
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
    )
  }

  const view: PoolView = { area, sort, here, apply: (jobs) => sortPool(jobs.filter((j) => jobInArea(j, area)), sort, here, Date.now()) }
  return { view, setArea, choose, locating }
}

export function PoolControls({ pool }: { pool: ReturnType<typeof usePoolView> }) {
  const { view, setArea, choose, locating } = pool
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label htmlFor="pool-area" className="sr-only">
        Area
      </label>
      <select id="pool-area" value={view.area ?? ''} onChange={(e) => setArea(e.target.value || null)} className={cx(inputCls, 'sm:w-64')}>
        <option value="">All areas</option>
        {DELIVERY_AREAS.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <Segmented<PoolSort>
        label="Sort by"
        value={view.sort}
        onChange={choose}
        size="sm"
        options={[
          { value: 'newest', label: 'Newest' },
          { value: 'pay', label: 'Best pay' },
          { value: 'nearest', label: locating ? 'Finding you…' : 'Nearest' },
        ]}
      />
      {view.sort === 'nearest' ? <span className="text-xs text-subtle">Your location stays on this phone.</span> : null}
    </div>
  )
}

/** "Ikeja and Maryland → Lekki and Ajah · ~18 km · Large · ₦2,450", and the buyer's window. */
export function JobFacts({ job: j }: { job: PoolJob }) {
  const distance = distanceText(j.fromArea, j.toArea)
  return (
    <span className="flex flex-col gap-1 text-xs">
      {j.windowStart && j.windowEnd ? <WindowLine start={j.windowStart} end={j.windowEnd} /> : null}
      <span className="flex items-start gap-1 text-muted">
        <MapPinIcon size={14} className="mt-px shrink-0" />
        {j.fromArea ? areaName(j.fromArea) : 'DrawMart'} → {areaName(j.toArea)}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-subtle">
        {distance ? <span>{distance}</span> : null}
        <span>{PACKAGE_SIZE_TEXT[j.size].label}</span>
        <span className="flex items-center gap-1 font-bold text-ink">
          <NairaIcon size={14} className="text-brand" /> Pays {formatNaira(j.payKobo)}
        </span>
      </span>
    </span>
  )
}

/** "Deliver tomorrow, 9am–12pm": the window the buyer chose (deliveryWindows.ts). */
export function WindowLine({ start, end }: { start: string; end: string }) {
  const now = Date.now()
  return (
    <span className={cx('flex items-center gap-1 font-bold', windowRank(start, now) === 0 ? 'text-hot' : 'text-ink')}>
      <ClockIcon size={14} className="shrink-0" /> Deliver {windowText({ start, end }, now).replace(/^(Today|Tomorrow)/, (d) => d.toLowerCase())}
    </span>
  )
}
