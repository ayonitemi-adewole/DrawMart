import { describe, expect, it } from 'vitest'
import { nairaToKobo as k } from './money'
import { checkOrder, saleEconomics, salePriceKobo, validateDelivery, validateProduct } from './orders'

const product = { kind: 'product' as const, status: 'for_sale' as const, priceKobo: k(50_000), fallbackPriceKobo: null }
const unsoldRaffle = { kind: 'raffle' as const, status: 'for_sale' as const, priceKobo: k(60_000), fallbackPriceKobo: k(55_000) }

describe('fixed-price sales', () => {
  it('prices products at their price and unsold raffles at the fallback price', () => {
    expect(salePriceKobo(product)).toBe(k(50_000))
    expect(salePriceKobo(unsoldRaffle)).toBe(k(55_000))
    expect(salePriceKobo({ ...product, status: 'sold' })).toBeNull()
    expect(salePriceKobo({ ...unsoldRaffle, status: 'live' })).toBeNull()
  })

  it('takes the platform fee from the store', () => expect(saleEconomics(k(50_000), 1250)).toEqual({ feeKobo: k(6_250), payoutKobo: k(43_750) }))

  it('validates products', () => {
    expect(validateProduct({ title: 'Chair', priceKobo: k(100) })).toEqual([])
    expect(validateProduct({ title: ' ', priceKobo: k(99) })).toEqual(['title_required', 'price_too_low'])
  })

  it('validates delivery details', () => {
    expect(validateDelivery({ address: '4 Admiralty Way, Lekki', location: { lat: 6.6, lng: 3.35 }, contactPhone: '0803 123 4567' })).toEqual([])
    expect(validateDelivery({ address: 'Lekki', location: null, contactPhone: '123' })).toEqual(['address_required', 'location_required', 'phone_invalid'])
  })

  it('checks the item is for sale and the wallet covers it, credit included', () => {
    expect(checkOrder(product, { cashKobo: k(40_000), creditKobo: k(10_000) })).toBeNull()
    expect(checkOrder(product, { cashKobo: k(40_000), creditKobo: k(9_999) })).toBe('insufficient_funds')
    expect(checkOrder({ ...product, status: 'sold' }, { cashKobo: k(99_999), creditKobo: 0 })).toBe('not_for_sale')
  })
})
