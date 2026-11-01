import { describe, expect, it } from 'vitest'
import { addConfirmTime, confirmDeadline, confirmOverdue, confirmReminderDue, needsConfirming } from './orderConfirm'

/** Times here are Lagos time, which is always UTC+1. */
const lagos = (s: string) => Date.parse(`${s}+01:00`)
const deadline = (ordered: string) => new Date(confirmDeadline(lagos(ordered))).getTime()

describe('the time to confirm', () => {
  it('gives 12 hours when they fit in the day', () => {
    expect(deadline('2026-11-02T10:00:00')).toBe(lagos('2026-11-02T22:00:00'))
    expect(deadline('2026-11-02T09:00:00')).toBe(lagos('2026-11-02T21:00:00'))
  })

  it('stops at 10pm and starts again at 9am', () => {
    expect(deadline('2026-11-02T21:00:00')).toBe(lagos('2026-11-03T20:00:00')) // 1 hour, then 11
    expect(deadline('2026-11-02T11:00:00')).toBe(lagos('2026-11-03T10:00:00')) // 11 hours, then 1
  })

  it('starts at 9am for an order placed overnight', () => {
    expect(deadline('2026-11-02T23:00:00')).toBe(lagos('2026-11-03T21:00:00'))
    expect(deadline('2026-11-02T22:00:00')).toBe(lagos('2026-11-03T21:00:00'))
    expect(deadline('2026-11-03T03:00:00')).toBe(lagos('2026-11-03T21:00:00'))
    expect(deadline('2026-11-03T08:59:00')).toBe(lagos('2026-11-03T21:00:00'))
  })

  it('crosses more than one night for a longer time', () => {
    expect(addConfirmTime(lagos('2026-11-02T21:00:00'), 27)).toBe(lagos('2026-11-04T22:00:00')) // 1, 13, 13
  })
})

describe('confirming an order', () => {
  const order = (ordered: string) => ({ status: 'paid' as const, confirmBy: confirmDeadline(lagos(ordered)), confirmedAt: null })

  it('only needs it while paid, unconfirmed and with a deadline', () => {
    const o = order('2026-11-02T10:00:00')
    expect(needsConfirming(o)).toBe(true)
    expect(needsConfirming({ ...o, confirmedAt: '2026-11-02T11:00:00Z' })).toBe(false)
    expect(needsConfirming({ ...o, status: 'dispatched' })).toBe(false)
    expect(needsConfirming({ ...o, confirmBy: null })).toBe(false)
  })

  it('reminds in the last 3 hours, and is overdue at the deadline', () => {
    const o = order('2026-11-02T10:00:00') // due 10pm
    expect(confirmReminderDue(o, lagos('2026-11-02T18:59:00'))).toBe(false)
    expect(confirmReminderDue(o, lagos('2026-11-02T19:00:00'))).toBe(true)
    expect(confirmReminderDue(o, lagos('2026-11-02T22:00:00'))).toBe(false)
    expect(confirmOverdue(o, lagos('2026-11-02T21:59:00'))).toBe(false)
    expect(confirmOverdue(o, lagos('2026-11-02T22:00:00'))).toBe(true)
    expect(confirmOverdue({ ...o, confirmedAt: '2026-11-02T11:00:00Z' }, lagos('2026-11-03T22:00:00'))).toBe(false)
  })

  it('counts the 3 hours on the same clock, so nothing runs out overnight', () => {
    const o = order('2026-11-02T11:00:00') // due 10am the next day: 1 hour that morning, 2 the evening before
    expect(confirmReminderDue(o, lagos('2026-11-02T19:59:00'))).toBe(false)
    expect(confirmReminderDue(o, lagos('2026-11-02T20:00:00'))).toBe(true)
    expect(confirmOverdue(o, lagos('2026-11-03T03:00:00'))).toBe(false)
    expect(confirmOverdue(o, lagos('2026-11-03T09:59:00'))).toBe(false)
    expect(confirmOverdue(o, lagos('2026-11-03T10:00:00'))).toBe(true)
  })
})
