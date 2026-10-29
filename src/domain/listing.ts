/**
 * Rules for submitting a listing: draw terms, how the item reaches DrawMart,
 * and the caution fee the store pays up front.
 */
import { formatNaira, nairaToKobo } from './money'
import { RULES } from './rules'
import type { CautionFee, Category, Handover, HandoverMethod, Kobo, ListingStatus, TimeSlot, UnsoldPolicy } from './types'

/** Cars can't sit in an escrow store, so they're inspected where they are. */
export function handoverMethodFor(category: Category): HandoverMethod {
  return category === 'Cars' ? 'inspection' : 'pickup'
}

/** Placeholder amounts until ops prices pickups per category (see docs/product-decisions.md). */
export const CAUTION_FEE_KOBO: Record<Category, Kobo> = {
  Phones: nairaToKobo(2_500),
  Fashion: nairaToKobo(2_500),
  Electronics: nairaToKobo(7_500),
  Home: nairaToKobo(10_000),
  Cars: nairaToKobo(25_000),
}

export function cautionFeeFor(category: Category): Kobo {
  return CAUTION_FEE_KOBO[category]
}

/**
 * What happens to the caution fee when a listing reaches a final state:
 * returned with the payout on a sell-out, kept to cover delivery otherwise.
 */
export function settleCautionFee(fee: CautionFee, status: ListingStatus): CautionFee {
  if (fee.status !== 'held') return fee // includes 'none' for products
  if (status === 'drawn') return { ...fee, status: 'refunded' }
  if (status === 'refunded' || status === 'for_sale' || status === 'rejected') return { ...fee, status: 'kept' }
  return fee
}

export const TIME_SLOTS: Record<TimeSlot, string> = {
  morning: '9am – 12pm',
  afternoon: '12pm – 5pm',
}

// ------------------------------------------------------------ draw terms

export interface ListingTermsInput {
  durationDays: number
  unsoldPolicy: UnsoldPolicy
  fallbackPriceKobo?: Kobo | null
}

export type ListingTermsError = 'duration_out_of_range' | 'fallback_price_required'

export function validateListingTerms(i: ListingTermsInput): ListingTermsError[] {
  const errors: ListingTermsError[] = []
  if (!Number.isInteger(i.durationDays) || i.durationDays < RULES.minDurationDays || i.durationDays > RULES.maxDurationDays)
    errors.push('duration_out_of_range')
  if (i.unsoldPolicy === 'convert_to_sale' && !(i.fallbackPriceKobo && i.fallbackPriceKobo > 0)) errors.push('fallback_price_required')
  return errors
}

export const LISTING_TERMS_ERROR_TEXT: Record<ListingTermsError, string> = {
  duration_out_of_range: `Pick a deadline between ${RULES.minDurationDays} and ${RULES.maxDurationDays} days.`,
  fallback_price_required: 'Enter the price you’ll sell it for if the draw doesn’t sell out.',
}

/** One sentence for buyers on what happens if the draw doesn't sell out. */
export function describeUnsoldPolicy(policy: UnsoldPolicy, fallbackPriceKobo: Kobo | null): string {
  if (policy === 'extend_once') return `If it doesn’t sell out, the deadline is extended once by ${RULES.extensionDays} days, then everyone is refunded.`
  if (policy === 'convert_to_sale')
    return `If it doesn’t sell out, everyone is refunded and the store keeps it on DrawMart for ${fallbackPriceKobo ? formatNaira(fallbackPriceKobo) : 'a fixed price'}.`
  return 'If it doesn’t sell out by the deadline, everyone is refunded to their wallet.'
}

export const UNSOLD_POLICY_LABEL: Record<UnsoldPolicy, string> = {
  refund: 'Refund if unsold',
  extend_once: 'Extend once if unsold',
  convert_to_sale: 'Sell at fixed price if unsold',
}

// -------------------------------------------------------------- handover

export type HandoverDetails = Omit<Handover, 'method'>

export type HandoverError = 'address_required' | 'phone_invalid' | 'date_out_of_range'

/** Nigerian mobile numbers: 080…, 0701…, +234 80… */
export function isNigerianMobile(phone: string): boolean {
  return /^(?:\+?234|0)[789][01]\d{8}$/.test(phone.replace(/[\s-]/g, ''))
}

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + days))
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((ms(to) - ms(from)) / 86_400_000)
}

export function handoverDateRange(today: string): { min: string; max: string } {
  return { min: addDays(today, RULES.handoverMinLeadDays), max: addDays(today, RULES.handoverMaxLeadDays) }
}

export function validateHandover(h: HandoverDetails, today: string): HandoverError[] {
  const errors: HandoverError[] = []
  if (h.address.trim().length < 10) errors.push('address_required')
  if (!isNigerianMobile(h.contactPhone)) errors.push('phone_invalid')
  const { min, max } = handoverDateRange(today)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date) || h.date < min || h.date > max) errors.push('date_out_of_range')
  return errors
}

export const HANDOVER_ERROR_TEXT: Record<HandoverError, string> = {
  address_required: 'Enter the full address, with street and area.',
  phone_invalid: 'Enter a Nigerian mobile number, e.g. 0803 123 4567.',
  date_out_of_range: `Pick a date between tomorrow and ${RULES.handoverMaxLeadDays} days from now.`,
}
