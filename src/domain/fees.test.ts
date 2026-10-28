import { describe, expect, it } from 'vitest'
import { computeListingEconomics, validateListingEconomics } from './fees'
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
    expect(validateListingEconomics({ title: 'Phone', priceKobo: k(1_000_000), ticketPriceKobo: k(5_000), feeBps: 1000, feeMode: 'seller' })).toEqual([])
  })
  it('flags tickets that are too cheap, too many or pricier than the item', () => {
    expect(validateListingEconomics({ title: 'x', priceKobo: k(1_000), ticketPriceKobo: k(50), feeBps: 1000, feeMode: 'seller' })).toContain('ticket_too_cheap')
    expect(validateListingEconomics({ title: 'x', priceKobo: k(10_000_000), ticketPriceKobo: k(100), feeBps: 1000, feeMode: 'seller' })).toContain('too_many_tickets')
    expect(validateListingEconomics({ title: 'x', priceKobo: k(1_000), ticketPriceKobo: k(2_000), feeBps: 1000, feeMode: 'seller' })).toContain('ticket_above_price')
  })
})
