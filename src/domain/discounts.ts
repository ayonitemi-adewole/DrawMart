/**
 * Store-funded discounts on regular products: a sale everyone gets, or a code the
 * store shares. Never on draws or tickets. The store pays for it: the order is
 * charged at the discounted price, and DrawMart's fee is worked out on that.
 * Mirrored in supabase/migrations/…_discounts.sql.
 */
import { formatNaira } from './money'
import { MIN_PRODUCT_PRICE_KOBO } from './orders'
import type { ISODate, Kobo } from './types'

export type DiscountKind = 'sale' | 'code'

export const MAX_PERCENT_OFF = 90
export const MIN_AMOUNT_OFF_KOBO: Kobo = 100_00
export const MAX_SALE_DAYS = 31
export const MAX_CODE_DAYS = 90
export const MAX_CODE_USES = 10_000
/** Running or yet to start, per shop. */
export const MAX_OPEN_DISCOUNTS = 20
const DAY = 86_400_000
const CODE = /^[A-Z0-9]{4,16}$/

export interface DiscountValue {
  /** One of these two. */
  percentOff: number | null
  amountOffKobo: Kobo | null
}

export interface Discount extends DiscountValue {
  id: string
  kind: DiscountKind
  code: string | null
  maxUses: number | null
  uses: number
  startsAt: ISODate
  endsAt: ISODate
  /** The store stopped it early. */
  endedAt: ISODate | null
  listingIds: string[]
  createdAt: ISODate
}

export interface DiscountInput extends DiscountValue {
  kind: DiscountKind
  code: string
  maxUses: number | null
  startsAt: ISODate
  endsAt: ISODate
  listingIds: string[]
}

/** A running sale on a product, as buyers see it with the listing. */
export interface ListingSale extends DiscountValue {
  /** What one costs during the sale. */
  priceKobo: Kobo
  endsAt: ISODate
}

/** What a discount code does to the items being bought: each one's price with it, by listing id. */
export interface CodeCheck {
  code: string
  prices: Record<string, Kobo>
}

export const normalizeCode = (code: string) => code.trim().toUpperCase()

/** What one costs with this discount. Never below the lowest product price, never above what it was. */
export function discountedUnitKobo(unitKobo: Kobo, d: DiscountValue): Kobo {
  const off = d.percentOff !== null ? Math.floor((unitKobo * d.percentOff) / 100) : (d.amountOffKobo ?? 0)
  return Math.min(unitKobo, Math.max(unitKobo - off, MIN_PRODUCT_PRICE_KOBO))
}

export function discountActive(d: Pick<Discount, 'startsAt' | 'endsAt' | 'endedAt' | 'maxUses' | 'uses'>, nowMs: number): boolean {
  return !d.endedAt && Date.parse(d.startsAt) <= nowMs && nowMs < Date.parse(d.endsAt) && (d.maxUses === null || d.uses < d.maxUses)
}

export type DiscountState = 'scheduled' | 'running' | 'ended'

export function discountState(d: Pick<Discount, 'startsAt' | 'endsAt' | 'endedAt' | 'maxUses' | 'uses'>, nowMs: number): DiscountState {
  if (discountActive(d, nowMs)) return 'running'
  return !d.endedAt && nowMs < Date.parse(d.startsAt) ? 'scheduled' : 'ended'
}

/** The cheapest of these, with the discount that gives it; or the price itself if none helps. */
export function bestPrice<D extends DiscountValue & { id: string }>(unitKobo: Kobo, discounts: readonly D[]): { unitKobo: Kobo; discountId: string | null } {
  let best = { unitKobo, discountId: null as string | null }
  for (const d of discounts) {
    const u = discountedUnitKobo(unitKobo, d)
    if (u < best.unitKobo) best = { unitKobo: u, discountId: d.id }
  }
  return best
}

export function describeDiscount(d: DiscountValue): string {
  return d.percentOff !== null ? `${d.percentOff}% off` : `${formatNaira(d.amountOffKobo ?? 0)} off`
}

/** `prices` are the chosen products' prices, by id; `codeTaken` comes from the server. */
export function discountErrors(i: DiscountInput, prices: Record<string, Kobo>): string[] {
  const errors: string[] = []
  const percent = i.percentOff !== null
  if (percent === (i.amountOffKobo !== null)) errors.push('Choose a percentage or an amount off.')
  if (percent && (!Number.isInteger(i.percentOff) || i.percentOff! < 1 || i.percentOff! > MAX_PERCENT_OFF)) errors.push(`Take 1% to ${MAX_PERCENT_OFF}% off.`)
  if (i.amountOffKobo !== null && (!Number.isInteger(i.amountOffKobo) || i.amountOffKobo < MIN_AMOUNT_OFF_KOBO)) errors.push(`Take at least ${formatNaira(MIN_AMOUNT_OFF_KOBO)} off.`)
  if (!i.listingIds.length) errors.push('Choose at least one product.')
  if (i.amountOffKobo !== null) {
    const tooMuch = i.listingIds.some((id) => prices[id] !== undefined && i.amountOffKobo! > prices[id] - MIN_PRODUCT_PRICE_KOBO)
    if (tooMuch) errors.push(`That’s more than one of the products costs. Leave at least ${formatNaira(MIN_PRODUCT_PRICE_KOBO)}.`)
  }
  const start = Date.parse(i.startsAt)
  const end = Date.parse(i.endsAt)
  const days = i.kind === 'sale' ? MAX_SALE_DAYS : MAX_CODE_DAYS
  if (!(end > start)) errors.push('The end has to be after the start.')
  else if (end - start > days * DAY) errors.push(`${i.kind === 'sale' ? 'A sale' : 'A code'} can run for up to ${days} days.`)
  if (i.kind === 'code') {
    if (!CODE.test(normalizeCode(i.code))) errors.push('Use 4 to 16 letters and numbers for the code, e.g. SAVE10.')
    if (i.maxUses !== null && (!Number.isInteger(i.maxUses) || i.maxUses < 1 || i.maxUses > MAX_CODE_USES)) errors.push(`Allow 1 to ${MAX_CODE_USES.toLocaleString('en-NG')} uses, or leave it unlimited.`)
  }
  return errors
}
