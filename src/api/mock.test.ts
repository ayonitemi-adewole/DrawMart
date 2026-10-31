import { isProductCode } from '@/domain/productCode'
import { describe, expect, it } from 'vitest'
import { verifyDraw } from '@/domain/draw'
import { addDays, cautionFeeFor, localDate } from '@/domain/listing'
import { nairaToKobo as k } from '@/domain/money'
import type { Delivery } from '@/domain/types'
import { createMockApi, memoryStore } from './mock'
import { ApiError, type NewListingInput } from './types'

const make = (now = () => Date.now()) => createMockApi({ store: memoryStore(), latencyMs: 0, now })

const buyNow = async (api: ReturnType<typeof make>, listingId: string, delivery: Delivery) =>
  (await api.checkout({ listingIds: [listingId], fulfilment: 'delivery', delivery, pickupPointId: null }))[0]

const newListing = (patch: Partial<NewListingInput> = {}): NewListingInput => ({
  title: 'Blender', description: '', category: 'Home', priceKobo: k(60_000), ticketPriceKobo: k(500),
  feeMode: 'seller', durationDays: 7, unsoldPolicy: 'refund',
  handover: { address: '12 Allen Avenue, Ikeja', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567', date: addDays(localDate(new Date()), 2), slot: 'morning' },
  ...patch,
})

describe('mock api', () => {
  it('seeds live listings without leaking draw seeds', async () => {
    const api = make()
    const listings = await api.listListings()
    expect(listings.length).toBe(25)
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
    await api.demoRunDraw(phone.id)
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
    await bad({ handover: { address: '', location: null, contactPhone: '123', date: '2020-01-01', slot: 'morning' } })
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

    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    await expect(buyNow(api, p.id, { address: 'Ikoyi', location: null, contactPhone: '1' })).rejects.toThrow(/full delivery address/)
    const before = (await api.getWallet()).balance.cashKobo
    const order = await buyNow(api, p.id, delivery)
    expect(order).toMatchObject({ status: 'paid', priceKobo: k(20_000), feeKobo: k(1_500), // 7.5% under ₦50,000
      listingTitle: 'Office chair', merchantName: 'Ikeja Partner Store' })
    expect((await api.getWallet()).balance.cashKobo).toBe(before - k(20_000))
    expect((await api.getListing(p.id)).status).toBe('sold')
    await expect(buyNow(api, p.id, delivery)).rejects.toMatchObject({ code: 'not_for_sale' })

    expect((await api.listMerchantOrders()).map((o) => o.id)).toEqual([order.id])
    await api.dispatchOrder(order.id)
    await expect(api.dispatchOrder(order.id)).rejects.toThrow(ApiError)
  })

  it('only marks an order delivered through a delivery account and the buyer’s PIN', async () => {
    let t = Date.now()
    const api = make(() => t)
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const p = await api.createProduct({ title: 'Lamp to deliver', description: 'A lamp', category: 'Home', priceKobo: k(20_000) })
    await api.approveListing(p.id)

    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    await api.topUp(k(50_000))
    const placed = await buyNow(api, p.id, delivery)
    expect(placed.deliveryPin).toMatch(/^[0-9]{6}$/)
    const pin = placed.deliveryPin!
    expect((await api.listMyOrders())[0].deliveryPin).toBe(pin)
    expect('confirmOrder' in api).toBe(false)
    await expect(api.listDeliveryJobs()).rejects.toMatchObject({ code: 'forbidden' })

    // Nobody but the buyer gets the PIN.
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const [forStore] = (await api.listMerchantOrders()).filter((o) => o.id === placed.id)
    expect(forStore.deliveryPin).toBeNull()
    expect(JSON.stringify(forStore)).not.toContain(pin)
    await api.dispatchOrder(placed.id)

    // In the pool: no buyer details until a rider takes it.
    await api.auth.signInWithPassword('rider@drawmart.test', 'drawmart-demo')
    const [waiting] = (await api.listDeliveryJobs()).filter((j) => j.id === placed.id)
    expect(waiting).toMatchObject({ mine: false, dropOff: null, productCode: p.productCode })
    expect(JSON.stringify(waiting)).not.toContain('Awolowo')
    await expect(api.confirmDelivery(placed.id, pin)).rejects.toThrow(/carrying/)

    await api.takeDelivery(placed.id)
    await expect(api.takeDelivery(placed.id)).rejects.toThrow(/Another rider/)
    const [taken] = (await api.listDeliveryJobs()).filter((j) => j.id === placed.id)
    expect(taken).toMatchObject({ mine: true, dropOff: { buyerName: 'Funke Ade', address: delivery.address, location: delivery.location, contactPhone: delivery.contactPhone } })
    expect(JSON.stringify(taken)).not.toContain(pin)

    // Handed back, it's anyone's again, without the details.
    await api.releaseDelivery(placed.id)
    expect((await api.listDeliveryJobs()).find((j) => j.id === placed.id)).toMatchObject({ mine: false, dropOff: null })
    await api.takeDelivery(placed.id)

    // Wrong PINs count, and pause it.
    await expect(api.confirmDelivery(placed.id, '12')).rejects.toThrow(/6-digit/)
    const wrong = pin === '000000' ? '111111' : '000000'
    for (let left = 4; left > 0; left--) expect(await api.confirmDelivery(placed.id, wrong)).toEqual({ confirmed: false, attemptsLeft: left, lockedUntil: null })
    const locked = await api.confirmDelivery(placed.id, wrong)
    expect(locked.lockedUntil).toBeTruthy()
    expect(await api.confirmDelivery(placed.id, pin)).toMatchObject({ confirmed: false })
    expect((await api.listDeliveryJobs()).find((j) => j.id === placed.id)?.pinLockedUntil).toBe(locked.lockedUntil)

    t += 31 * 60_000
    expect(await api.confirmDelivery(placed.id, pin)).toEqual({ confirmed: true, attemptsLeft: 0, lockedUntil: null })
    await expect(api.confirmDelivery(placed.id, pin)).rejects.toThrow(/carrying/)
    expect((await api.listDeliveryJobs()).find((j) => j.id === placed.id)).toMatchObject({ status: 'delivered', dropOff: null })

    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    expect((await api.listMyOrders())[0]).toMatchObject({ status: 'delivered', deliveryPin: null })
    expect((await api.listMyOrders())[0].deliveredAt).toBeTruthy()
  })

  it('needs enough in the wallet to buy now', async () => {
    const api = make()
    const [mac] = (await api.listListings({ status: ['for_sale'] })).filter((l) => l.kind === 'product' && l.title.startsWith('MacBook'))
    await expect(buyNow(api, mac.id, { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' })).rejects.toMatchObject({ code: 'insufficient_funds' })
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
    await expect(buyNow(api, p.id, { address: '12 Herbert Macaulay Way, Yaba', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' })).rejects.toThrow(/your own item/)
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
    await api.demoRunDraw(a.id)
    expect((await api.getListing(a.id)).cautionFee.status).toBe('held') // the other is still live
    await api.demoSellOut(b.id)
    await api.demoRunDraw(b.id)
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

  it('announces the winner later, and tells everyone who took part', async () => {
    let t = Date.parse('2026-11-01T12:00:00Z')
    const api = make(() => t)
    await api.auth.signInWithPassword('chidi@drawmart.test', 'drawmart-demo')
    const [draw] = (await api.listListings()).filter((l) => l.ticketCount - l.ticketsSold > 1 && l.buyerTicketPriceKobo <= k(5_000))
    await api.buyTickets(draw.id, 1)
    expect(await api.listNotifications()).toEqual([])

    await api.demoSellOut(draw.id)
    const soldOut = await api.getListing(draw.id)
    expect(soldOut.status).toBe('sold_out')
    expect(soldOut.result).toBeNull()
    expect(JSON.stringify(soldOut)).not.toMatch(/"seed"/)
    expect(Date.parse(soldOut.drawAt!)).toBe(Math.min(Date.parse(draw.closesAt), t + 7 * 86_400_000))
    await expect(api.buyTickets(draw.id, 1)).rejects.toMatchObject({ code: 'not_live' })
    const [first] = await api.listNotifications()
    expect(first).toMatchObject({ kind: 'draw_sold_out', listingId: draw.id, read: false, drawAt: soldOut.drawAt })

    // Other buyers hear nothing about a draw they're not in.
    await api.auth.signInWithPassword('ngozi@drawmart.test', 'drawmart-demo')
    expect(await api.listNotifications()).toEqual([])
    await api.auth.signInWithPassword('chidi@drawmart.test', 'drawmart-demo')

    // On the date, the draw runs by itself and can be verified.
    t = Date.parse(soldOut.drawAt!)
    const drawn = await api.getListing(draw.id)
    expect(drawn.status).toBe('drawn')
    expect(drawn.result?.seed).toBeTruthy()
    const v = await verifyDraw({ commitment: drawn.commitment, seed: drawn.result!.seed, closingRef: drawn.result!.closingRef, ticketCount: drawn.ticketCount, claimedWinner: drawn.result!.winningNumber })
    expect(v.valid).toBe(true)
    const notes = await api.listNotifications()
    expect(notes.map((n) => n.kind).sort()).toEqual([drawn.result!.iWon ? 'draw_won' : 'draw_lost', 'draw_sold_out'].sort())
    await api.markNotificationsRead()
    expect((await api.listNotifications()).every((n) => n.read)).toBe(true)
  })

  it('gives every product a permanent ID, shown wherever the product is', async () => {
    const api = make()
    const all = await api.listListings({ status: ['live', 'for_sale'] })
    expect(all.every((l) => isProductCode(l.productCode))).toBe(true)
    expect(new Set(all.map((l) => l.productCode)).size).toBe(all.length)

    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const created = await api.createProduct({ title: 'New lamp', description: 'A lamp', category: 'Home', priceKobo: k(20_000) })
    expect(isProductCode(created.productCode)).toBe(true)
    const [pending] = (await api.listMerchantListings()).filter((l) => l.id === created.id)
    expect(pending.productCode).toBe(created.productCode)
    await api.approveListing(created.id)
    expect((await api.getListing(created.id)).productCode).toBe(created.productCode) // approval keeps it

    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    await api.topUp(k(50_000))
    await api.sendFirstMessage(created.id, 'Still available?')
    expect((await api.listConversations())[0].productCode).toBe(created.productCode)
    const [order] = await api.checkout({ listingIds: [created.id], fulfilment: 'delivery', delivery: { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }, pickupPointId: null })
    expect(order.productCode).toBe(created.productCode)
    expect((await api.listMyOrders())[0].productCode).toBe(created.productCode)

    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    expect((await api.getMerchantMetrics(7)).listings.find((l) => l.listingId === created.id)?.productCode).toBe(created.productCode)
    expect((await api.listMerchantOrders()).find((o) => o.listingId === created.id)?.productCode).toBe(created.productCode)
  })

  it('keeps a win to celebrate until it has been shown, for that buyer only', async () => {
    const api = make()
    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    const [draw] = (await api.listListings()).filter((l) => l.title.includes('test draw'))
    await api.topUp(k(200_000))
    await api.buyTickets(draw.id, 2)
    await api.demoRunDraw(draw.id)
    const toCelebrate = async () => (await api.listNotifications()).filter((n) => n.kind === 'draw_won' && !n.celebrated)

    expect(await toCelebrate()).toMatchObject([{ listingId: draw.id, listingTitle: draw.title, listingImage: draw.images[0] ?? null, listingCategory: draw.category }])
    await api.markNotificationsRead()
    expect((await toCelebrate()).length).toBe(1) // reading the bell isn't the pop-up

    await api.auth.signInWithPassword('ngozi@drawmart.test', 'drawmart-demo')
    await api.markWinCelebrated(draw.id)
    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    expect((await toCelebrate()).length).toBe(1) // someone else can't clear it

    await api.markWinCelebrated(draw.id)
    expect(await toCelebrate()).toEqual([])
  })

  it('keeps a cart of items on sale and won draws, and checks them out together', async () => {
    const api = make()
    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    const onSale = await api.listListings({ status: ['for_sale'] })
    const cheap = onSale.filter((l) => l.kind === 'product' && l.priceKobo <= k(100_000) && l.category !== 'Cars')
    const car = onSale.find((l) => l.category === 'Cars')!
    const [draw] = (await api.listListings()).filter((l) => l.title.includes('test draw'))

    await expect(api.addToCart(car.id)).rejects.toThrow(/Cars don’t go in the cart/)
    await expect(api.addToCart(draw.id)).rejects.toThrow(/draws you’ve won/)

    await api.topUp(k(200_000))
    // Win the tiny draw: both tickets.
    await api.buyTickets(draw.id, 2)
    await api.demoRunDraw(draw.id)
    await api.addToCart(draw.id)
    await api.addToCart(cheap[0].id)
    await api.addToCart(cheap[0].id)
    const lines = await api.listCart()
    expect(lines.map((l) => l.amountKobo)).toEqual([0, cheap[0].priceKobo])

    const before = (await api.getWallet()).balance.cashKobo
    const orders = await api.checkout({ listingIds: lines.map((l) => l.listing.id), fulfilment: 'delivery', delivery, pickupPointId: null })
    expect(orders.map((o) => [o.isPrize, o.handledBy])).toEqual([[true, 'drawmart'], [false, 'store']])
    expect((await api.getWallet()).balance.cashKobo).toBe(before - cheap[0].priceKobo)
    expect(await api.listCart()).toEqual([])
    expect((await api.getListing(draw.id)).status).toBe('drawn')
    await expect(api.addToCart(draw.id)).rejects.toThrow(/already arranged/)

    // DrawMart sends the won item, not the store.
    await api.auth.signInWithPassword('yaba@drawmart.test', 'drawmart-demo')
    expect((await api.listMerchantOrders()).map((o) => o.listingId)).not.toContain(draw.id)
    await expect(api.dispatchOrder(orders[0].id)).rejects.toThrow(ApiError)
    await api.auth.signInWithPassword('admin@drawmart.test', 'drawmart-demo')
    expect((await api.listPrizeOrders()).map((o) => o.id)).toEqual([orders[0].id])
    await api.dispatchOrder(orders[0].id)
  })

  it('collects from a pickup location, but never a car', async () => {
    const api = make()
    await api.auth.signInWithPassword('emeka@drawmart.test', 'drawmart-demo')
    await api.topUp(k(500_000))
    await api.topUp(k(500_000))
    const onSale = await api.listListings({ status: ['for_sale'] })
    const item = onSale.find((l) => l.kind === 'product' && l.priceKobo <= k(100_000) && l.category !== 'Cars')!
    const noAddress = { address: '', location: null, contactPhone: '0803 123 4567' }
    expect((await api.listPickupPoints()).length).toBe(5)
    await expect(api.checkout({ listingIds: [item.id], fulfilment: 'pickup', delivery: noAddress, pickupPointId: null })).rejects.toThrow(/Choose a pickup location/)
    const [order] = await api.checkout({ listingIds: [item.id], fulfilment: 'pickup', delivery: noAddress, pickupPointId: 'yaba' })
    expect(order).toMatchObject({ fulfilment: 'pickup', pickupPoint: { name: 'DrawMart Yaba' } })
    const car = onSale.find((l) => l.category === 'Cars')!
    await expect(api.checkout({ listingIds: [car.id], fulfilment: 'pickup', delivery: noAddress, pickupPointId: 'yaba' })).rejects.toThrow(/stay with the dealer/)
  })

  it('saves profile details and delivery addresses, per buyer', async () => {
    const api = make()
    await api.auth.signInWithPassword('ngozi@drawmart.test', 'drawmart-demo')
    await expect(api.updateProfile({ phone: '123' })).rejects.toThrow(/Nigerian mobile/)
    expect(await api.updateProfile({ displayName: ' Ngozi B. ', phone: '0803 123 4567' })).toMatchObject({ displayName: 'Ngozi B.', phone: '0803 123 4567' })
    expect((await api.updateProfile({ phone: '' })).phone).toBeNull()

    const home = { label: 'Home', address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    await expect(api.saveAddress({ ...home, location: null })).rejects.toThrow(/Pin the exact spot/)
    const [first] = await api.saveAddress(home)
    expect(first.isDefault).toBe(true) // the first saved
    const two = await api.saveAddress({ ...home, label: 'Work' })
    expect(two.map((a) => [a.label, a.isDefault])).toEqual([['Home', true], ['Work', false]])
    const work = two[1]
    expect((await api.setDefaultAddress(work.id))[0].label).toBe('Work') // default first
    expect((await api.saveAddress({ ...home, id: first.id, label: 'Home 2' })).map((a) => a.label)).toEqual(['Work', 'Home 2'])
    await expect(api.saveAddress({ ...home, id: 'nope' })).rejects.toMatchObject({ code: 'not_found' })

    await api.auth.signInWithPassword('chidi@drawmart.test', 'drawmart-demo')
    expect(await api.listAddresses()).toEqual([])
    await api.auth.signInWithPassword('ngozi@drawmart.test', 'drawmart-demo')

    const left = await api.deleteAddress(work.id)
    expect(left.map((a) => [a.label, a.isDefault])).toEqual([['Home 2', true]]) // hands on the default

    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    await expect(api.saveAddress(home)).rejects.toMatchObject({ code: 'forbidden' })
  })
})
