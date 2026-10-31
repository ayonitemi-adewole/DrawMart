import { describe, expect, it } from 'vitest'
import { listingShareText, whatsAppShareUrl } from './share'

const base = { title: 'Honda Civic', kind: 'raffle' as const, status: 'live' as const, priceKobo: 2_200_000_000, fallbackPriceKobo: null, buyerTicketPriceKobo: 5_000_000 }

describe('listingShareText', () => {
  it('gives the ticket price for a live draw', () => {
    expect(listingShareText(base)).toBe('Honda Civic: ₦50,000 a ticket on DrawMart')
  })

  it('gives the price for anything on sale', () => {
    expect(listingShareText({ ...base, kind: 'product', status: 'for_sale', priceKobo: 45_000_000 })).toBe('Honda Civic: ₦450,000 on DrawMart')
    expect(listingShareText({ ...base, status: 'for_sale', fallbackPriceKobo: 2_100_000_000 })).toBe('Honda Civic: ₦21,000,000 on DrawMart')
  })

  it('names no price once sales have ended', () => {
    for (const status of ['sold_out', 'drawn', 'refunded', 'sold'] as const) expect(listingShareText({ ...base, status })).toBe('Honda Civic on DrawMart')
  })

  it('doesn’t promise a win', () => {
    expect(listingShareText(base)).not.toMatch(/\bwin\b/i)
  })
})

describe('whatsAppShareUrl', () => {
  it('opens WhatsApp with the message and link, encoded', () => {
    const url = new URL(whatsAppShareUrl('Phones & more: ₦1,000 a ticket', 'https://drawmart.example/listings/abc?x=1'))
    expect(url.origin).toBe('https://wa.me')
    expect(url.searchParams.get('text')).toBe('Phones & more: ₦1,000 a ticket https://drawmart.example/listings/abc?x=1')
  })
})
