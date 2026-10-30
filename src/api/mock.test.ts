import { describe, expect, it } from 'vitest'
import { verifyDraw } from '@/domain/draw'
import { addDays, cautionFeeFor, localDate } from '@/domain/listing'
import { nairaToKobo as k } from '@/domain/money'
import { createMockApi, memoryStore } from './mock'
import { ApiError, type NewListingInput } from './types'

const make = (now = () => Date.now()) => createMockApi({ store: memoryStore(), latencyMs: 0, now })

const newListing = (patch: Partial<NewListingInput> = {}): NewListingInput => ({
  title: 'Blender', description: '', category: 'Home', priceKobo: k(60_000), ticketPriceKobo: k(500),
  feeMode: 'seller', durationDays: 7, unsoldPolicy: 'refund',
  handover: { address: '12 Allen Avenue, Ikeja', contactPhone: '0803 123 4567', date: addDays(localDate(new Date()), 2), slot: 'morning' },
  ...patch,
})

describe('mock api', () => {
  it('seeds live listings without leaking draw seeds', async () => {
    const api = make()
    const listings = await api.listListings()
    expect(listings.length).toBe(24)
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
    // Every sample draw has a photo now.
    expect((await api.listListings()).filter((l) => l.images.length === 0)).toEqual([])
    expect((await api.createListing(newListing())).images).toEqual([])
  })

  it('signs demo accounts into their own app and remembers them', async () => {
    const store = memoryStore()
    const api = createMockApi({ store, latencyMs: 0 })
    const seen: (string | null)[] = []
    const stop = api.auth.onChange((s) => seen.push(s?.role ?? null))
    expect(await api.auth.getSession()).toBeNull()
    await expect(api.auth.signInWithPassword('store@drawmart.test', 'nope')).rejects.toThrow(ApiError)
    await api.auth.signInWithPassword(' Store@drawmart.test ', 'drawmart-demo')
    expect(await createMockApi({ store, latencyMs: 0 }).auth.getSession()).toMatchObject({ role: 'store', email: 'store@drawmart.test' })
    await api.auth.signOut()
    stop()
    expect(seen).toEqual(['store', null])
    expect(await api.auth.getSession()).toBeNull()
    await expect(api.auth.sendSignInLink('a@b.co', '/')).rejects.toThrow(/demo accounts/)
  })

  it('tops up within the per-top-up limits', async () => {
    const api = make()
    const before = (await api.getWallet()).balance.cashKobo
    await api.topUp(k(5_000))
    expect((await api.getWallet()).balance.cashKobo).toBe(before + k(5_000))
    await expect(api.topUp(k(99))).rejects.toThrow('The smallest top-up is ₦100.')
    await expect(api.topUp(k(500_001))).rejects.toThrow('The largest single top-up is ₦500,000.')
    expect((await api.getWallet()).pendingDeposits).toEqual([])
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
    await bad({ ticketPriceKobo: k(50) })
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

  it('reviews regular products, then sells them once from the wallet', async () => {
    const api = make()
    await expect(api.createProduct({ title: ' ', description: '', category: 'Home', priceKobo: k(50) })).rejects.toThrow(/Give the item a name/)
    const p = await api.createProduct({ title: 'Office chair', description: 'Mesh back', category: 'Home', priceKobo: k(20_000) })
    expect(p).toMatchObject({ kind: 'product', status: 'pending_review', ticketCount: 0, handover: null, cautionFee: { amountKobo: 0, status: 'none' } })
    await api.approveListing(p.id)
    expect((await api.getListing(p.id)).status).toBe('for_sale')

    const delivery = { address: '15 Awolowo Road, Ikoyi', contactPhone: '0803 123 4567' }
    await expect(api.buyNow(p.id, { address: 'Ikoyi', contactPhone: '1' })).rejects.toThrow(/full delivery address/)
    const before = (await api.getWallet()).balance.cashKobo
    const order = await api.buyNow(p.id, delivery)
    expect(order).toMatchObject({ status: 'paid', priceKobo: k(20_000), feeKobo: k(1_500), // 7.5% under ₦50,000
      listingTitle: 'Office chair', merchantName: 'Ikeja Partner Store' })
    expect((await api.getWallet()).balance.cashKobo).toBe(before - k(20_000))
    expect((await api.getListing(p.id)).status).toBe('sold')
    await expect(api.buyNow(p.id, delivery)).rejects.toMatchObject({ code: 'not_for_sale' })

    expect((await api.listMerchantOrders()).map((o) => o.id)).toEqual([order.id])
    await api.dispatchOrder(order.id)
    await api.confirmOrder(order.id)
    expect((await api.listMyOrders())[0]).toMatchObject({ status: 'delivered' })
    await expect(api.dispatchOrder(order.id)).rejects.toThrow(ApiError)
  })

  it('needs enough in the wallet to buy now', async () => {
    const api = make()
    const [mac] = (await api.listListings({ status: ['for_sale'] })).filter((l) => l.kind === 'product' && l.title.startsWith('MacBook'))
    await expect(api.buyNow(mac.id, { address: '15 Awolowo Road, Ikoyi', contactPhone: '0803 123 4567' })).rejects.toMatchObject({ code: 'insufficient_funds' })
  })

  it('verifies individual sellers, who sell products but never raffles', async () => {
    const api = make()
    await api.auth.signInWithPassword('buyer@drawmart.test', 'drawmart-demo')
    const input = {
      shopName: 'Tolu’s Gadgets', legalName: 'Toluwani Adebayo', nin: '12345678901', phone: '0803 123 4567',
      address: '12 Herbert Macaulay Way, Yaba', area: 'Yaba', idPhoto: 'data:image/jpeg;base64,x', selfie: 'data:image/jpeg;base64,y',
    }
    await expect(api.createProduct({ title: 'PS5', description: '', category: 'Electronics', priceKobo: k(150_000) })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(api.submitSellerApplication({ ...input, nin: '12' })).rejects.toThrow(/11-digit NIN/)
    const a = await api.submitSellerApplication(input)
    expect(a.status).toBe('pending')
    await expect(api.submitSellerApplication(input)).rejects.toThrow(/already being reviewed/)

    await expect(api.rejectSeller(a.id, '')).rejects.toThrow(/what to fix/)
    await api.rejectSeller(a.id, 'The selfie is blurry.')
    expect(await api.getMySellerApplication()).toMatchObject({ status: 'rejected', reviewNote: 'The selfie is blurry.' })
    await api.submitSellerApplication(input)
    expect((await api.listSellerApplications()).map((x) => x.id)).toEqual([a.id])
    await api.approveSeller(a.id)

    expect(await api.getMyMerchant()).toMatchObject({ kind: 'individual', name: 'Tolu’s Gadgets', cacNumber: '' })
    await expect(api.createListing(newListing())).rejects.toMatchObject({ code: 'forbidden' })
    const p = await api.createProduct({ title: 'PS5', description: '', category: 'Electronics', priceKobo: k(15_000) })
    expect((await api.listMerchantListings()).map((l) => l.id)).toEqual([p.id])
    await api.approveListing(p.id)
    await expect(api.buyNow(p.id, { address: '12 Herbert Macaulay Way, Yaba', contactPhone: '0803 123 4567' })).rejects.toThrow(/your own item/)
  })

  it('lets buyers and sellers chat about products, with unread counts and opt-in calls', async () => {
    const store = memoryStore()
    const api = createMockApi({ store, latencyMs: 0 })
    await api.auth.signInWithPassword('buyer@drawmart.test', 'drawmart-demo')
    const seeded = await api.listConversations()
    expect(seeded).toHaveLength(1) // the demo buyer's TV chat; the store's chat with Ada isn't theirs
    expect(seeded[0]).toMatchObject({ me: 'buyer', unread: 1, callPhone: '0803 000 1234', merchantName: 'Surulere Partner Store' })

    const products = await api.listListings({ status: ['for_sale'] })
    const ikejaPhone = products.find((l) => l.kind === 'product' && l.merchant.id === 'm-ikeja')!
    const raffle = (await api.listListings())[0]
    await expect(api.sendFirstMessage(raffle.id, 'Hi')).rejects.toThrow(/no seller chat/)
    await expect(api.sendFirstMessage(ikejaPhone.id, '  ')).rejects.toThrow(/Write a message/)
    expect(await api.listConversations()).toHaveLength(1) // a blank message created nothing
    const c = await api.sendFirstMessage(ikejaPhone.id, 'Can I pick it up today?')
    expect((await api.sendFirstMessage(ikejaPhone.id, 'Or tomorrow?')).id).toBe(c.id) // same chat
    expect((await api.listMessages(c.id)).length).toBe(2)
    expect(c.callPhone).toBeNull() // the store hasn't shared a number

    // The store sees it as unread, replies, and shares a number.
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const storeInbox = await api.listConversations()
    expect(storeInbox.map((x) => x.buyerName).sort()).toEqual(['Ada Okafor', 'Chidi Eze'])
    expect(storeInbox.find((x) => x.id === c.id)).toMatchObject({ me: 'seller', unread: 2, callPhone: null })
    await api.markConversationRead(c.id)
    await api.sendMessage(c.id, 'Yes, any time before 6pm.')
    await expect(api.setCallPhone('123')).rejects.toThrow(/Nigerian mobile/)
    await api.setCallPhone('0803 555 0000')
    expect(await api.getCallPhone()).toBe('0803 555 0000')

    await api.auth.signInWithPassword('buyer@drawmart.test', 'drawmart-demo')
    expect((await api.listConversations()).find((x) => x.id === c.id)).toMatchObject({ unread: 1, callPhone: '0803 555 0000' })
    expect((await api.listMessages(c.id)).map((m) => m.sender)).toEqual(['buyer', 'buyer', 'seller'])
  })

  it('counts listing views for seller insights, but not the seller’s own', async () => {
    const store = memoryStore()
    const api = createMockApi({ store, latencyMs: 0 })
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const before = await api.getMerchantMetrics(7)
    expect(before.daily).toHaveLength(7)
    expect(before.listings.length).toBeGreaterThan(0)
    expect(before.listings.some((l) => l.views > 0 && l.salesKobo > 0)).toBe(true)
    const own = before.listings.find((l) => l.status === 'live')!
    await api.recordListingView(own.listingId, 'visitor-1234')
    expect((await api.getMerchantMetrics(7)).listings.find((l) => l.listingId === own.listingId)!.views).toBe(own.views)

    await api.auth.signOut()
    await api.recordListingView(own.listingId, 'visitor-1234')
    await api.recordListingView(own.listingId, 'visitor-1234') // same visitor, same day
    await api.recordListingView(own.listingId, 'x') // not a visitor id
    await expect(api.getMerchantMetrics(7)).rejects.toMatchObject({ code: 'forbidden' })

    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const after = await api.getMerchantMetrics(30)
    expect(after.daily).toHaveLength(30)
    expect(after.listings.find((l) => l.listingId === own.listingId)!.views).toBeGreaterThan(own.views)
    expect((await api.getMerchantMetrics(7)).listings.find((l) => l.listingId === own.listingId)!.views).toBe(own.views + 1)
  })

  it('lets sellers boost live listings, within the slot limit an admin sets', async () => {
    const api = make()
    const listings = await api.listListings()
    expect(listings.some((l) => l.boostedUntil && l.boostedUntil > new Date().toISOString())).toBe(true) // seeded sponsors

    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const status = await api.getBoostStatus()
    expect(status).toMatchObject({ unlocked: true, admin: null })
    const mine = (await api.listMerchantListings()).filter((l) => l.status === 'live')
    await expect(api.buyBoost(mine[0].id, 'nope')).rejects.toThrow(/Pick a boost package/)
    expect(await api.buyBoost(mine[0].id, '3d')).toBe('successful')
    const first = (await api.getListing(mine[0].id)).boostedUntil!
    await api.buyBoost(mine[0].id, '7d') // runs on after the first
    expect(Date.parse((await api.getListing(mine[0].id)).boostedUntil!) - Date.parse(first)).toBe(7 * 86_400_000)
    expect((await api.listBoosts()).map((b) => b.days)).toEqual([7, 3])

    await api.auth.signInWithPassword('admin@drawmart.test', 'drawmart-demo')
    expect((await api.getBoostStatus()).admin).toMatchObject({ forcedOn: true })
    expect((await api.listBoosts()).length).toBe(4)
    await api.setBoostSettings({ minActiveBuyers: 1000, forcedOn: false, maxActive: 12 })

    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    expect((await api.getBoostStatus()).unlocked).toBe(false)
    await expect(api.buyBoost(mine[1].id, '3d')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(api.setBoostSettings({ minActiveBuyers: 0, forcedOn: true, maxActive: 1 })).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('shows a boost’s results against the days before it', async () => {
    const api = make()
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const live = (await api.listMerchantListings()).find((l) => l.status === 'live')!
    await api.buyBoost(live.id, '3d')
    const [boost] = await api.listBoosts()
    expect(boost.txRef).toMatch(/^BST-/)
    await api.auth.signOut()
    await api.recordListingView(live.id, 'visitor-during-1')
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const r = await api.getBoostInsights(boost.id)
    expect(r.window.days).toBe(1)
    expect(r.daily).toHaveLength(2)
    expect(r.during.views).toBeGreaterThan(0) // seeded views today, plus ours
    expect(r.before.views).toBeGreaterThan(0) // seeded views yesterday

    await api.auth.signInWithPassword('buyer@drawmart.test', 'drawmart-demo')
    await expect(api.getBoostInsights(boost.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('gives every demo account its own data, all starting with the same balance', async () => {
    const api = make()
    await api.auth.signInWithPassword('chidi@drawmart.test', 'drawmart-demo')
    expect((await api.getWallet()).balance.cashKobo).toBe(k(25_000))
    const [phone] = await api.listListings({ category: 'Phones' })
    await api.buyTickets(phone.id, 1)
    expect((await api.getWallet()).balance.cashKobo).toBe(k(25_000) - phone.buyerTicketPriceKobo)

    await api.auth.signInWithPassword('ngozi@drawmart.test', 'drawmart-demo')
    expect((await api.getWallet()).balance.cashKobo).toBe(k(25_000))
    expect((await api.getListing(phone.id)).myNumbers).toEqual([])
    expect((await api.getCurrentUser()).displayName).toBe('Ngozi Bello')

    // Each store manages its own listings.
    await api.auth.signInWithPassword('lekki@drawmart.test', 'drawmart-demo')
    expect((await api.getMyMerchant()).name).toBe('Lekki Partner Store')
    expect((await api.listMerchantListings()).every((l) => l.merchant.id === 'm-lekki')).toBe(true)

    // The ID-verified seller already has a shop with items.
    await api.auth.signInWithPassword('seller@drawmart.test', 'drawmart-demo')
    expect(await api.getMySellerApplication()).toMatchObject({ status: 'approved' })
    expect((await api.getMyMerchant()).kind).toBe('individual')
    expect((await api.listMerchantListings()).length).toBe(3)
  })

  it('sends several items in one pickup for one fee, refunded only if all sell out', async () => {
    const api = make()
    const { handover, ...item } = newListing()
    const pair = [{ ...item, title: 'Phone' , category: 'Phones' as const }, { ...item, title: 'Fridge', category: 'Home' as const }]

    await expect(api.createListingBatch({ items: pair.slice(0, 1), handover })).rejects.toThrow(/at least 2/)
    await expect(api.createListingBatch({ items: [pair[0], { ...item, title: 'Saloon', category: 'Cars' }], handover })).rejects.toThrow(/Cars are inspected/)
    const pending = (await api.listPendingListings()).length
    await expect(api.createListingBatch({ items: [pair[0], { ...pair[1], title: ' ' }], handover })).rejects.toThrow(/Give the item a name/)
    expect((await api.listPendingListings()).length).toBe(pending) // all or none

    const [a, b] = await api.createListingBatch({ items: pair, handover })
    expect(a.pickupBatchId).toBeTruthy()
    expect(b.pickupBatchId).toBe(a.pickupBatchId)
    expect(a.cautionFee).toEqual({ amountKobo: cautionFeeFor('Home'), status: 'held' })
    expect(b.cautionFee.amountKobo).toBe(cautionFeeFor('Home'))
    expect(a.handover?.address).toBe(b.handover?.address)

    await api.approveListing(a.id)
    await api.approveListing(b.id)
    await api.demoSellOut(a.id)
    expect((await api.getListing(a.id)).cautionFee.status).toBe('held') // the other is still live
    await api.demoSellOut(b.id)
    expect((await api.getListing(a.id)).cautionFee.status).toBe('refunded')
    expect((await api.getListing(b.id)).cautionFee.status).toBe('refunded')

    const [c, d] = await api.createListingBatch({ items: pair, handover })
    await api.rejectListing(d.id)
    expect((await api.getListing(c.id)).cautionFee.status).toBe('kept')
  })

  it('keeps saved pickup items for a limited time, per store', async () => {
    let t = Date.parse('2026-10-30T12:00:00Z')
    const api = make(() => t)
    const { handover: _h, ...item } = newListing()
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    expect(await api.getSavedPickup()).toBeNull()

    const first = await api.savePickupItems([item])
    expect(first?.expiresAt).toBe('2026-11-06T12:00:00.000Z')
    t += 86_400_000
    const second = await api.savePickupItems([item, { ...item, title: 'Toaster' }])
    expect(second?.expiresAt).toBe(first?.expiresAt) // edits don't extend it
    expect((await api.getSavedPickup())?.items).toHaveLength(2)

    await api.auth.signInWithPassword('lekki@drawmart.test', 'drawmart-demo')
    expect(await api.getSavedPickup()).toBeNull() // another store's
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')

    await expect(api.savePickupItems([{ ...item, category: 'Cars' }])).rejects.toThrow(/Cars are inspected/)
    t += 7 * 86_400_000
    expect(await api.getSavedPickup()).toBeNull() // expired
    expect((await api.savePickupItems([item]))?.expiresAt).toBe(new Date(t + 7 * 86_400_000).toISOString()) // starts afresh
    expect(await api.savePickupItems([])).toBeNull()
    expect(await api.getSavedPickup()).toBeNull()
  })
})
