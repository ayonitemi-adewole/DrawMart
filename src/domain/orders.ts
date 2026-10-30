/**
 * Regular products and fixed-price sales: what a store may list, what an
 * item costs right now, and whether a buyer can check out.
 */
import { isNigerianMobile } from './listing'
import { LOCATION_ERROR_TEXT, locationError, type LocationError } from './location'
import { applyBps, formatNaira } from './money'
import type { Delivery, Kobo, Listing, WalletBalance } from './types'

export const MIN_PRODUCT_PRICE_KOBO = 100_00 // ₦100

/** The price a buyer pays today, or null if it isn't on sale at a fixed price. */
export function salePriceKobo(l: Pick<Listing, 'kind' | 'status' | 'priceKobo' | 'fallbackPriceKobo'>): Kobo | null {
  if (l.status !== 'for_sale') return null
  return l.kind === 'product' ? l.priceKobo : l.fallbackPriceKobo
}

/** The store pays the platform fee on fixed-price sales; buyers see one clean price. */
export function saleEconomics(priceKobo: Kobo, feeBps: number): { feeKobo: Kobo; payoutKobo: Kobo } {
  const feeKobo = applyBps(priceKobo, feeBps)
  return { feeKobo, payoutKobo: priceKobo - feeKobo }
}

// ------------------------------------------------------------- listing

export interface ProductInput {
  title: string
  priceKobo: Kobo
}

export type ProductError = 'title_required' | 'price_too_low'

export function validateProduct(i: ProductInput): ProductError[] {
  const errors: ProductError[] = []
  if (!i.title.trim()) errors.push('title_required')
  if (!Number.isInteger(i.priceKobo) || i.priceKobo < MIN_PRODUCT_PRICE_KOBO) errors.push('price_too_low')
  return errors
}

export const PRODUCT_ERROR_TEXT: Record<ProductError, string> = {
  title_required: 'Give the item a name.',
  price_too_low: `Set a price of at least ${formatNaira(MIN_PRODUCT_PRICE_KOBO)}.`,
}

// ------------------------------------------------------------ checkout

export type DeliveryError = 'address_required' | 'phone_invalid' | LocationError

export function validateDelivery(d: Delivery): DeliveryError[] {
  const errors: DeliveryError[] = []
  if (d.address.trim().length < 10) errors.push('address_required')
  const pin = locationError(d.location)
  if (pin) errors.push(pin)
  if (!isNigerianMobile(d.contactPhone)) errors.push('phone_invalid')
  return errors
}

export const DELIVERY_ERROR_TEXT: Record<DeliveryError, string> = {
  ...LOCATION_ERROR_TEXT,
  address_required: 'Enter the full delivery address, with street and area.',
  phone_invalid: 'Enter a Nigerian mobile number, e.g. 0803 123 4567.',
}

export type OrderError = 'not_for_sale' | 'insufficient_funds'

/** Store credit counts too, and is spent first (rules.ts splitPayment). */
export function checkOrder(listing: Pick<Listing, 'kind' | 'status' | 'priceKobo' | 'fallbackPriceKobo'>, balance: WalletBalance): OrderError | null {
  const price = salePriceKobo(listing)
  if (price === null) return 'not_for_sale'
  if (balance.cashKobo + balance.creditKobo < price) return 'insufficient_funds'
  return null
}

export const ORDER_ERROR_TEXT: Record<OrderError, string> = {
  not_for_sale: 'This item isn’t for sale any more.',
  insufficient_funds: 'Not enough in your wallet. Top up to continue.',
}
