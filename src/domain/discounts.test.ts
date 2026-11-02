import { describe, expect, it } from 'vitest'
import { bestPrice, discountActive, discountErrors, discountState, discountedUnitKobo, normalizeCode, type DiscountInput } from './discounts'

const NOW = Date.parse('2026-11-02T12:00:00Z')
const input = (over: Partial<DiscountInput> = {}): DiscountInput => ({
  kind: 'sale', percentOff: 10, amountOffKobo: null, code: '', maxUses: null,
  startsAt: '2026-11-02T00:00:00Z', endsAt: '2026-11-09T00:00:00Z', listingIds: ['a'], ...over,
})

describe('discounts', () => {
  it('takes a percentage or an amount off, never below ₦100', () => {
    expect(discountedUnitKobo(2_000_000, { percentOff: 10, amountOffKobo: null })).toBe(1_800_000)
    expect(discountedUnitKobo(333_333, { percentOff: 10, amountOffKobo: null })).toBe(300_000) // rounds the saving down
    expect(discountedUnitKobo(2_000_000, { percentOff: null, amountOffKobo: 500_000 })).toBe(1_500_000)
    expect(discountedUnitKobo(15_000, { percentOff: null, amountOffKobo: 10_000 })).toBe(10_000)
  })

  it('gives the bigger saving when more than one applies', () => {
    const ds = [{ id: 'pct', percentOff: 10, amountOffKobo: null }, { id: 'amt', percentOff: null, amountOffKobo: 300_000 }]
    expect(bestPrice(2_000_000, ds)).toEqual({ unitKobo: 1_700_000, discountId: 'amt' })
    expect(bestPrice(4_000_000, ds)).toEqual({ unitKobo: 3_600_000, discountId: 'pct' })
    expect(bestPrice(2_000_000, [])).toEqual({ unitKobo: 2_000_000, discountId: null })
  })

  it('runs between its dates, until ended or used up', () => {
    const d = { startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-03T00:00:00Z', endedAt: null, maxUses: null, uses: 0 }
    expect(discountActive(d, NOW)).toBe(true)
    expect(discountState({ ...d, startsAt: '2026-11-02T13:00:00Z' }, NOW)).toBe('scheduled')
    expect(discountState({ ...d, endedAt: '2026-11-02T10:00:00Z' }, NOW)).toBe('ended')
    expect(discountState({ ...d, maxUses: 5, uses: 5 }, NOW)).toBe('ended')
    expect(discountState({ ...d, endsAt: '2026-11-02T12:00:00Z' }, NOW)).toBe('ended')
  })

  it('checks what the store sets', () => {
    expect(discountErrors(input(), { a: 2_000_000 })).toEqual([])
    expect(discountErrors(input({ percentOff: 91 }), {})).toHaveLength(1)
    expect(discountErrors(input({ percentOff: null, amountOffKobo: 1_995_000 }), { a: 2_000_000 })).toHaveLength(1)
    expect(discountErrors(input({ percentOff: 10, amountOffKobo: 100_000 }), {})).toHaveLength(1)
    expect(discountErrors(input({ listingIds: [] }), {})).toHaveLength(1)
    expect(discountErrors(input({ endsAt: '2026-12-04T00:00:00Z' }), {})).toHaveLength(1) // 32 days
    expect(discountErrors(input({ kind: 'code', code: 'save10', endsAt: '2026-12-04T00:00:00Z' }), {})).toEqual([])
    expect(discountErrors(input({ kind: 'code', code: 'no' }), {})).toHaveLength(1)
    expect(discountErrors(input({ kind: 'code', code: 'SAVE10', maxUses: 0 }), {})).toHaveLength(1)
    expect(normalizeCode(' save10 ')).toBe('SAVE10')
  })
})
