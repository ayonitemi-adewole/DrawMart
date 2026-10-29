/**
 * Individual sellers: regular people who sell regular products. They can
 * never run raffle draws (only CAC-registered stores can), and they must pass
 * an identity check by a DrawMart admin before they list anything.
 */
import { isNigerianMobile } from './listing'

/** pending → an admin approves (a shop is created) or rejects with a reason; rejected sellers can apply again. */
export type SellerApplicationStatus = 'pending' | 'approved' | 'rejected'

export interface SellerApplicationInput {
  /** Shown to buyers on the seller's items. */
  shopName: string
  /** As on the ID; must match it. */
  legalName: string
  /** National Identification Number, 11 digits. */
  nin: string
  phone: string
  address: string
  /** Lagos area, shown to buyers, e.g. "Yaba". */
  area: string
  /** Photo of a government ID (NIN slip, driver's licence, passport, voter's card). */
  idPhoto: string
  /** Selfie holding the same ID. */
  selfie: string
}

export type SellerApplicationError =
  | 'shop_name_required'
  | 'legal_name_required'
  | 'nin_invalid'
  | 'phone_invalid'
  | 'address_required'
  | 'area_required'
  | 'id_photo_required'
  | 'selfie_required'

export const normalizeNin = (nin: string) => nin.replace(/\s/g, '')

export function validateSellerApplication(i: SellerApplicationInput): SellerApplicationError[] {
  const errors: SellerApplicationError[] = []
  if (i.shopName.trim().length < 2) errors.push('shop_name_required')
  // First and last name, at least.
  if (i.legalName.trim().split(/\s+/).filter((w) => w.length > 1).length < 2) errors.push('legal_name_required')
  if (!/^\d{11}$/.test(normalizeNin(i.nin))) errors.push('nin_invalid')
  if (!isNigerianMobile(i.phone)) errors.push('phone_invalid')
  if (i.address.trim().length < 10) errors.push('address_required')
  if (i.area.trim().length < 2) errors.push('area_required')
  if (!i.idPhoto) errors.push('id_photo_required')
  if (!i.selfie) errors.push('selfie_required')
  return errors
}

export const SELLER_APPLICATION_ERROR_TEXT: Record<SellerApplicationError, string> = {
  shop_name_required: 'Give your shop a name buyers will see.',
  legal_name_required: 'Enter your full legal name, as on your ID.',
  nin_invalid: 'Enter your 11-digit NIN.',
  phone_invalid: 'Enter a Nigerian mobile number, e.g. 0803 123 4567.',
  address_required: 'Enter your full home address, with street and area.',
  area_required: 'Enter your area in Lagos, e.g. Yaba.',
  id_photo_required: 'Add a photo of your ID.',
  selfie_required: 'Add a selfie of you holding the same ID.',
}

/** Last 4 digits only, for places that don't need the whole number. */
export const maskNin = (nin: string) => `•••••••${normalizeNin(nin).slice(-4)}`
