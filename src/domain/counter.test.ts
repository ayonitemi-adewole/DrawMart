import { describe, expect, it } from 'vitest'
import { collectFromCounterBy, counterCodeError, counterReminderDue, counterReturnDue, daysOnShelf } from './counter'

describe('pickup counters', () => {
  const at = '2026-11-02T10:00:00.000Z'
  const later = (days: number, hours = 0) => Date.parse(at) + days * 86_400_000 + hours * 3_600_000

  it('counts whole days on the shelf', () => {
    expect(daysOnShelf(at, later(0, 23))).toBe(0)
    expect(daysOnShelf(at, later(1))).toBe(1)
    expect(daysOnShelf(at, later(-1))).toBe(0)
  })

  it('reminds after 7 days and sends it back after 14', () => {
    expect(counterReminderDue(at, later(6, 23))).toBe(false)
    expect(counterReminderDue(at, later(7))).toBe(true)
    expect(counterReturnDue(at, later(13, 23))).toBe(false)
    expect(counterReturnDue(at, later(14))).toBe(true)
    expect(collectFromCounterBy(at)).toBe('2026-11-16T10:00:00.000Z')
  })

  it('takes the whole product ID however it’s typed, and nothing less', () => {
    expect(counterCodeError('PRD-7K3Q9X', 'PRD-7K3Q9X')).toBeNull()
    expect(counterCodeError(' prd 7k3q9x ', 'PRD-7K3Q9X')).toBeNull()
    expect(counterCodeError('7K3Q9X', 'PRD-7K3Q9X')).toBeNull()
    expect(counterCodeError('Q9X', 'PRD-7K3Q9X')).toMatch(/doesn’t match/)
    expect(counterCodeError('PRD-7K3Q9Y', 'PRD-7K3Q9X')).toMatch(/doesn’t match/)
    expect(counterCodeError('', 'PRD-7K3Q9X')).toMatch(/Type the product ID/)
  })
})
