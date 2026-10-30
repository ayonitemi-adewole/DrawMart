/**
 * A buyer's saved delivery addresses, picked from at checkout. Mirrored in
 * supabase/migrations/…_saved_addresses.sql.
 */
import { isNigerianMobile } from './listing'
import { LOCATION_ERROR_TEXT, locationError, type LocationError } from './location'
import type { GeoPoint } from './types'

export const MAX_SAVED_ADDRESSES = 10
export const MAX_ADDRESS_LABEL = 40

export interface SavedAddress {
  id: string
  /** e.g. Home, Work. */
  label: string
  address: string
  location: GeoPoint
  contactPhone: string
  isDefault: boolean
}

export interface SavedAddressInput {
  /** Set to update an existing address. */
  id?: string
  label: string
  address: string
  location: GeoPoint | null
  contactPhone: string
  makeDefault?: boolean
}

export type SavedAddressError = 'label_required' | 'address_required' | 'phone_invalid' | LocationError

export function validateSavedAddress(a: Pick<SavedAddressInput, 'label' | 'address' | 'location' | 'contactPhone'>): SavedAddressError[] {
  const errors: SavedAddressError[] = []
  const label = a.label.trim()
  if (!label || label.length > MAX_ADDRESS_LABEL) errors.push('label_required')
  if (a.address.trim().length < 10) errors.push('address_required')
  const pin = locationError(a.location)
  if (pin) errors.push(pin)
  if (!isNigerianMobile(a.contactPhone)) errors.push('phone_invalid')
  return errors
}

export const SAVED_ADDRESS_ERROR_TEXT: Record<SavedAddressError, string> = {
  ...LOCATION_ERROR_TEXT,
  label_required: 'Give it a short name, like Home or Work.',
  address_required: 'Enter the full address, with street and area.',
  phone_invalid: 'Enter a Nigerian mobile number, e.g. 0803 123 4567.',
}

/** The one checkout starts on: the default, or failing that the first. */
export function preferredAddress(addresses: readonly SavedAddress[]): SavedAddress | null {
  return addresses.find((a) => a.isDefault) ?? addresses[0] ?? null
}

/** Default first, then in the order they were saved. */
export function sortAddresses(addresses: readonly SavedAddress[]): SavedAddress[] {
  return [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
}

/** The phone to suggest for a pickup: the one on their account, else on their usual address. */
export function suggestedPhone(profilePhone: string | null | undefined, addresses: readonly SavedAddress[]): string {
  return profilePhone?.trim() || preferredAddress(addresses)?.contactPhone || ''
}
