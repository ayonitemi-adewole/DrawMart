/**
 * Proof a seller has a product before it's listed, and new individual sellers' limits.
 * Mirrored in supabase/migrations/…_listing_checks.sql.
 */
import { formatNaira } from './money'
import type { Category, Kobo } from './types'

export const MAX_VIDEO_SECONDS = 15
/** Phones and electronics from this price need a serial or IMEI number. */
export const SERIAL_FROM_KOBO: Kobo = 5_000_000
/** Individuals selling above this need proof of purchase. */
export const PROOF_ABOVE_KOBO: Kobo = 10_000_000
export const NEW_SELLER = { maxPriceKobo: 20_000_000, maxLive: 5, deliveriesNeeded: 3 } as const

/** No letters that look like numbers, so it's easy to write down and read in a video. */
export const CODE_ALPHABET = 'ACDEFHJKMNPRTUVWXY3479'

export function newCheckCode(random: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]).join('')
}

/** 15 digits with a Luhn check digit. */
export function imeiValid(imei: string): boolean {
  if (!/^[0-9]{15}$/.test(imei)) return false
  let sum = 0
  for (let i = 0; i < 15; i++) {
    let d = Number(imei[i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

export const needsSerial = (category: Category, priceKobo: Kobo) => (category === 'Phones' || category === 'Electronics') && priceKobo >= SERIAL_FROM_KOBO

export function serialError(category: Category, priceKobo: Kobo, serial: string): string | null {
  const s = serial.trim()
  if (!s) return needsSerial(category, priceKobo) ? 'Add the serial or IMEI number.' : null
  if (!/^[A-Za-z0-9-]{4,40}$/.test(s) || (/^[0-9]{15}$/.test(s) && category === 'Phones' && !imeiValid(s))) return 'That serial or IMEI number doesn’t look right.'
  return null
}

export const needsProofOfPurchase = (individual: boolean, priceKobo: Kobo) => individual && priceKobo > PROOF_ABOVE_KOBO

export interface ProofInput {
  videoRequired: boolean
  individual: boolean
  hasVideo: boolean
  hasProof: boolean
  category: Category
  priceKobo: Kobo
  serial: string
}

export function proofErrors(p: ProofInput): string[] {
  const errors: string[] = []
  if (p.videoRequired && !p.hasVideo) errors.push('Record a short video of the item with your code.')
  const serial = serialError(p.category, p.priceKobo, p.serial)
  if (serial) errors.push(serial)
  if (needsProofOfPurchase(p.individual, p.priceKobo) && !p.hasProof) errors.push('Add a photo of your receipt or other proof you bought it.')
  return errors
}

/** Only for individuals until they've had 3 deliveries that weren't refunded. `adding` is 1 for a new listing. */
export function newSellerLimitError(s: { individual: boolean; deliveries: number; live: number; priceKobo: Kobo; adding: number }): string | null {
  if (!s.individual || s.deliveries >= NEW_SELLER.deliveriesNeeded) return null
  if (s.priceKobo > NEW_SELLER.maxPriceKobo) return `New sellers can list items up to ${formatNaira(NEW_SELLER.maxPriceKobo)} until they’ve had ${NEW_SELLER.deliveriesNeeded} successful deliveries.`
  if (s.live + s.adding > NEW_SELLER.maxLive) return `New sellers can have ${NEW_SELLER.maxLive} items on sale or in review until they’ve had ${NEW_SELLER.deliveriesNeeded} successful deliveries.`
  return null
}
