import { describe, expect, it } from 'vitest'
import { nairaToKobo as k } from './money'
import { clampQuantity, lowStockLabel, MAX_ORDER_QUANTITY, MAX_STOCK, maxOrderQuantity, quantityError, saleEconomics, salePriceKobo, takeStock, validateProduct } from './orders'

describe('stock', () => {
  const title = 'Chair'
  const priceKobo = k(50_000)

  it('takes a whole number from 1 up to the limit, and one if it’s left out', () => {
    expect(validateProduct({ title, priceKobo })).toEqual([])
    for (const stock of [1, MAX_STOCK]) expect(validateProduct({ title, priceKobo, stock })).toEqual([])
    for (const stock of [0, -1, 1.5, NaN, MAX_STOCK + 1]) expect(validateProduct({ title, priceKobo, stock })).toEqual(['stock_invalid'])
  })

  it('limits an order to what’s left, and one at a time for draws, prizes and cars', () => {
    const on = { kind: 'product' as const, status: 'for_sale' as const, stock: 3, category: 'Phones' as const, title: 'Case' }
    expect(maxOrderQuantity(on)).toBe(3)
    expect(maxOrderQuantity({ ...on, stock: 500 })).toBe(MAX_ORDER_QUANTITY)
    expect(maxOrderQuantity({ ...on, category: 'Cars' })).toBe(1)
    expect(maxOrderQuantity({ ...on, kind: 'raffle' })).toBe(1)
    expect(maxOrderQuantity({ ...on, status: 'drawn' })).toBe(1)
    expect(quantityError(on, 3)).toBeNull()
    expect(quantityError(on, 4)).toBe('Only 3 left of Case.')
    for (const n of [0, -1, 1.5]) expect(quantityError(on, n)).toBe('Choose at least one.')
    expect(quantityError({ ...on, category: 'Cars' }, 2)).toContain('one of Case')
    expect(clampQuantity(on, 9)).toBe(3)
    expect(clampQuantity(on, NaN)).toBe(1)
    expect(clampQuantity(on, 0)).toBe(1)
  })

  it('is sold out when the last one goes', () => {
    expect(takeStock(5, 2)).toEqual({ stock: 3, soldOut: false })
    expect(takeStock(2, 2)).toEqual({ stock: 0, soldOut: true })
    expect(takeStock(3)).toEqual({ stock: 2, soldOut: false })
    expect(takeStock(1)).toEqual({ stock: 0, soldOut: true })
  })

  it('only says it’s running low on products on sale', () => {
    const on = { kind: 'product' as const, status: 'for_sale' as const }
    expect(lowStockLabel({ ...on, stock: 6 })).toBeNull()
    expect(lowStockLabel({ ...on, stock: 5 })).toBe('Only 5 left')
    expect(lowStockLabel({ ...on, stock: 1 })).toBe('Only 1 left')
    expect(lowStockLabel({ ...on, status: 'sold', stock: 0 })).toBeNull()
    expect(lowStockLabel({ ...on, status: 'pending_review', stock: 3 })).toBeNull()
    expect(lowStockLabel({ kind: 'raffle', status: 'for_sale', stock: 1 })).toBeNull()
  })
})

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
