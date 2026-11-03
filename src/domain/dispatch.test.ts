import { describe, expect, it } from 'vitest'
import { STUCK_CARRYING_HOURS, STUCK_WAITING_HOURS, assignJobError, canAssign, canTakeBack, claimStage, dispatchStuck, orderStage, waitedText, type DispatchOrderFacts } from './dispatch'

const T = '2026-11-03T08:00:00.000Z'
const at = (hhmm: string) => Date.parse(`2026-11-03T${hhmm}:00.000Z`)
const order = (patch: Partial<DispatchOrderFacts> = {}): DispatchOrderFacts => ({
  status: 'dispatched', hasRider: false, riderTakenAt: null, dispatchedAt: T, collectedAt: null, atCounterAt: null, counterOutAt: null,
  returnState: null, failedAttempts: 0, lastFailedAt: null, cancelledAt: null, ...patch,
})

describe('dispatch board', () => {
  it('puts each order at one stage, from when it got there', () => {
    expect(orderStage(order())).toEqual({ stage: 'waiting', since: T })
    expect(orderStage(order({ hasRider: true, riderTakenAt: 'a' }))).toEqual({ stage: 'taken', since: 'a' })
    expect(orderStage(order({ hasRider: true, collectedAt: 'b' }))).toEqual({ stage: 'carrying', since: 'b' })
    expect(orderStage(order({ hasRider: true, collectedAt: 'b', failedAttempts: 1, lastFailedAt: 'c' }))).toEqual({ stage: 'failed', since: 'c' })
    expect(orderStage(order({ hasRider: true, collectedAt: 'b', atCounterAt: 'd' }))).toEqual({ stage: 'at_counter', since: 'd' })
    for (const status of ['paid', 'delivered', 'cancelled']) expect(orderStage(order({ status }))).toBeNull()
    expect(orderStage(order({ status: 'cancelled', returnState: 'returned' }))).toBeNull()
  })

  it('follows an item going back, including one waiting on a counter’s shelf', () => {
    const back = { status: 'cancelled', returnState: 'returning' as const, cancelledAt: 'x' }
    expect(orderStage(order({ ...back, hasRider: true, collectedAt: 'b' }))).toEqual({ stage: 'returning', since: 'x' })
    expect(orderStage(order({ ...back, atCounterAt: 'd' }))).toEqual({ stage: 'waiting', since: 'x' })
    expect(orderStage(order({ ...back, atCounterAt: 'd', hasRider: true, riderTakenAt: 'e' }))).toEqual({ stage: 'taken', since: 'e' })
    expect(orderStage(order({ ...back, atCounterAt: 'd', hasRider: true, counterOutAt: 'f' }))).toEqual({ stage: 'returning', since: 'f' })
  })

  it('places buyers’ returns too', () => {
    const c = { hasRider: false, riderTakenAt: null, openedAt: 'o', pickedUpAt: null }
    expect(claimStage({ ...c, status: 'awaiting_pickup' })).toEqual({ stage: 'waiting', since: 'o' })
    expect(claimStage({ ...c, status: 'awaiting_pickup', hasRider: true, riderTakenAt: 't' })).toEqual({ stage: 'taken', since: 't' })
    expect(claimStage({ ...c, status: 'returning', hasRider: true, pickedUpAt: 'p' })).toEqual({ stage: 'returning', since: 'p' })
    for (const status of ['open', 'declined', 'upheld', 'returned', 'pickup_failed'] as const) expect(claimStage({ ...c, status })).toBeNull()
  })

  it('flags a job waiting 3 hours or carried for 6', () => {
    expect([STUCK_WAITING_HOURS, STUCK_CARRYING_HOURS]).toEqual([3, 6])
    expect(dispatchStuck('waiting', T, at('10:59'))).toBe(false)
    expect(dispatchStuck('waiting', T, at('11:00'))).toBe(true)
    for (const stage of ['carrying', 'returning'] as const) {
      expect(dispatchStuck(stage, T, at('13:59'))).toBe(false)
      expect(dispatchStuck(stage, T, at('14:00'))).toBe(true)
    }
    // Taken jobs go back by themselves; counters and failed attempts have their own deadlines.
    for (const stage of ['taken', 'at_counter', 'failed'] as const) expect(dispatchStuck(stage, T, at('23:00'))).toBe(false)
    expect(dispatchStuck('waiting', null, at('23:00'))).toBe(false)
    expect(dispatchStuck('waiting', T, at('09:00'), { waitingHours: 1, carryingHours: 2 })).toBe(true)
  })

  it('assigns waiting jobs, and takes back only what hasn’t been collected', () => {
    expect(canAssign('waiting')).toBe(true)
    expect(canAssign('taken')).toBe(false)
    expect(canTakeBack('taken')).toBe(true)
    for (const stage of ['waiting', 'carrying', 'at_counter', 'failed', 'returning'] as const) expect(canTakeBack(stage)).toBe(false)
    expect(assignJobError(4)).toBeNull()
    expect(assignJobError(5)).toMatch(/has 5 jobs, the most they can hold/)
  })

  it('says how long it has waited', () => {
    expect(waitedText(T, at('08:45'))).toBe('45 min')
    expect(waitedText(T, at('11:20'))).toBe('3 h 20 min')
    expect(waitedText(T, at('14:00'))).toBe('6 h')
    expect(waitedText(T, Date.parse('2026-11-06T08:00:00.000Z'))).toBe('3 days')
  })
})
