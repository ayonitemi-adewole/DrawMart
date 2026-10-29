/**
 * Paid promotion ("boosts"): a seller pays to show a listing first, marked
 * Sponsored, for a fixed number of days. Boosts only unlock once DrawMart has
 * enough active buyers to be worth paying for (an admin can switch them on
 * early). Mirrored in supabase/migrations/…_boosts.sql.
 */
import { addDays, daysBetween } from './listing'
import { lagosDay, type ListingMetricsInput } from './metrics'
import type { Kobo, Listing } from './types'

export interface BoostPackage {
  id: string
  days: number
  priceKobo: Kobo
}

/** Placeholder prices (see docs/product-decisions.md). Admins change them in public.boost_packages. */
export const DEFAULT_BOOST_PACKAGES: BoostPackage[] = [
  { id: '3d', days: 3, priceKobo: 2_500_00 },
  { id: '7d', days: 7, priceKobo: 5_000_00 },
  { id: '14d', days: 14, priceKobo: 9_000_00 },
]

export const BOOST_DEFAULTS = {
  /** Buyers active in the last 30 days needed before boosts unlock. */
  minActiveBuyers: 1_000,
  /** Boosts running at once, app-wide, so Sponsored stays meaningful. */
  maxActiveBoosts: 12,
  /** Sponsored items shown above each list at most. */
  sponsoredPerList: 4,
}

/** Boosts are open when there are enough active buyers, or an admin switched them on. */
export function boostsUnlocked(activeBuyers: number, minActiveBuyers: number, forcedOn: boolean): boolean {
  return forcedOn || activeBuyers >= minActiveBuyers
}

/** Only things buyers can act on right now are worth promoting. */
export function canBoost(l: Pick<Listing, 'kind' | 'status'>): boolean {
  return (l.kind === 'raffle' && l.status === 'live') || l.status === 'for_sale'
}

export function isBoosted(l: { boostedUntil: string | null }, now: number): boolean {
  return !!l.boostedUntil && new Date(l.boostedUntil).getTime() > now
}

/** A new boost starts now, or runs on from the end of one still going. */
export function boostEndsAt(currentBoostedUntil: string | null, days: number, now: number): string {
  const start = Math.max(now, currentBoostedUntil ? new Date(currentBoostedUntil).getTime() : 0)
  return new Date(start + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Puts up to `max` boosted listings first, the one ending soonest first so
 * each gets its turn at the top. The rest keep their order.
 */
export function withSponsoredFirst<T extends { id: string; boostedUntil: string | null }>(
  list: T[],
  now: number,
  max = BOOST_DEFAULTS.sponsoredPerList,
): { sponsored: T[]; rest: T[] } {
  const sponsored = list
    .filter((l) => isBoosted(l, now))
    .sort((a, b) => a.boostedUntil!.localeCompare(b.boostedUntil!))
    .slice(0, max)
  const ids = new Set(sponsored.map((l) => l.id))
  return { sponsored, rest: list.filter((l) => !ids.has(l.id)) }
}

export type BoostError = 'locked' | 'not_boostable' | 'slots_full' | 'no_package'

export const BOOST_ERROR_TEXT: Record<BoostError, string> = {
  locked: 'Boosts open once DrawMart has enough active buyers.',
  not_boostable: 'Only live draws and items on sale can be boosted.',
  slots_full: 'All boost slots are taken right now. Try again in a day or two.',
  no_package: 'Pick a boost package.',
}

// ------------------------------------------------------------- results

/**
 * The Lagos days a boost covered so far, and the same number of days just
 * before it started, to compare against. Views are counted per day, so the
 * whole start day counts as boosted.
 */
export interface BoostWindow {
  from: string
  to: string
  days: number
  beforeFrom: string
  beforeTo: string
}

export function boostWindow(startsAt: string, endsAt: string, now: number): BoostWindow {
  const from = lagosDay(startsAt)
  const to = lagosDay(Math.min(Date.parse(endsAt), now))
  const days = Math.max(1, daysBetween(from, to) + 1)
  return { from, to, days, beforeFrom: addDays(from, -days), beforeTo: addDays(from, -1) }
}

/** Change in the daily average from before the boost to during it, in whole percent; null with nothing before to compare. */
export function liftPct(before: number, during: number): number | null {
  if (before <= 0) return null
  return Math.round(((during - before) / before) * 100)
}

/** Key numbers, before and during, as daily averages so a boost still running compares fairly. */
export function boostComparison(before: ListingMetricsInput, during: ListingMetricsInput, days: number) {
  const row = (k: 'views' | 'visitors' | 'units' | 'salesKobo' | 'chats') => ({ before: before[k] / days, during: during[k] / days, lift: liftPct(before[k], during[k]) })
  return { views: row('views'), visitors: row('visitors'), chats: row('chats'), units: row('units'), salesKobo: row('salesKobo') }
}
