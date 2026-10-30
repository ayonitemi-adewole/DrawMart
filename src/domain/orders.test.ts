import { describe, expect, it } from 'vitest'
import { nairaToKobo as k } from './money'
import { saleEconomics, salePriceKobo, validateProduct } from './orders'

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


})
