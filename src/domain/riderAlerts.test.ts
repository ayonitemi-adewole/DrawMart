import { describe, expect, it } from 'vitest'
import { RIDER_JOB_ALERTS_PER_HOUR, areaName, riderAreasError, riderJobAlertAllowed } from './riderAlerts'

describe('rider alerts', () => {
  const base = { enabled: true, areas: [] as string[], jobArea: 'ikeja', held: 0, sentLastHour: 0 }

  it('goes to riders in the job’s area, or who chose none', () => {
    expect(riderJobAlertAllowed(base)).toBe(true)
    expect(riderJobAlertAllowed({ ...base, areas: ['ikeja', 'yaba'] })).toBe(true)
    expect(riderJobAlertAllowed({ ...base, areas: ['lekki'] })).toBe(false)
    // Won items come from DrawMart, not a seller's area.
    expect(riderJobAlertAllowed({ ...base, areas: ['lekki'], jobArea: null })).toBe(true)
  })

  it('skips riders who switched it off, are full, or have had enough this hour', () => {
    expect(riderJobAlertAllowed({ ...base, enabled: false })).toBe(false)
    expect(riderJobAlertAllowed({ ...base, held: 5 })).toBe(false)
    expect(riderJobAlertAllowed({ ...base, held: 2, maxJobs: 2 })).toBe(false)
    expect(riderJobAlertAllowed({ ...base, sentLastHour: RIDER_JOB_ALERTS_PER_HOUR - 1 })).toBe(true)
    expect(riderJobAlertAllowed({ ...base, sentLastHour: RIDER_JOB_ALERTS_PER_HOUR })).toBe(false)
  })

  it('only takes our own areas', () => {
    expect(riderAreasError([])).toBeNull()
    expect(riderAreasError(['ikeja', 'vi'])).toBeNull()
    expect(riderAreasError(['mars'])).toMatch(/delivery areas/)
    expect(riderAreasError(['ikeja', 'ikeja'])).toMatch(/once/)
    expect(areaName('vi')).toBe('Victoria Island and Ikoyi')
    expect(areaName(null)).toBe('Lagos')
  })
})
