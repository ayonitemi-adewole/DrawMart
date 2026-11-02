/**
 * A shop's public page. Mirrored in supabase/migrations/…_shop_profiles.sql.
 */
import { CLAIM_WINDOW_HOURS } from './claims'
import { isNigerianMobile } from './listing'
import type { MerchantKind } from './types'

export const SHOP_LIMITS = { about: 300, openingHours: 80, shopNote: 300 } as const

export interface ShopProfileInput {
  about: string
  openingHours: string
  shopNote: string
  /** Blank keeps it private. */
  publicPhone: string
  logoUrl: string | null
  coverUrl: string | null
  showCac: boolean
}

export function shopProfileErrors(p: ShopProfileInput, kind: MerchantKind): string[] {
  const errors: string[] = []
  if (p.about.trim().length > SHOP_LIMITS.about) errors.push(`Keep the description to ${SHOP_LIMITS.about} characters.`)
  if (p.openingHours.trim().length > SHOP_LIMITS.openingHours) errors.push(`Keep opening hours to ${SHOP_LIMITS.openingHours} characters.`)
  if (p.shopNote.trim().length > SHOP_LIMITS.shopNote) errors.push(`Keep your note to buyers to ${SHOP_LIMITS.shopNote} characters.`)
  if (p.publicPhone.trim() && !isNigerianMobile(p.publicPhone)) errors.push('Enter a Nigerian mobile number, e.g. 0803 123 4567, or leave it blank.')
  if (p.showCac && kind === 'individual') errors.push('Only registered stores have a CAC number to show.')
  return errors
}

export function verifiedSince(verifiedAt: string | null | undefined): string | null {
  if (!verifiedAt) return null
  return new Date(verifiedAt).toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' })
}

/** The same for every shop: these are DrawMart's rules, not the seller's. */
export const BUYING_TERMS = [
  'Delivered anywhere in Lagos by DrawMart’s riders. You see the delivery fee at checkout.',
  'You open it and check it before you give the rider your PIN, and can refuse it if it’s wrong or damaged.',
  `Report a fault or return it within ${CLAIM_WINDOW_HOURS} hours of delivery. A return because you changed your mind has a return fee.`,
  'The seller is only paid once you have it.',
] as const
