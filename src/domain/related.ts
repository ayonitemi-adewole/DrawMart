/**
 * What to show under a listing: more from the same seller, then similar items
 * from other sellers. "Similar" means the same category, closest in value.
 */
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
