import { describe, expect, it } from 'vitest'
import { confirmDeadline, confirmOverdue, confirmReminderDue, needsConfirming } from './orderConfirm'

const at = Date.parse('2026-11-01T10:00:00Z')
const order = { status: 'paid' as const, confirmBy: confirmDeadline(at), confirmedAt: null }
const hours = (n: number) => at + n * 3_600_000

describe('confirming an order', () => {
  it('gives the seller 12 hours', () => {
    expect(order.confirmBy).toBe('2026-11-01T22:00:00.000Z')
  })

  it('only needs it while paid, unconfirmed and with a deadline', () => {
    expect(needsConfirming(order)).toBe(true)
    expect(needsConfirming({ ...order, confirmedAt: '2026-11-01T11:00:00Z' })).toBe(false)
    expect(needsConfirming({ ...order, status: 'dispatched' })).toBe(false)
    expect(needsConfirming({ ...order, confirmBy: null })).toBe(false)
  })

  it('reminds in the last 3 hours, and is overdue at the deadline', () => {
    expect(confirmReminderDue(order, hours(8.9))).toBe(false)
    expect(confirmReminderDue(order, hours(9))).toBe(true)
    expect(confirmReminderDue(order, hours(12))).toBe(false)
    expect(confirmOverdue(order, hours(11.9))).toBe(false)
    expect(confirmOverdue(order, hours(12))).toBe(true)
    expect(confirmOverdue({ ...order, confirmedAt: '2026-11-01T11:00:00Z' }, hours(13))).toBe(false)
  })
})
