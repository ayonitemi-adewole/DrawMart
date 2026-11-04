import { describe, expect, it } from 'vitest'
import { nairaToKobo as k } from './money'
import { cartSuggestions, itemValueKobo, moreFromSeller, similarListings } from './related'

const item = (id: string, patch: Partial<Parameters<typeof itemValueKobo>[0] & { result: { iWon: boolean } }> = {}) => ({
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

describe('cart suggestions', () => {
  const ids = (xs: { id: string }[]) => xs.map((l) => l.id)

  it('suggests the cart sellers’ other items first by category and value, then similar items from other sellers', () => {
    const cart = [item('phone', { merchantId: 'm1', priceKobo: k(100_000) })]
    const all = [
      cart[0],
      item('m1-home', { merchantId: 'm1', category: 'Home' }),
      item('m1-far', { merchantId: 'm1', priceKobo: k(1_000_000) }),
      item('m1-close', { merchantId: 'm1', priceKobo: k(90_000) }),
      item('m2-close', { merchantId: 'm2', priceKobo: k(110_000) }),
      item('m3-far', { merchantId: 'm3', priceKobo: k(500_000) }),
      item('m2-home', { merchantId: 'm2', category: 'Home' }),
    ]
    const s = cartSuggestions(cart, all)
    expect(ids(s.fromCartSellers)).toEqual(['m1-close', 'm1-far', 'm1-home'])
    expect(ids(s.similar)).toEqual(['m2-close', 'm3-far'])
  })

  it('measures value from the nearest cart item in that category', () => {
    const cart = [item('cheap', { priceKobo: k(10_000) }), item('dear', { priceKobo: k(1_000_000) })]
    const all = [item('near-dear', { merchantId: 'm2', priceKobo: k(900_000) }), item('mid', { merchantId: 'm3', priceKobo: k(100_000) })]
    expect(ids(cartSuggestions(cart, all).similar)).toEqual(['near-dear', 'mid'])
  })

  it('only suggests what can go in the cart and isn’t there already', () => {
    const cart = [item('a', { category: 'Cars' }), item('b')]
    const all = [
      item('a', { category: 'Cars' }),
      item('b'),
      item('car', { merchantId: 'm2', category: 'Cars' }),
      item('live-draw', { merchantId: 'm2', kind: 'raffle', status: 'live' }),
      item('unsold-draw', { merchantId: 'm2', kind: 'raffle', status: 'for_sale', fallbackPriceKobo: k(50_000) }),
      item('sold', { merchantId: 'm2', status: 'sold' }),
    ]
    const s = cartSuggestions(cart, all)
    expect(ids(s.fromCartSellers)).toEqual([])
    expect(ids(s.similar)).toEqual(['unsold-draw'])
  })

  it('counts a won item’s category but not its seller, who isn’t sending it', () => {
    const cart = [item('prize', { merchantId: 'm1', kind: 'raffle', status: 'drawn', result: { iWon: true } })]
    const all = [item('m1-phone', { merchantId: 'm1' }), item('m1-home', { merchantId: 'm1', category: 'Home' })]
    const s = cartSuggestions(cart, all)
    expect(ids(s.fromCartSellers)).toEqual([])
    expect(ids(s.similar)).toEqual(['m1-phone'])
  })

  it('suggests nothing for an empty cart, and respects the limit', () => {
    const all = [item('x', { merchantId: 'm2' }), item('y', { merchantId: 'm3' })]
    expect(cartSuggestions([], all)).toEqual({ fromCartSellers: [], similar: [] })
    expect(cartSuggestions([item('c')], all, 1).similar).toHaveLength(1)
  })
})
