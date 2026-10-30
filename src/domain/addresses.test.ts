import { describe, expect, it } from 'vitest'
import { preferredAddress, sortAddresses, suggestedPhone, validateSavedAddress, type SavedAddress } from './addresses'

const pin = { lat: 6.45, lng: 3.43 }
const row = (id: string, isDefault = false): SavedAddress => ({ id, label: id, address: '15 Awolowo Road, Ikoyi', location: pin, contactPhone: `0803 123 000${id}`, isDefault })

describe('saved addresses', () => {
  it('needs a name, full address, pin in Lagos and a phone', () => {
    expect(validateSavedAddress({ label: 'Home', address: '15 Awolowo Road, Ikoyi', location: pin, contactPhone: '0803 123 4567' })).toEqual([])
    expect(validateSavedAddress({ label: ' ', address: 'Ikoyi', location: null, contactPhone: '1' })).toEqual(['label_required', 'address_required', 'location_required', 'phone_invalid'])
    expect(validateSavedAddress({ label: 'x'.repeat(41), address: '15 Awolowo Road, Ikoyi', location: { lat: 9.06, lng: 7.49 }, contactPhone: '0803 123 4567' })).toEqual(['label_required', 'outside_service_area'])
  })

  it('starts checkout on the default, or else the first', () => {
    expect(preferredAddress([])).toBeNull()
    expect(preferredAddress([row('1'), row('2', true)])?.id).toBe('2')
    expect(preferredAddress([row('1'), row('2')])?.id).toBe('1')
    expect(sortAddresses([row('1'), row('2', true), row('3')]).map((a) => a.id)).toEqual(['2', '1', '3'])
  })

  it('suggests the account phone, then the usual address', () => {
    expect(suggestedPhone('0803 000 0000', [row('1', true)])).toBe('0803 000 0000')
    expect(suggestedPhone(null, [row('1', true)])).toBe('0803 123 0001')
    expect(suggestedPhone('  ', [])).toBe('')
  })
})
