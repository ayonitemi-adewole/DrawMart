import { describe, expect, it } from 'vitest'
import { NO_BROWSE_OPTIONS as NONE, hasBrowseFilters, hasDrawOnlyOptions, matchesBrowseOptions, parseBrowseOptions, sortForBrowse, writeBrowseOptions } from './browse'
import type { ListingStatus } from './types'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
// Noon in Lagos (UTC+1).
const NOW = Date.parse('2026-11-05T11:00:00Z')

const listing = (p: { status?: ListingStatus; naira?: number; sold?: number; count?: number; closesAt?: string; createdAt?: string } = {}) => ({
  status: p.status ?? ('live' as ListingStatus),
  buyerTicketPriceKobo: (p.naira ?? 1000) * 100,
  ticketCount: p.count ?? 100,
  ticketsSold: p.sold ?? 10,
  closesAt: p.closesAt ?? new Date(NOW + 5 * DAY).toISOString(),
  createdAt: p.createdAt ?? new Date(NOW - 30 * DAY).toISOString(),
})
const product = () => listing({ status: 'for_sale', naira: 0, count: 0, sold: 0 })
const passes = (l: ReturnType<typeof listing>, o: Partial<typeof NONE>) => matchesBrowseOptions(l, { ...NONE, ...o }, NOW)

describe('browse filters', () => {
  it('lets everything through with nothing chosen', () => {
    expect(passes(listing(), {})).toBe(true)
    expect(passes(product(), {})).toBe(true)
  })

  it('filters by ticket price, including the limit itself', () => {
    expect(passes(listing({ naira: 1000 }), { maxTicket: 1000 })).toBe(true)
    expect(passes(listing({ naira: 1001 }), { maxTicket: 1000 })).toBe(false)
    expect(passes(listing({ naira: 500 }), { maxTicket: 500 })).toBe(true)
    expect(passes(listing({ naira: 5000 }), { maxTicket: 5000 })).toBe(true)
  })

  it('counts closing today by the Lagos calendar, not UTC', () => {
    // 22:30 UTC is 23:30 in Lagos: still today.
    expect(passes(listing({ closesAt: '2026-11-05T22:30:00Z' }), { closingToday: true })).toBe(true)
    // 23:30 UTC is 00:30 tomorrow in Lagos, though it's the same UTC date.
    expect(passes(listing({ closesAt: '2026-11-05T23:30:00Z' }), { closingToday: true })).toBe(false)
  })

  it('counts almost sold out from 80%', () => {
    expect(passes(listing({ sold: 80 }), { almostSoldOut: true })).toBe(true)
    expect(passes(listing({ sold: 79 }), { almostSoldOut: true })).toBe(false)
  })

  it('counts new as under 7 days old', () => {
    expect(passes(listing({ createdAt: new Date(NOW - 6 * DAY).toISOString() }), { newThisWeek: true })).toBe(true)
    expect(passes(listing({ createdAt: new Date(NOW - 7 * DAY).toISOString() }), { newThisWeek: true })).toBe(false)
  })

  it('needs every chosen filter to match', () => {
    const l = listing({ naira: 1000, sold: 90 })
    expect(passes(l, { maxTicket: 1000, almostSoldOut: true })).toBe(true)
    expect(passes(l, { maxTicket: 500, almostSoldOut: true })).toBe(false)
  })

  it('leaves buy-now items out of draw-only filters, but not out of new', () => {
    expect(passes(product(), { maxTicket: 5000 })).toBe(false)
    expect(passes(product(), { closingToday: true })).toBe(false)
    expect(passes(product(), { almostSoldOut: true })).toBe(false)
    const fresh = { ...product(), createdAt: new Date(NOW - DAY).toISOString() }
    expect(passes(fresh, { newThisWeek: true })).toBe(true)
  })

  it('knows which options only apply to draws', () => {
    expect(hasDrawOnlyOptions({ ...NONE, newThisWeek: true })).toBe(false)
    expect(hasDrawOnlyOptions({ ...NONE, sort: 'sold' })).toBe(true)
    expect(hasBrowseFilters({ ...NONE, sort: 'sold' })).toBe(false)
    expect(hasBrowseFilters({ ...NONE, newThisWeek: true })).toBe(true)
  })
})

describe('browse sorting', () => {
  const a = listing({ naira: 3000, sold: 10, closesAt: new Date(NOW + 3 * DAY).toISOString() })
  const b = listing({ naira: 1000, sold: 50, closesAt: new Date(NOW + 9 * DAY).toISOString() })
  const c = listing({ naira: 2000, sold: 90, closesAt: new Date(NOW + DAY).toISOString() })
  const p = product()

  it('keeps the order when no sort is chosen', () => {
    expect(sortForBrowse([a, p, b], null)).toEqual([a, p, b])
  })

  it('sorts live draws, with buy-now items after them', () => {
    expect(sortForBrowse([p, a, b, c], 'closing')).toEqual([c, a, b, p])
    expect(sortForBrowse([p, a, b, c], 'cheapest')).toEqual([b, c, a, p])
    expect(sortForBrowse([p, a, b, c], 'sold')).toEqual([c, b, a, p])
  })

  it('judges most sold by share, not by the number of tickets', () => {
    const big = listing({ count: 1000, sold: 100 })
    const small = listing({ count: 10, sold: 9 })
    expect(sortForBrowse([big, small], 'sold')).toEqual([small, big])
  })

  it('doesn’t change the list it was given', () => {
    const list = [a, b]
    sortForBrowse(list, 'cheapest')
    expect(list).toEqual([a, b])
  })
})

describe('browse options in the address', () => {
  it('reads what it wrote', () => {
    const o = { maxTicket: 1000, closingToday: true, almostSoldOut: true, newThisWeek: true, sort: 'sold' } as const
    expect(parseBrowseOptions(writeBrowseOptions(new URLSearchParams(), o))).toEqual(o)
  })

  it('ignores anything it doesn’t recognise', () => {
    expect(parseBrowseOptions(new URLSearchParams('ticket=750&closing=tomorrow&sort=random'))).toEqual(NONE)
  })

  it('leaves category, seller and search alone, and removes what’s turned off', () => {
    const start = new URLSearchParams('category=Phones&seller=s1&q=pixel&ticket=500&new=1')
    const next = writeBrowseOptions(start, { maxTicket: null, sort: 'cheapest' })
    expect(next.get('category')).toBe('Phones')
    expect(next.get('seller')).toBe('s1')
    expect(next.get('q')).toBe('pixel')
    expect(next.has('ticket')).toBe(false)
    expect(next.get('new')).toBe('1')
    expect(next.get('sort')).toBe('cheapest')
  })
})
