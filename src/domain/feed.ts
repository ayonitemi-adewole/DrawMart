/**
 * The personal explore feed: what a buyer has bought, saved, looked at and
 * searched for moves those categories, sellers and items up, and a seed made
 * fresh each time the app opens shuffles the rest, so the page isn't the same
 * every visit and no two buyers get the same one. Searches and views stay on the
 * device (src/lib/feed.ts); purchases and saves are the buyer's own data.
 */
import { listingMatchesSearch } from './productCode'
import type { Category } from './types'

export interface FeedItem {
  listingId: string
  category: Category
  merchantId: string
}

export interface FeedSignals {
  /** Draws they hold tickets in and things they've ordered. */
  bought: FeedItem[]
  saved: FeedItem[]
  /** Newest first. */
  viewed: FeedItem[]
  /** Newest first. */
  searches: string[]
}

export interface Taste {
  /** 0 to 1, the strongest category being 1. */
  categories: Map<Category, number>
  /** 0 to 1, the strongest seller being 1. */
  merchants: Map<string, number>
  searches: string[]
  /** Already bought into: shown a little lower, so the feed has new things. */
  owned: Set<string>
  /** Whether there's anything to go on yet. */
  known: boolean
}

export type FeedListing = {
  id: string
  category: Category
  merchantId: string
  ticketsSold: number
  ticketCount: number
  productCode: string
  title: string
  description: string
  merchant: { name: string; area: string }
}

export const MAX_REMEMBERED_SEARCHES = 10
/** How many recent searches show under the explore search box. */
export const MAX_SHOWN_SEARCHES = 6
export const MAX_REMEMBERED_VIEWS = 30
const MIN_SEARCH_LENGTH = 2

const SOURCE_WEIGHT = { bought: 3, saved: 2, viewed: 1 } as const

/** How much each signal counts towards an item's place. The jitter keeps the feed moving. */
const SCORE = { category: 4, merchant: 2, search: 3, almostGone: 0.5, jitter: 1.5, owned: -1.5 } as const

function scaled<K>(weights: Map<K, number>): Map<K, number> {
  const top = Math.max(0, ...weights.values())
  return new Map([...weights].map(([k, w]) => [k, top > 0 ? w / top : 0]))
}

export function tasteFrom(s: FeedSignals): Taste {
  const categories = new Map<Category, number>()
  const merchants = new Map<string, number>()
  const add = (item: FeedItem, weight: number) => {
    categories.set(item.category, (categories.get(item.category) ?? 0) + weight)
    merchants.set(item.merchantId, (merchants.get(item.merchantId) ?? 0) + weight)
  }
  for (const i of s.bought) add(i, SOURCE_WEIGHT.bought)
  for (const i of s.saved) add(i, SOURCE_WEIGHT.saved)
  // Recent views count more than old ones.
  s.viewed.forEach((i, n) => add(i, SOURCE_WEIGHT.viewed / (1 + n / 10)))
  const searches = s.searches.slice(0, MAX_REMEMBERED_SEARCHES)
  return {
    categories: scaled(categories),
    merchants: scaled(merchants),
    searches,
    owned: new Set(s.bought.map((i) => i.listingId)),
    known: categories.size > 0 || searches.length > 0,
  }
}

/** A steady number from 0 to 1 for this seed and key (FNV-1a), so the order holds while the app stays open. */
export function feedJitter(seed: string, key: string): number {
  let h = 0x811c9dc5
  for (const ch of `${seed}:${key}`) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x1_0000_0000
}

export function feedScore(l: FeedListing, taste: Taste, seed: string): number {
  // Newer searches count more.
  const search = taste.searches.reduce((best, q, n) => (listingMatchesSearch(l, q) ? Math.max(best, 1 / (1 + n / 3)) : best), 0)
  const sold = l.ticketCount > 0 ? l.ticketsSold / l.ticketCount : 0
  return (
    SCORE.category * (taste.categories.get(l.category) ?? 0) +
    SCORE.merchant * (taste.merchants.get(l.merchantId) ?? 0) +
    SCORE.search * search +
    SCORE.almostGone * sold +
    SCORE.jitter * feedJitter(seed, l.id) +
    (taste.owned.has(l.id) ? SCORE.owned : 0)
  )
}

/** The listings, best match first. */
export function personalFeed<T extends FeedListing>(listings: readonly T[], taste: Taste, seed: string): T[] {
  return listings
    .map((l) => ({ l, score: feedScore(l, taste, seed) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.l)
}

/** Categories they like first; the rest in a different order each time. */
export function categoryOrder(categories: readonly Category[], taste: Taste, seed: string): Category[] {
  const score = (c: Category) => 2 * (taste.categories.get(c) ?? 0) + feedJitter(seed, c)
  return [...categories].sort((a, b) => score(b) - score(a))
}

/**
 * Adds a search to the front of the list. Typing "iph" then "iphone" keeps only
 * "iphone", since a live search sends each step.
 */
export function rememberSearch(list: readonly string[], term: string): string[] {
  const t = term.trim().toLowerCase()
  if (t.length < MIN_SEARCH_LENGTH) return [...list]
  const [last, ...older] = list
  const rest = last !== undefined && (t.startsWith(last) || last.startsWith(t)) ? older : list
  return [t, ...rest.filter((s) => s !== t)].slice(0, MAX_REMEMBERED_SEARCHES)
}

export function forgetSearch(list: readonly string[], term: string): string[] {
  return list.filter((s) => s !== term)
}

/**
 * The recent searches to show under the box: the newest, narrowed to those
 * containing what's typed so far (not what's already there exactly).
 */
export function recentSearchSuggestions(list: readonly string[], typed: string): string[] {
  const t = typed.trim().toLowerCase()
  return list.filter((s) => s !== t && s.includes(t)).slice(0, MAX_SHOWN_SEARCHES)
}

export function rememberView(list: readonly FeedItem[], item: FeedItem): FeedItem[] {
  return [item, ...list.filter((i) => i.listingId !== item.listingId)].slice(0, MAX_REMEMBERED_VIEWS)
}
