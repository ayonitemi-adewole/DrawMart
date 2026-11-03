import { describe, expect, it } from 'vitest'
import { OFFLINE_KEEP_HOURS, deliveryJobsToKeep, returnJobsToKeep, savedJobsFor } from './offlineJobs'

describe('jobs without signal', () => {
  it('keeps only the rider’s own unfinished jobs', () => {
    const jobs = [
      { id: 'carrying', mine: true, status: 'dispatched', atCounterAt: null, returning: false },
      { id: 'pool', mine: false, status: 'dispatched', atCounterAt: null, returning: false },
      { id: 'delivered', mine: true, status: 'delivered', atCounterAt: null, returning: false },
      { id: 'at-counter', mine: true, status: 'dispatched', atCounterAt: '2026-11-03T10:00:00Z', returning: false },
      { id: 'refused', mine: true, status: 'cancelled', atCounterAt: null, returning: true },
      { id: 'returned', mine: true, status: 'cancelled', atCounterAt: null, returning: false },
    ]
    expect(deliveryJobsToKeep(jobs).map((j) => j.id)).toEqual(['carrying', 'refused'])
    const returns = [{ id: 'collect', mine: true, status: 'awaiting_pickup' }, { id: 'back', mine: true, status: 'returning' }, { id: 'done', mine: true, status: 'returned' }, { id: 'pool', mine: false, status: 'awaiting_pickup' }]
    expect(returnJobsToKeep(returns).map((j) => j.id)).toEqual(['collect', 'back'])
  })

  it('only gives a day-old save to the account that made it', () => {
    const saved = { userId: 'u1', savedAt: 0, jobs: [1] }
    expect(savedJobsFor(saved, 'u1', 1000)).toBe(saved)
    expect(savedJobsFor(saved, 'u2', 1000)).toBeNull()
    expect(savedJobsFor(saved, null, 1000)).toBeNull()
    expect(savedJobsFor(saved, 'u1', OFFLINE_KEEP_HOURS * 3_600_000 + 1)).toBeNull()
    expect(savedJobsFor(null, 'u1', 0)).toBeNull()
  })
})
