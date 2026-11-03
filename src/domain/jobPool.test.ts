import { describe, expect, it } from 'vitest'
import { areaDistanceKm, distanceText, jobInArea, sortPool, type PoolJob } from './jobPool'

const job = (fromArea: string | null, toArea: string | null, payKobo: number, postedAt: string): PoolJob & { id: string } => ({ id: `${fromArea}-${toArea}`, fromArea, toArea, size: 'small', payKobo, postedAt })

describe('job pool', () => {
  it('gives a rough distance between areas', () => {
    expect(distanceText('ikeja', 'ikeja')).toBe('Same area')
    expect(Math.round(areaDistanceKm('ikeja', 'lekki')!)).toBe(Math.round(areaDistanceKm('lekki', 'ikeja')!))
    expect(distanceText('ikeja', 'epe')).toMatch(/^~\d+ km$/)
    expect(distanceText(null, 'ikeja')).toBeNull()
  })

  it('filters by either end, and sorts by newest, pay or nearest', () => {
    const jobs = [job('ikeja', 'yaba', 100_000, '2026-11-02T10:00:00Z'), job('lekki', 'vi', 200_000, '2026-11-02T09:00:00Z'), job(null, 'ikeja', 150_000, '2026-11-02T11:00:00Z')]
    expect(jobs.filter((j) => jobInArea(j, 'yaba')).map((j) => j.id)).toEqual(['ikeja-yaba'])
    expect(jobs.filter((j) => jobInArea(j, 'ikeja')).map((j) => j.id)).toEqual(['ikeja-yaba', 'null-ikeja'])
    expect(jobs.filter((j) => jobInArea(j, null))).toHaveLength(3)
    expect(sortPool(jobs, 'newest', null, 0).map((j) => j.id)).toEqual(['null-ikeja', 'ikeja-yaba', 'lekki-vi'])
    expect(sortPool(jobs, 'pay', null, 0).map((j) => j.payKobo)).toEqual([200_000, 150_000, 100_000])
    // Standing in Lekki: the Lekki pickup first, the unknown one (DrawMart's escrow) last.
    expect(sortPool(jobs, 'nearest', { lat: 6.45, lng: 3.49 }, 0).map((j) => j.id)).toEqual(['lekki-vi', 'ikeja-yaba', 'null-ikeja'])
    // Without a location, nearest falls back to newest.
    expect(sortPool(jobs, 'nearest', null, 0).map((j) => j.id)).toEqual(['null-ikeja', 'ikeja-yaba', 'lekki-vi'])
  })

  it('puts today’s delivery windows first, soonest first, and later days last, whatever the sort', () => {
    const now = Date.parse('2026-11-05T08:00:00Z')
    const jobs = [
      { ...job('ikeja', 'yaba', 300_000, '2026-11-05T07:00:00Z'), id: 'none' },
      { ...job('ikeja', 'yaba', 100_000, '2026-11-04T07:00:00Z'), id: 'today-evening', windowStart: '2026-11-05T15:00:00Z' },
      { ...job('ikeja', 'yaba', 100_000, '2026-11-04T07:00:00Z'), id: 'today-morning', windowStart: '2026-11-05T08:00:00Z' },
      { ...job('ikeja', 'yaba', 900_000, '2026-11-04T07:00:00Z'), id: 'friday', windowStart: '2026-11-06T08:00:00Z' },
    ]
    expect(sortPool(jobs, 'pay', null, now).map((j) => j.id)).toEqual(['today-morning', 'today-evening', 'none', 'friday'])
  })
})
