import { describe, expect, it } from 'vitest'
import { crossedAlmostSold, isClosingSoon, isRelistOf, priceDropped, relistAlertKind, sameLagosDay, savedAlertAllowed, type SavedAlertCheck } from './savedAlerts'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-11-05T11:00:00Z')

describe('crossedAlmostSold', () => {
  it('fires on the sale that crosses 90%', () => {
    expect(crossedAlmostSold(89, 90, 100)).toBe(true)
    expect(crossedAlmostSold(80, 95, 100)).toBe(true)
  })

  it('stays quiet below it, or once past it', () => {
    expect(crossedAlmostSold(10, 89, 100)).toBe(false)
    expect(crossedAlmostSold(90, 91, 100)).toBe(false)
  })

  it('stays quiet when the last ticket sells, since there’s nothing left to tell anyone about', () => {
    expect(crossedAlmostSold(80, 100, 100)).toBe(false)
  })

  it('leaves products alone', () => {
    expect(crossedAlmostSold(0, 0, 0)).toBe(false)
  })
})

describe('isClosingSoon', () => {
  it('is true within 24 hours', () => {
    expect(isClosingSoon(new Date(NOW + 24 * HOUR).toISOString(), NOW)).toBe(true)
    expect(isClosingSoon(new Date(NOW + HOUR).toISOString(), NOW)).toBe(true)
  })

  it('is false further out, or already closed', () => {
    expect(isClosingSoon(new Date(NOW + 25 * HOUR).toISOString(), NOW)).toBe(false)
    expect(isClosingSoon(new Date(NOW - HOUR).toISOString(), NOW)).toBe(false)
  })
})

describe('isRelistOf', () => {
  const saved = { id: 'a', merchantId: 'm1', title: 'Honda Civic 2022', status: 'refunded' as const }
  const fresh = { id: 'b', merchantId: 'm1', title: 'Honda Civic 2022' }

  it('matches the same store and title, ignoring case and spacing', () => {
    expect(isRelistOf(fresh, saved)).toBe(true)
    expect(isRelistOf({ ...fresh, title: '  honda   civic 2022 ' }, saved)).toBe(true)
  })

  it('needs the first one to have ended', () => {
    for (const status of ['drawn', 'refunded', 'sold'] as const) expect(isRelistOf(fresh, { ...saved, status })).toBe(true)
    for (const status of ['live', 'sold_out', 'for_sale', 'pending_review'] as const) expect(isRelistOf(fresh, { ...saved, status })).toBe(false)
  })

  it('doesn’t match another store, another title or itself', () => {
    expect(isRelistOf({ ...fresh, merchantId: 'm2' }, saved)).toBe(false)
    expect(isRelistOf({ ...fresh, title: 'Honda Civic 2023' }, saved)).toBe(false)
    expect(isRelistOf({ ...fresh, id: 'a' }, saved)).toBe(false)
  })

  it('calls a fixed-price return back on sale, and a draw relisted', () => {
    expect(relistAlertKind('for_sale')).toBe('saved_back_on_sale')
    expect(relistAlertKind('live')).toBe('saved_relisted')
  })
})

describe('priceDropped', () => {
  const product = { kind: 'product' as const, status: 'for_sale' as const, priceKobo: 100, fallbackPriceKobo: null }

  it('is true only for a lower price on something on sale', () => {
    expect(priceDropped(product, { ...product, priceKobo: 90 })).toBe(true)
    expect(priceDropped(product, { ...product, priceKobo: 100 })).toBe(false)
    expect(priceDropped(product, { ...product, priceKobo: 110 })).toBe(false)
  })

  it('uses a converted draw’s sale price, not what it was worth', () => {
    const draw = { kind: 'raffle' as const, status: 'for_sale' as const, priceKobo: 500, fallbackPriceKobo: 100 }
    expect(priceDropped(draw, { ...draw, fallbackPriceKobo: 90 })).toBe(true)
    expect(priceDropped(draw, { ...draw, priceKobo: 400 })).toBe(false)
  })

  it('ignores anything that isn’t on sale', () => {
    expect(priceDropped({ ...product, status: 'sold' }, { ...product, status: 'sold', priceKobo: 90 })).toBe(false)
  })
})

describe('savedAlertAllowed', () => {
  const ok: SavedAlertCheck = { kind: 'saved_almost_sold', enabled: true, alreadySent: false, sentToday: 0, weeklyRoomKobo: 5000, ticketPriceKobo: 1000 }

  it('allows an alert within every limit', () => {
    expect(savedAlertAllowed(ok)).toBe(true)
  })

  it('respects the switch, one per item per kind, and three a day', () => {
    expect(savedAlertAllowed({ ...ok, enabled: false })).toBe(false)
    expect(savedAlertAllowed({ ...ok, alreadySent: true })).toBe(false)
    expect(savedAlertAllowed({ ...ok, sentToday: 2 })).toBe(true)
    expect(savedAlertAllowed({ ...ok, sentToday: 3 })).toBe(false)
  })

  it('tells nobody about a draw they have no weekly limit left for', () => {
    for (const kind of ['saved_almost_sold', 'saved_closing_soon', 'saved_relisted'] as const) {
      expect(savedAlertAllowed({ ...ok, kind, weeklyRoomKobo: 999 })).toBe(false)
      expect(savedAlertAllowed({ ...ok, kind, weeklyRoomKobo: 0 })).toBe(false)
      expect(savedAlertAllowed({ ...ok, kind, weeklyRoomKobo: 1000 })).toBe(true)
    }
  })

  it('doesn’t apply the limit to items on sale, which it doesn’t cover', () => {
    for (const kind of ['saved_back_on_sale', 'saved_price_drop'] as const) expect(savedAlertAllowed({ ...ok, kind, weeklyRoomKobo: 0 })).toBe(true)
  })
})

describe('sameLagosDay', () => {
  it('goes by the Lagos calendar', () => {
    expect(sameLagosDay(Date.parse('2026-11-05T22:30:00Z'), Date.parse('2026-11-05T01:00:00Z'))).toBe(true)
    expect(sameLagosDay(Date.parse('2026-11-05T23:30:00Z'), Date.parse('2026-11-05T01:00:00Z'))).toBe(false)
  })
})
