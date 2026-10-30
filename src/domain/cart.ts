/**
 * The buyer's cart and checkout: regular products and draw items they've won,
 * delivered together or collected from a pickup location. Cars don't go in the
 * cart, and can only be delivered, because they stay with the dealer.
 * Mirrored in supabase/migrations/…_cart_and_pickup_points.sql.
 */
import { isNigerianMobile } from './listing'
import { LOCATION_ERROR_TEXT, locationError, type LocationError } from './location'
import { salePriceKobo } from './orders'
import type { Delivery, Fulfilment, Kobo, Listing } from './types'

type CartListing = Pick<Listing, 'kind' | 'status' | 'category' | 'priceKobo' | 'fallbackPriceKobo'> & { result?: { iWon: boolean } | null }

export const isWonPrize = (l: CartListing) => l.status === 'drawn' && !!l.result?.iWon

export const isCar = (l: Pick<Listing, 'category'>) => l.category === 'Cars'

export type CartError = 'car' | 'not_available'

export function cartError(l: CartListing): CartError | null {
  if (isCar(l)) return 'car'
  return isWonPrize(l) || salePriceKobo(l) !== null ? null : 'not_available'
}

export const CART_ERROR_TEXT: Record<CartError, string> = {
  car: 'Cars don’t go in the cart. Each one is arranged on its own.',
  not_available: 'Only items on sale, and draws you’ve won, can go in your cart.',
}

/** What a line costs today (a won item is free), or null if it can't be bought any more. */
export function lineAmountKobo(l: CartListing): Kobo | null {
  return isWonPrize(l) ? 0 : salePriceKobo(l)
}

export function checkoutTotalKobo(lines: readonly CartListing[]): Kobo {
  return lines.reduce((sum, l) => sum + (lineAmountKobo(l) ?? 0), 0)
}

export interface CheckoutDetails {
  fulfilment: Fulfilment
  delivery: Delivery
  pickupPointId: string | null
}

export type CheckoutError = 'address_required' | 'phone_invalid' | 'pickup_point_required' | 'car_pickup' | LocationError

export function validateCheckout(d: CheckoutDetails, hasCar: boolean): CheckoutError[] {
  const errors: CheckoutError[] = []
  if (d.fulfilment === 'delivery') {
    if (d.delivery.address.trim().length < 10) errors.push('address_required')
    const pin = locationError(d.delivery.location)
    if (pin) errors.push(pin)
  } else {
    if (hasCar) errors.push('car_pickup')
    if (!d.pickupPointId) errors.push('pickup_point_required')
  }
  if (!isNigerianMobile(d.delivery.contactPhone)) errors.push('phone_invalid')
  return errors
}

export const CHECKOUT_ERROR_TEXT: Record<CheckoutError, string> = {
  ...LOCATION_ERROR_TEXT,
  address_required: 'Enter the full delivery address, with street and area.',
  phone_invalid: 'Enter a Nigerian mobile number, e.g. 0803 123 4567.',
  pickup_point_required: 'Choose a pickup location.',
  car_pickup: 'Cars stay with the dealer, so they can’t be collected from a pickup location.',
}
