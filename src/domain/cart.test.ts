import { describe, expect, it } from 'vitest'
import { cartError, checkoutTotalKobo, isWonPrize, lineAmountKobo, validateCheckout } from './cart'
import { nairaToKobo as k } from './money'

const product = { kind: 'product' as const, status: 'for_sale' as const, category: 'Home' as const, priceKobo: k(50_000), fallbackPriceKobo: null, result: null }
const won = { ...product, kind: 'raffle' as const, status: 'drawn' as const, result: { iWon: true } }
const pin = { lat: 6.45, lng: 3.43 }
const delivery = { address: '15 Awolowo Road, Ikoyi', location: pin, contactPhone: '0803 123 4567' }

describe('cart', () => {
  it('takes items on sale and won draws, never cars', () => {
    expect(cartError(product)).toBeNull()
    expect(cartError(won)).toBeNull()
    expect(cartError({ ...product, category: 'Cars' })).toBe('car')
    expect(cartError({ ...won, category: 'Cars' })).toBe('car')
    expect(cartError({ ...product, status: 'sold' })).toBe('not_available')
    expect(cartError({ ...won, result: { iWon: false } })).toBe('not_available')
  })

  it('charges for products, not won items', () => {
    expect(isWonPrize(won)).toBe(true)
    expect(lineAmountKobo(won)).toBe(0)
    expect(lineAmountKobo({ ...product, status: 'sold' })).toBeNull()
    expect(checkoutTotalKobo([product, won, product])).toBe(k(100_000))
  })

  it('needs an address and pin to deliver, a location to collect, and a phone for both', () => {
    expect(validateCheckout({ fulfilment: 'delivery', delivery, pickupPointId: null }, false)).toEqual([])
    expect(validateCheckout({ fulfilment: 'delivery', delivery: { address: 'Ikoyi', location: null, contactPhone: '1' }, pickupPointId: null }, false)).toEqual(['address_required', 'location_required', 'phone_invalid'])
    const noAddress = { address: '', location: null, contactPhone: '0803 123 4567' }
    expect(validateCheckout({ fulfilment: 'pickup', delivery: noAddress, pickupPointId: 'ikeja' }, false)).toEqual([])
    expect(validateCheckout({ fulfilment: 'pickup', delivery: noAddress, pickupPointId: null }, false)).toEqual(['pickup_point_required'])
    expect(validateCheckout({ fulfilment: 'pickup', delivery: noAddress, pickupPointId: 'ikeja' }, true)).toEqual(['car_pickup'])
  })
})
