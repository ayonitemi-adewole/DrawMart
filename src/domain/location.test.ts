import { describe, expect, it } from 'vitest'
import { directionsUrl, isInServiceArea, locationError, roundPoint } from './location'

describe('pinned locations', () => {
  it('needs a real pin inside Lagos', () => {
    expect(locationError({ lat: 6.45, lng: 3.43 })).toBeNull()
    expect(locationError(null)).toBe('location_required')
    expect(locationError({ lat: Number.NaN, lng: 3.4 })).toBe('location_required')
    expect(locationError({ lat: 9.06, lng: 7.49 })).toBe('outside_service_area') // Abuja
    expect(isInServiceArea({ lat: 6.41, lng: 2.89 })).toBe(true) // Badagry
    expect(isInServiceArea({ lat: 6.9, lng: 3.4 })).toBe(false) // Ogun State
  })

  it('rounds to a sensible precision and links to directions', () => {
    expect(roundPoint({ lat: 6.123456789, lng: 3.987654321 })).toEqual({ lat: 6.123457, lng: 3.987654 })
    expect(directionsUrl({ lat: 6.45, lng: 3.43 })).toContain('query=6.45,3.43')
  })
})
