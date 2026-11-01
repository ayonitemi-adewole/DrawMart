/**
 * Regular products and fixed-price sales: what a store may list, what an
 * item costs right now, and whether a buyer can check out.
 */
import { applyBps, formatNaira } from './money'
import type { Kobo, Listing } from './types'

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

/** After one is sold: it's sold out once none are left. */
export function takeStock(stock: number): { stock: number; soldOut: boolean } {
  const left = Math.max(0, stock - 1)
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
