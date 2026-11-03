import { describe, expect, it } from 'vitest'
import { carryingToBuyer, etaMinutes, etaText, locationFresh, positionError } from './riderLocation'

describe('live rider location', () => {
  it('shares only on the way to the buyer’s door', () => {
    const j = { mine: true, status: 'dispatched', fulfilment: 'delivery', collected: true, atCounterAt: null, returning: false }
    expect(carryingToBuyer(j)).toBe(true)
    expect(carryingToBuyer({ ...j, collected: false })).toBe(false)
    expect(carryingToBuyer({ ...j, fulfilment: 'pickup' })).toBe(false)
    expect(carryingToBuyer({ ...j, mine: false })).toBe(false)
    expect(carryingToBuyer({ ...j, status: 'delivered' })).toBe(false)
    expect(carryingToBuyer({ ...j, returning: true, status: 'cancelled' })).toBe(false)
    expect(carryingToBuyer({ ...j, atCounterAt: '2026-11-03T10:00:00Z' })).toBe(false)
  })

  it('shows a position only while it’s recent', () => {
    const now = Date.parse('2026-11-03T10:00:00Z')
    expect(locationFresh('2026-11-03T09:55:00Z', now)).toBe(true)
    expect(locationFresh('2026-11-03T09:54:59Z', now)).toBe(false)
  })

  it('gives a rough arrival time, never under 5 minutes', () => {
    const ikeja = { lat: 6.6018, lng: 3.3515 }
    expect(etaMinutes(ikeja, ikeja)).toBe(5)
    // About 10 km as the crow flies: 14 km of road at 18 km/h is about 47 minutes.
    expect(etaMinutes(ikeja, { lat: 6.5115, lng: 3.3515 })).toBe(50)
    expect(etaText(50)).toBe('About 50 min away')
    expect(etaText(65)).toBe('Over an hour away')
  })

  it('refuses positions that can’t be real', () => {
    expect(positionError({ lat: 6.5, lng: 3.4 })).toBeNull()
    expect(positionError({ lat: 95, lng: 3.4 })).toMatch(/doesn’t look right/)
    expect(positionError({ lat: Number.NaN, lng: 3.4 })).toMatch(/doesn’t look right/)
  })
})
