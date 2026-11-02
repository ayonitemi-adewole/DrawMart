/**
 * What riders earn, and their weekly pay. Each job earns a set amount from a pay
 * table admins edit beside the delivery prices: a delivery (to the door, handed in at a
 * counter, or refused at the door, since the trip happened) and a return to the seller
 * go by the pair of areas and the package size; a failed attempt earns a flat amount.
 * Pay never exceeds what the buyer is charged for the same trip, so each delivery
 * covers its own cost. A week runs Monday to Sunday, Lagos time; admins pay finished
 * weeks by hand, into an account confirmed by the bank, as with sellers.
 * Mirrored in private.rider_pay, private.earn_for_* and public.mark_rider_paid.
 */
import { PACKAGE_SIZES, type DeliveryPricing, areaPairPrice } from './deliveryFees'
import { formatNaira } from './money'
import type { Kobo, PackageSize } from './types'

export type EarningKind = 'delivery' | 'return' | 'failed_attempt'

export const EARNING_KIND_TEXT: Record<EarningKind, string> = { delivery: 'Delivery', return: 'Return to seller', failed_attempt: 'Failed attempt' }

export interface RiderPayRates {
  /** For a small package, one row per pair of areas, like delivery prices. */
  pays: { areaA: string; areaB: string; payKobo: Kobo }[]
  sizeExtras: Record<PackageSize, Kobo>
  attemptKobo: Kobo
}

export interface RiderEarning {
  id: string
  kind: EarningKind
  amountKobo: Kobo
  productCode: string
  listingTitle: string
  fromArea: string | null
  toArea: string | null
  earnedAt: string
  paidAt: string | null
  reference: string | null
  paidTo: string | null
}

/** Placeholders until riders' real rates are known: this share of the delivery price. */
export const PLACEHOLDER_PAY_SHARE_BPS = 7000
const roundTo50 = (k: Kobo) => Math.floor(k / 5_000) * 5_000

export function placeholderRiderPay(pricing: DeliveryPricing): RiderPayRates {
  const extras = {} as Record<PackageSize, Kobo>
  for (const s of PACKAGE_SIZES) extras[s] = roundTo50((pricing.sizeExtras[s] * PLACEHOLDER_PAY_SHARE_BPS) / 10_000)
  return {
    pays: pricing.prices.map((p) => ({ areaA: p.areaA, areaB: p.areaB, payKobo: roundTo50((p.priceKobo * PLACEHOLDER_PAY_SHARE_BPS) / 10_000) })),
    sizeExtras: extras,
    attemptKobo: 50_000,
  }
}

export function areaPairPay(rates: RiderPayRates, from: string, to: string): Kobo {
  const [areaA, areaB] = from <= to ? [from, to] : [to, from]
  return rates.pays.find((p) => p.areaA === areaA && p.areaB === areaB)?.payKobo ?? 0
}

export const tripPay = (rates: RiderPayRates, from: string, to: string, size: PackageSize): Kobo => areaPairPay(rates, from, to) + rates.sizeExtras[size]

/** A rate must stay within what the buyer pays for the same trip. */
export function riderPayError(payKobo: Kobo, chargedKobo: Kobo): string | null {
  if (!Number.isInteger(payKobo) || payKobo < 0) return 'Enter an amount.'
  return payKobo > chargedKobo ? `Rider pay can’t be more than the buyer pays (${formatNaira(chargedKobo)}).` : null
}

export const pairPayError = (rates: DeliveryPricing, from: string, to: string, payKobo: Kobo) => riderPayError(payKobo, areaPairPrice(rates, from, to))
export const attemptPayError = (payKobo: Kobo) => (Number.isInteger(payKobo) && payKobo >= 0 && payKobo <= 300_000 ? null : 'A failed attempt pays from ₦0 to ₦3,000.')

// Weeks run Monday to Sunday in Lagos (UTC+1, no summer time).
const HOUR = 3_600_000
const LAGOS = HOUR

/** The Monday 00:00 Lagos that starts the week containing `at`, as an ISO time. */
export function weekStart(at: string | number): string {
  const lagos = new Date((typeof at === 'number' ? at : Date.parse(at)) + LAGOS)
  const daysSinceMonday = (lagos.getUTCDay() + 6) % 7
  const midnight = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() - daysSinceMonday)
  return new Date(midnight - LAGOS).toISOString()
}

/** Unpaid earnings from weeks that have ended: what admins pay now. */
export const payableNow = (lines: RiderEarning[], nowMs: number) => {
  const thisWeek = Date.parse(weekStart(nowMs))
  return lines.filter((l) => !l.paidAt && Date.parse(l.earnedAt) < thisWeek)
}

export interface EarningWeek {
  start: string
  lines: RiderEarning[]
  totalKobo: Kobo
  paidKobo: Kobo
}

/** Newest week first. */
export function earningWeeks(lines: RiderEarning[]): EarningWeek[] {
  const weeks = new Map<string, RiderEarning[]>()
  for (const l of lines) weeks.set(weekStart(l.earnedAt), [...(weeks.get(weekStart(l.earnedAt)) ?? []), l])
  return [...weeks.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([start, ls]) => ({
      start,
      lines: ls.sort((a, b) => b.earnedAt.localeCompare(a.earnedAt)),
      totalKobo: ls.reduce((n, l) => n + l.amountKobo, 0),
      paidKobo: ls.filter((l) => l.paidAt).reduce((n, l) => n + l.amountKobo, 0),
    }))
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** One week's statement. Naira with two decimals, so spreadsheets add it up. */
export function earningsCsv(week: EarningWeek): string {
  const rows = [['Date', 'Job', 'Product ID', 'Item', 'Amount (NGN)', 'Paid', 'Reference']]
  for (const l of [...week.lines].reverse()) {
    rows.push([l.earnedAt.slice(0, 10), EARNING_KIND_TEXT[l.kind], l.productCode, l.listingTitle, (l.amountKobo / 100).toFixed(2), l.paidAt ? l.paidAt.slice(0, 10) : '', l.reference ?? ''])
  }
  rows.push(['', 'Total', '', '', (week.totalKobo / 100).toFixed(2), '', ''])
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}
