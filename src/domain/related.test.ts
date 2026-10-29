import { describe, expect, it } from 'vitest'
import { nairaToKobo as k } from './money'
import { itemValueKobo, moreFromSeller, similarListings } from './related'

const item = (id: string, patch: Partial<Parameters<typeof itemValueKobo>[0]> = {}) => ({
  id, merchantId: 'm1', category: 'Phones' as const, kind: 'product' as const, status: 'for_sale' as const, priceKobo: k(100_000), fallbackPriceKobo: null, ...patch,
})

describe('related listings', () => {
  const current = item('now', { priceKobo: k(100_000) })

  it('values items by what a buyer pays, or the prize for a draw', () => {
    expect(itemValueKobo(item('a', { priceKobo: k(10) }))).toBe(k(10))
    expect(itemValueKobo(item('b', { kind: 'raffle', status: 'for_sale', priceKobo: k(10), fallbackPriceKobo: k(8) }))).toBe(k(8))
    expect(itemValueKobo(item('c', { kind: 'raffle', status: 'live', priceKobo: k(10) }))).toBe(k(10))
  })

  it('lists the seller’s other available items, not this one', () => {
    const all = [current, item('a'), item('sold', { status: 'sold' }), item('other', { merchantId: 'm2' }), item('b', { category: 'Home' })]
    expect(moreFromSeller(current, all).map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('suggests the same category from other sellers, closest in value first', () => {
    const all = [
      current,
      item('mine', { priceKobo: k(100_000) }),
      item('far', { merchantId: 'm2', priceKobo: k(1_000_000) }),
      item('close', { merchantId: 'm3', priceKobo: k(90_000) }),
      item('closer-up', { merchantId: 'm4', kind: 'raffle', status: 'live', priceKobo: k(105_000) }),
      item('home', { merchantId: 'm2', category: 'Home', priceKobo: k(100_000) }),
      item('rejected', { merchantId: 'm2', status: 'rejected' }),
    ]
    expect(similarListings(current, all).map((l) => l.id)).toEqual(['closer-up', 'close', 'far'])
    expect(similarListings(current, all, 1).map((l) => l.id)).toEqual(['closer-up'])
  })
})
