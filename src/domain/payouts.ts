/**
 * What a seller is owed, item by item. Mirrored in
 * supabase/migrations/…_payouts.sql (private.sync_payouts).
 *
 * waiting: earned, but not delivered yet. due: delivered, so DrawMart owes it.
 * paid: an admin has sent it. A line only ever moves forward.
 */
import { CLAIM_HOLDS_PAYOUT, claimWindowOpen } from './claims'
import { computeListingEconomics } from './fees'
import { lagosDay } from './metrics'
import type { Kobo, Listing, Order } from './types'

export type PayoutKind = 'sale' | 'draw' | 'caution_fee' | 'charge' | 'return_fee' | 'charge_refund'
export type PayoutStatus = 'waiting' | 'due' | 'paid'

export interface PayoutLine {
  id: string
  listingId: string
  orderId: string | null
  kind: PayoutKind
  amountKobo: Kobo
  status: PayoutStatus
  createdAt: string
  dueAt: string | null
  paidAt: string | null
  /** The bank transfer's reference, once paid. */
  reference: string | null
  /** Bank and last four digits it went to, as they were at the time. */
  paidTo: string | null
}

export interface PayoutAccount {
  bankCode: string
  bankName: string
  accountNumber: string
  /** The name the bank holds, from Flutterwave's lookup. Never typed in. */
  accountName: string
  confirmedAt: string
  /** Nothing is paid to it before this: see PAYOUT_ACCOUNT_HOLD_HOURS. */
  payableFrom: string
}

/**
 * Changing the account stops payouts for this long, and the store is told, so
 * someone in a stolen session can't quietly redirect its money.
 */
export const PAYOUT_ACCOUNT_HOLD_HOURS = 48
export const MIN_REFERENCE_LENGTH = 3

export const PAYOUT_KIND_TEXT: Record<PayoutKind, string> = { charge: 'Charge for a failed order', return_fee: 'Your share of a return fee', charge_refund: 'Charge taken back', sale: 'Sale', draw: 'Draw payout', caution_fee: 'Caution fee back' }
export const PAYOUT_STATUS_TEXT: Record<PayoutStatus, string> = { waiting: 'Not due yet', due: 'Due', paid: 'Paid' }

export function accountNumberError(accountNumber: string): string | null {
  return /^[0-9]{10}$/.test(accountNumber) ? null : 'Enter the 10-digit account number.'
}

export const maskAccountNumber = (accountNumber: string) => `•••• ${accountNumber.slice(-4)}`

/**
 * A first account has no hold: it's payable from the moment it's confirmed, and comparing
 * that moment to a device's clock would show a hold whenever the clock runs a little behind.
 */
export const accountPayable = (account: Pick<PayoutAccount, 'confirmedAt' | 'payableFrom'>, nowMs: number) =>
  Date.parse(account.payableFrom) <= Date.parse(account.confirmedAt) || Date.parse(account.payableFrom) <= nowMs

export interface DesiredPayout {
  merchantId: string
  listingId: string
  orderId: string | null
  kind: PayoutKind
  amountKobo: Kobo
  due: boolean
}

type PayoutListing = Pick<Listing, 'id' | 'merchantId' | 'kind' | 'status' | 'priceKobo' | 'ticketPriceKobo' | 'feeBps' | 'feeMode' | 'cautionFee' | 'pickupBatchId'>
type PayoutOrder = Pick<Order, 'id' | 'listingId' | 'merchantId' | 'priceKobo' | 'feeKobo' | 'isPrize' | 'status'> & Partial<Pick<Order, 'deliveredAt' | 'refundedAt' | 'claim'>>

/**
 * The lines these listings and orders should have.
 * - A fixed-price sale pays its price less the fee, due once delivered.
 * - A draw pays from the moment it sells out, due once the winner has it.
 * - A caution fee back is its own line, due with the draw. A shared pickup has one
 *   fee, so one line, due once all its draws are delivered. A withdrawn listing's
 *   is due straight away, since nothing is left to deliver.
 */
/** A sale waits out the claim window, and any claim still being dealt with. */
function saleDue(o: PayoutOrder, nowMs: number): boolean {
  if (o.status !== 'delivered' || (o.claim && CLAIM_HOLDS_PAYOUT.includes(o.claim.status))) return false
  return !o.deliveredAt || !claimWindowOpen(o.deliveredAt, nowMs)
}

export function payoutsFor(listings: readonly PayoutListing[], orders: readonly PayoutOrder[], nowMs = Infinity): DesiredPayout[] {
  const lines: DesiredPayout[] = []
  const prizeDelivered = (id: string) => orders.some((o) => o.listingId === id && o.isPrize && o.status === 'delivered')

  for (const o of orders) {
    if (!o.isPrize && o.status !== 'cancelled' && !o.refundedAt) lines.push({ merchantId: o.merchantId, listingId: o.listingId, orderId: o.id, kind: 'sale', amountKobo: o.priceKobo - o.feeKobo, due: saleDue(o, nowMs) })
  }
  for (const l of listings) {
    if (l.kind === 'raffle' && (l.status === 'sold_out' || l.status === 'drawn')) {
      lines.push({ merchantId: l.merchantId, listingId: l.id, orderId: null, kind: 'draw', amountKobo: computeListingEconomics(l).sellerPayoutKobo, due: prizeDelivered(l.id) })
    }
    if (l.cautionFee.status !== 'refunded' || l.cautionFee.amountKobo <= 0) continue
    const fee = { merchantId: l.merchantId, listingId: l.id, orderId: null, kind: 'caution_fee' as const, amountKobo: l.cautionFee.amountKobo }
    if (l.status === 'withdrawn') {
      lines.push({ ...fee, due: true })
    } else if (!l.pickupBatchId) {
      lines.push({ ...fee, due: prizeDelivered(l.id) })
    } else {
      const members = listings.filter((m) => m.pickupBatchId === l.pickupBatchId).map((m) => m.id).sort()
      if (members[0] === l.id) lines.push({ ...fee, due: members.every(prizeDelivered) })
    }
  }
  return lines
}

export function payoutTotals(lines: readonly Pick<PayoutLine, 'status' | 'amountKobo'>[]): Record<PayoutStatus, Kobo> {
  const totals: Record<PayoutStatus, Kobo> = { waiting: 0, due: 0, paid: 0 }
  for (const l of lines) totals[l.status] += l.amountKobo
  return totals
}

/** A problem with paying these lines, or null if they can go. */
export function markPaidError(lines: readonly (Pick<PayoutLine, 'status'> & { amountKobo?: Kobo })[], account: Pick<PayoutAccount, 'confirmedAt' | 'payableFrom'> | null, reference: string, nowMs: number): string | null {
  if (!lines.length) return 'Pick something to pay.'
  if (lines.some((l) => l.status !== 'due')) return 'Only payouts that are due can be marked paid.'
  if (lines.some((l) => l.amountKobo !== undefined) && lines.reduce((sum, l) => sum + (l.amountKobo ?? 0), 0) <= 0) return 'This seller’s charges are more than what’s due, so there’s nothing to send yet.'
  if (!account) return 'This seller hasn’t added a bank account yet.'
  if (!accountPayable(account, nowMs)) return 'This seller changed their bank account recently, so payouts are on hold.'
  if (reference.trim().length < MIN_REFERENCE_LENGTH) return 'Enter the transfer’s reference.'
  return null
}

const statementMonth = (paidAt: string) => lagosDay(Date.parse(paidAt)).slice(0, 7)

/** Months with anything paid, newest first, as YYYY-MM in Lagos time. */
export function statementMonths(lines: readonly Pick<PayoutLine, 'paidAt'>[]): string[] {
  return [...new Set(lines.flatMap((l) => (l.paidAt ? [statementMonth(l.paidAt)] : [])))].sort().reverse()
}

/** Plain digits, for a spreadsheet: formatNaira's symbol and commas would make it text. */
export const nairaCell = (kobo: Kobo) => `${Math.floor(kobo / 100)}.${String(kobo % 100).padStart(2, '0')}`

/**
 * Quoted, and a leading = + - @ neutralised: a title or reference is free text, and a
 * spreadsheet would otherwise run it as a formula.
 */
export function textCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

/** One month's paid lines, with their total. */
export function statementCsv(lines: readonly (PayoutLine & { listingTitle: string; productCode: string })[], month: string): string {
  const paid = lines.filter((l) => l.paidAt && statementMonth(l.paidAt) === month).sort((a, b) => a.paidAt!.localeCompare(b.paidAt!))
  const rows = paid.map((l) =>
    [lagosDay(Date.parse(l.paidAt!)), textCell(l.productCode), textCell(l.listingTitle), PAYOUT_KIND_TEXT[l.kind], nairaCell(l.amountKobo), textCell(l.paidTo ?? ''), textCell(l.reference ?? '')].join(','),
  )
  const total = paid.reduce((sum, l) => sum + l.amountKobo, 0)
  return ['Date paid,Product ID,Item,Type,Amount (NGN),Paid to,Reference', ...rows, `Total,,,,${nairaCell(total)},,`].join('\r\n')
}
