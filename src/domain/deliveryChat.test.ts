import { describe, expect, it } from 'vitest'
import { containsPhoneNumber, deliveryMessageError, deliveryTimeline, firstName } from './deliveryChat'

describe('delivery chat', () => {
  it('keeps phone numbers out, however they’re written', () => {
    for (const s of ['call me on 08031234567', '0803 123 4567', '0803-123-4567', '+234 803 123 4567', '2348031234567', 'my line is 0 7 0 1 2 3 4 5 6 7 8']) expect(containsPhoneNumber(s)).toBe(true)
    for (const s of ['I’m at the gate', 'Flat 12, block 4', 'PRD-7K3Q9X', 'order 1234567890 thanks', 'about 15 minutes']) expect(containsPhoneNumber(s)).toBe(false)
    expect(deliveryMessageError('Call 08031234567')).toMatch(/phone numbers/)
    expect(deliveryMessageError('  ')).toMatch(/Write a message/)
    expect(deliveryMessageError('Blue gate, second house')).toBeNull()
  })

  it('shows only the first name', () => {
    expect(firstName('Bayo Rider')).toBe('Bayo')
    expect(firstName('  ')).toBe('Your rider')
  })

  it('follows a delivery from ready to delivered', () => {
    const base = { status: 'dispatched' as const, fulfilment: 'delivery' as const, dispatchedAt: 't1', collectedAt: null, arrivedAt: null, atCounterAt: null, deliveredAt: null, pickupPoint: null }
    expect(deliveryTimeline(base).map((s) => s.state)).toEqual(['done', 'now', 'next', 'next'])
    const going = deliveryTimeline({ ...base, collectedAt: 't2' })
    expect(going.map((s) => [s.label, s.state])).toEqual([['Ready for a rider', 'done'], ['Collected by your rider', 'done'], ['On the way to you', 'now'], ['Delivered', 'next']])
    expect(deliveryTimeline({ ...base, collectedAt: 't2', arrivedAt: 't3' })[2]).toEqual({ label: 'At your door', at: 't3', state: 'done' })
    expect(deliveryTimeline({ ...base, status: 'delivered', collectedAt: 't2', deliveredAt: 't4' }).every((s) => s.state === 'done')).toBe(true)
    expect(deliveryTimeline({ ...base, status: 'paid' as never })).toEqual([])
    const pickup = deliveryTimeline({ ...base, fulfilment: 'pickup', collectedAt: 't2', atCounterAt: 't3', pickupPoint: { name: 'DrawMart Ikeja' } as never })
    expect(pickup.map((s) => [s.label, s.state])).toEqual([['Ready for a rider', 'done'], ['Collected by your rider', 'done'], ['Ready at DrawMart Ikeja', 'done'], ['Collected by you', 'now']])
  })
})
