import type { NewProductInput } from './types'
import { APOLOGY_CREDIT_KOBO, FAILURE_CHARGE_KOBO } from '@/domain/deliveryChecks'
import { returnFeeKobo, sellerShareOfReturnFee } from '@/domain/claims'
import { areaPairPrice, deliveryFeeKobo, placeholderPricing } from '@/domain/deliveryFees'
import { isProductCode } from '@/domain/productCode'
import { describe, expect, it } from 'vitest'
import { verifyDraw } from '@/domain/draw'
import { addDays, cautionFeeFor, localDate } from '@/domain/listing'
import { nairaToKobo as k } from '@/domain/money'
import type { Delivery } from '@/domain/types'
import { createMockApi, memoryStore } from './mock'
import { ApiError, type NewListingInput } from './types'

// Proof on stores' first listings and spot checks are off, except where a test turns them on.
const make = (now = () => Date.now(), listingChecks = { firstListings: 0, spotPercent: 0 }) => createMockApi({ store: memoryStore(), latencyMs: 0, now, listingChecks })

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
    expect(listings.length).toBe(100)
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
    await api.rejectListing(created.id, 'photos_unclear', '')
    expect((await api.listMerchantListings()).find((l) => l.id === created.id)?.cautionFee.status).toBe('kept')
  })

  it('shows the store why a listing was rejected, and takes it back to review when it’s fixed', async () => {
    const api = make()
    const created = await api.createListing(newListing())
    await expect(api.rejectListing(created.id, 'other', '')).rejects.toMatchObject({ code: 'invalid_input' })
    await api.rejectListing(created.id, 'photos_unclear', ' The cover is too dark. ')

    const rejected = (await api.listMerchantListings()).find((l) => l.id === created.id)!
    expect(rejected.rejection).toEqual({ reason: 'photos_unclear', note: 'The cover is too dark.' })
    expect(rejected.cautionFee.status).toBe('kept')

    const resent = await api.resubmitListing(created.id, { ...newListing(), title: 'Brighter photos' })
    expect(resent).toMatchObject({ id: created.id, productCode: created.productCode, title: 'Brighter photos', status: 'pending_review', rejection: null })
    expect(resent.cautionFee).toEqual({ amountKobo: created.cautionFee.amountKobo, status: 'held' })
    await expect(api.resubmitListing(created.id, newListing())).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('lets a store edit a listing in review, and refuses an approval of the old version', async () => {
    const api = make()
    const created = await api.createListing(newListing())
    const edited = await api.updateListing(created.id, { ...newListing(), title: 'Better title' })
    expect(edited).toMatchObject({ id: created.id, productCode: created.productCode, title: 'Better title', status: 'pending_review', revision: 1 })
    expect(edited.cautionFee.status).toBe('held')
    await expect(api.updateListing(created.id, { ...newListing(), title: ' ' })).rejects.toMatchObject({ code: 'invalid_input' })

    await expect(api.approveListing(created.id, 0)).rejects.toThrow('just changed')
    await api.approveListing(created.id, 1)
    await expect(api.updateListing(created.id, newListing())).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(api.withdrawListing(created.id)).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('refunds the caution fee on a withdrawal', async () => {
    const api = make()
    const created = await api.createListing(newListing())
    await api.withdrawListing(created.id)
    const mine = (await api.listMerchantListings()).find((l) => l.id === created.id)!
    expect(mine.status).toBe('withdrawn')
    expect(mine.cautionFee).toEqual({ amountKobo: created.cautionFee.amountKobo, status: 'refunded' })
    await expect(api.withdrawListing(created.id)).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('keeps the fee when a rejected listing is resent and then withdrawn', async () => {
    const api = make()
    const created = await api.createListing(newListing())
    await api.rejectListing(created.id, 'failed_escrow_check', '')
    await api.resubmitListing(created.id, newListing())
    await api.withdrawListing(created.id)
    expect((await api.listMerchantListings()).find((l) => l.id === created.id)?.cautionFee.status).toBe('kept')
  })

  it('locks a draw on its pickup day', async () => {
    let t = Date.now()
    const api = make(() => t)
    const created = await api.createListing(newListing())
    t += 15 * 86_400_000
    await expect(api.withdrawListing(created.id)).rejects.toThrow('pickup or inspection day')
    await expect(api.updateListing(created.id, newListing())).rejects.toThrow('pickup or inspection day')
  })

  it('checks a resent listing like a new one', async () => {
    const api = make()
    const created = await api.createListing(newListing())
    await api.rejectListing(created.id, 'price_wrong', '')
    await expect(api.resubmitListing(created.id, { ...newListing(), title: ' ' })).rejects.toMatchObject({ code: 'invalid_input' })
    expect((await api.listMerchantListings()).find((l) => l.id === created.id)?.status).toBe('rejected')
  })

  it('resends a regular product without a caution fee, and has no escrow reason for it', async () => {
    const api = make()
    const input = { title: 'Office chair', description: '', category: 'Home' as const, priceKobo: 5_000_000 }
    const created = await api.createProduct(input)
    await expect(api.rejectListing(created.id, 'failed_escrow_check', '')).rejects.toMatchObject({ code: 'invalid_input' })
    await api.rejectListing(created.id, 'price_wrong', '')
    const resent = await api.resubmitListing(created.id, { ...input, priceKobo: 4_000_000 })
    expect(resent).toMatchObject({ status: 'pending_review', priceKobo: 4_000_000, rejection: null })
    expect(resent.cautionFee.status).toBe('none')
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
    expect(order.deliveryFeeKobo).toBeGreaterThan(0)
    expect((await api.getWallet()).balance.cashKobo).toBe(before - k(20_000) - order.deliveryFeeKobo)
    expect((await api.getListing(p.id)).status).toBe('sold')
    await expect(buyNow(api, p.id, delivery)).rejects.toMatchObject({ code: 'not_for_sale' })

    expect((await api.listMerchantOrders()).map((o) => o.id)).toEqual([order.id])
    await expect(api.dispatchOrder(order.id)).rejects.toThrow('Confirm it with a photo')
    await api.sellerConfirmOrder(order.id, '/assets/confirm.jpg')
    await api.dispatchOrder(order.id)
    await expect(api.dispatchOrder(order.id)).rejects.toThrow(ApiError)
  })

  it('sells a product until its stock runs out, and shows it gone in other carts', async () => {
    const api = make()
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    const input = { title: 'Phone case', description: '', category: 'Phones' as const, priceKobo: k(2_000) }
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    await expect(api.createProduct({ ...input, stock: 0 })).rejects.toMatchObject({ code: 'invalid_input' })
    const p = await api.createProduct({ ...input, stock: 3 })
    expect(p.stock).toBe(3)
    expect((await api.updateListing(p.id, { ...input, stock: 2 })).stock).toBe(2)
    await api.approveListing(p.id, 1)

    await api.auth.signInWithPassword('chidi@drawmart.test', 'drawmart-demo')
    await api.topUp(k(10_000))
    await api.addToCart(p.id)
    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    await api.topUp(k(10_000))
    await buyNow(api, p.id, delivery)
    expect(await api.getListing(p.id)).toMatchObject({ stock: 1, status: 'for_sale' })
    await api.addToCart(p.id) // having bought one doesn't stop them buying another
    await buyNow(api, p.id, delivery)
    expect(await api.getListing(p.id)).toMatchObject({ stock: 0, status: 'sold' })
    expect((await api.listMyOrders()).filter((o) => o.listingId === p.id)).toHaveLength(2)
    await expect(buyNow(api, p.id, delivery)).rejects.toMatchObject({ code: 'not_for_sale' })

    await api.auth.signInWithPassword('chidi@drawmart.test', 'drawmart-demo')
    expect((await api.listCart()).find((c) => c.listing.id === p.id)?.listing.status).toBe('sold')
    await expect(buyNow(api, p.id, delivery)).rejects.toMatchObject({ code: 'not_for_sale' })
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    expect((await api.listPayouts()).filter((l) => l.listingId === p.id && l.kind === 'sale')).toHaveLength(2)
  })

  it('sells several at once as one order, with the fee and payout on the whole', async () => {
    const api = make()
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const p = await api.createProduct({ title: 'Case pack', description: '', category: 'Phones', priceKobo: k(2_000), stock: 5 })
    await api.approveListing(p.id)
    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    await api.topUp(k(20_000))
    const before = (await api.getWallet()).balance.cashKobo

    await expect(api.addToCart(p.id, 6)).rejects.toThrow('Only 5 left')
    await api.addToCart(p.id, 2)
    await api.addToCart(p.id, 4) // changes it, rather than adding a second line
    expect((await api.listCart()).find((c) => c.listing.id === p.id)).toMatchObject({ quantity: 4, wanted: 4, amountKobo: k(8_000) })
    await expect(api.checkout({ listingIds: [p.id], quantities: { [p.id]: 6 }, fulfilment: 'delivery', delivery, pickupPointId: null })).rejects.toThrow('Only 5 left')

    const [order] = await api.checkout({ listingIds: [p.id], quantities: { [p.id]: 3 }, fulfilment: 'delivery', delivery, pickupPointId: null })
    expect(order).toMatchObject({ quantity: 3, priceKobo: k(6_000) })
    expect((await api.getWallet()).balance.cashKobo).toBe(before - k(6_000) - order.deliveryFeeKobo)
    expect(await api.getListing(p.id)).toMatchObject({ stock: 2, status: 'for_sale' })

    await api.addToCart(p.id, 2)
    await api.auth.signInWithPassword('chidi@drawmart.test', 'drawmart-demo')
    await api.topUp(k(20_000))
    await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null })
    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    expect((await api.listCart()).find((c) => c.listing.id === p.id)).toMatchObject({ quantity: 1, wanted: 2, amountKobo: k(2_000) })

    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const lines = (await api.listPayouts()).filter((l) => l.listingId === p.id)
    expect(lines.map((l) => l.amountKobo)).toContain(order.priceKobo - order.feeKobo)
  })

  it('lets a seller pause, restock and reprice a product', async () => {
    const api = make()
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    const seller = () => api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const shopper = () => api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    await seller()
    const p = await api.createProduct({ title: 'Lamp', description: '', category: 'Home', priceKobo: k(10_000), stock: 2 })
    await expect(api.pauseListing(p.id)).rejects.toThrow('on sale')
    await expect(api.changeStock(p.id, 1)).rejects.toMatchObject({ code: 'invalid_input' })
    await api.approveListing(p.id)
    const browse = async () => (await api.listListings({ status: ['live', 'for_sale'] })).some((l) => l.id === p.id)

    // Paused: out of browse and not for sale, but still there.
    await api.pauseListing(p.id)
    expect(await browse()).toBe(false)
    await shopper()
    await api.topUp(k(100_000))
    expect((await api.getListing(p.id)).status).toBe('paused')
    await expect(buyNow(api, p.id, delivery)).rejects.toMatchObject({ code: 'not_for_sale' })
    await expect(api.pauseListing(p.id)).rejects.toThrow()
    await seller()
    await expect(api.pauseListing(p.id)).rejects.toThrow('on sale')
    await api.resumeListing(p.id)
    expect(await browse()).toBe(true)

    // A small change applies now, measured from the reviewed price, so small ones can't add up.
    expect(await api.changePrice(p.id, k(12_000))).toBe(false)
    expect((await api.getListing(p.id)).priceKobo).toBe(k(12_000))
    expect(await api.changePrice(p.id, k(12_500))).toBe(true)
    const pending = () => api.listMerchantListings().then((all) => all.find((l) => l.id === p.id)!)
    expect(await pending()).toMatchObject({ priceKobo: k(12_000), pendingPriceKobo: k(12_500), status: 'for_sale' })
    expect((await api.getListing(p.id)).pendingPriceKobo).toBeNull() // buyers don't see it

    // Admin: only the version they saw.
    await expect(api.reviewPriceChange(p.id, k(13_000), true)).rejects.toThrow('just changed')
    await api.reviewPriceChange(p.id, k(12_500), true)
    expect(await pending()).toMatchObject({ priceKobo: k(12_500), reviewedPriceKobo: k(12_500), pendingPriceKobo: null })
    await expect(api.reviewPriceChange(p.id, k(12_500), true)).rejects.toThrow('dealt with')
    await api.changePrice(p.id, k(20_000))
    await api.reviewPriceChange(p.id, k(20_000), false)
    expect(await pending()).toMatchObject({ priceKobo: k(12_500), pendingPriceKobo: null })
    expect((await api.listNotifications()).map((n) => n.kind)).toEqual(expect.arrayContaining(['store_price_approved', 'store_price_rejected']))

    // A price they haven't seen is never charged.
    await shopper()
    const details = { fulfilment: 'delivery' as const, delivery, pickupPointId: null }
    await expect(api.checkout({ listingIds: [p.id], expectedTotalKobo: k(10_000), ...details })).rejects.toThrow('price has just changed')
    const fee = deliveryFeeKobo(placeholderPricing(), 'ikeja', delivery.location, 'large')
    await expect(api.checkout({ listingIds: [p.id], expectedTotalKobo: k(12_500), ...details })).rejects.toThrow('price has just changed') // without delivery
    await api.checkout({ listingIds: [p.id], expectedTotalKobo: k(12_500) + fee, ...details })

    // Stock: removing the last sells it out, and restocking brings it back. A pause stays a pause.
    await seller()
    await expect(api.changeStock(p.id, -2)).rejects.toThrow('remove more')
    await api.changeStock(p.id, -1)
    expect(await pending()).toMatchObject({ stock: 0, status: 'sold' })
    await api.changeStock(p.id, 3)
    expect(await pending()).toMatchObject({ stock: 3, status: 'for_sale' })
    await api.pauseListing(p.id)
    await api.changeStock(p.id, -3)
    expect(await pending()).toMatchObject({ stock: 0, status: 'paused' })
    await api.resumeListing(p.id)
    expect((await pending()).status).toBe('sold')
    await api.auth.signInWithPassword('lekki@drawmart.test', 'drawmart-demo')
    await expect(api.changePrice(p.id, k(1_000))).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refunds a cancelled order the way it was paid, and tells the buyer why', async () => {
    const api = make()
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    const seller = () => api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const shopper = () => api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    await seller()
    const p = await api.createProduct({ title: 'Kettle', description: '', category: 'Home', priceKobo: k(5_000), stock: 4 })
    await api.approveListing(p.id)
    await shopper()
    await api.topUp(k(50_000))
    const start = (await api.getWallet()).balance
    const details = { fulfilment: 'delivery' as const, delivery, pickupPointId: null }
    const [order] = await api.checkout({ listingIds: [p.id], quantities: { [p.id]: 2 }, ...details })
    await expect(api.cancelOrder(order.id, 'out_of_stock', '')).rejects.toThrow() // a buyer can't cancel their own order

    await seller()
    await expect(api.cancelOrder(order.id, 'other', '')).rejects.toThrow('Say why')
    expect((await api.listPayouts()).some((l) => l.orderId === order.id)).toBe(true)
    await api.cancelOrder(order.id, 'cant_send', 'Shop closed this week')
    await expect(api.cancelOrder(order.id, 'cant_send', '')).rejects.toThrow('ready for a rider')
    expect((await api.listPayouts()).some((l) => l.orderId === order.id)).toBe(false)
    expect((await api.getListing(p.id)).stock).toBe(4) // it goes back
    expect((await api.getMerchantMetrics(7)).listings.find((l) => l.listingId === p.id)?.units ?? 0).toBe(0)

    await shopper()
    expect((await api.getWallet()).balance).toEqual(start)
    const [mine] = (await api.listMyOrders()).filter((o) => o.id === order.id)
    expect(mine).toMatchObject({ status: 'cancelled', cancelReason: 'cant_send', cancelNote: 'Shop closed this week', deliveryPin: null })
    expect((await api.listNotifications()).find((n) => n.listingId === p.id)?.kind).toBe('order_cancelled')

    // Out of stock takes the rest off sale, and a ready order can't be cancelled.
    const [second] = await api.checkout({ listingIds: [p.id], ...details })
    const [third] = await api.checkout({ listingIds: [p.id], ...details })
    await seller()
    await api.sellerConfirmOrder(second.id, '/assets/confirm.jpg')
    await api.dispatchOrder(second.id)
    await expect(api.cancelOrder(second.id, 'damaged', '')).rejects.toThrow('ready for a rider')
    await api.cancelOrder(third.id, 'out_of_stock', '')
    expect(await api.getListing(p.id)).toMatchObject({ stock: 0, status: 'sold' })
    await api.auth.signInWithPassword('admin@drawmart.test', 'drawmart-demo')
    const mineRate = (await api.listCancelRates()).find((r) => r.merchantId === order.merchantId)
    expect(mineRate?.cancelled).toBe(2)
  })

  it('charges one delivery fee per seller, and refunds it only when nothing’s left to deliver', async () => {
    const api = make()
    const pricing = placeholderPricing()
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    const product = (title: string, packageSize: 'small' | 'large') => api.createProduct({ title, description: '', category: 'Home', priceKobo: k(5_000), packageSize })
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const [small, large] = [await product('Small thing', 'small'), await product('Large thing', 'large')]
    for (const p of [small, large]) await api.approveListing(p.id)
    await api.auth.signInWithPassword('lekki@drawmart.test', 'drawmart-demo')
    const other = await product('Other seller', 'small')
    await api.approveListing(other.id)

    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    await api.topUp(k(100_000))
    const start = (await api.getWallet()).balance.cashKobo
    const details = { fulfilment: 'delivery' as const, delivery, pickupPointId: null }
    const orders = await api.checkout({ listingIds: [small.id, large.id, other.id], ...details })
    const fromIkeja = deliveryFeeKobo(pricing, 'ikeja', delivery.location, 'large')
    const fromLekki = deliveryFeeKobo(pricing, 'lekki', delivery.location, 'small')
    expect(orders.map((o) => o.deliveryFeeKobo).sort((a, b) => a - b)).toEqual([0, fromLekki, fromIkeja].sort((a, b) => a - b))
    const paid = start - (await api.getWallet()).balance.cashKobo
    expect(paid).toBe(k(15_000) + fromIkeja + fromLekki)

    // Cancelling the order holding the fee moves it to what's still coming.
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const fromStore = orders.filter((o) => o.merchantId === small.merchantId)
    const holder = fromStore.find((o) => o.deliveryFeeKobo > 0)!
    const rest = fromStore.find((o) => o.id !== holder.id)!
    await api.cancelOrder(holder.id, 'damaged', '')
    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    expect((await api.getWallet()).balance.cashKobo).toBe(start - paid + k(5_000))
    const mine = await api.listMyOrders()
    expect(mine.find((o) => o.id === holder.id)?.deliveryFeeKobo).toBe(0)
    expect(mine.find((o) => o.id === rest.id)?.deliveryFeeKobo).toBe(fromIkeja)

    // The last one brings the fee back too.
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    await api.cancelOrder(rest.id, 'damaged', '')
    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    expect((await api.getWallet()).balance.cashKobo).toBe(start - paid + k(10_000) + fromIkeja)
  })

  it('prices a pickup location, lets admins edit prices, and lets a seller set their area', async () => {
    const api = make()
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const p = await api.createProduct({ title: 'To collect', description: '', category: 'Phones', priceKobo: k(5_000) })
    await api.approveListing(p.id)
    await api.setShopDeliveryArea('yaba')
    await expect(api.setShopDeliveryArea('mars')).rejects.toThrow('Pick an area')
    await expect(api.setDeliveryPrice('yaba', 'lekki', k(999))).rejects.toThrow('₦1,000')
    await api.setDeliveryPrice('yaba', 'lekki', k(4_200))
    await expect(api.setDeliverySizeExtra('large', k(4_001))).rejects.toThrow('₦4,000')
    expect(areaPairPrice(await api.getDeliveryPricing(), 'lekki', 'yaba')).toBe(k(4_200))

    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    await api.topUp(k(50_000))
    const [order] = await api.checkout({ listingIds: [p.id], fulfilment: 'pickup', delivery: { address: '', location: null, contactPhone: '0803 123 4567' }, pickupPointId: 'lekki' })
    expect(order.deliveryFeeKobo).toBe(k(4_200)) // from Yaba to the Lekki pickup location, small
  })

  it('cancels and pauses if a seller doesn’t confirm in time, with a reminder first', async () => {
    let t = Date.parse('2026-11-02T10:00:00+01:00') // due at 10pm, Lagos time
    const api = make(() => t)
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    const details = { fulfilment: 'delivery' as const, delivery, pickupPointId: null }
    const seller = () => api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const shopper = () => api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    await seller()
    const p = await api.createProduct({ title: 'Quiet shop lamp', description: '', category: 'Home', priceKobo: k(5_000), stock: 2 })
    await api.approveListing(p.id)
    await shopper()
    await api.topUp(k(50_000))
    const start = (await api.getWallet()).balance.cashKobo
    const [late] = await api.checkout({ listingIds: [p.id], ...details })
    const [onTime] = await api.checkout({ listingIds: [p.id], ...details })
    expect(late.confirmBy).toBe(new Date(t + 12 * 3_600_000).toISOString())
    await expect(api.sellerConfirmOrder(late.id, '/assets/confirm.jpg')).rejects.toThrow() // not the buyer's to confirm

    await seller()
    await expect(api.sellerConfirmOrder(onTime.id, 'nonsense')).rejects.toThrow('Add a photo')
    await api.sellerConfirmOrder(onTime.id, '/assets/confirm.jpg')
    await api.dispatchOrder(onTime.id)
    const kinds = async () => (await api.listNotifications()).filter((n) => n.listingId === p.id).map((n) => n.kind)
    t += 9.5 * 3_600_000
    expect(await kinds()).toContain('store_order_confirm_soon')
    t += 1000
    expect((await kinds()).filter((x) => x === 'store_order_confirm_soon')).toHaveLength(1)

    t += 3 * 3_600_000
    expect(await kinds()).toContain('store_order_expired')
    expect((await api.getListing(p.id))).toMatchObject({ status: 'paused', stock: 1 })
    expect((await api.listMerchantOrders()).find((o) => o.id === onTime.id)).toMatchObject({ status: 'dispatched', confirmPhoto: '/assets/confirm.jpg' })
    await api.resumeListing(p.id)

    await shopper()
    expect((await api.listMyOrders()).find((o) => o.id === late.id)).toMatchObject({ status: 'cancelled', cancelReason: 'not_confirmed', deliveryPin: null })
    // Everything back but the confirmed order's item and the one delivery fee it still needs.
    expect((await api.getWallet()).balance.cashKobo).toBe(start - k(5_000) - onTime.deliveryFeeKobo)
  })

  describe('listing checks', () => {
    const video = () => new Blob(['v'], { type: 'video/webm' })
    const item = (over: Partial<NewProductInput> = {}): NewProductInput => ({ title: 'Checked chair', description: '', category: 'Home', priceKobo: k(50_000), ...over })

    it('needs a live video with the code from an individual, and shows it only to them and admins', async () => {
      const api = make()
      await api.auth.signInWithPassword('seller@drawmart.test', 'drawmart-demo')
      const plan = await api.getListingCheckPlan()
      expect(plan).toMatchObject({ videoRequired: true, individual: true, newSeller: { deliveries: 0 } })
      expect((await api.getListingCheckPlan()).code).toBe(plan.code)
      await expect(api.createProduct(item())).rejects.toThrow('Record a short video')
      await expect(api.createProduct(item({ check: { code: 'XXXX', video: video() } }))).rejects.toThrow('new code')
      const p = await api.createProduct(item({ check: { code: plan.code, video: video() } }))
      expect((await api.getListingCheckPlan()).code).not.toBe(plan.code)
      await api.auth.signInWithPassword('admin@drawmart.test', 'drawmart-demo')
      expect(await api.getListingCheck(p.id)).toMatchObject({ code: plan.code })
    })

    it('needs a serial on dearer phones, proof over ₦100,000, and keeps new sellers within limits', async () => {
      const api = make()
      await api.auth.signInWithPassword('seller@drawmart.test', 'drawmart-demo')
      const check = async (over = {}) => ({ code: (await api.getListingCheckPlan()).code, video: video(), ...over })
      await expect(api.createProduct(item({ category: 'Phones', check: await check() }))).rejects.toThrow('serial')
      await api.createProduct(item({ category: 'Phones', check: await check({ serial: '490154203237518' }) }))
      await expect(api.createProduct(item({ priceKobo: k(150_000), check: await check() }))).rejects.toThrow('proof you bought it')
      await expect(api.createProduct(item({ priceKobo: k(200_001), check: await check({ proof: 'data:image/png;base64,x' }) }))).rejects.toThrow('₦200,000')
      const live = (await api.getListingCheckPlan()).newSeller!.live
      for (let i = live; i < 5; i++) await api.createProduct(item({ title: `Chair ${i}`, check: await check() }))
      await expect(api.createProduct(item({ check: await check() }))).rejects.toThrow('5 items')
    })

    it('asks a store on its first listings, then on spot checks it can’t dodge', async () => {
      const first = make(undefined, { firstListings: 1000, spotPercent: 0 })
      await first.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
      expect((await first.getListingCheckPlan()).videoRequired).toBe(true)
      const spot = make(undefined, { firstListings: 0, spotPercent: 100 })
      await spot.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
      const p = await spot.getListingCheckPlan()
      expect(p).toMatchObject({ videoRequired: true, newSeller: null })
      await expect(spot.createProduct(item())).rejects.toThrow('Record a short video')
      await spot.createProduct(item({ check: { code: p.code, video: video() } }))
    })
  })

  describe('claims and returns', () => {
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    const as = (api: ReturnType<typeof make>, who: string) => api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')
    const PHOTOS = ['/assets/a.jpg']
    const clock = () => {
      const c = { t: Date.parse('2026-11-02T10:00:00+01:00') }
      return { c, api: make(() => c.t) }
    }
    /** A delivered ₦20,000 order. Leaves the buyer signed in. */
    const delivered = async (api: ReturnType<typeof make>, category: 'Home' | 'Cars' = 'Home') => {
      await as(api, 'store')
      const p = await api.createProduct({ title: 'Claim lamp', description: '', category, priceKobo: k(20_000), stock: 1 })
      await api.approveListing(p.id)
      await as(api, 'funke')
      await api.topUp(k(100_000))
      const start = (await api.getWallet()).balance
      const [order] = await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null })
      await as(api, 'store')
      await api.sellerConfirmOrder(order.id, '/assets/c.jpg')
      await api.dispatchOrder(order.id)
      await as(api, 'rider')
      await api.takeDelivery(order.id)
      await api.passCollection(order.id, PHOTOS)
      await api.confirmDelivery(order.id, order.deliveryPin!)
      await as(api, 'funke')
      return { p, order, start }
    }
    const saleLine = async (api: ReturnType<typeof make>, id: string) => (await api.listPayouts()).find((l) => l.orderId === id && l.kind === 'sale')

    it('returns a changed mind for a fee: refunded when the rider has it, back in stock, seller gets a share', async () => {
      const { c, api } = clock()
      const { p, order, start } = await delivered(api)
      const fee = returnFeeKobo(k(20_000), 1)
      expect(fee).toBe(k(6_000))
      await api.openClaim(order.id, { kind: 'change_of_mind', description: '', photos: [] })
      await expect(api.openClaim(order.id, { kind: 'change_of_mind', description: '', photos: [] })).rejects.toThrow('already')
      const paid = (await api.getWallet()).balance.cashKobo
      expect(paid).toBe(start.cashKobo - k(20_000) - order.deliveryFeeKobo) // not yet

      await as(api, 'store')
      c.t += 49 * 3_600_000
      expect((await saleLine(api, order.id))?.status).toBe('waiting') // held by the claim

      await as(api, 'rider')
      const pool = (await api.listReturnJobs())[0]
      expect(pool).toMatchObject({ mine: false, pickupFrom: null })
      await api.takeReturn(pool.id)
      expect((await api.listReturnJobs())[0].pickupFrom).toMatchObject({ address: delivery.address, contactPhone: delivery.contactPhone })
      await api.passReturnPickup(pool.id, PHOTOS)
      const going = (await api.listReturnJobs())[0]
      expect(going).toMatchObject({ status: 'returning', pickupFrom: null })
      expect(going.returnTo.address).toBeTruthy()
      await api.finishReturn(pool.id, '/assets/b.jpg')
      expect(await api.listReturnJobs()).toEqual([])

      await as(api, 'funke')
      expect((await api.getWallet()).balance.cashKobo).toBe(paid + k(20_000) - fee) // delivery isn't refunded
      await as(api, 'store')
      expect(await saleLine(api, order.id)).toBeUndefined()
      const trip = deliveryFeeKobo(placeholderPricing(), 'ikeja', delivery.location, 'large')
      expect((await api.listPayouts()).find((l) => l.orderId === order.id && l.kind === 'return_fee')?.amountKobo).toBe(sellerShareOfReturnFee(fee, trip))
      expect(await api.getListing(p.id)).toMatchObject({ stock: 1, status: 'for_sale' })
    })

    it('sends a fault to an admin, then refunds everything and charges the seller', async () => {
      const { api } = clock()
      const { order, start } = await delivered(api)
      await expect(api.openClaim(order.id, { kind: 'fault', description: 'short', photos: PHOTOS })).rejects.toThrow('few words')
      await api.openClaim(order.id, { kind: 'fault', description: 'The base is cracked', photos: PHOTOS })
      await as(api, 'admin')
      const [c] = await api.listOpenClaims()
      expect(c).toMatchObject({ kind: 'fault', description: 'The base is cracked', confirmPhoto: '/assets/c.jpg' })
      await api.reviewClaim(c.id, true, '')
      expect(await api.listOpenClaims()).toEqual([])
      await as(api, 'rider')
      await api.takeReturn(c.id)
      await api.passReturnPickup(c.id, PHOTOS)
      await as(api, 'funke')
      const after = (await api.getWallet()).balance
      expect(after.cashKobo).toBe(start.cashKobo)
      expect(after.creditKobo).toBe(start.creditKobo + APOLOGY_CREDIT_KOBO)
      await as(api, 'store')
      expect((await api.listPayouts()).find((l) => l.orderId === order.id)).toMatchObject({ kind: 'charge', amountKobo: -FAILURE_CHARGE_KOBO })
    })

    it('lets the seller’s payout go ahead if a claim is turned down, or the item isn’t as described', async () => {
      const { c, api } = clock()
      const { order } = await delivered(api)
      await api.openClaim(order.id, { kind: 'fault', description: 'The base is cracked', photos: PHOTOS })
      await as(api, 'admin')
      const [claim] = await api.listOpenClaims()
      await expect(api.reviewClaim(claim.id, false, '')).rejects.toThrow('Say why')
      await api.reviewClaim(claim.id, false, 'The photo shows no damage')
      c.t += 49 * 3_600_000
      await as(api, 'store')
      expect((await saleLine(api, order.id))?.status).toBe('due')

      const second = await delivered(api)
      const buyerBefore = (await api.getWallet()).balance.cashKobo
      await api.openClaim(second.order.id, { kind: 'change_of_mind', description: '', photos: [] })
      await as(api, 'rider')
      const [job] = await api.listReturnJobs()
      await api.takeReturn(job.id)
      await expect(api.failReturnPickup(job.id, 'no', [])).rejects.toThrow('Say what')
      await api.failReturnPickup(job.id, 'It’s been used', [])
      await as(api, 'funke')
      expect((await api.getWallet()).balance.cashKobo).toBe(buyerBefore)
      expect((await api.listMyOrders()).find((o) => o.id === second.order.id)?.claim).toMatchObject({ status: 'pickup_failed', reviewNote: 'It’s been used' })
    })

    it('closes after 48 hours, and isn’t for cars or other people’s orders', async () => {
      const { c, api } = clock()
      const { order } = await delivered(api)
      await as(api, 'chidi')
      await expect(api.openClaim(order.id, { kind: 'change_of_mind', description: '', photos: [] })).rejects.toMatchObject({ code: 'not_found' })
      await as(api, 'funke')
      c.t += 48 * 3_600_000
      await expect(api.openClaim(order.id, { kind: 'change_of_mind', description: '', photos: [] })).rejects.toThrow('48 hours')
      const car = await delivered(api, 'Cars')
      await expect(api.openClaim(car.order.id, { kind: 'change_of_mind', description: '', photos: [] })).rejects.toThrow('cars')
    })

    it('lets a seller contest a failure: the charge goes and it stops counting', async () => {
      const { api } = clock()
      await as(api, 'store')
      const p = await api.createProduct({ title: 'Contested', description: '', category: 'Home', priceKobo: k(20_000), stock: 2 })
      await api.approveListing(p.id)
      await as(api, 'funke')
      await api.topUp(k(100_000))
      const [order] = await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null })
      await as(api, 'store')
      await expect(api.contestFailure(order.id, 'It was the right item')).rejects.toThrow('7 days')
      await api.sellerConfirmOrder(order.id, '/assets/c.jpg')
      await api.dispatchOrder(order.id)
      await as(api, 'rider')
      await api.takeDelivery(order.id)
      await api.failCollection(order.id, ['no_item'], '', [])
      await as(api, 'store')
      await expect(api.contestFailure(order.id, 'short')).rejects.toThrow('10 to 500')
      await api.contestFailure(order.id, 'I had it ready, the rider never came')
      await as(api, 'admin')
      const [c] = await api.listOpenClaims()
      expect(c).toMatchObject({ kind: 'contest', cancelReason: 'failed_check' })
      await api.reviewClaim(c.id, true, '')
      await as(api, 'store')
      expect((await api.listPayouts()).filter((l) => l.orderId === order.id)).toEqual([])
    })
  })

  describe('rider job limits', () => {
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    const as = (api: ReturnType<typeof make>, who: string) => api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')

    it('alerts riders to new jobs in their areas, a few an hour, and reminds them about their own', async () => {
      const c = { t: Date.parse('2026-11-02T10:00:00+01:00') }
      const api = make(() => c.t)
      await as(api, 'store')
      const p = await api.createProduct({ title: 'Alert lamp', description: '', category: 'Home', priceKobo: k(5_000), stock: 9 })
      await api.approveListing(p.id)
      await as(api, 'funke')
      await api.topUp(k(100_000))
      const orders = []
      for (let i = 0; i < 8; i++) orders.push((await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null }))[0])
      const ids = orders.map((o) => o.id)
      const ready = async (id: string) => {
        await as(api, 'store')
        await api.sellerConfirmOrder(id, '/assets/c.jpg')
        await api.dispatchOrder(id)
        await as(api, 'rider')
      }
      const alerts = async (kind: string) => (await api.listNotifications()).filter((n) => n.kind === kind)

      await ready(ids[0])
      const [first] = await alerts('rider_new_job')
      expect(first).toMatchObject({ listingId: p.id, listingTitle: 'Alert lamp' })
      expect(first.area).toBeTruthy()

      // Somewhere else: nothing. Back to everywhere: alerts again, up to 4 an hour.
      await expect(api.setRiderAreas(['mars'])).rejects.toThrow('delivery areas')
      await api.setRiderAreas([first.area === 'lekki' ? 'ikeja' : 'lekki'])
      await ready(ids[1])
      expect(await alerts('rider_new_job')).toHaveLength(1)
      await api.setRiderAreas([])
      expect(await api.getRiderAreas()).toEqual([])
      for (const id of ids.slice(2, 6)) await ready(id)
      expect(await alerts('rider_new_job')).toHaveLength(4)
      c.t += 61 * 60_000
      await ready(ids[6])
      expect(await alerts('rider_new_job')).toHaveLength(5)

      // Switched off: no more, in the app either.
      await api.setPushPreference('riderNewJobs', false)
      await ready(ids[7])
      expect(await alerts('rider_new_job')).toHaveLength(5)

      // Its own jobs: half an hour before one goes back, then when it has.
      await api.takeDelivery(ids[0])
      c.t += 89 * 60_000
      expect(await alerts('rider_collect_soon')).toHaveLength(0)
      c.t += 60_000
      expect(await alerts('rider_collect_soon')).toHaveLength(1)
      c.t += 30 * 60_000
      expect(await alerts('rider_collect_soon')).toHaveLength(1)
      expect(await alerts('rider_job_released')).toHaveLength(1)

      // A PIN paused at the door: told when it can be tried again.
      await api.takeDelivery(ids[1])
      await api.passCollection(ids[1], ['/assets/a.jpg'])
      const wrong = orders[1].deliveryPin === '000000' ? '111111' : '000000'
      for (let i = 0; i < 5; i++) await api.confirmDelivery(ids[1], wrong)
      expect(await alerts('rider_pin_unlocked')).toHaveLength(0)
      c.t += 31 * 60_000
      expect(await alerts('rider_pin_unlocked')).toHaveLength(1)
    })

    it('holds at most 5 jobs, and sends ones not collected within 2 hours back to the pool', async () => {
      const c = { t: Date.parse('2026-11-02T10:00:00+01:00') }
      const api = make(() => c.t)
      await as(api, 'store')
      const p = await api.createProduct({ title: 'Many lamps', description: '', category: 'Home', priceKobo: k(5_000), stock: 6 })
      await api.approveListing(p.id)
      await as(api, 'funke')
      await api.topUp(k(100_000))
      const ids: string[] = []
      for (let i = 0; i < 6; i++) ids.push((await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null }))[0].id)
      await as(api, 'store')
      for (const id of ids) {
        await api.sellerConfirmOrder(id, '/assets/c.jpg')
        await api.dispatchOrder(id)
      }
      await as(api, 'rider')
      for (const id of ids.slice(0, 5)) await api.takeDelivery(id)
      await expect(api.takeDelivery(ids[5])).rejects.toThrow('5 jobs, the most')
      const job = async (id: string) => (await api.listDeliveryJobs()).find((j) => j.id === id)!
      expect((await job(ids[0])).collectBy).toBe(new Date(c.t + 2 * 3_600_000).toISOString())
      expect((await job(ids[5])).collectBy).toBeNull() // not theirs

      // Collected, it's theirs for as long as it takes.
      await api.passCollection(ids[0], ['/assets/a.jpg'])
      expect((await job(ids[0])).collectBy).toBeNull()
      c.t += 119 * 60_000
      expect((await job(ids[1])).mine).toBe(true)
      c.t += 60_000
      expect(await job(ids[0])).toMatchObject({ mine: true, collected: true })
      for (const id of ids.slice(1, 5)) expect(await job(id)).toMatchObject({ mine: false, collectBy: null })
      await api.takeDelivery(ids[5])
    })
  })

  describe('rider and door checks', () => {
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    const as = (api: ReturnType<typeof make>, who: string) => api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')
    /** An order with a rider on it. Leaves the rider signed in. */
    const riding = async (api: ReturnType<typeof make>, stock = 2) => {
      await as(api, 'store')
      const p = await api.createProduct({ title: 'Checked lamp', description: '', category: 'Home', priceKobo: k(10_000), stock })
      await api.approveListing(p.id)
      await as(api, 'funke')
      await api.topUp(k(100_000))
      const before = (await api.getWallet()).balance
      const [order] = await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null })
      await as(api, 'store')
      await api.sellerConfirmOrder(order.id, '/assets/confirm.jpg')
      await api.dispatchOrder(order.id)
      await as(api, 'rider')
      await api.takeDelivery(order.id)
      return { p, order, before }
    }

    it('refunds and credits the buyer, charges the seller, and hides the buyer when a check fails', async () => {
      const api = make()
      const { p, order, before } = await riding(api)
      const job = (await api.listDeliveryJobs()).find((j) => j.id === order.id)!
      expect(job.confirmPhoto).toBe('/assets/confirm.jpg')
      expect(job.dropOff).toBeNull()

      await expect(api.failCollection(order.id, [], '', ['/assets/check.jpg'])).rejects.toThrow('Pick')
      await expect(api.failCollection(order.id, ['damaged'], '', [])).rejects.toThrow('photos')
      await api.failCollection(order.id, ['damaged'], 'Cracked base', ['/assets/check.jpg'])
      expect((await api.listDeliveryJobs()).some((j) => j.id === order.id)).toBe(false)

      await as(api, 'funke')
      const after = (await api.getWallet()).balance
      expect(after.cashKobo).toBe(before.cashKobo)
      expect(after.creditKobo).toBe(before.creditKobo + APOLOGY_CREDIT_KOBO)
      expect((await api.listMyOrders()).find((o) => o.id === order.id)).toMatchObject({ status: 'cancelled', cancelReason: 'failed_check', collectionProblems: ['damaged'], deliveryPin: null })

      await as(api, 'store')
      const lines = (await api.listPayouts()).filter((l) => l.orderId === order.id)
      expect(lines.map((l) => [l.kind, l.status, l.amountKobo])).toEqual([['charge', 'due', -FAILURE_CHARGE_KOBO]])
      expect((await api.listNotifications()).map((n) => n.kind)).toContain('store_order_failed')
      expect((await api.getListing(p.id)).stock).toBe(1) // that one doesn't go back
    })

    it('lets the buyer refuse at the door with their PIN only, and sends it back', async () => {
      const api = make()
      const { order, before } = await riding(api)
      await api.passCollection(order.id, ['/assets/check.jpg'])
      const pin = order.deliveryPin!
      const wrong = pin === '000000' ? '111111' : '000000'
      await expect(api.refuseDelivery(order.id, '12', 'refused_wrong', '', '/assets/a.jpg')).rejects.toThrow('6-digit')
      await expect(api.refuseDelivery(order.id, pin, 'refused_wrong', '', 'nope')).rejects.toThrow('photos')
      expect(await api.refuseDelivery(order.id, wrong, 'refused_wrong', '', '/assets/a.jpg')).toEqual({ confirmed: false, attemptsLeft: 4, lockedUntil: null })
      expect((await api.refuseDelivery(order.id, pin, 'refused_damaged', 'Dented', '/assets/a.jpg')).confirmed).toBe(true)

      const job = (await api.listDeliveryJobs()).find((j) => j.id === order.id)!
      expect(job).toMatchObject({ returning: true, dropOff: null })
      await api.completeReturn(order.id, '/assets/b.jpg')
      expect((await api.listDeliveryJobs()).some((j) => j.id === order.id)).toBe(false)
      await expect(api.completeReturn(order.id, '/assets/b.jpg')).rejects.toThrow('taking back')

      await as(api, 'funke')
      const [mine] = (await api.listMyOrders()).filter((o) => o.id === order.id)
      expect(mine).toMatchObject({ cancelReason: 'refused_damaged', returnState: 'returned' })
      expect((await api.getWallet()).balance.cashKobo).toBe(before.cashKobo)
    })

    it('takes charges off the next payout, and won’t send a negative amount', async () => {
      const api = make()
      const { order } = await riding(api)
      await api.failCollection(order.id, ['no_item'], '', [])
      await as(api, 'admin')
      const group = (await api.listDuePayouts()).find((g) => g.lines.some((l) => l.orderId === order.id))!
      await expect(api.markPayoutsPaid(group.lines.filter((l) => l.kind === 'charge').map((l) => l.id), 'TRF-1')).rejects.toThrow('charges are more')
    })

    it('suspends after 3 failures in 30 days, until an admin lifts it', async () => {
      const api = make()
      let last = ''
      for (let i = 0; i < 3; i++) {
        const { p, order } = await riding(api)
        await api.failCollection(order.id, ['no_item'], '', [])
        last = p.id
      }
      await as(api, 'store')
      expect((await api.getMyMerchant()).suspendedAt).toBeTruthy()
      expect((await api.getListing(last)).status).toBe('paused')
      await expect(api.resumeListing(last)).rejects.toThrow('suspended')
      await expect(api.createProduct({ title: 'No', description: '', category: 'Home', priceKobo: k(1_000) })).rejects.toThrow('suspended')
      await as(api, 'admin')
      expect((await api.listCancelRates()).find((r) => r.suspended)?.failed).toBe(3)
      await api.liftSuspension((await api.listCancelRates()).find((r) => r.suspended)!.merchantId)
      await as(api, 'store')
      await api.resumeListing(last)
      expect((await api.getListing(last)).status).toBe('for_sale')
    })

    it('cancels if a confirmed order is never made ready', async () => {
      let t = Date.parse('2026-11-02T10:00:00+01:00')
      const api = make(() => t)
      await as(api, 'store')
      const p = await api.createProduct({ title: 'Never ready', description: '', category: 'Home', priceKobo: k(5_000), stock: 2 })
      await api.approveListing(p.id)
      await as(api, 'funke')
      await api.topUp(k(50_000))
      const [order] = await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null })
      await as(api, 'store')
      await api.sellerConfirmOrder(order.id, '/assets/a.jpg')
      t = Date.parse('2026-11-03T10:30:00+01:00')
      expect(await api.getListing(p.id)).toMatchObject({ status: 'paused', stock: 2 })
      expect((await api.listMerchantOrders()).find((o) => o.id === order.id)).toMatchObject({ status: 'cancelled', cancelReason: 'not_sent' })
    })
  })

  it('saves where riders collect from, sets the area from it, and only tells the rider on the way', async () => {
    const api = make()
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    await expect(api.saveShopPickup({ address: 'Ikeja', location: { lat: 9, lng: 7 }, contactPhone: '1' })).rejects.toThrow('full address')
    await api.saveShopPickup({ address: '12 Admiralty Way, Lekki Phase 1', location: { lat: 6.44, lng: 3.47 }, contactPhone: '0803 123 4567' })
    expect((await api.getShopPickup())?.address).toBe('12 Admiralty Way, Lekki Phase 1')
    expect((await api.getMyMerchant()).deliveryArea).toBe('lekki')
    const p = await api.createProduct({ title: 'Pickup lamp', description: '', category: 'Home', priceKobo: k(5_000) })
    await api.approveListing(p.id)
    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    await api.topUp(k(50_000))
    const [order] = await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null })
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    await api.sellerConfirmOrder(order.id, '/assets/a.jpg')
    await api.dispatchOrder(order.id)
    await api.auth.signInWithPassword('rider@drawmart.test', 'drawmart-demo')
    const job = async () => (await api.listDeliveryJobs()).find((j) => j.id === order.id)!
    expect((await job()).collectFrom.address).toBeUndefined()
    await api.takeDelivery(order.id)
    expect((await job()).collectFrom).toMatchObject({ address: '12 Admiralty Way, Lekki Phase 1', contactPhone: '0803 123 4567' })
    await api.passCollection(order.id, ['/assets/a.jpg'])
    expect((await job()).collectFrom.address).toBeUndefined()
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
    await api.sellerConfirmOrder(placed.id, '/assets/confirm.jpg')
    await api.dispatchOrder(placed.id)

    // In the pool: no buyer details until a rider takes it.
    await api.auth.signInWithPassword('rider@drawmart.test', 'drawmart-demo')
    const [waiting] = (await api.listDeliveryJobs()).filter((j) => j.id === placed.id)
    expect(waiting).toMatchObject({ mine: false, dropOff: null, productCode: p.productCode })
    expect(JSON.stringify(waiting)).not.toContain('Awolowo')
    await expect(api.confirmDelivery(placed.id, pin)).rejects.toThrow(/carrying/)

    await api.takeDelivery(placed.id)
    await expect(api.takeDelivery(placed.id)).rejects.toThrow(/Another rider/)
    // Taken, but no buyer details until it's passed the check, and no delivering it either.
    expect((await api.listDeliveryJobs()).find((j) => j.id === placed.id)).toMatchObject({ mine: true, collected: false, dropOff: null })
    await expect(api.confirmDelivery(placed.id, pin)).rejects.toThrow(/carrying/)
    await expect(api.passCollection(placed.id, [])).rejects.toThrow('photos')
    await api.passCollection(placed.id, ['/assets/check.jpg'])
    const [taken] = (await api.listDeliveryJobs()).filter((j) => j.id === placed.id)
    expect(taken).toMatchObject({ mine: true, dropOff: { buyerName: 'Funke Ade', address: delivery.address, location: delivery.location, contactPhone: delivery.contactPhone } })
    expect(JSON.stringify(taken)).not.toContain(pin)

    // Handed back, it's anyone's again, without the details.
    await api.releaseDelivery(placed.id)
    expect((await api.listDeliveryJobs()).find((j) => j.id === placed.id)).toMatchObject({ mine: false, dropOff: null })
    await api.takeDelivery(placed.id)
    await api.passCollection(placed.id, ['/assets/check.jpg'])

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
    const { code } = await api.getListingCheckPlan()
    const p = await api.createProduct({ title: 'PS5', description: '', category: 'Electronics', priceKobo: k(15_000), check: { code, video: new Blob(['v'], { type: 'video/webm' }) } })
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
    await api.rejectListing(d.id, 'photos_unclear', '')
    expect((await api.getListing(c.id)).cautionFee.status).toBe('kept')

    // A withdrawn item leaves the pickup, and the items left show the fee without it.
    const [e, f] = await api.createListingBatch({ items: pair, handover })
    await api.withdrawListing(f.id)
    expect((await api.getListing(e.id)).cautionFee).toEqual({ amountKobo: cautionFeeFor('Phones'), status: 'held' })
    expect((await api.listMerchantListings()).find((l) => l.id === f.id)).toMatchObject({
      status: 'withdrawn', pickupBatchId: null, cautionFee: { amountKobo: cautionFeeFor('Home') - cautionFeeFor('Phones'), status: 'refunded' },
    })

    // Fixed and resent: the shared fee goes back on hold, and a car still can't join.
    await expect(api.resubmitListing(d.id, { ...pair[1], category: 'Cars', handover })).rejects.toMatchObject({ code: 'invalid_input' })
    await api.resubmitListing(d.id, { ...pair[1], handover })
    expect((await api.getListing(c.id)).cautionFee.status).toBe('held')
    expect((await api.getListing(d.id)).cautionFee.status).toBe('held')
  })

  describe('payouts', () => {
    const sign = async (api: ReturnType<typeof make>, who: string) => {
      await api.auth.signOut()
      await api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')
    }

    it('keeps an account until it’s changed, and holds the change', async () => {
      let t = Date.now()
      const api = make(() => t)
      await sign(api, 'store')
      expect(await api.getPayoutAccount()).toBeNull()
      await expect(api.lookupBankAccount('044', '123')).rejects.toMatchObject({ code: 'invalid_input' })
      await expect(api.lookupBankAccount('044', '0001234567')).rejects.toThrow('couldn’t find')
      expect(await api.lookupBankAccount('044', '0123456789')).toEqual({ accountName: 'TEST ACCOUNT 6789' })

      await api.savePayoutAccount('044', '0123456789')
      const first = (await api.getPayoutAccount())!
      expect(first.accountName).toBe('TEST ACCOUNT 6789')
      expect(Date.parse(first.payableFrom)).toBeLessThanOrEqual(t)
      await api.savePayoutAccount('044', '0123456789') // the same one changes nothing
      expect((await api.listNotifications()).some((n) => n.kind === 'store_bank_changed')).toBe(false)

      await api.savePayoutAccount('058', '9876543210')
      expect(Date.parse((await api.getPayoutAccount())!.payableFrom)).toBe(t + 48 * 3_600_000)
      expect((await api.listNotifications()).filter((n) => n.kind === 'store_bank_changed')).toHaveLength(1)
    })

    it('only lets a seller add one', async () => {
      const api = make()
      await sign(api, 'funke')
      await expect(api.savePayoutAccount('044', '0123456789')).rejects.toMatchObject({ code: 'forbidden' })
    })

    it('follows a sale from waiting to paid, once, and tells the store', async () => {
      let t = Date.now()
      const api = make(() => t)
      const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
      await sign(api, 'store')
      const p = await api.createProduct({ title: 'Payout chair', description: '', category: 'Home', priceKobo: k(50_000) })
      await sign(api, 'admin')
      await api.approveListing(p.id)
      await sign(api, 'funke')
      await api.topUp(k(60_000))
      const placed = await buyNow(api, p.id, delivery)

      await sign(api, 'store')
      const line = async () => (await api.listPayouts()).find((l) => l.listingId === p.id)!
      expect(await line()).toMatchObject({ kind: 'sale', status: 'waiting', amountKobo: placed.priceKobo - placed.feeKobo, productCode: p.productCode, listingTitle: 'Payout chair' })
      await api.sellerConfirmOrder(placed.id, '/assets/confirm.jpg')
      await api.dispatchOrder(placed.id)

      await sign(api, 'rider')
      await api.takeDelivery(placed.id)
      await api.passCollection(placed.id, ['/assets/check.jpg'])
      await api.confirmDelivery(placed.id, placed.deliveryPin!)

      await sign(api, 'store')
      expect((await line()).status).toBe('waiting') // the claim window
      t += 48 * 3_600_000 + 1000
      expect((await line()).status).toBe('due')
      const { id } = await line()

      await sign(api, 'admin')
      const group = () => api.listDuePayouts().then((g) => g.find((x) => x.lines.some((l) => l.id === id)))
      expect((await group())?.account).toBeNull()
      await expect(api.markPayoutsPaid([id], 'TRF-1')).rejects.toThrow('bank account')

      await sign(api, 'store')
      await api.savePayoutAccount('044', '0123456789')
      await sign(api, 'admin')
      expect((await group())?.account?.accountName).toBe('TEST ACCOUNT 6789')
      await expect(api.markPayoutsPaid([id], ' ')).rejects.toThrow('reference')
      await api.markPayoutsPaid([id], ' TRF-1 ')
      expect(await group()).toBeUndefined()
      await expect(api.markPayoutsPaid([id], 'TRF-2')).rejects.toThrow('due')

      await sign(api, 'store')
      expect(await line()).toMatchObject({ status: 'paid', reference: 'TRF-1', paidTo: 'Access Bank •••• 6789' })
      expect((await api.listNotifications()).filter((n) => n.kind === 'store_payout_sent')).toHaveLength(1)
      await sign(api, 'lekki')
      expect((await api.listPayouts()).some((l) => l.id === id)).toBe(false)
    })

    it('won’t pay into a changed account until the hold is over', async () => {
      let t = Date.now()
      const api = make(() => t)
      await sign(api, 'store')
      await api.savePayoutAccount('044', '0123456789')
      const draw = await api.createListing(newListing())
      await api.withdrawListing(draw.id)
      const id = (await api.listPayouts()).find((l) => l.listingId === draw.id)!.id
      await api.savePayoutAccount('058', '9876543210')
      await sign(api, 'admin')
      await expect(api.markPayoutsPaid([id], 'TRF-1')).rejects.toThrow('on hold')
      t += 48 * 3_600_000 + 1000
      await api.markPayoutsPaid([id], 'TRF-1')
    })
  })

  const signInAs = async (api: ReturnType<typeof make>, who: string) => {
    await api.auth.signOut()
    await api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')
  }

  it('tells a store about its reviews, orders and messages, and only that store', async () => {
    const api = make()
    await signInAs(api, 'store')
    const a = await api.createListing(newListing())
    const b = await api.createListing(newListing())
    const product = await api.createProduct({ title: 'Office chair', description: '', category: 'Home', priceKobo: 5_000_000 })
        await signInAs(api, 'admin')
    await api.approveListing(a.id)
    await api.rejectListing(b.id, 'price_wrong', '')
    await api.approveListing(product.id)
    
    await signInAs(api, 'store')
    const kinds = (await api.listNotifications()).map((n) => n.kind)
    expect(kinds).toContain('store_listing_approved')
    expect(kinds).toContain('store_listing_rejected')
    expect((await api.listNotifications()).every((n) => !n.read)).toBe(true)
    await api.markNotificationsRead()
    expect((await api.listNotifications()).every((n) => n.read)).toBe(true)
    await api.setPushPreference('storeOrders', false)
    expect((await api.getPushPreferences()).storeOrders).toBe(false)
    
    await signInAs(api, 'lekki')
    expect((await api.listNotifications()).filter((n) => [a.id, b.id, product.id].includes(n.listingId))).toEqual([])
    
    await signInAs(api, 'buyer')
    expect((await api.listNotifications()).some((n) => n.kind.startsWith('store_'))).toBe(false)
    await api.sendFirstMessage(product.id, 'Is it still available?')
    await api.sendFirstMessage(product.id, 'And in black?')
    
    await signInAs(api, 'store')
    expect((await api.listNotifications()).filter((n) => n.kind === 'store_new_message')).toHaveLength(1)
  })

  it('reminds a store the morning before a pickup, and about a draw closing unsold', async () => {
    let t = Date.parse('2026-11-02T05:00:00Z') // 06:00 in Lagos
    const api = make(() => t)
    await signInAs(api, 'store')
    const pending = await api.createListing({ ...newListing(), handover: { ...newListing().handover, date: '2026-11-03' } })
    const reminders = async () => (await api.listNotifications()).filter((n) => n.kind === 'store_pickup_tomorrow' && n.listingId === pending.id)
    expect(await reminders()).toHaveLength(0)
    t = Date.parse('2026-11-02T08:00:00Z') // 09:00 in Lagos
    expect(await reminders()).toHaveLength(1)
    t += 3_600_000
    expect(await reminders()).toHaveLength(1)
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

  it('keeps each buyer’s saved items through signing out, and from everyone else', async () => {
    const store = memoryStore()
    const api = createMockApi({ store, latencyMs: 0 })
    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    const [draw, other] = await api.listListings()
    const [product] = await api.listListings({ status: ['for_sale'] })
    await api.saveListing(draw.id)
    await api.saveListing(product.id)
    await api.saveListing(product.id) // twice is still once
    expect(await api.listSavedIds()).toEqual([product.id, draw.id])
    expect((await api.listSavedListings()).map((l) => l.id)).toEqual([product.id, draw.id])

    await api.auth.signOut()
    await api.auth.signInWithPassword('buyer@drawmart.test', 'drawmart-demo')
    expect(await api.listSavedIds()).toEqual([])
    await api.saveListing(other.id)
    await api.auth.signOut()

    await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    expect(await api.listSavedIds()).toEqual([product.id, draw.id])
    await api.unsaveListing(draw.id)
    await api.unsaveListing(draw.id) // already gone is fine
    expect(await api.listSavedIds()).toEqual([product.id])
    await api.auth.signOut()

    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    await expect(api.saveListing(draw.id)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('shows everyone who took part how a draw went, once each', async () => {
    const api = make()
    await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
    const draw = await api.createListing(newListing({ title: 'Reveal draw', priceKobo: k(2_000), ticketPriceKobo: k(1_000) }))
    await api.auth.signOut()
    await api.auth.signInWithPassword('admin@drawmart.test', 'drawmart-demo')
    await api.approveListing(draw.id)
    for (const who of ['funke', 'ngozi']) {
      await api.auth.signOut()
      await api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')
      await api.buyTickets(draw.id, 1)
    }
    await api.demoRunDraw(draw.id)
    const results: string[] = []
    for (const who of ['funke', 'ngozi']) {
      await api.auth.signOut()
      await api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')
      const unseen = async () => (await api.listNotifications()).filter((n) => (n.kind === 'draw_won' || n.kind === 'draw_lost') && !n.celebrated)
      const [n] = await unseen()
      results.push(n.kind)
      expect(n.winningNumber).toBe((await api.getListing(draw.id)).result?.winningNumber)
      await api.markWinCelebrated(draw.id)
      expect(await unseen()).toEqual([])
    }
    expect(results.sort()).toEqual(['draw_lost', 'draw_won'])
  })

  describe('saved-item alerts', () => {
    const kinds = async (api: ReturnType<typeof make>) => (await api.listNotifications()).map((n) => n.kind).filter((k) => k.startsWith('saved_'))
    const signIn = async (api: ReturnType<typeof make>, who: string) => {
      await api.auth.signOut()
      await api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')
    }
    /** A new 10-ticket draw, where buying 9 carries it to 90% without selling out. Leaves buyer@ signed in. */
    const nearlyThere = async (api: ReturnType<typeof make>) => {
      await signIn(api, 'store')
      const near = await api.createListing(newListing({ title: 'Alert draw', priceKobo: k(10_000), ticketPriceKobo: k(1_000) }))
      await signIn(api, 'admin')
      await api.approveListing(near.id)
      await signIn(api, 'buyer')
      return { near: await api.getListing(near.id), need: 9 }
    }

    it('tells savers once when a draw passes 90%, and nobody else', async () => {
      const api = make()
      await api.auth.signInWithPassword('buyer@drawmart.test', 'drawmart-demo')
      const { near, need } = await nearlyThere(api)
      await api.saveListing(near.id)
      await signIn(api, 'funke')
      await api.buyTickets(near.id, need)
      expect(await kinds(api)).toEqual([])
      await signIn(api, 'buyer')
      expect(await kinds(api)).toEqual(['saved_almost_sold'])
      expect((await api.listNotifications())[0].listingId).toBe(near.id)
    })

    it('says nothing to someone with no weekly limit left for a ticket, or who’s turned it off', async () => {
      for (const quieten of [(api: ReturnType<typeof make>, near: { buyerTicketPriceKobo: number }) => api.setWeeklyLimit(near.buyerTicketPriceKobo - 100), (api: ReturnType<typeof make>) => api.setPushPreference('savedItems', false)]) {
        const api = make()
        await api.auth.signInWithPassword('buyer@drawmart.test', 'drawmart-demo')
        const { near, need } = await nearlyThere(api)
        await api.saveListing(near.id)
        await quieten(api, near)
        await signIn(api, 'funke')
        await api.buyTickets(near.id, need)
        await signIn(api, 'buyer')
        expect(await kinds(api)).toEqual([])
      }
    })

    it('warns once when a saved draw is within 24 hours of closing, and never more than three a day', async () => {
      let t = Date.now()
      const api = make(() => t)
      await api.auth.signInWithPassword('buyer@drawmart.test', 'drawmart-demo')
      const later = (await api.listListings()).filter((l) => Date.parse(l.closesAt) - t > 72 * 3600_000 && Date.parse(l.closesAt) - t < 96 * 3600_000).slice(0, 5)
      expect(later.length).toBe(5)
      for (const l of later) await api.saveListing(l.id)
      expect(await kinds(api)).toEqual([])
      t = Math.max(...later.map((l) => Date.parse(l.closesAt))) - 3600_000
      const notified = (await api.listNotifications()).filter((n) => n.kind === 'saved_closing_soon')
      expect(notified.length).toBeGreaterThan(0)
      expect(notified.length).toBeLessThanOrEqual(3)
      await api.listNotifications()
      expect(new Set((await api.listNotifications()).filter((n) => n.kind === 'saved_closing_soon').map((n) => n.listingId)).size).toBe(notified.length)
    })

    it('says when a draw that ended unsold goes on sale', async () => {
      let t = Date.now()
      const api = make(() => t)
      await api.auth.signInWithPassword('buyer@drawmart.test', 'drawmart-demo')
      const l = (await api.listListings()).find((x) => x.unsoldPolicy === 'convert_to_sale' && x.fallbackPriceKobo)!
      await api.saveListing(l.id)
      t = Date.parse(l.closesAt) + 1000
      expect(await kinds(api)).toContain('saved_back_on_sale')
    })

    it('tells savers when the same store lists an ended item again, and not for a different one', async () => {
      const api = make()
      await api.auth.signInWithPassword('store@drawmart.test', 'drawmart-demo')
      const input = newListing({ title: 'Relisted blender' })
      const first = await api.createListing(input)
      await signIn(api, 'admin')
      await api.approveListing(first.id)
      await signIn(api, 'buyer')
      await api.saveListing(first.id)
      await signIn(api, 'admin')
      await api.demoExpire(first.id)
      expect((await api.getListing(first.id)).status).toBe('refunded')
      await signIn(api, 'store')
      const second = await api.createListing(input)
      const other = await api.createListing(newListing({ title: 'Something else' }))
      await signIn(api, 'admin')
      await api.approveListing(other.id)
      await api.approveListing(second.id)
      await signIn(api, 'buyer')
      const alerts = (await api.listNotifications()).filter((n) => n.kind === 'saved_relisted')
      expect(alerts.map((n) => n.listingId)).toEqual([second.id])
    })
  })

  describe('push notifications', () => {
    const device = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }

    it('has everything on until a buyer turns something off, per buyer', async () => {
      const api = make()
      await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
      expect(await api.getPushPreferences()).toMatchObject({ wins: true, drawResults: true, orders: true, messages: true, savedItems: true, drawReveal: true })
      await api.setPushPreference('orders', false)
      expect(await api.getPushPreferences()).toMatchObject({ wins: true, drawResults: true, orders: false, messages: true, savedItems: true, drawReveal: true })
      await api.auth.signOut()
      await api.auth.signInWithPassword('buyer@drawmart.test', 'drawmart-demo')
      expect((await api.getPushPreferences()).orders).toBe(true)
    })

    it('only takes real push services, and not from admins', async () => {
      const api = make()
      await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
      await api.savePushSubscription(device)
      await api.savePushSubscription(device) // twice is fine
      await api.deletePushSubscription(device.endpoint)
      await api.deletePushSubscription(device.endpoint)
      await expect(api.savePushSubscription({ ...device, endpoint: 'https://evil.example/abc' })).rejects.toMatchObject({ code: 'invalid_input' })
      await expect(api.setPushPreference('nonsense' as 'wins', false)).rejects.toMatchObject({ code: 'invalid_input' })
      await api.auth.signOut()
      await api.auth.signInWithPassword('rider@drawmart.test', 'drawmart-demo')
      await api.savePushSubscription(device)
      await api.auth.signInWithPassword('admin@drawmart.test', 'drawmart-demo')
      await expect(api.savePushSubscription(device)).rejects.toMatchObject({ code: 'forbidden' })
    })

    it('says whether it’s set up', () => {
      expect(make().pushPublicKey).toBeNull()
      expect(createMockApi({ store: memoryStore(), latencyMs: 0, pushPublicKey: 'abc' }).pushPublicKey).toBe('abc')
    })
  })

  describe('winners wall', () => {
    /** Funke wins the 2-ticket test draw. */
    async function funkeWins() {
      const store = memoryStore()
      const api = createMockApi({ store, latencyMs: 0 })
      await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
      const draw = (await api.listListings()).find((l) => l.title.startsWith('JBL Go'))!
      await api.buyTickets(draw.id, 2)
      await api.demoRunDraw(draw.id)
      return { api, id: draw.id }
    }
    const asAdmin = async (api: Awaited<ReturnType<typeof funkeWins>>['api']) => {
      await api.auth.signOut()
      await api.auth.signInWithPassword('admin@drawmart.test', 'drawmart-demo')
    }
    const asFunke = async (api: Awaited<ReturnType<typeof funkeWins>>['api']) => {
      await api.auth.signOut()
      await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
    }
    const story = (listingId: string, patch = {}) => ({ listingId, firstName: 'Funke', consent: true, ...patch })

    it('shows nothing until the winner agrees and an admin approves, then first name only', async () => {
      const { api, id } = await funkeWins()
      expect(await api.listWinnersWall()).toEqual([])
      await api.shareWinnerStory(story(id))
      expect(await api.listWinnersWall()).toEqual([])
      expect((await api.listMyWinnerStories())[0]).toMatchObject({ listingId: id, status: 'pending' })

      await asAdmin(api)
      const [pending] = await api.listPendingWinnerStories()
      expect(JSON.stringify(pending)).not.toMatch(/userId|u-/)
      await api.reviewWinnerStory(pending.id, true)
      expect(await api.listPendingWinnerStories()).toEqual([])

      await api.auth.signOut()
      const [entry] = await api.listWinnersWall()
      expect(entry).toMatchObject({ firstName: 'Funke', listingId: id })
      expect(Object.keys(entry).sort()).toEqual(['category', 'drawnAt', 'firstName', 'id', 'listingId', 'listingImage', 'listingTitle', 'productCode', 'ticketCount', 'winningNumber'])
    })

    it('removes the story and its details when withdrawn, and keeps a record of the consent', async () => {
      // Sees what's written to storage, to check the name really goes.
      const base = memoryStore()
      let written = ''
      const api = createMockApi({ store: { ...base, setItem: (k, v) => ((written = v), base.setItem(k, v)) }, latencyMs: 0 })
      await api.auth.signInWithPassword('funke@drawmart.test', 'drawmart-demo')
      const draw = (await api.listListings()).find((l) => l.title.startsWith('JBL Go'))!
      await api.buyTickets(draw.id, 2)
      await api.demoRunDraw(draw.id)
      await api.shareWinnerStory(story(draw.id, { firstName: 'Funkeunique' }))
      expect(written).toContain('Funkeunique')
      await asAdmin(api)
      await api.reviewWinnerStory((await api.listPendingWinnerStories())[0].id, true)
      await asFunke(api)
      expect(await api.listWinnersWall()).toHaveLength(1)

      await api.withdrawWinnerStory(draw.id)
      await api.withdrawWinnerStory(draw.id) // twice is fine
      expect(await api.listWinnersWall()).toEqual([])
      expect(await api.listMyWinnerStories()).toEqual([])
      expect(written).not.toContain('Funkeunique')
      expect(written).toContain('"event":"withdrawn"')
    })

    it('goes back for review, and off the wall, if shared again', async () => {
      const { api, id } = await funkeWins()
      await api.shareWinnerStory(story(id))
      await asAdmin(api)
      await api.reviewWinnerStory((await api.listPendingWinnerStories())[0].id, true)
      await asFunke(api)
      await api.shareWinnerStory(story(id, { firstName: 'Funmi' }))
      expect(await api.listWinnersWall()).toEqual([])
      expect((await api.listMyWinnerStories())[0]).toMatchObject({ status: 'pending', firstName: 'Funmi' })
    })

    it('can be turned down, and sent again', async () => {
      const { api, id } = await funkeWins()
      await api.shareWinnerStory(story(id))
      await asAdmin(api)
      const [p] = await api.listPendingWinnerStories()
      await api.reviewWinnerStory(p.id, false)
      await expect(api.reviewWinnerStory(p.id, true)).rejects.toMatchObject({ code: 'invalid_input' })
      expect(await api.listWinnersWall()).toEqual([])
      await asFunke(api)
      expect((await api.listMyWinnerStories())[0].status).toBe('rejected')
    })

    it('is only for the winner, with valid details and consent', async () => {
      const { api, id } = await funkeWins()
      for (const bad of [{ firstName: 'Funke Adeyemi' }, { firstName: '08031234567' }, { consent: false }]) {
        await expect(api.shareWinnerStory(story(id, bad))).rejects.toMatchObject({ code: 'invalid_input' })
      }
      await api.auth.signOut()
      await api.auth.signInWithPassword('buyer@drawmart.test', 'drawmart-demo')
      await expect(api.shareWinnerStory(story(id))).rejects.toMatchObject({ code: 'forbidden' })
      await expect(api.listPendingWinnerStories()).rejects.toMatchObject({ code: 'forbidden' })
    })
  })

  it('won’t save a listing buyers can’t see', async () => {
    const api = make()
    const [pending] = await api.listPendingListings()
    await expect(api.saveListing(pending.id)).rejects.toMatchObject({ code: 'not_found' })
    expect(await api.listSavedIds()).toEqual([])
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
    expect(orders[0].deliveryFeeKobo).toBe(0) // the won item
    expect((await api.getWallet()).balance.cashKobo).toBe(before - cheap[0].priceKobo - orders[1].deliveryFeeKobo)
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

  describe('shop pages', () => {
    const profile = { about: 'Phones with warranty.', openingHours: 'Mon–Sat, 9am–6pm', shopNote: '', publicPhone: '', logoUrl: null, coverUrl: null, showCac: false }

    it('shows the profile and listings, and the CAC number only once the store chooses', async () => {
      const api = make()
      await signInAs(api, 'store')
      const mine = await api.getMyMerchant()
      expect(mine.cacNumber).not.toBe('')
      await api.updateShopProfile(profile)
      await api.auth.signOut()
      const shop = await api.getShop(mine.id)
      expect(shop).toMatchObject({ about: 'Phones with warranty.', openingHours: 'Mon–Sat, 9am–6pm', cacNumber: '' })
      expect((await api.listListings({ merchantId: mine.id })).every((l) => l.merchant.id === mine.id && l.merchant.cacNumber === '')).toBe(true)
      await expect(api.getMerchantCacNumber(mine.id)).rejects.toMatchObject({ code: 'forbidden' })

      await signInAs(api, 'store')
      await expect(api.updateShopProfile({ ...profile, publicPhone: '123' })).rejects.toMatchObject({ code: 'invalid_input' })
      await api.updateShopProfile({ ...profile, showCac: true })
      await api.auth.signOut()
      expect((await api.getShop(mine.id)).cacNumber).toBe(mine.cacNumber)
    })

    it('doesn’t let an individual seller show a CAC number', async () => {
      const api = make()
      await signInAs(api, 'seller')
      await expect(api.updateShopProfile({ ...profile, showCac: true })).rejects.toMatchObject({ code: 'invalid_input' })
    })
  })

  describe('reviews', () => {
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    const as = (api: ReturnType<typeof make>, who: string) => api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')
    const clock = () => {
      const c = { t: Date.parse('2026-11-02T10:00:00+01:00') }
      return { c, api: make(() => c.t) }
    }
    const IKEJA = 'm-ikeja'
    /** A delivered order from the Ikeja store. Leaves the buyer signed in. */
    const delivered = async (api: ReturnType<typeof make>, title = 'Review lamp') => {
      await as(api, 'store')
      const p = await api.createProduct({ title, description: '', category: 'Home', priceKobo: k(20_000), stock: 1 })
      await api.approveListing(p.id)
      await as(api, 'funke')
      await api.topUp(k(100_000))
      const [order] = await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null })
      await as(api, 'store')
      await api.sellerConfirmOrder(order.id, '/assets/c.jpg')
      await api.dispatchOrder(order.id)
      await as(api, 'rider')
      await api.takeDelivery(order.id)
      await api.passCollection(order.id, ['/assets/a.jpg'])
      await api.confirmDelivery(order.id, order.deliveryPin!)
      await as(api, 'funke')
      return { p, order }
    }
    const input = { rating: 4, sellerComment: 'Quick and friendly.', productComment: 'Works well.' }

    it('lets the buyer review once delivered, change it until the seller replies, and tells each side', async () => {
      const { api } = clock()
      const { p, order } = await delivered(api)
      await api.submitReview(order.id, input)
      expect((await api.listMyOrders()).find((o) => o.id === order.id)?.review).toMatchObject({ rating: 4, reply: null })
      await api.submitReview(order.id, { ...input, rating: 5 })

      await as(api, 'store')
      expect((await api.listNotifications()).some((n) => n.kind === 'store_new_review' && n.listingId === p.id)).toBe(true)
      const mine = await api.getShopReviews(IKEJA)
      expect(mine).toMatchObject({ count: 1, shown: false, average: 5 })
      await expect(api.replyToReview(mine.reviews[0].id, ' ')).rejects.toMatchObject({ code: 'invalid_input' })
      await api.replyToReview(mine.reviews[0].id, 'Thank you!')
      await expect(api.replyToReview(mine.reviews[0].id, 'Again')).rejects.toMatchObject({ code: 'invalid_input' })

      await as(api, 'funke')
      expect((await api.listNotifications()).some((n) => n.kind === 'review_reply')).toBe(true)
      await expect(api.submitReview(order.id, input)).rejects.toThrow('replied')

      await api.auth.signOut()
      expect(await api.getShopReviews(IKEJA)).toMatchObject({ count: 1, shown: false, average: null, reviews: [] })
    })

    it('refuses before delivery, after 30 days, and for another buyer’s order', async () => {
      const { c, api } = clock()
      await as(api, 'store')
      const p = await api.createProduct({ title: 'Early lamp', description: '', category: 'Home', priceKobo: k(20_000), stock: 1 })
      await api.approveListing(p.id)
      await as(api, 'funke')
      await api.topUp(k(100_000))
      const [early] = await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null })
      await expect(api.submitReview(early.id, input)).rejects.toThrow('once it’s delivered')

      const { order } = await delivered(api)
      await as(api, 'buyer')
      await expect(api.submitReview(order.id, input)).rejects.toMatchObject({ code: 'not_found' })
      await as(api, 'funke')
      await expect(api.submitReview(order.id, { ...input, rating: 0 })).rejects.toMatchObject({ code: 'invalid_input' })
      c.t += 31 * 86_400_000
      await expect(api.submitReview(order.id, input)).rejects.toThrow('30 days')
    })

    it('shows a shop’s rating from 5 reviews, first names only, and admins can hide one', async () => {
      const { api } = clock()
      const orders = []
      for (const [i, rating] of [5, 4, 4, 4, 5].entries()) {
        const { order } = await delivered(api, `Lamp ${i}`)
        await api.submitReview(order.id, { ...input, rating })
        orders.push(order)
      }
      await api.auth.signOut()
      const pub = await api.getShopReviews(IKEJA)
      expect(pub).toMatchObject({ count: 5, shown: true, average: 4.4, breakdown: [2, 3, 0, 0, 0] })
      expect(pub.reviews.map((r) => r.name)).toEqual(Array(5).fill('Funke'))
      expect(JSON.stringify(pub)).not.toContain('u-funke')
      expect((await api.getShopReviews(IKEJA, orders[0].listingId)).reviews).toHaveLength(1)

      await as(api, 'admin')
      const id = (await api.listAdminReviews())[0].id
      await expect(api.setReviewHidden(id, true, '')).rejects.toMatchObject({ code: 'invalid_input' })
      await api.setReviewHidden(id, true, 'Abusive')
      await api.auth.signOut()
      expect(await api.getShopReviews(IKEJA)).toMatchObject({ count: 4, shown: false, reviews: [] })
      await as(api, 'store')
      expect((await api.getShopReviews(IKEJA)).reviews.filter((r) => r.hidden)).toHaveLength(1)
      await as(api, 'funke')
      await expect(api.listAdminReviews()).rejects.toMatchObject({ code: 'forbidden' })
    }, 20_000)
  })

  describe('store applications', () => {
    const as = (api: ReturnType<typeof make>, who: string) => api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')
    const input = {
      businessName: 'Emeka Electronics Ltd', cacNumber: 'rc-7654321', directorName: 'Emeka Nwosu', phone: '0803 123 4567',
      address: '4 Allen Avenue, Ikeja', area: 'Ikeja', certificatePhoto: 'data:image/jpeg;base64,c', directorIdPhoto: 'data:image/jpeg;base64,d',
    }

    it('turns a fresh account into a store once an admin approves', async () => {
      const api = make()
      await as(api, 'emeka')
      const sent = await api.submitStoreApplication(input)
      expect(sent).toMatchObject({ status: 'pending', cacNumber: 'RC 7654321' })
      await expect(api.submitStoreApplication(input)).rejects.toThrow('already being reviewed')
      await expect(api.approveStoreApplication(sent.id)).rejects.toMatchObject({ code: 'forbidden' })

      await as(api, 'admin')
      expect((await api.listStoreApplications()).map((a) => a.id)).toEqual([sent.id])
      await api.approveStoreApplication(sent.id)
      expect(await api.listStoreApplications()).toEqual([])

      await as(api, 'emeka')
      const session = await api.auth.getSession()
      expect(session?.role).toBe('store')
      expect(await api.getMyMerchant()).toMatchObject({ kind: 'store', name: 'Emeka Electronics Ltd', cacNumber: 'RC 7654321', verified: true })
      expect((await api.listNotifications()).map((n) => n.kind)).toContain('store_approved')
    })

    it('needs an account that hasn’t bought or sold, and a CAC number not already in use', async () => {
      const api = make()
      await as(api, 'buyer')
      const draw = (await api.listListings()).find((l) => l.kind === 'raffle' && l.status === 'live')!
      await api.buyTickets(draw.id, 1)
      await expect(api.submitStoreApplication(input)).rejects.toThrow('already bought')
      await as(api, 'seller')
      await expect(api.submitStoreApplication(input)).rejects.toThrow('individual')
      await as(api, 'ngozi')
      await expect(api.submitStoreApplication({ ...input, cacNumber: '123' })).rejects.toMatchObject({ code: 'invalid_input' })

      await as(api, 'emeka')
      const first = await api.submitStoreApplication(input)
      await as(api, 'admin')
      await api.approveStoreApplication(first.id)
      await as(api, 'ngozi')
      await expect(api.submitStoreApplication(input)).rejects.toThrow('already on DrawMart')
    })

    it('sends one back with a reason, and takes it again', async () => {
      const api = make()
      await as(api, 'emeka')
      const sent = await api.submitStoreApplication(input)
      await as(api, 'admin')
      await expect(api.rejectStoreApplication(sent.id, 'no')).rejects.toMatchObject({ code: 'invalid_input' })
      await api.rejectStoreApplication(sent.id, 'The certificate photo is cut off.')
      await as(api, 'emeka')
      expect(await api.getMyStoreApplication()).toMatchObject({ status: 'rejected', reviewNote: 'The certificate photo is cut off.' })
      expect(await api.submitStoreApplication(input)).toMatchObject({ id: sent.id, status: 'pending', reviewNote: null })
    })
  })

  describe('seller support', () => {
    const as = (api: ReturnType<typeof make>, who: string) => api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')

    it('lets a shop write to DrawMart and admins answer, with unread counts on both sides', async () => {
      const api = make()
      await as(api, 'store')
      expect(await api.getSupportThread()).toEqual({ messages: [], unread: 0 })
      await expect(api.sendSupportMessage('  ')).rejects.toMatchObject({ code: 'invalid_input' })
      await api.sendSupportMessage('When will my payout arrive?')
      await expect(api.listSupportThreads()).rejects.toMatchObject({ code: 'forbidden' })

      await as(api, 'admin')
      const [t] = await api.listSupportThreads()
      expect(t).toMatchObject({ merchantId: 'm-ikeja', unread: 1, resolved: false, lastSender: 'shop' })
      await api.markSupportRead(t.merchantId)
      await api.replySupport(t.merchantId, 'It’s due 48 hours after delivery.')
      await api.setSupportResolved(t.merchantId, true)
      expect((await api.listSupportThreads())[0]).toMatchObject({ unread: 0, resolved: true, lastSender: 'drawmart' })

      await as(api, 'store')
      const mine = await api.getSupportThread()
      expect(mine.unread).toBe(1)
      expect(mine.messages.map((m) => m.sender)).toEqual(['shop', 'drawmart'])
      expect((await api.listNotifications()).some((n) => n.kind === 'store_support_reply')).toBe(true)
      await api.markSupportRead()
      expect((await api.getSupportThread()).unread).toBe(0)
      await api.sendSupportMessage('Thanks!')

      await as(api, 'admin')
      expect((await api.listSupportThreads())[0]).toMatchObject({ unread: 1, resolved: false })
    })

    it('is for shops only', async () => {
      const api = make()
      await as(api, 'buyer')
      await expect(api.sendSupportMessage('Hello')).rejects.toMatchObject({ code: 'forbidden' })
      await as(api, 'seller')
      await api.sendSupportMessage('How do I add a video?')
      expect((await api.getSupportThread()).messages).toHaveLength(1)
    })
  })

  describe('quick replies', () => {
    const as = (api: ReturnType<typeof make>, who: string) => api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')

    it('keeps each shop’s own list, up to 20', async () => {
      const api = make()
      await as(api, 'store')
      await api.saveQuickReply({ body: '  Yes, it’s available.  ' })
      const [r] = await api.listQuickReplies()
      expect(r.body).toBe('Yes, it’s available.')
      await api.saveQuickReply({ id: r.id, body: 'Yes, still available.' })
      expect((await api.listQuickReplies()).map((x) => x.body)).toEqual(['Yes, still available.'])
      await expect(api.saveQuickReply({ body: ' ' })).rejects.toMatchObject({ code: 'invalid_input' })
      for (let n = 1; n < 20; n++) await api.saveQuickReply({ body: `Reply ${n}` })
      await expect(api.saveQuickReply({ body: 'One too many' })).rejects.toThrow('Delete one')
      await api.saveQuickReply({ id: r.id, body: 'Changing one still works at the limit' })

      await as(api, 'lekki')
      expect(await api.listQuickReplies()).toEqual([])
      await expect(api.deleteQuickReply(r.id)).rejects.toMatchObject({ code: 'not_found' })
      await as(api, 'buyer')
      await expect(api.saveQuickReply({ body: 'Hi' })).rejects.toMatchObject({ code: 'forbidden' })

      await as(api, 'store')
      await api.deleteQuickReply(r.id)
      expect(await api.listQuickReplies()).toHaveLength(19)
    })
  })

  describe('draw pricing tips', () => {
    const as = (api: ReturnType<typeof make>, who: string) => api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')

    it('is for stores, and says nothing without enough finished draws', async () => {
      const api = make()
      await as(api, 'buyer')
      await expect(api.getDrawPriceStats('Phones', 3)).rejects.toMatchObject({ code: 'forbidden' })
      await as(api, 'store')
      expect(await api.getDrawPriceStats('Phones', 3)).toEqual({ category: 'Phones', band: 3, draws: null, soldOut: null, avgDaysToSellOut: null })
    })

    it('records when a draw goes on sale', async () => {
      const api = make()
      await as(api, 'store')
      const l = await api.createListing(newListing())
      await as(api, 'admin')
      await api.approveListing(l.id)
      expect((await api.getListing(l.id))?.liveAt).toBeTruthy()
    })
  })

  describe('discounts', () => {
    const delivery = { address: '15 Awolowo Road, Ikoyi', location: { lat: 6.45, lng: 3.43 }, contactPhone: '0803 123 4567' }
    const as = (api: ReturnType<typeof make>, who: string) => api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')
    const week = (from = Date.now()) => ({ startsAt: new Date(from - 60_000).toISOString(), endsAt: new Date(from + 7 * 86_400_000).toISOString() })
    const product = async (api: ReturnType<typeof make>, priceKobo = k(20_000)) => {
      await as(api, 'store')
      const p = await api.createProduct({ title: 'Discount lamp', description: '', category: 'Home', priceKobo, stock: 5 })
      await api.approveListing(p.id)
      return p
    }

    it('puts products on sale: the buyer pays less, and the fee is on what they paid', async () => {
      const api = make()
      const p = await product(api)
      await api.createDiscount({ kind: 'sale', percentOff: 10, amountOffKobo: null, code: '', maxUses: null, listingIds: [p.id], ...week() })
      const [d] = await api.listDiscounts()
      expect(d).toMatchObject({ kind: 'sale', percentOff: 10, listingIds: [p.id] })

      await as(api, 'funke')
      expect(await api.listDiscounts()).toEqual([])
      expect((await api.getListing(p.id)).sale).toMatchObject({ priceKobo: k(18_000), percentOff: 10 })
      await api.topUp(k(100_000))
      const [order] = await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null, quantities: { [p.id]: 2 } })
      expect(order).toMatchObject({ priceKobo: k(36_000), discountKobo: k(4_000) })
      const listing = await api.getListing(p.id)
      expect(order.feeKobo).toBe(Math.round((k(36_000) * listing.feeBps) / 10_000))

      await as(api, 'store')
      await api.endDiscount(d.id)
      await expect(api.endDiscount(d.id)).rejects.toMatchObject({ code: 'not_found' })
      expect((await api.getListing(p.id)).sale).toBeNull()
    })

    it('never discounts draws, and checks what the store sets', async () => {
      const api = make()
      const p = await product(api)
      const draw = (await api.listMerchantListings()).find((l) => l.kind === 'raffle')!
      await expect(api.createDiscount({ kind: 'sale', percentOff: 10, amountOffKobo: null, code: '', maxUses: null, listingIds: [draw.id], ...week() })).rejects.toThrow('never draws')
      await expect(api.createDiscount({ kind: 'sale', percentOff: 95, amountOffKobo: null, code: '', maxUses: null, listingIds: [p.id], ...week() })).rejects.toMatchObject({ code: 'invalid_input' })
      await expect(api.createDiscount({ kind: 'sale', percentOff: null, amountOffKobo: k(19_950), code: '', maxUses: null, listingIds: [p.id], ...week() })).rejects.toMatchObject({ code: 'invalid_input' })
      await as(api, 'lekki')
      await expect(api.createDiscount({ kind: 'sale', percentOff: 10, amountOffKobo: null, code: '', maxUses: null, listingIds: [p.id], ...week() })).rejects.toThrow('your own products')
    })

    it('takes a code once per buyer, up to its limit, and gives the better of code and sale', async () => {
      const api = make()
      const p = await product(api)
      await api.createDiscount({ kind: 'sale', percentOff: 5, amountOffKobo: null, code: '', maxUses: null, listingIds: [p.id], ...week() })
      await api.createDiscount({ kind: 'code', percentOff: null, amountOffKobo: k(3_000), code: 'save3k', maxUses: 2, listingIds: [p.id], ...week() })
      await expect(api.createDiscount({ kind: 'code', percentOff: 10, amountOffKobo: null, code: 'SAVE3K', maxUses: null, listingIds: [p.id], ...week() })).rejects.toThrow('taken')

      await as(api, 'funke')
      await expect(api.checkDiscountCode('NOPE', [p.id])).rejects.toThrow('isn’t valid')
      expect(await api.checkDiscountCode(' save3k ', [p.id])).toEqual({ code: 'SAVE3K', prices: { [p.id]: k(17_000) } })
      await api.topUp(k(100_000))
      const [order] = await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null, code: 'SAVE3K' })
      expect(order).toMatchObject({ priceKobo: k(17_000), discountKobo: k(3_000) })
      await expect(api.checkDiscountCode('SAVE3K', [p.id])).rejects.toThrow('already used')

      await as(api, 'emeka')
      await api.topUp(k(100_000))
      await api.checkout({ listingIds: [p.id], fulfilment: 'delivery', delivery, pickupPointId: null, code: 'SAVE3K' })
      await as(api, 'ngozi')
      await expect(api.checkDiscountCode('SAVE3K', [p.id])).rejects.toThrow('used up')
      expect((await api.getListing(p.id)).sale?.priceKobo).toBe(k(19_000)) // the sale still runs
    })
  })

  describe('bulk upload', () => {
    const as = (api: ReturnType<typeof make>, who: string) => api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')
    const item = (n: number, over: Partial<NewProductInput> = {}): NewProductInput => ({
      title: `Bulk fan ${n}`, description: '', category: 'Home', priceKobo: k(25_000), stock: 3, images: ['/assets/fan.jpg'], check: { code: '', serial: '' }, ...over,
    })

    it('puts every row into review, or none if one is wrong', async () => {
      const api = make()
      await as(api, 'store')
      const before = (await api.listMerchantListings()).length
      await expect(api.createProductsBulk([item(1), item(2), item(3, { priceKobo: k(50) })])).rejects.toThrow('Row 4')
      expect((await api.listMerchantListings()).length).toBe(before)
      const out = await api.createProductsBulk(Array.from({ length: 50 }, (_, n) => item(n)))
      expect(out).toEqual({ created: 50, checkTitles: [] })
      const added = (await api.listMerchantListings()).filter((l) => l.title.startsWith('Bulk fan'))
      expect(added).toHaveLength(50)
      expect(added.every((l) => l.status === 'pending_review' && l.kind === 'product' && l.images.length === 1)).toBe(true)
    })

    it('is for stores only', async () => {
      const api = make()
      await as(api, 'seller')
      await expect(api.createProductsBulk([item(1)])).rejects.toMatchObject({ code: 'forbidden' })
    })

    it('holds back spot-checked rows, and the next listing needs a video', async () => {
      const api = make(undefined, { firstListings: 0, spotPercent: 100 })
      await as(api, 'store')
      expect(await api.createProductsBulk([item(1), item(2)])).toEqual({ created: 0, checkTitles: ['Bulk fan 1', 'Bulk fan 2'] })
      await expect(api.createProductsBulk([item(3)])).rejects.toThrow('needs a short video')
      const plan = await api.getListingCheckPlan()
      expect(plan.videoRequired).toBe(true)
      await expect(api.createProduct(item(1))).rejects.toThrow('Record a short video')
      await api.createProduct(item(1, { check: { code: plan.code, video: new Blob(['v'], { type: 'video/webm' }) } }))
      await api.createProduct(item(2, { check: { code: (await api.getListingCheckPlan()).code, video: new Blob(['v'], { type: 'video/webm' }) } }))
    })
  })

  describe('store teams', () => {
    const as = (api: ReturnType<typeof make>, who: string) => api.auth.signInWithPassword(`${who}@drawmart.test`, 'drawmart-demo')
    const product = (title: string): NewProductInput => ({ title, description: '', category: 'Home', priceKobo: k(20_000), stock: 2, check: { code: '', serial: '' } })

    it('invites staff with a role, and each role does its own work', async () => {
      const api = make()
      await as(api, 'store')
      expect(await api.getMyStoreRole()).toBe('owner')
      await expect(api.inviteStoreMember('nope', 'manager')).rejects.toMatchObject({ code: 'invalid_input' })
      await api.inviteStoreMember('Ngozi@drawmart.test', 'manager')
      await api.inviteStoreMember('emeka@drawmart.test', 'orders')
      await expect(api.inviteStoreMember('store@drawmart.test', 'orders')).rejects.toThrow('already on your team')
      expect((await api.getStoreTeam()).invites.map((x) => [x.email, x.role])).toEqual([['ngozi@drawmart.test', 'manager'], ['emeka@drawmart.test', 'orders']])

      await as(api, 'ngozi')
      const [invite] = await api.listMyStoreInvites()
      expect(invite).toMatchObject({ storeName: 'Ikeja Partner Store', role: 'manager' })
      await api.acceptStoreInvite(invite.id)
      await as(api, 'ngozi')
      expect((await api.auth.getSession())?.role).toBe('store')
      expect(await api.getMyStoreRole()).toBe('manager')
      await api.createProduct(product('Team lamp'))
      expect((await api.listPayouts()).length).toBeGreaterThanOrEqual(0)
      await expect(api.getPayoutAccount()).rejects.toMatchObject({ code: 'forbidden' })
      await expect(api.getStoreTeam()).rejects.toMatchObject({ code: 'forbidden' })

      await as(api, 'emeka')
      await api.acceptStoreInvite((await api.listMyStoreInvites())[0].id)
      await as(api, 'emeka')
      expect(await api.getMyStoreRole()).toBe('orders')
      await expect(api.createProduct(product('Not allowed'))).rejects.toMatchObject({ code: 'forbidden' })
      await expect(api.listPayouts()).rejects.toMatchObject({ code: 'forbidden' })
      expect(Array.isArray(await api.listMerchantOrders())).toBe(true)

      await as(api, 'store')
      const team = await api.getStoreTeam()
      expect(team.members.map((m) => [m.name, m.role])).toEqual([['Ikeja Partner Store', 'owner'], ['Ngozi Bello', 'manager'], ['Emeka Nwosu', 'orders']])
      expect((await api.listStoreActivity())[0]).toMatchObject({ who: 'Ngozi Bello', action: 'listed', listingTitle: 'Team lamp' })
    })

    it('always keeps an owner, and removing someone makes their account a buyer’s again', async () => {
      const api = make()
      await as(api, 'store')
      await api.inviteStoreMember('emeka@drawmart.test', 'orders')
      await as(api, 'emeka')
      await api.acceptStoreInvite((await api.listMyStoreInvites())[0].id)
      await as(api, 'store')
      await expect(api.setStoreMemberRole('m-ikeja', 'manager')).rejects.toThrow('at least one owner')
      await api.setStoreMemberRole('u-emeka', 'owner')
      await api.setStoreMemberRole('m-ikeja', 'manager')
      expect(await api.getMyStoreRole()).toBe('manager')
      await expect(api.getStoreTeam()).rejects.toMatchObject({ code: 'forbidden' })

      await as(api, 'emeka')
      await api.setStoreMemberRole('m-ikeja', 'owner')
      await api.setStoreMemberRole('u-emeka', 'orders')
      await as(api, 'store')
      await api.removeStoreMember('u-emeka')
      await as(api, 'emeka')
      expect((await api.auth.getSession())?.role).toBe('buyer')
    })

    it('needs an account that hasn’t bought, with the invited email', async () => {
      const api = make()
      await as(api, 'store')
      await api.inviteStoreMember('funke@drawmart.test', 'orders')
      await as(api, 'ngozi')
      expect(await api.listMyStoreInvites()).toEqual([])
      await as(api, 'funke')
      const draw = (await api.listListings()).find((l) => l.kind === 'raffle' && l.status === 'live')!
      await api.buyTickets(draw.id, 1)
      await expect(api.acceptStoreInvite((await api.listMyStoreInvites())[0].id)).rejects.toThrow('already bought')
    })
  })
})
