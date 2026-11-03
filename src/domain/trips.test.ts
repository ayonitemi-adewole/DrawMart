import { describe, expect, it } from 'vitest'
import { planStops, poolTrips, tripRoomError, type StopJob, type TripJob } from './trips'

const job = (id: string, patch: Partial<TripJob> = {}): TripJob => ({ id, collectKey: 'shop:a', fromArea: 'ikeja', toArea: 'lekki', locked: false, payKobo: 100_000, ...patch })

describe('trips', () => {
  it('offers jobs from one place together, then jobs on the same route', () => {
    const trips = poolTrips([
      job('1'), job('2'), job('3', { collectKey: 'shop:b', toArea: 'vi' }),
      job('4', { collectKey: 'shop:c', fromArea: 'yaba', toArea: 'vi' }), job('5', { collectKey: 'shop:d', fromArea: 'yaba', toArea: 'vi' }),
      job('6', { collectKey: 'drawmart', fromArea: null }),
    ])
    expect(trips.map((t) => [t.kind, t.jobs.map((j) => j.id), t.payKobo])).toEqual([
      ['same_pickup', ['1', '2'], 200_000],
      ['same_route', ['4', '5'], 200_000],
    ])
  })

  it('leaves out jobs a new rider can’t take, and splits big groups to the job limit', () => {
    expect(poolTrips([job('1'), job('2', { locked: true })])).toEqual([])
    const seven = Array.from({ length: 7 }, (_, i) => job(String(i)))
    expect(poolTrips(seven).map((t) => t.jobs.length)).toEqual([5, 2])
    expect(poolTrips(seven.slice(0, 6)).map((t) => t.jobs.length)).toEqual([5])
    expect(poolTrips(seven, 3).map((t) => t.jobs.length)).toEqual([3, 3])
  })

  it('takes a trip only if there’s room for all of it', () => {
    expect(tripRoomError(3, 2)).toBeNull()
    expect(tripRoomError(4, 2)).toBe('That’s 2 jobs, and you have room for 1 more.')
    expect(tripRoomError(6, 2)).toBe('That’s 2 jobs, and you have room for 0 more.')
    expect(tripRoomError(1, 3, 3)).toMatch(/room for 2/)
  })

  it('collects everything first, one stop per place, then drops off nearest first', () => {
    const ikeja = { lat: 6.59, lng: 3.35 }
    const s = (id: string, patch: Partial<StopJob>): StopJob => ({
      id, collectKey: 'shop:a', collected: false, collectName: 'Ikeja Store', collectAt: ikeja, collectArea: 'ikeja', dropName: `Buyer ${id}`, dropAt: null, dropArea: 'lekki', ...patch,
    })
    const stops = planStops([
      s('far', { dropArea: 'epe' }),
      s('near', { dropAt: { lat: 6.58, lng: 3.36 } }),
      s('mid', { dropArea: 'yaba' }),
      s('other', { collectKey: 'shop:b', collectName: 'Yaba Store', collectAt: null, collectArea: 'yaba', dropArea: 'vi' }),
      s('held', { collected: true, collectKey: 'shop:z', dropArea: 'island' }),
    ])
    // Nothing to collect for the one already held.
    expect(stops.slice(0, 2).map((x) => [x.kind, x.jobIds.join('+')])).toEqual([
      ['collect', 'far+near+mid'],
      ['collect', 'other'],
    ])
    // From Yaba, the last collection: Yaba itself, the Island, VI, Ikeja, and Epe last.
    expect(stops.slice(2).map((x) => [x.kind, x.jobIds[0]])).toEqual([['drop', 'mid'], ['drop', 'held'], ['drop', 'other'], ['drop', 'near'], ['drop', 'far']])
    expect(stops[0]).toMatchObject({ name: 'Ikeja Store', area: 'ikeja' })
  })

  it('starts from where the rider is, when they share it, and copes with nothing to collect', () => {
    const j = (id: string, area: string): StopJob => ({ id, collectKey: `shop:${id}`, collected: false, collectName: id, collectAt: null, collectArea: area, dropName: id, dropAt: null, dropArea: area })
    const fromLekki = planStops([j('ikeja', 'ikeja'), j('lekki', 'lekki')], { lat: 6.45, lng: 3.49 })
    expect(fromLekki.filter((x) => x.kind === 'collect').map((x) => x.name)).toEqual(['lekki', 'ikeja'])
    expect(planStops([{ ...j('a', 'vi'), collected: true }]).map((x) => x.kind)).toEqual(['drop'])
    expect(planStops([])).toEqual([])
  })
})
