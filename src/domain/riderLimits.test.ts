import { describe, expect, it } from 'vitest'
import { COLLECT_WITHIN_MINUTES, MAX_RIDER_JOBS, collectBy, collectSoon, collectionOverdue, takeJobError } from './riderLimits'

describe('rider limits', () => {
  it('refuses a job past the most a rider can hold', () => {
    expect(takeJobError(MAX_RIDER_JOBS - 1)).toBeNull()
    expect(takeJobError(MAX_RIDER_JOBS)).toMatch(/5 jobs, the most/)
    expect(takeJobError(3, 3)).toMatch(/3 jobs/)
  })

  it('sends an uncollected job back after the time limit, warning half an hour before', () => {
    const by = collectBy('2026-11-02T10:00:00.000Z')
    expect(COLLECT_WITHIN_MINUTES).toBe(120)
    expect(by).toBe('2026-11-02T12:00:00.000Z')
    expect(collectBy('2026-11-02T10:00:00.000Z', 30)).toBe('2026-11-02T10:30:00.000Z')
    const at = (hhmm: string) => Date.parse(`2026-11-02T${hhmm}:00.000Z`)
    expect(collectSoon(by, at('11:29'))).toBe(false)
    expect(collectSoon(by, at('11:30'))).toBe(true)
    expect(collectionOverdue(by, at('11:59'))).toBe(false)
    expect(collectionOverdue(by, at('12:00'))).toBe(true)
    expect(collectSoon(by, at('12:00'))).toBe(false)
  })
})
