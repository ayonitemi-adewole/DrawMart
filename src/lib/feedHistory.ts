import { forgetSearch, rememberSearch, rememberView, type FeedItem } from '@/domain/feed'

/**
 * What this device has searched for and looked at, for the personal explore feed
 * (domain/feed.ts). It stays in this browser, never goes to the server, and goes
 * on sign-out. Storage can be missing or full: then the feed just knows less.
 */
const SEARCHES = 'drawmart.feed.searches'
const VIEWS = 'drawmart.feed.views'
const SEED = 'drawmart.feed.seed'

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* full or blocked: nothing kept, nothing broken */
  }
}

export const recentSearches = () => read<string>(SEARCHES).filter((s) => typeof s === 'string')
export const recentViews = () => read<FeedItem>(VIEWS).filter((v) => v && typeof v.listingId === 'string' && typeof v.category === 'string')

export function recordSearch(term: string) {
  write(SEARCHES, rememberSearch(recentSearches(), term))
}

export function removeSearch(term: string) {
  write(SEARCHES, forgetSearch(recentSearches(), term))
}

export function clearSearches() {
  try {
    localStorage.removeItem(SEARCHES)
  } catch {
    /* nothing to clear */
  }
}

export function recordView(item: FeedItem) {
  write(VIEWS, rememberView(recentViews(), item))
}

export function clearFeedHistory() {
  try {
    localStorage.removeItem(SEARCHES)
    localStorage.removeItem(VIEWS)
  } catch {
    /* nothing to clear */
  }
}

let seed: string | undefined

/**
 * New each time the app is opened (a new tab or launch), and kept while it's
 * open, so going back to explore doesn't reshuffle what was just there.
 */
export function feedSeed(): string {
  if (seed) return seed
  try {
    seed = sessionStorage.getItem(SEED) ?? undefined
    if (!seed) {
      seed = crypto.randomUUID()
      sessionStorage.setItem(SEED, seed)
    }
  } catch {
    seed ??= crypto.randomUUID()
  }
  return seed
}
