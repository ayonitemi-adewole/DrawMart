import { describe, expect, it } from 'vitest'
import { shopPickupErrors } from './shopPickup'

const good = { address: '12 Allen Avenue, Ikeja', location: { lat: 6.6, lng: 3.35 }, contactPhone: '0803 123 4567' }

describe('where a rider collects from', () => {
  it('needs a full address, a pin in Lagos and a mobile number', () => {
    expect(shopPickupErrors(good)).toEqual([])
    expect(shopPickupErrors({ ...good, address: 'Ikeja' })).toEqual(['address_required'])
    expect(shopPickupErrors({ ...good, location: null })).toEqual(['location_required'])
    expect(shopPickupErrors({ ...good, location: { lat: 9.06, lng: 7.49 } })).toEqual(['outside_service_area'])
    expect(shopPickupErrors({ ...good, contactPhone: '12345' })).toEqual(['phone_invalid'])
  })
})
