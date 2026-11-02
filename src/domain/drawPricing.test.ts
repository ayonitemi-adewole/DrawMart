import { describe, expect, it } from 'vitest'
import { pricingStats, pricingTip, ticketBand, ticketBandLabel, type FinishedDraw } from './drawPricing'

const draw = (merchantId: string, over: Partial<FinishedDraw> = {}): FinishedDraw => ({
  merchantId,
  category: 'Phones',
  ticketPriceKobo: 500_000,
  status: 'drawn',
  liveAt: '2026-10-01T09:00:00Z',
  soldOutAt: '2026-10-07T09:00:00Z',
  closesAt: '2026-10-15T09:00:00Z',
  durationDays: 14,
  ...over,
})

describe('draw pricing tips', () => {
  it('puts ticket prices in bands', () => {
    expect([10_000, 50_000, 50_100, 500_000, 1_000_000, 1_000_100].map(ticketBand)).toEqual([0, 0, 1, 3, 4, 5])
    expect(ticketBandLabel(0)).toBe('₦500 or less')
    expect(ticketBandLabel(3)).toBe('₦2,501–₦5,000')
    expect(ticketBandLabel(5)).toBe('over ₦10,000')
  })

  it('needs 5 similar draws from at least 3 stores', () => {
    const fourFromThree = [draw('a'), draw('b'), draw('c'), draw('a')]
    expect(pricingStats(fourFromThree, 'Phones', 3).draws).toBeNull()
    const fiveFromTwo = [draw('a'), draw('a'), draw('a'), draw('b'), draw('b')]
    expect(pricingStats(fiveFromTwo, 'Phones', 3).draws).toBeNull()
    const ok = [draw('a'), draw('b'), draw('c'), draw('a'), draw('b', { soldOutAt: null, status: 'refunded' })]
    const s = pricingStats(ok, 'Phones', 3)
    expect(s).toMatchObject({ draws: 5, soldOut: 4, avgDaysToSellOut: 6 })
    expect(pricingTip(s)).toBe('Phones draws with ₦2,501–₦5,000 tickets: 4 of 5 sold out, in 6 days on average.')
  })

  it('ignores other categories, other bands and draws still selling', () => {
    const mixed = [draw('a'), draw('b'), draw('c'), draw('d', { category: 'Home' }), draw('e', { ticketPriceKobo: 100_000 }), draw('f', { status: 'live', soldOutAt: null })]
    expect(pricingStats(mixed, 'Phones', 3).draws).toBeNull()
  })

  it('works out when older draws went live from their closing date', () => {
    const old = ['a', 'b', 'c', 'd', 'e'].map((m) => draw(m, { liveAt: null, closesAt: '2026-10-15T09:00:00Z', durationDays: 14, soldOutAt: '2026-10-03T21:00:00Z' }))
    expect(pricingStats(old, 'Phones', 3).avgDaysToSellOut).toBe(2.5)
    const none = ['a', 'b', 'c', 'd', 'e'].map((m) => draw(m, { soldOutAt: null, status: 'refunded' }))
    expect(pricingTip(pricingStats(none, 'Phones', 3))).toBe('Phones draws with ₦2,501–₦5,000 tickets: none of the last 5 sold out.')
  })
})
