/**
 * Regular products and fixed-price sales: what a store may list, what an
 * item costs right now, and whether a buyer can check out.
 */
import { applyBps, formatNaira } from './money'
import type { Kobo, Listing } from './types'

export const MIN_PRODUCT_PRICE_KOBO = 100_00 // ₦100

/** The price a buyer pays today, or null if it isn't on sale at a fixed price. */
export function salePriceKobo(l: Pick<Listing, 'kind' | 'status' | 'priceKobo' | 'fallbackPriceKobo'> & { sale?: { priceKobo: Kobo } | null }): Kobo | null {
  if (l.status !== 'for_sale') return null
  // A store's sale (discounts.ts). Products only, never draws.
  return l.kind === 'product' ? (l.sale?.priceKobo ?? l.priceKobo) : l.fallbackPriceKobo
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
  /** Left out by older callers: one item. */
  stock?: number
}

export type ProductError = 'title_required' | 'price_too_low' | 'stock_invalid'

export const MAX_STOCK = 10_000
/** "Only 3 left" starts here. */
export const LOW_STOCK_AT = 5

export function validateProduct(i: ProductInput): ProductError[] {
  const errors: ProductError[] = []
  if (!i.title.trim()) errors.push('title_required')
  if (!Number.isInteger(i.priceKobo) || i.priceKobo < MIN_PRODUCT_PRICE_KOBO) errors.push('price_too_low')
  const stock = i.stock ?? 1
  if (!Number.isInteger(stock) || stock < 1 || stock > MAX_STOCK) errors.push('stock_invalid')
  return errors
}

export const PRODUCT_ERROR_TEXT: Record<ProductError, string> = {
  title_required: 'Give the item a name.',
  price_too_low: `Set a price of at least ${formatNaira(MIN_PRODUCT_PRICE_KOBO)}.`,
  stock_invalid: `Enter how many you have, from 1 to ${MAX_STOCK.toLocaleString('en-NG')}.`,
}

// --------------------------------------------------------------- stock

export const MAX_ORDER_QUANTITY = 99

type QuantityListing = Pick<Listing, 'kind' | 'status' | 'stock' | 'category'>

/** Draws, won items and cars are one at a time. */
export function maxOrderQuantity(l: QuantityListing): number {
  return l.kind === 'product' && l.status === 'for_sale' && l.category !== 'Cars' ? Math.min(l.stock, MAX_ORDER_QUANTITY) : 1
}

/** A quantity that can be bought now, from whatever was asked for. */
export function clampQuantity(l: QuantityListing, wanted: number): number {
  return Math.min(Math.max(1, Number.isInteger(wanted) ? wanted : 1), maxOrderQuantity(l))
}

export function quantityError(l: QuantityListing & Pick<Listing, 'title'>, quantity: number): string | null {
  if (!Number.isInteger(quantity) || quantity < 1) return 'Choose at least one.'
  const max = maxOrderQuantity(l)
  if (quantity <= max) return null
  if (max === 1) return `You can only buy one of ${l.title} at a time.`
  return max === MAX_ORDER_QUANTITY ? `You can buy up to ${MAX_ORDER_QUANTITY} of ${l.title} at a time.` : `Only ${max} left of ${l.title}.`
}

/** After an order: it's sold out once none are left. */
export function takeStock(stock: number, quantity = 1): { stock: number; soldOut: boolean } {
  const left = Math.max(0, stock - quantity)
  return { stock: left, soldOut: left === 0 }
}

/** "Only 3 left" for a product running low. A draw's one item doesn't need saying. */
export function lowStockLabel(l: Pick<Listing, 'kind' | 'status' | 'stock'>): string | null {
  if (l.kind !== 'product' || l.status !== 'for_sale' || l.stock > LOW_STOCK_AT) return null
  return `Only ${l.stock} left`
}

// ------------------------------------------------------------ checkout

export type OrderError = 'not_for_sale' | 'insufficient_funds'

export const ORDER_ERROR_TEXT: Record<OrderError, string> = {
  not_for_sale: 'This item isn’t for sale any more.',
  insufficient_funds: 'Not enough in your wallet. Top up to continue.',
}
