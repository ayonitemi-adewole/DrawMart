import { lagosDay } from './metrics'
import { nairaToKobo } from './money'
import type { ISODate, Kobo, ListingStatus } from './types'

/** Filters and sorts on /browse. They live in the address, so they survive a refresh and can be shared. */

const DAY = 24 * 60 * 60 * 1000

/** Naira. "Up to", so a ₦1,000 ticket counts under ₦1,000. */
export const TICKET_LIMITS = [500, 1000, 5000] as const
export type TicketLimit = (typeof TICKET_LIMITS)[number]

export const ALMOST_SOLD_OUT_PCT = 80
export const NEW_LISTING_DAYS = 7

export type BrowseSort = 'closing' | 'cheapest' | 'sold'
export const BROWSE_SORTS: { value: BrowseSort; label: string }[] = [
  { value: 'closing', label: 'Closing soonest' },
  { value: 'cheapest', label: 'Cheapest ticket' },
  { value: 'sold', label: 'Most sold' },
]

export interface BrowseOptions {
  maxTicket: TicketLimit | null
  closingToday: boolean
  almostSoldOut: boolean
  newThisWeek: boolean
  sort: BrowseSort | null
}

export const NO_BROWSE_OPTIONS: BrowseOptions = { maxTicket: null, closingToday: false, almostSoldOut: false, newThisWeek: false, sort: null }

/** Reads the address, ignoring anything it doesn't recognise. */
export function parseBrowseOptions(params: URLSearchParams): BrowseOptions {
  const limit = Number(params.get('ticket'))
  const sort = params.get('sort')
  return {
    maxTicket: TICKET_LIMITS.find((t) => t === limit) ?? null,
    closingToday: params.get('closing') === 'today',
    almostSoldOut: params.has('almost'),
    newThisWeek: params.has('new'),
    sort: BROWSE_SORTS.find((s) => s.value === sort)?.value ?? null,
  }
}

/** Sets these options on the address, leaving category, seller and search alone. */
export function writeBrowseOptions(params: URLSearchParams, o: Partial<BrowseOptions>): URLSearchParams {
  const next = new URLSearchParams(params)
  const set = (key: string, value: string | null) => (value === null ? next.delete(key) : next.set(key, value))
  if ('maxTicket' in o) set('ticket', o.maxTicket ? String(o.maxTicket) : null)
  if ('closingToday' in o) set('closing', o.closingToday ? 'today' : null)
  if ('almostSoldOut' in o) set('almost', o.almostSoldOut ? '1' : null)
  if ('newThisWeek' in o) set('new', o.newThisWeek ? '1' : null)
  if ('sort' in o) set('sort', o.sort ?? null)
  return next
}

/** Only live draws have tickets, a closing time and a share sold, so these leave out buy-now items. */
export const hasDrawOnlyOptions = (o: BrowseOptions) => o.maxTicket !== null || o.closingToday || o.almostSoldOut || o.sort !== null

export const hasBrowseFilters = (o: BrowseOptions) => o.maxTicket !== null || o.closingToday || o.almostSoldOut || o.newThisWeek

interface BrowseListing {
  status: ListingStatus
  buyerTicketPriceKobo: Kobo
  ticketCount: number
  ticketsSold: number
  closesAt: ISODate
  createdAt: ISODate
}

const shareSold = (l: BrowseListing) => (l.ticketCount > 0 ? l.ticketsSold / l.ticketCount : 0)

export function matchesBrowseOptions(l: BrowseListing, o: BrowseOptions, now: number): boolean {
  const live = l.status === 'live'
  if (o.maxTicket !== null && !(live && l.buyerTicketPriceKobo <= nairaToKobo(o.maxTicket))) return false
  if (o.closingToday && !(live && lagosDay(Date.parse(l.closesAt)) === lagosDay(now))) return false
  if (o.almostSoldOut && !(live && shareSold(l) * 100 >= ALMOST_SOLD_OUT_PCT)) return false
  if (o.newThisWeek && now - Date.parse(l.createdAt) >= NEW_LISTING_DAYS * DAY) return false
  return true
}

/** Live draws in the chosen order, then everything else as it was. */
export function sortForBrowse<T extends BrowseListing>(list: T[], sort: BrowseSort | null): T[] {
  if (!sort) return list
  const key = (l: T) => (sort === 'closing' ? Date.parse(l.closesAt) : sort === 'cheapest' ? l.buyerTicketPriceKobo : -shareSold(l))
  const rank = (l: T) => (l.status === 'live' ? key(l) : Infinity)
  return [...list].sort((a, b) => {
    const [x, y] = [rank(a), rank(b)]
    return x === y ? 0 : x - y
  })
}
