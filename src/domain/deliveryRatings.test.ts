import { describe, expect, it } from 'vitest'
import { canRateDelivery, deliveredOnTime, followUpReasons, ratingError, riderPerformance, riderStats, type DeliveryRating, type TimedJob } from './deliveryRatings'

const at = (s: string) => Date.parse(s)
const job = (patch: Partial<TimedJob> = {}): TimedJob => ({ collectedAt: '2026-11-03T09:00:00Z', doneAt: '2026-11-03T10:00:00Z', windowEnd: null, redeliverAt: null, ...patch })
const rating = (good: boolean, ratedAt: string, reasons: DeliveryRating['reasons'] = []): DeliveryRating => ({ good, reasons, ratedAt })

describe('delivery ratings', () => {
  it('rates deliveries to the door for a week, not pickups or cars', () => {
    const o = { status: 'delivered', fulfilment: 'delivery', deliveredAt: '2026-11-01T10:00:00Z', category: 'Home' }
    expect(canRateDelivery(o, at('2026-11-07T10:00:00Z'))).toBe(true)
    expect(canRateDelivery(o, at('2026-11-08T10:00:00Z'))).toBe(false)
    expect(canRateDelivery({ ...o, fulfilment: 'pickup' }, at('2026-11-02T10:00:00Z'))).toBe(false)
    expect(canRateDelivery({ ...o, category: 'Cars' }, at('2026-11-02T10:00:00Z'))).toBe(false)
    expect(canRateDelivery({ ...o, status: 'dispatched' }, at('2026-11-02T10:00:00Z'))).toBe(false)
  })

  it('takes reasons only with a thumbs down', () => {
    expect(ratingError(true, [])).toBeNull()
    expect(ratingError(false, [])).toBeNull()
    expect(ratingError(false, ['late', 'rude'])).toBeNull()
    expect(ratingError(true, ['late'])).toMatch(/only for a thumbs down/)
    expect(ratingError(false, ['late', 'late'])).toMatch(/Pick from/)
    expect(ratingError(false, ['slow'])).toMatch(/Pick from/)
  })

  it('counts on time by the buyer’s window, a rebooked time, or hours from collecting', () => {
    expect(deliveredOnTime(job())).toBe(true)
    expect(deliveredOnTime(job({ doneAt: '2026-11-03T13:01:00Z' }))).toBe(false)
    expect(deliveredOnTime(job({ doneAt: '2026-11-03T13:01:00Z', windowEnd: '2026-11-03T15:00:00Z' }))).toBe(true)
    expect(deliveredOnTime(job({ windowEnd: '2026-11-03T09:30:00Z' }))).toBe(false)
    expect(deliveredOnTime(job({ doneAt: '2026-11-04T10:30:00Z', redeliverAt: '2026-11-04T09:00:00Z' }))).toBe(true)
    expect(deliveredOnTime(job({ doneAt: '2026-11-04T11:30:00Z', redeliverAt: '2026-11-04T09:00:00Z' }))).toBe(false)
    expect(deliveredOnTime(job({ collectedAt: null }))).toBeNull()
  })

  it('shows a rider their ratings only from five, and not ones given today', () => {
    const now = at('2026-11-10T12:00:00Z')
    const jobs = [job({ doneAt: '2026-11-09T10:00:00Z', collectedAt: '2026-11-09T09:00:00Z' }), job({ doneAt: '2026-11-09T10:00:00Z', collectedAt: '2026-11-09T01:00:00Z' }), job({ doneAt: '2026-10-01T10:00:00Z' })]
    const four = [1, 2, 3, 4].map((d) => rating(d !== 2, `2026-11-0${d}T10:00:00Z`, d === 2 ? ['late'] : []))
    expect(riderStats(jobs, four, now)).toEqual({ completed: 2, onTimeShare: 0.5, ratings: null })
    // A fifth today doesn't count until tomorrow.
    const five = [...four, rating(false, '2026-11-10T08:00:00Z', ['rude'])]
    expect(riderStats(jobs, five, now).ratings).toBeNull()
    expect(riderStats(jobs, five, at('2026-11-11T08:00:00Z')).ratings).toEqual({ up: 3, down: 2, reasons: { late: 1, rude: 1 } })
  })

  it('flags riders for a call: rude or unsafe at once, otherwise from enough jobs', () => {
    const now = at('2026-11-10T12:00:00Z')
    expect(followUpReasons(riderPerformance([], [rating(false, '2026-11-10T08:00:00Z', ['unsafe'])], now))).toEqual(['1 buyer said rude or unsafe'])
    const late = Array.from({ length: 5 }, (_, i) => job({ doneAt: '2026-11-09T10:00:00Z', collectedAt: i < 2 ? '2026-11-09T01:00:00Z' : '2026-11-09T09:00:00Z' }))
    expect(followUpReasons(riderPerformance(late, [], now))).toEqual(['60% on time'])
    expect(followUpReasons(riderPerformance(late.slice(0, 4), [], now))).toEqual([])
    const downs = [true, true, true, false, false].map((g) => rating(g, '2026-11-09T10:00:00Z', g ? [] : ['late']))
    expect(followUpReasons(riderPerformance([], downs, now))).toEqual(['2 of 5 thumbs down'])
    expect(followUpReasons(riderPerformance([], downs.slice(0, 4), now))).toEqual([])
  })
})
