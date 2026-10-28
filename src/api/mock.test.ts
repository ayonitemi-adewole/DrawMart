import { describe, expect, it } from 'vitest'
import { verifyDraw } from '@/domain/draw'
import { addDays, cautionFeeFor, localDate } from '@/domain/listing'
import { nairaToKobo as k } from '@/domain/money'
import { createMockApi, memoryStore } from './mock'
import { ApiError, type NewListingInput } from './types'

const make = (now = () => Date.now()) => createMockApi({ store: memoryStore(), latencyMs: 0, now })

const newListing = (patch: Partial<NewListingInput> = {}): NewListingInput => ({
  title: 'Blender', description: '', category: 'Home', priceKobo: k(60_000), ticketPriceKobo: k(500),
  feeMode: 'seller', feeBps: 1000, durationDays: 7, unsoldPolicy: 'refund',
  handover: { address: '12 Allen Avenue, Ikeja', contactPhone: '0803 123 4567', date: addDays(localDate(new Date()), 2), slot: 'morning' },
  ...patch,
})

describe('mock api', () => {
  it('seeds live listings without leaking draw seeds', async () => {
    const api = make()
    const listings = await api.listListings()
    expect(listings.length).toBe(10)
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
    const [inverter] = await api.listListings({ category: 'Home' })
    expect(inverter.images).toEqual([])
    expect((await api.createListing(newListing())).images).toEqual([])
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

  it('keeps the store’s pickup details away from buyers', async () => {
    const api = make()
    for (const l of await api.listListings()) expect(l.handover).toBeNull()
    const created = await api.createListing(newListing())
    expect(created.handover?.address).toBe('12 Allen Avenue, Ikeja')
    expect((await api.getListing(created.id)).handover).toBeNull()
    expect((await api.listPendingListings()).find((l) => l.id === created.id)?.handover).not.toBeNull()
  })

  it('sells tickets, charges the wallet and records numbers', async () => {
    const api = make()
    const [inverter] = await api.listListings({ category: 'Home' })
    const receipt = await api.buyTickets(inverter.id, 3)
    expect(receipt.numbers).toEqual([inverter.ticketsSold + 1, inverter.ticketsSold + 2, inverter.ticketsSold + 3])
    const wallet = await api.getWallet()
    expect(wallet.balance.cashKobo).toBe(k(25_000) - 3 * inverter.buyerTicketPriceKobo)
    expect((await api.getListing(inverter.id)).myNumbers).toHaveLength(3)
  })

  it('rejects purchases that break the rules', async () => {
    const api = make()
    const [phone] = await api.listListings({ category: 'Phones' })
    await expect(api.buyTickets(phone.id, 6)).rejects.toMatchObject({ code: 'insufficient_funds' })
    await expect(api.buyTickets(phone.id, 21)).rejects.toBeInstanceOf(ApiError)
    await api.updateProfile({ state: 'Oyo' })
    await expect(api.buyTickets(phone.id, 1)).rejects.toMatchObject({ code: 'state_not_licensed' })
  })

  it('runs a verifiable draw on sell-out, pays consolation credit and returns the caution fee', async () => {
    const api = make()
    const [phone] = await api.listListings({ category: 'Phones' })
    expect(phone.cautionFee.status).toBe('held')
    await api.buyTickets(phone.id, 2)
    await api.demoSellOut(phone.id)
    const drawn = await api.getListing(phone.id)
    expect(drawn.status).toBe('drawn')
    expect(drawn.cautionFee.status).toBe('refunded')
    const r = drawn.result!
    expect(r.seed).toMatch(/^[0-9a-f]{64}$/)
    const v = await verifyDraw({ commitment: drawn.commitment, seed: r.seed, closingRef: r.closingRef, ticketCount: drawn.ticketCount, claimedWinner: r.winningNumber })
    expect(v.valid).toBe(true)
    if (!r.iWon) expect(r.myCreditKobo).toBe(k(2_000)) // 20% of ₦10,000
  })

  it('refunds buyers and keeps the caution fee when a draw expires unsold', async () => {
    const api = make()
    const [laptop] = (await api.listListings({ category: 'Electronics' })).filter((l) => l.title.startsWith('MacBook'))
    await api.buyTickets(laptop.id, 2)
    await api.demoExpire(laptop.id)
    const after = await api.getListing(laptop.id)
    expect(after.status).toBe('refunded')
    expect(after.cautionFee.status).toBe('kept')
    expect((await api.getWallet()).balance.cashKobo).toBe(k(25_000))
  })

  it('keeps a convert-to-sale item on the platform at its regular price after an unsold draw', async () => {
    const api = make()
    const [tv] = (await api.listListings({ category: 'Electronics' })).filter((l) => l.unsoldPolicy === 'convert_to_sale')
    expect(tv.fallbackPriceKobo).toBeGreaterThan(0)
    await api.buyTickets(tv.id, 2)
    await api.demoExpire(tv.id)
    const after = await api.getListing(tv.id)
    expect(after.status).toBe('for_sale')
    expect(after.cautionFee.status).toBe('kept')
    expect((await api.getWallet()).balance.cashKobo).toBe(k(25_000))
    expect((await api.listListings({ status: ['for_sale'] })).map((l) => l.id)).toContain(tv.id)
    await expect(api.buyTickets(tv.id, 1)).rejects.toMatchObject({ code: 'not_live' })
  })

  it('makes merchant listings go live only after approval, holding the caution fee', async () => {
    const api = make()
    const created = await api.createListing(newListing())
    expect(created.status).toBe('pending_review')
    expect(created.ticketCount).toBe(120)
    expect(created.cautionFee).toEqual({ amountKobo: cautionFeeFor('Home'), status: 'held' })
    expect(created.handover?.method).toBe('pickup')
    await expect(api.buyTickets(created.id, 1)).rejects.toMatchObject({ code: 'not_live' })
    await api.approveListing(created.id)
    await expect(api.buyTickets(created.id, 1)).resolves.toMatchObject({ numbers: [1] })
  })

  it('books an inspection instead of a pickup for cars', async () => {
    const car = await make().createListing(newListing({ title: 'Saloon car', category: 'Cars', priceKobo: k(9_000_000), ticketPriceKobo: k(10_000) }))
    expect(car.handover?.method).toBe('inspection')
  })

  it('refuses listings that break the submission rules', async () => {
    const api = make()
    const bad = (patch: Partial<NewListingInput>) => expect(api.createListing(newListing(patch))).rejects.toMatchObject({ code: 'invalid_input' })
    await bad({ feeBps: 500 })
    await bad({ durationDays: 90 })
    await bad({ unsoldPolicy: 'convert_to_sale' })
    await bad({ handover: { address: '', contactPhone: '123', date: '2020-01-01', slot: 'morning' } })
    await expect(api.createListing(newListing({ durationDays: 21, unsoldPolicy: 'convert_to_sale', fallbackPriceKobo: k(65_000) }))).resolves.toMatchObject({
      durationDays: 21,
      fallbackPriceKobo: k(65_000),
    })
  })

  it('keeps the caution fee when admin rejects a listing', async () => {
    const api = make()
    const created = await api.createListing(newListing())
    await api.rejectListing(created.id)
    expect((await api.listMerchantListings()).find((l) => l.id === created.id)?.cautionFee.status).toBe('kept')
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
