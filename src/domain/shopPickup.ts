/**
 * Where a rider collects from a seller. Mirrored in supabase/migrations/…_shop_pickups.sql.
 */
import { HANDOVER_ERROR_TEXT, isNigerianMobile, type HandoverError } from './listing'
import { locationError } from './location'
import type { GeoPoint } from './types'

export interface ShopPickup {
  address: string
  location: GeoPoint
  contactPhone: string
}

export function shopPickupErrors(p: { address: string; location: GeoPoint | null; contactPhone: string }): HandoverError[] {
  const errors: HandoverError[] = []
  if (p.address.trim().length < 10) errors.push('address_required')
  const pin = locationError(p.location)
  if (pin) errors.push(pin)
  if (!isNigerianMobile(p.contactPhone)) errors.push('phone_invalid')
  return errors
}

export const shopPickupErrorText = (errors: readonly HandoverError[]) => errors.map((e) => HANDOVER_ERROR_TEXT[e]).join(' ')
