/**
 * Self-serve store sign-up: a CAC-registered business applies from a new account, and
 * an admin's approval turns that account into the store's. Mirrored in
 * supabase/migrations/…_store_applications.sql.
 */
import { isNigerianMobile } from './listing'
import type { SellerApplicationStatus } from './sellers'

export type StoreApplicationStatus = SellerApplicationStatus

export interface StoreApplicationInput {
  /** As on the CAC certificate. Buyers see it. */
  businessName: string
  /** RC (company), BN (business name) or IT (incorporated trustees), then the number. */
  cacNumber: string
  /** A director or the proprietor, as on their ID. */
  directorName: string
  phone: string
  /** Where the business is. */
  address: string
  /** Lagos area, shown to buyers, e.g. "Ikeja". */
  area: string
  /** Photo or screenshot of the CAC certificate. */
  certificatePhoto: string
  /** Photo of the director's government ID. */
  directorIdPhoto: string
}

export type StoreApplicationError =
  | 'business_name_required'
  | 'cac_invalid'
  | 'director_name_required'
  | 'phone_invalid'
  | 'address_required'
  | 'area_required'
  | 'certificate_required'
  | 'director_id_required'

/** "rc-1234567" → "RC 1234567"; null if it isn't a CAC number. */
export function normalizeCac(cac: string): string | null {
  const m = /^(RC|BN|IT)[\s-]*(\d{4,8})$/i.exec(cac.trim())
  return m ? `${m[1].toUpperCase()} ${m[2]}` : null
}

export function validateStoreApplication(i: StoreApplicationInput): StoreApplicationError[] {
  const errors: StoreApplicationError[] = []
  if (i.businessName.trim().length < 2) errors.push('business_name_required')
  if (!normalizeCac(i.cacNumber)) errors.push('cac_invalid')
  if (i.directorName.trim().split(/\s+/).filter((w) => w.length > 1).length < 2) errors.push('director_name_required')
  if (!isNigerianMobile(i.phone)) errors.push('phone_invalid')
  if (i.address.trim().length < 10) errors.push('address_required')
  if (i.area.trim().length < 2) errors.push('area_required')
  if (!i.certificatePhoto) errors.push('certificate_required')
  if (!i.directorIdPhoto) errors.push('director_id_required')
  return errors
}

export const STORE_APPLICATION_ERROR_TEXT: Record<StoreApplicationError, string> = {
  business_name_required: 'Enter your business name, as on your CAC certificate.',
  cac_invalid: 'Enter your CAC number, e.g. RC 1234567 or BN 1234567.',
  director_name_required: 'Enter the director’s full name, as on their ID.',
  phone_invalid: 'Enter a Nigerian mobile number, e.g. 0803 123 4567.',
  address_required: 'Enter the business address, with street and area.',
  area_required: 'Enter your area in Lagos, e.g. Ikeja.',
  certificate_required: 'Add a photo of your CAC certificate.',
  director_id_required: 'Add a photo of the director’s ID.',
}

/**
 * The account becomes the store's, and only buyers hold money or tickets, so it must be
 * one that hasn't bought or sold. Null when it can apply.
 */
export function storeAccountBlocker(a: { isBuyer: boolean; sellsAsIndividual: boolean; hasBought: boolean }): string | null {
  if (!a.isBuyer) return 'Only a new account can become a store account.'
  if (a.sellsAsIndividual) return 'This account sells as an individual. Sign up with a new account for your business.'
  if (a.hasBought) return 'This account has already bought on DrawMart. Sign up with a new account for your business.'
  return null
}

export const DUPLICATE_CAC_TEXT = 'A store with this CAC number is already on DrawMart. Contact us if it’s yours.'
