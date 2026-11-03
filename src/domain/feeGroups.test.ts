import { describe, expect, it } from 'vitest'
import { feeGroupOf, largestSize, mergeFeeGroups, tripAlreadyPaid, type TripEarning } from './feeGroups'

describe('fee groups', () => {
  it('groups one seller’s orders in one checkout, never won items or older orders', () => {
    expect(feeGroupOf({ id: 'o1', checkoutId: 'c', merchantId: 'm', isPrize: false })).toBe('c:m')
    expect(feeGroupOf({ id: 'o2', checkoutId: 'c', merchantId: 'n', isPrize: false })).toBe('c:n')
    expect(feeGroupOf({ id: 'o3', checkoutId: 'c', merchantId: 'm', isPrize: true })).toBe('o3')
    expect(feeGroupOf({ id: 'o4', checkoutId: null, merchantId: 'm', isPrize: false })).toBe('o4')
  })

  it('pays at the largest package, as the buyer was charged', () => {
    expect(largestSize(['small', 'large', 'medium'])).toBe('large')
    expect(largestSize(['small'])).toBe('small')
  })

  it('shows one pool card per group, where its first job was', () => {
    const merged = mergeFeeGroups([{ id: 'a', feeGroup: 'x' }, { id: 'b', feeGroup: 'y' }, { id: 'c', feeGroup: 'x' }])
    expect(merged.map((g) => [g.lead.id, g.jobs.map((j) => j.id)])).toEqual([['a', ['a', 'c']], ['b', ['b']]])
  })

  it('pays a trip once, and a failed visit once, but a separate trip again', () => {
    const paid: TripEarning = { feeGroup: 'c:m', riderId: 'r', takenAt: 'T', kind: 'delivery', at: '2026-11-03T10:00:00Z' }
    expect(tripAlreadyPaid([paid], { ...paid, at: '2026-11-03T10:05:00Z' })).toBe(true)
    expect(tripAlreadyPaid([paid], { ...paid, kind: 'return' })).toBe(false)
    expect(tripAlreadyPaid([paid], { ...paid, takenAt: 'T2' })).toBe(false) // made ready after collection: its own trip
    expect(tripAlreadyPaid([paid], { ...paid, riderId: 's' })).toBe(false)
    const visit = { ...paid, kind: 'failed_attempt' as const }
    expect(tripAlreadyPaid([visit], { ...visit, at: '2026-11-03T10:30:00Z' })).toBe(true)
    expect(tripAlreadyPaid([visit], { ...visit, at: '2026-11-03T12:00:00Z' })).toBe(false) // the second try, later
  })
})
