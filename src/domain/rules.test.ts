import { describe, expect, it } from 'vitest'
import { nairaToKobo as k } from './money'
import { balanceFromLedger, checkPurchase, consolationCredit, maxPurchasable, spentInLastWeek, splitPayment, topUpError } from './rules'
import type { LedgerEntry, Listing, User } from './types'

const user: User = { id: 'u1', displayName: 'Test', state: 'Lagos', weeklyLimitKobo: k(50_000), ageVerified: true }
const listing: Listing = {
  id: 'l1', kind: 'raffle', merchantId: 'm1', title: 'Phone', description: '', category: 'Phones', images: [],
  priceKobo: k(1_000_000), ticketPriceKobo: k(5_000), buyerTicketPriceKobo: k(5_000),
  ticketCount: 200, ticketsSold: 190, feeMode: 'seller', feeBps: 1000, unsoldPolicy: 'refund', fallbackPriceKobo: null, durationDays: 7, extended: false,
  status: 'live', commitment: 'x',
  handover: { method: 'pickup', address: '1 Test Street, Ikeja', location: null, contactPhone: '08031234567', date: '2026-10-02', slot: 'morning' },
  cautionFee: { amountKobo: k(2_500), status: 'held' }, createdAt: '2026-10-01T00:00:00Z', closesAt: '2026-11-01T00:00:00Z', boostedUntil: null, pickupBatchId: null,
}
const base = { user, listing, quantity: 1, ticketsAlreadyHeld: 0, balance: { cashKobo: k(20_000), creditKobo: 0 }, spentThisWeekKobo: 0 }

describe('checkPurchase', () => {
  it('allows a normal purchase', () => expect(checkPurchase(base)).toBeNull())
  it('blocks unlicensed states', () => expect(checkPurchase({ ...base, user: { ...user, state: 'Kano' } })).toBe('state_not_licensed'))
  it('blocks unverified age', () => expect(checkPurchase({ ...base, user: { ...user, ageVerified: false } })).toBe('age_not_verified'))
  it('blocks closed listings', () => expect(checkPurchase({ ...base, listing: { ...listing, status: 'drawn' } })).toBe('not_live'))
  it('blocks more than are left', () => expect(checkPurchase({ ...base, quantity: 11 })).toBe('not_enough_tickets_left'))
  it('enforces the per-person cap', () => expect(checkPurchase({ ...base, quantity: 2, ticketsAlreadyHeld: 19 })).toBe('per_user_limit'))
  it('enforces the weekly limit', () => expect(checkPurchase({ ...base, spentThisWeekKobo: k(48_000) })).toBe('weekly_limit'))
  it('needs enough money (cash + credit)', () => {
    expect(checkPurchase({ ...base, quantity: 5 })).toBe('insufficient_funds')
    expect(checkPurchase({ ...base, quantity: 5, balance: { cashKobo: k(20_000), creditKobo: k(5_000) } })).toBeNull()
  })
})

describe('wallet helpers', () => {
  const now = new Date('2026-10-28T12:00:00Z')
  const entries: LedgerEntry[] = [
    { id: '1', userId: 'u1', kind: 'topup', cashKobo: k(30_000), creditKobo: 0, memo: '', createdAt: '2026-10-27T10:00:00Z' },
    { id: '2', userId: 'u1', kind: 'ticket_purchase', cashKobo: -k(8_000), creditKobo: -k(2_000), memo: '', createdAt: '2026-10-27T11:00:00Z' },
    { id: '3', userId: 'u1', kind: 'refund', cashKobo: k(5_000), creditKobo: 0, memo: '', createdAt: '2026-10-28T09:00:00Z' },
    { id: '4', userId: 'u1', kind: 'ticket_purchase', cashKobo: -k(5_000), creditKobo: 0, memo: '', createdAt: '2026-10-10T09:00:00Z' },
  ]
  it('derives balances from the ledger', () => expect(balanceFromLedger(entries)).toEqual({ cashKobo: k(22_000), creditKobo: -k(2_000) }))
  it('counts only the last 7 days, net of refunds', () => expect(spentInLastWeek(entries, now)).toBe(k(5_000)))
  it('spends credit before cash', () => expect(splitPayment(k(5_000), { cashKobo: k(10_000), creditKobo: k(2_000) })).toEqual({ fromCredit: k(2_000), fromCash: k(3_000) }))
  it('computes consolation credit', () => expect(consolationCredit(k(15_000))).toBe(k(3_000)))
  it('caps purchasable quantity', () => expect(maxPurchasable(listing, 15)).toBe(5))
  it('keeps top-ups between ₦100 and ₦500,000', () => {
    expect(topUpError(k(100))).toBeNull()
    expect(topUpError(k(500_000))).toBeNull()
    expect(topUpError(0)).toBe('Enter an amount to add.')
    expect(topUpError(k(99))).toBe('The smallest top-up is ₦100.')
    expect(topUpError(k(500_001))).toBe('The largest single top-up is ₦500,000.')
  })
})
