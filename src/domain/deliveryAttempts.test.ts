import { describe, expect, it } from 'vitest'
import { attemptError, canFailFrom, chooseBy, metresBetween, redeliveryWindowError, redeliveryWindows, windowEnd } from './deliveryAttempts'

describe('failed delivery attempts', () => {
  const pin = { lat: 6.45, lng: 3.43 }
  const arrivedAt = '2026-11-02T13:00:00.000Z'
  const base = { arrivedAt, nowMs: Date.parse('2026-11-02T13:10:00.000Z'), photos: ['/assets/a.jpg'], at: pin, dropOff: pin }

  it('needs the arrival, the wait, a photo and being there', () => {
    expect(canFailFrom(arrivedAt)).toBe('2026-11-02T13:10:00.000Z')
    expect(attemptError(base)).toBeNull()
    expect(attemptError({ ...base, arrivedAt: null })).toMatch(/arrived/)
    expect(attemptError({ ...base, nowMs: base.nowMs - 1 })).toMatch(/Wait 10 minutes/)
    expect(attemptError({ ...base, photos: [] })).toMatch(/photo/)
    expect(attemptError({ ...base, at: null })).toMatch(/location/)
    expect(attemptError({ ...base, at: { lat: 6.454, lng: 3.43 } })).toBeNull() // ~450m
    expect(attemptError({ ...base, at: { lat: 6.46, lng: 3.43 } })).toMatch(/buyer’s address/)
    // Older orders without a pin go by the written address.
    expect(attemptError({ ...base, at: { lat: 6.6, lng: 3.3 }, dropOff: null })).toBeNull()
    expect(Math.round(metresBetween(pin, { lat: 6.46, lng: 3.43 }))).toBe(1112)
  })

  it('offers 2-hour windows from an hour away, up to 2 days after the attempt', () => {
    // 14:30 Lagos on Monday.
    const failedAt = '2026-11-02T13:30:00.000Z'
    const now = Date.parse(failedAt)
    const windows = redeliveryWindows(failedAt, now)
    // Lagos 17:00 Monday is the first, Wednesday 13:00 the last before 14:30.
    expect(windows[0]).toBe('2026-11-02T16:00:00.000Z')
    expect(windows.at(-1)).toBe('2026-11-04T12:00:00.000Z')
    expect(windows).toHaveLength(1 + 5 + 3)
    expect(windowEnd(windows[0])).toBe('2026-11-02T18:00:00.000Z')
    expect(redeliveryWindowError(windows[2], failedAt, now)).toBeNull()
    expect(redeliveryWindowError('2026-11-02T16:30:00.000Z', failedAt, now)).toMatch(/Pick one/)
    expect(redeliveryWindowError('2026-11-04T14:00:00.000Z', failedAt, now)).toMatch(/Pick one/)
    expect(chooseBy(failedAt)).toBe('2026-11-03T13:30:00.000Z')
  })
})
