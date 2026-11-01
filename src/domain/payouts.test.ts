import { describe, expect, it } from 'vitest'
import { computeListingEconomics } from './fees'
import { accountNumberError, accountPayable, markPaidError, maskAccountNumber, payoutsFor, payoutTotals, statementCsv, statementMonths, type PayoutLine } from './payouts'

const listing = (over = {}) => ({
  id: 'a', merchantId: 'm', kind: 'raffle' as const, status: 'drawn' as const, priceKobo: 10_000_000, ticketPriceKobo: 100_000, feeBps: 500, feeMode: 'seller' as const,
  cautionFee: { amountKobo: 250_000, status: 'refunded' as const }, pickupBatchId: null, ...over,
})
const order = (over = {}) => ({ id: 'o', listingId: 'a', merchantId: 'm', priceKobo: 5_000_000, feeKobo: 250_000, isPrize: false, status: 'paid' as const, ...over })

describe('what a seller is owed', () => {
  it('pays a sale its price less the fee, due once delivered', () => {
    expect(payoutsFor([], [order()])).toEqual([{ merchantId: 'm', listingId: 'a', orderId: 'o', kind: 'sale', amountKobo: 4_750_000, due: false }])
    expect(payoutsFor([], [order({ status: 'delivered' })])[0].due).toBe(true)
  })

  it('pays nothing for a won item’s own order, but the draw once it’s delivered', () => {
    const l = listing()
    const lines = payoutsFor([l], [order({ isPrize: true, priceKobo: 0, feeKobo: 0 })])
    expect(lines.map((x) => [x.kind, x.due])).toEqual([['draw', false], ['caution_fee', false]])
    expect(lines[0].amountKobo).toBe(computeListingEconomics(l).sellerPayoutKobo)
    const delivered = payoutsFor([l], [order({ isPrize: true, priceKobo: 0, feeKobo: 0, status: 'delivered' })])
    expect(delivered.map((x) => [x.kind, x.due])).toEqual([['draw', true], ['caution_fee', true]])
  })

  it('counts a sold-out draw before the winner is known, with its fee to follow', () => {
    const lines = payoutsFor([listing({ status: 'sold_out', cautionFee: { amountKobo: 250_000, status: 'held' } })], [])
    expect(lines.map((x) => x.kind)).toEqual(['draw'])
  })

  it('owes nothing for a draw that ended any other way', () => {
    for (const status of ['live', 'refunded', 'for_sale', 'rejected', 'pending_review']) {
      expect(payoutsFor([listing({ status, cautionFee: { amountKobo: 250_000, status: 'kept' } })], [])).toEqual([])
    }
  })

  it('gives a shared pickup one fee line, due once all its draws are delivered', () => {
    const a = listing({ id: 'a', pickupBatchId: 'b' })
    const b = listing({ id: 'b', pickupBatchId: 'b' })
    const prize = (id: string, listingId: string, status: string) => order({ id, listingId, status, isPrize: true, priceKobo: 0, feeKobo: 0 })
    const fees = (orders: ReturnType<typeof order>[]) => payoutsFor([a, b], orders).filter((l) => l.kind === 'caution_fee')
    expect(fees([prize('1', 'a', 'delivered')])).toEqual([expect.objectContaining({ listingId: 'a', due: false })])
    expect(fees([prize('1', 'a', 'delivered'), prize('2', 'b', 'delivered')])).toEqual([expect.objectContaining({ due: true })])
  })

  it('pays a withdrawn listing’s fee back straight away, and not one with nothing to give back', () => {
    expect(payoutsFor([listing({ status: 'withdrawn' })], [])).toEqual([expect.objectContaining({ kind: 'caution_fee', due: true })])
    expect(payoutsFor([listing({ status: 'withdrawn', cautionFee: { amountKobo: 0, status: 'none' } })], [])).toEqual([])
    expect(payoutsFor([listing({ status: 'withdrawn', cautionFee: { amountKobo: 250_000, status: 'kept' } })], [])).toEqual([])
  })
})

describe('bank accounts', () => {
  it('takes a 10-digit number, and hides most of it', () => {
    expect(accountNumberError('0123456789')).toBeNull()
    for (const n of ['', '123', '01234567890', '012345678a']) expect(accountNumberError(n)).toBeTruthy()
    expect(maskAccountNumber('0123456789')).toBe('•••• 6789')
  })

  it('holds a changed account', () => {
    const changed = { confirmedAt: '2026-11-01T00:00:00Z', payableFrom: '2026-11-03T00:00:00Z' }
    expect(accountPayable(changed, Date.parse('2026-11-02T00:00:00Z'))).toBe(false)
    expect(accountPayable(changed, Date.parse('2026-11-03T00:00:00Z'))).toBe(true)
  })

  it('never holds a first account, even on a device whose clock runs behind', () => {
    const first = { confirmedAt: '2026-11-01T17:05:00Z', payableFrom: '2026-11-01T17:05:00Z' }
    expect(accountPayable(first, Date.parse('2026-11-01T17:04:59Z'))).toBe(true)
  })
})

describe('marking paid', () => {
  const now = Date.parse('2026-11-02T00:00:00Z')
  const account = { confirmedAt: '2026-11-01T00:00:00Z', payableFrom: '2026-11-01T00:00:00Z' }
  const due = [{ status: 'due' as const }]

  it('needs due lines, a usable account and a reference', () => {
    expect(markPaidError(due, account, 'TRF-123', now)).toBeNull()
    expect(markPaidError([], account, 'TRF-123', now)).toBeTruthy()
    expect(markPaidError([{ status: 'paid' }], account, 'TRF-123', now)).toBeTruthy()
    expect(markPaidError([{ status: 'waiting' }], account, 'TRF-123', now)).toBeTruthy()
    expect(markPaidError(due, null, 'TRF-123', now)).toContain('bank account')
    expect(markPaidError(due, { confirmedAt: '2026-11-01T00:00:00Z', payableFrom: '2026-11-03T00:00:00Z' }, 'TRF-123', now)).toContain('on hold')
    expect(markPaidError(due, account, ' x ', now)).toContain('reference')
  })
})

describe('statements', () => {
  const line = (over: Partial<PayoutLine & { listingTitle: string }> = {}) => ({
    id: '1', listingId: 'a', orderId: null, kind: 'sale' as const, amountKobo: 1_234_505, status: 'paid' as const, createdAt: '', dueAt: null,
    paidAt: '2026-10-31T23:30:00Z', reference: 'TRF-1', paidTo: 'GTBank •••• 6789', listingTitle: 'Chair', productCode: 'PRD-222222', ...over,
  })

  it('goes by the Lagos date, newest month first', () => {
    // 23:30 UTC on 31 Oct is already November in Lagos.
    expect(statementMonths([line(), line({ paidAt: '2026-10-05T12:00:00Z' }), line({ paidAt: null })])).toEqual(['2026-11', '2026-10'])
  })

  it('lists one month’s payments in exact naira, with a total', () => {
    const csv = statementCsv([line(), line({ id: '2', amountKobo: 100, paidAt: '2026-11-02T12:00:00Z' }), line({ id: '3', paidAt: '2026-10-05T12:00:00Z' })], '2026-11')
    const rows = csv.split('\r\n')
    expect(rows).toHaveLength(4)
    expect(rows[1]).toBe('2026-11-01,"PRD-222222","Chair",Sale,12345.05,"GTBank •••• 6789","TRF-1"')
    expect(rows[2]).toContain(',1.00,')
    expect(rows[3]).toBe('Total,,,,12346.05,,')
  })

  it('can’t be used to run a formula, and keeps quotes intact', () => {
    const csv = statementCsv([line({ listingTitle: '=HYPERLINK("http://x")', reference: '+1' })], '2026-11')
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`)
    expect(csv).toContain(`"'+1"`)
  })
})

describe('totals', () => {
  it('adds up each stage', () => {
    expect(payoutTotals([{ status: 'waiting', amountKobo: 100 }, { status: 'waiting', amountKobo: 50 }, { status: 'paid', amountKobo: 7 }])).toEqual({ waiting: 150, due: 0, paid: 7 })
  })
})
