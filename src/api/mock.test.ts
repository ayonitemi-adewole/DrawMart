import { describe, expect, it } from 'vitest'
import { verifyDraw } from '@/domain/draw'
import { nairaToKobo as k } from '@/domain/money'
import { createMockApi, memoryStore } from './mock'
import { ApiError } from './types'

const make = (now = () => Date.now()) => createMockApi({ store: memoryStore(), latencyMs: 0, now })

describe('mock api', () => {
  it('seeds live listings without leaking draw seeds', async () => {
    const api = make()
    const listings = await api.listListings()
    expect(listings.length).toBe(11)
    for (const l of listings) {
      expect(l.status).toBe('live')
      expect(l.commitment).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(l)).not.toMatch(/"seed"/)
    }
  })

  it('returns listing photos, cover first, and none for new merchant listings', async () => {
    const api = make()
    const [phone] = await api.listListings({ category: 'Phones' })
    expect(phone.images[0]).toMatch(/^\/assets\/.+\.jpg$/)
    const [rice] = await api.listListings({ category: 'Food' })
    expect(rice.images).toEqual([])
    const created = await api.createListing({
      title: 'Fan', description: '', category: 'Home', priceKobo: k(40_000), ticketPriceKobo: k(500),
      feeMode: 'seller', feeBps: 1000, durationDays: 7, unsoldPolicy: 'refund',
    })
    expect(created.images).toEqual([])
  })

  it('includes the cover photo in draw results', async () => {
    const results = await make().listResults()
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) expect(r.listingImage).toMatch(/^\/assets\//)
  })

  it('seeds an admin queue', async () => {
    const pending = await make().listPendingListings()
    expect(pending.length).toBeGreaterThan(0)
    expect(pending.every((l) => l.status === 'pending_review')).toBe(true)
  })

  it('sells tickets, charges the wallet and records numbers', async () => {
    const api = make()
    const [rice] = await api.listListings({ category: 'Food' })
    const receipt = await api.buyTickets(rice.id, 3)
    expect(receipt.numbers).toEqual([rice.ticketsSold + 1, rice.ticketsSold + 2, rice.ticketsSold + 3])
    const wallet = await api.getWallet()
    expect(wallet.balance.cashKobo).toBe(k(25_000) - 3 * rice.buyerTicketPriceKobo)
    expect((await api.getListing(rice.id)).myNumbers).toHaveLength(3)
  })

  it('rejects purchases that break the rules', async () => {
    const api = make()
    const [phone] = await api.listListings({ category: 'Phones' })
    await expect(api.buyTickets(phone.id, 6)).rejects.toMatchObject({ code: 'insufficient_funds' })
    await expect(api.buyTickets(phone.id, 21)).rejects.toBeInstanceOf(ApiError)
    await api.updateProfile({ state: 'Oyo' })
    await expect(api.buyTickets(phone.id, 1)).rejects.toMatchObject({ code: 'state_not_licensed' })
  })

  it('runs a verifiable draw when the last ticket sells, and pays consolation credit', async () => {
    const api = make()
    const [phone] = await api.listListings({ category: 'Phones' })
    await api.buyTickets(phone.id, 2)
    await api.demoSellOut(phone.id)
    const drawn = await api.getListing(phone.id)
    expect(drawn.status).toBe('drawn')
    const r = drawn.result!
    expect(r.seed).toMatch(/^[0-9a-f]{64}$/)
    const v = await verifyDraw({ commitment: drawn.commitment, seed: r.seed, closingRef: r.closingRef, ticketCount: drawn.ticketCount, claimedWinner: r.winningNumber })
    expect(v.valid).toBe(true)
    if (!r.iWon) expect(r.myCreditKobo).toBe(k(2_000)) // 20% of ₦10,000
  })

  it('refunds buyers when a draw expires unsold', async () => {
    const api = make()
    const [laptop] = (await api.listListings({ category: 'Electronics' })).filter((l) => l.title.startsWith('MacBook'))
    await api.buyTickets(laptop.id, 2)
    await api.demoExpire(laptop.id)
    expect((await api.getListing(laptop.id)).status).toBe('refunded')
    expect((await api.getWallet()).balance.cashKobo).toBe(k(25_000))
  })

  it('makes merchant listings go live only after approval', async () => {
    const api = make()
    const created = await api.createListing({
      title: 'Blender', description: '', category: 'Home', priceKobo: k(60_000), ticketPriceKobo: k(500),
      feeMode: 'seller', feeBps: 1000, durationDays: 7, unsoldPolicy: 'refund',
    })
    expect(created.status).toBe('pending_review')
    expect(created.ticketCount).toBe(120)
    await expect(api.buyTickets(created.id, 1)).rejects.toMatchObject({ code: 'not_live' })
    await api.approveListing(created.id)
    await expect(api.buyTickets(created.id, 1)).resolves.toMatchObject({ numbers: [1] })
  })

  it('delays weekly-limit increases but applies decreases at once', async () => {
    let t = Date.now()
    const api = make(() => t)
    await api.setWeeklyLimit(k(10_000))
    expect((await api.getWallet()).weeklyLimitKobo).toBe(k(10_000))
    await api.setWeeklyLimit(k(80_000))
    expect((await api.getWallet()).weeklyLimitKobo).toBe(k(10_000))
    t += 25 * 60 * 60 * 1000
    expect((await api.getWallet()).weeklyLimitKobo).toBe(k(80_000))
  })
})
