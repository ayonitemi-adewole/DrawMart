import { describe, expect, it } from 'vitest'
import { FEE_TIERS, MAX_FEE_BPS, MIN_FEE_BPS, computeListingEconomics, platformFeeBps, validateListingEconomics } from './fees'
import { nairaToKobo as k } from './money'

describe('computeListingEconomics', () => {
  it('seller pays: buyer sees the plain ticket price, fee comes off the payout', () => {
    const e = computeListingEconomics({ priceKobo: k(1_000_000), ticketPriceKobo: k(5_000), feeBps: 1000, feeMode: 'seller' })
    expect(e.ticketCount).toBe(200)
    expect(e.buyerTicketKobo).toBe(k(5_000))
    expect(e.poolKobo).toBe(k(1_000_000))
    expect(e.sellerPayoutKobo).toBe(k(900_000))
    expect(e.platformKobo).toBe(k(100_000))
  })

  it('buyer pays: fee added per ticket, merchant gets full price', () => {
    const e = computeListingEconomics({ priceKobo: k(1_000_000), ticketPriceKobo: k(5_000), feeBps: 1000, feeMode: 'buyer' })
    expect(e.buyerTicketKobo).toBe(k(5_500))
    expect(e.poolKobo).toBe(k(1_100_000))
    expect(e.sellerPayoutKobo).toBe(k(1_000_000))
    expect(e.platformKobo).toBe(k(100_000))
  })

  it('split: half each side', () => {
    const e = computeListingEconomics({ priceKobo: k(1_000_000), ticketPriceKobo: k(5_000), feeBps: 1000, feeMode: 'split' })
    expect(e.buyerTicketKobo).toBe(k(5_250))
    expect(e.sellerPayoutKobo).toBe(k(950_000))
    expect(e.platformKobo).toBe(k(100_000))
  })

  it('rounds ticket count up so the pool always covers the price', () => {
    const e = computeListingEconomics({ priceKobo: k(1_001), ticketPriceKobo: k(500), feeBps: 0, feeMode: 'seller' })
    expect(e.ticketCount).toBe(3)
    expect(e.poolKobo).toBeGreaterThanOrEqual(k(1_001))
    expect(e.poolKobo).toBe(e.sellerPayoutKobo + e.platformKobo)
  })

  it('keeps pool = payout + platform for awkward numbers', () => {
    for (const feeMode of ['seller', 'buyer', 'split'] as const) {
      const e = computeListingEconomics({ priceKobo: 1_234_567, ticketPriceKobo: 33_333, feeBps: 1250, feeMode })
      expect(e.poolKobo).toBe(e.sellerPayoutKobo + e.platformKobo)
      expect(Number.isInteger(e.buyerTicketKobo)).toBe(true)
    }
  })

  it('returns zeros for empty input', () => {
    expect(computeListingEconomics({ priceKobo: 0, ticketPriceKobo: 0, feeBps: 1000, feeMode: 'seller' }).ticketCount).toBe(0)
  })
})

describe('validateListingEconomics', () => {
  it('accepts a sensible listing', () => {
    expect(validateListingEconomics({ title: 'Phone', priceKobo: k(1_000_000), ticketPriceKobo: k(5_000), feeMode: 'seller' })).toEqual([])
  })
  it('flags tickets that are too cheap, too many or pricier than the item', () => {
    expect(validateListingEconomics({ title: 'x', priceKobo: k(1_000), ticketPriceKobo: k(50), feeMode: 'seller' })).toContain('ticket_too_cheap')
    expect(validateListingEconomics({ title: 'x', priceKobo: k(10_000_000), ticketPriceKobo: k(100), feeMode: 'seller' })).toContain('too_many_tickets')
    expect(validateListingEconomics({ title: 'x', priceKobo: k(1_000), ticketPriceKobo: k(2_000), feeMode: 'seller' })).toContain('ticket_above_price')
  })
})

describe('platformFeeBps', () => {
  it('sets the rate from the item value', () => {
    expect(platformFeeBps(k(100))).toBe(750)
    expect(platformFeeBps(k(49_999))).toBe(750)
    expect(platformFeeBps(k(50_000))).toBe(500)
    expect(platformFeeBps(k(500_000))).toBe(300)
    expect(platformFeeBps(k(4_999_999))).toBe(300)
    expect(platformFeeBps(k(5_000_000))).toBe(250)
    expect(platformFeeBps(k(300_000_000))).toBe(250)
  })

  it('stays between 10% and 30%, and never pays a seller less for a pricier item', () => {
    for (const t of FEE_TIERS) expect(t.bps).toBeGreaterThanOrEqual(MIN_FEE_BPS)
    for (const t of FEE_TIERS) expect(t.bps).toBeLessThanOrEqual(MAX_FEE_BPS)
    const payout = (p: number) => p - Math.round((p * platformFeeBps(p)) / 10_000)
    for (const t of FEE_TIERS.slice(1)) expect(payout(t.fromKobo)).toBeGreaterThan(payout(t.fromKobo - 1))
  })
})
