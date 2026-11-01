import { lagosDay } from './metrics'
import { salePriceKobo } from './orders'
import type { ISODate, Kobo, Listing, ListingKind, ListingStatus, NotificationKind } from './types'

/**
 * Alerts about items a buyer has saved. Mirrored in private.alert_saved and
 * private.saved_alerts_on_listing.
 *
 * These can nudge someone to buy, so they're rationed: once per item per kind, a few
 * a day per buyer, none about draws once a buyer's weekly limit leaves no room for a
 * ticket, and a single switch turns them all off.
 */
export const ALMOST_SOLD_PCT = 90
export const CLOSING_SOON_HOURS = 24
export const MAX_SAVED_ALERTS_PER_DAY = 3

export type SavedAlertKind = Extract<NotificationKind, 'saved_almost_sold' | 'saved_closing_soon' | 'saved_relisted' | 'saved_back_on_sale' | 'saved_price_drop'>

/** About tickets, so the weekly spending limit applies. Items on sale aren't limited by it. */
const DRAW_ALERTS: readonly SavedAlertKind[] = ['saved_almost_sold', 'saved_closing_soon', 'saved_relisted']

/** Only on the sale that crosses the line, and not the one that sells the last ticket. */
export function crossedAlmostSold(soldBefore: number, soldAfter: number, ticketCount: number): boolean {
  return ticketCount > 0 && soldAfter < ticketCount && soldBefore * 100 < ALMOST_SOLD_PCT * ticketCount && soldAfter * 100 >= ALMOST_SOLD_PCT * ticketCount
}

export function isClosingSoon(closesAt: ISODate, now: number): boolean {
  const left = Date.parse(closesAt) - now
  return left > 0 && left <= CLOSING_SOON_HOURS * 60 * 60 * 1000
}

const sameTitle = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

const ENDED: readonly ListingStatus[] = ['drawn', 'refunded', 'sold']

/** There's no "relist" action, so this means the same store listing the same title again after the first one ended. */
export function isRelistOf(fresh: { id: string; merchantId: string; title: string }, saved: { id: string; merchantId: string; title: string; status: ListingStatus }): boolean {
  return fresh.id !== saved.id && fresh.merchantId === saved.merchantId && ENDED.includes(saved.status) && sameTitle(fresh.title, saved.title)
}

/** A new listing matching a saved one: a draw is relisted; a fixed-price item is back on sale. */
export const relistAlertKind = (status: ListingStatus): SavedAlertKind => (status === 'for_sale' ? 'saved_back_on_sale' : 'saved_relisted')

type PricedListing = Pick<Listing, 'status' | 'priceKobo' | 'fallbackPriceKobo'> & { kind: ListingKind }

export function priceDropped(before: PricedListing, after: PricedListing): boolean {
  const [was, now] = [salePriceKobo(before), salePriceKobo(after)]
  return was !== null && now !== null && now < was
}

export interface SavedAlertCheck {
  kind: SavedAlertKind
  enabled: boolean
  alreadySent: boolean
  /** Saved-item alerts this buyer has already had today, Lagos time. */
  sentToday: number
  /** Left of their weekly limit. */
  weeklyRoomKobo: Kobo
  ticketPriceKobo: Kobo
}

export function savedAlertAllowed(c: SavedAlertCheck): boolean {
  if (!c.enabled || c.alreadySent || c.sentToday >= MAX_SAVED_ALERTS_PER_DAY) return false
  return !DRAW_ALERTS.includes(c.kind) || c.weeklyRoomKobo >= c.ticketPriceKobo
}

export const sameLagosDay = (a: number, b: number) => lagosDay(a) === lagosDay(b)
