import { describe, expect, it } from 'vitest'
import { canTakeYet, takeTooSoonError, latestReadyMs, offeredWindows, windowError, windowOpens, windowRank, windowText, windowTimes } from './deliveryWindows'

// Lagos is UTC+1: 09:00Z is 10am in Lagos.
const at = (s: string) => Date.parse(s)

describe('delivery windows', () => {
  it('turns a day and part of the day into Lagos times', () => {
    expect(windowTimes({ day: '2026-11-05', part: 'morning' })).toEqual({ start: '2026-11-05T08:00:00.000Z', end: '2026-11-05T11:00:00.000Z' })
    expect(windowTimes({ day: '2026-11-05', part: 'evening' })).toEqual({ start: '2026-11-05T15:00:00.000Z', end: '2026-11-05T19:00:00.000Z' })
  })

  it('starts from the latest the seller can have it ready', () => {
    // Ordered Tue 10am: confirm by 10pm, ready by Wed 9pm.
    expect(new Date(latestReadyMs(at('2026-11-03T09:00:00Z'))).toISOString()).toBe('2026-11-04T20:00:00.000Z')
    const offered = offeredWindows(at('2026-11-03T09:00:00Z'))
    expect(offered[0]).toEqual({ day: '2026-11-05', part: 'morning' })
    expect(offered).toHaveLength(9)
    expect(offered.at(-1)).toEqual({ day: '2026-11-07', part: 'evening' })
  })

  it('offers the rest of a day the seller can still make, then two more days', () => {
    // Ordered Tue 8pm: confirm by Wed 7pm, ready by Thu 6pm. Thu's evening starts at 4pm, so Fri.
    const offered = offeredWindows(at('2026-11-03T19:00:00Z'))
    expect(offered[0]).toEqual({ day: '2026-11-06', part: 'morning' })
    // Ordered Mon 1pm: ready by Wed 11am, so Wed afternoon is the first.
    const monday = offeredWindows(at('2026-11-02T12:00:00Z'))
    expect(monday[0]).toEqual({ day: '2026-11-04', part: 'afternoon' })
    expect(new Set(monday.map((w) => w.day))).toEqual(new Set(['2026-11-04', '2026-11-05', '2026-11-06']))
    expect(monday).toHaveLength(8)
  })

  it('refuses a window that isn’t offered, and allows none', () => {
    const now = at('2026-11-03T09:00:00Z')
    expect(windowError(null, now)).toBeNull()
    expect(windowError({ day: '2026-11-05', part: 'morning' }, now)).toBeNull()
    expect(windowError({ day: '2026-11-04', part: 'evening' }, now)).toMatch(/Pick one/)
    expect(windowError({ day: '2026-11-08', part: 'morning' }, now)).toMatch(/Pick one/)
  })

  it('lets riders take it from 7am on the day, and puts today’s first', () => {
    const start = '2026-11-05T15:00:00.000Z'
    expect(windowOpens(start)).toBe('2026-11-05T06:00:00.000Z')
    expect(canTakeYet(start, at('2026-11-05T05:59:00Z'))).toBe(false)
    expect(canTakeYet(start, at('2026-11-05T06:00:00Z'))).toBe(true)
    expect(canTakeYet(null, 0)).toBe(true)
    expect(takeTooSoonError(start, at('2026-11-04T12:00:00Z'))).toBe('This one is for Thu 5 Nov. It can be taken from 7am that day.')
    expect(takeTooSoonError(start, at('2026-11-05T06:00:00Z'))).toBeNull()
    expect(windowRank(start, at('2026-11-05T06:00:00Z'))).toBe(0)
    expect(windowRank(start, at('2026-11-06T06:00:00Z'))).toBe(0) // overdue
    expect(windowRank(null, 0)).toBe(1)
    expect(windowRank(start, at('2026-11-04T22:00:00Z'))).toBe(2) // 11pm Wed in Lagos
  })

  it('says when, plainly', () => {
    const t = windowTimes({ day: '2026-11-05', part: 'afternoon' })
    expect(windowText(t, at('2026-11-05T10:00:00Z'))).toBe('Today, 12pm–4pm')
    expect(windowText(t, at('2026-11-04T10:00:00Z'))).toBe('Tomorrow, 12pm–4pm')
    expect(windowText(windowTimes({ day: '2026-11-05', part: 'morning' }), at('2026-11-03T10:00:00Z'))).toBe('Thu 5 Nov, 9am–12pm')
  })
})
