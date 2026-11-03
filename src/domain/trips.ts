/**
 * Several jobs on one trip. Pool jobs collected from the same place (one seller,
 * one pickup counter, or DrawMart's escrow), or going the same way between two
 * areas, are offered together; taking a trip takes each job, all or none, within
 * the rider's job limit (take_deliveries ↔ tripRoomError). Each order still has
 * its own check and PIN. A rider's own jobs are put in order as stops: collect
 * everything first, then drop off nearest first. Worked out on the phone only,
 * from places the rider already has, so nothing new is sent or stored.
 */
import { DELIVERY_AREAS } from './deliveryFees'
import { metresBetween } from './deliveryAttempts'
import { MAX_RIDER_JOBS } from './riderLimits'
import type { GeoPoint, Kobo } from './types'

export interface TripJob {
  id: string
  /** Where it's collected: 'shop:<id>', 'point:<id>' or 'drawmart'. */
  collectKey: string
  fromArea: string | null
  toArea: string | null
  locked: boolean
  payKobo: Kobo
}

export interface Trip<T extends TripJob> {
  key: string
  /** One collection point, or several on the same route. */
  kind: 'same_pickup' | 'same_route'
  jobs: T[]
  payKobo: Kobo
}

/** In the pool's order. A job is in at most one trip, and a trip has 2 to `max` jobs. */
export function poolTrips<T extends TripJob>(jobs: readonly T[], max = MAX_RIDER_JOBS): Trip<T>[] {
  const open = jobs.filter((j) => !j.locked)
  const trips: Trip<T>[] = []
  const used = new Set<string>()
  const add = (kind: Trip<T>['kind'], key: string, group: T[]) => {
    for (let i = 0; i + 1 < group.length; i += max) {
      const part = group.slice(i, i + max)
      if (part.length < 2) break
      trips.push({ key: `${key}#${i / max}`, kind, jobs: part, payKobo: part.reduce((n, j) => n + j.payKobo, 0) })
      for (const j of part) used.add(j.id)
    }
  }
  for (const [key, group] of groupBy(open, (j) => j.collectKey)) add('same_pickup', key, group)
  const rest = open.filter((j) => !used.has(j.id) && j.fromArea && j.toArea)
  for (const [key, group] of groupBy(rest, (j) => `${j.fromArea}>${j.toArea}`)) add('same_route', key, group)
  return trips
}

function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const t of items) m.set(key(t), [...(m.get(key(t)) ?? []), t])
  return m
}

/** Mirrors take_deliveries. */
export function tripRoomError(held: number, count: number, max = MAX_RIDER_JOBS): string | null {
  const room = Math.max(max - held, 0)
  return count > room ? `That’s ${count} jobs, and you have room for ${room} more.` : null
}

export interface StopJob {
  id: string
  collectKey: string
  /** Picked up already: only the drop-off is left. */
  collected: boolean
  collectName: string
  collectAt: GeoPoint | null
  collectArea: string | null
  dropName: string
  dropAt: GeoPoint | null
  dropArea: string | null
}

export interface Stop {
  kind: 'collect' | 'drop'
  /** Every job collected at this stop, or the one dropped off. */
  jobIds: string[]
  name: string
  area: string | null
}

const centre = (area: string | null): GeoPoint | null => DELIVERY_AREAS.find((a) => a.id === area) ?? null

/** Nearest next, from `from`. Places with no known spot go last, in their order. */
function nearestFirst<T>(items: T[], at: (t: T) => GeoPoint | null, from: GeoPoint | null): T[] {
  const left = [...items]
  const out: T[] = []
  let here = from
  while (left.length) {
    let best = 0
    if (here) {
      let bestM = Number.POSITIVE_INFINITY
      left.forEach((t, i) => {
        const p = at(t)
        const m = p ? metresBetween(here!, p) : Number.POSITIVE_INFINITY
        if (m < bestM) [best, bestM] = [i, m]
      })
    }
    const [next] = left.splice(best, 1)
    out.push(next)
    here = at(next) ?? here
  }
  return out
}

/** Collect everything first (one stop per place), then drop off nearest first. */
export function planStops(jobs: readonly StopJob[], start: GeoPoint | null = null): Stop[] {
  const collectAt = (j: StopJob) => j.collectAt ?? centre(j.collectArea)
  const dropAt = (j: StopJob) => j.dropAt ?? centre(j.dropArea)
  const pickups = [...groupBy(jobs.filter((j) => !j.collected), (j) => j.collectKey).values()]
  const firstFrom = start ?? (pickups[0] ? collectAt(pickups[0][0]) : null)
  const collects = nearestFirst(pickups, (g) => collectAt(g[0]), firstFrom)
  const last = collects.length ? collectAt(collects[collects.length - 1][0]) : start
  const drops = nearestFirst([...jobs], dropAt, last)
  return [
    ...collects.map((g): Stop => ({ kind: 'collect', jobIds: g.map((j) => j.id), name: g[0].collectName, area: g[0].collectArea })),
    ...drops.map((j): Stop => ({ kind: 'drop', jobIds: [j.id], name: j.dropName, area: j.dropArea })),
  ]
}
