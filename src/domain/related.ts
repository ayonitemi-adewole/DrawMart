/**
 * What to show under a listing: more from the same seller, then similar items
 * from other sellers. "Similar" means the same category, closest in value.
 */
import { cartError, isWonPrize } from './cart'
import { salePriceKobo } from './orders'
import type { Kobo, Listing } from './types'

type Related = Pick<Listing, 'id' | 'merchantId' | 'category' | 'kind' | 'status' | 'priceKobo' | 'fallbackPriceKobo'>

/** Only things a buyer can act on: draws taking tickets and items on sale. */
const isAvailable = (l: Related) => l.status === 'live' || l.status === 'for_sale'

/** What the item is worth to a buyer: its sale price, or the prize value of a draw. */
export const itemValueKobo = (l: Related): Kobo => salePriceKobo(l) ?? l.priceKobo

export function moreFromSeller<T extends Related>(current: Related, all: T[], limit = 6): T[] {
  return all.filter((l) => l.id !== current.id && l.merchantId === current.merchantId && isAvailable(l)).slice(0, limit)
}

/**
 * Same category, other sellers, ordered by how close the value is (as a
 * ratio, so ₦50k vs ₦60k counts as closer than ₦5m vs ₦5.2m). Items already
 * shown under "more from this seller" never repeat.
 */
export function similarListings<T extends Related>(current: Related, all: T[], limit = 6): T[] {
  const value = Math.max(1, itemValueKobo(current))
  const distance = (l: T) => Math.abs(Math.log(Math.max(1, itemValueKobo(l)) / value))
  return all
    .filter((l) => l.id !== current.id && l.merchantId !== current.merchantId && l.category === current.category && isAvailable(l))
    .map((l) => ({ l, d: distance(l) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.l)
}

type CartSeed = Related & { result?: { iWon: boolean } | null; sale?: { priceKobo: Kobo } | null }

export interface CartSuggestions<T> {
  /** On sale from a seller already in the cart, so it comes in the same delivery. */
  fromCartSellers: T[]
  /** Same category as something in the cart, from other sellers, closest in value first. */
  similar: T[]
}

/**
 * What to suggest under the cart, from what's already in it. Only things that
 * can go in the cart (cartError) and aren't there yet. A won item counts for
 * its category but not its seller: DrawMart sends it, not the store.
 */
export function cartSuggestions<T extends CartSeed>(cart: readonly CartSeed[], all: readonly T[], limit = 12): CartSuggestions<T> {
  const inCart = new Set(cart.map((l) => l.id))
  const sellers = new Set(cart.filter((l) => !isWonPrize(l)).map((l) => l.merchantId))
  const values = new Map<string, number[]>()
  for (const l of cart) values.set(l.category, [...(values.get(l.category) ?? []), Math.max(1, itemValueKobo(l))])
  // How far a candidate is in value from the nearest cart item in its category (as a ratio).
  const distance = (l: T) => Math.min(...(values.get(l.category) ?? []).map((v) => Math.abs(Math.log(Math.max(1, itemValueKobo(l)) / v))))

  const candidates = all.filter((l) => !inCart.has(l.id) && !isWonPrize(l) && cartError(l) === null)
  const byCloseness = (list: T[]) => list.map((l) => ({ l, d: distance(l) })).sort((a, b) => a.d - b.d).map((x) => x.l)

  const sameSeller = candidates.filter((l) => sellers.has(l.merchantId))
  // Same category first (closest in value), then the seller's other things in their usual order.
  const fromCartSellers = [...byCloseness(sameSeller.filter((l) => values.has(l.category))), ...sameSeller.filter((l) => !values.has(l.category))].slice(0, limit)
  const similar = byCloseness(candidates.filter((l) => !sellers.has(l.merchantId) && values.has(l.category))).slice(0, limit)
  return { fromCartSellers, similar }
}
