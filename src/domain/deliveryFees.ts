/**
 * What delivery costs: one fee per seller, by where it leaves from, where it's going
 * and the package size. Mirrored in supabase/migrations/…_delivery_fees.sql.
 */
import type { Category, GeoPoint, Kobo, Listing, Merchant, PackageSize } from './types'

export const MIN_DELIVERY_KOBO = 100_000 // ₦1,000
export const MAX_DELIVERY_KOBO = 500_000 // ₦5,000
export const MAX_SIZE_EXTRA_KOBO = 400_000

export const PACKAGE_SIZES: readonly PackageSize[] = ['small', 'medium', 'large']

export const PACKAGE_SIZE_TEXT: Record<PackageSize, { label: string; sub: string }> = {
  small: { label: 'Small', sub: 'Fits in a bag: a phone, clothes, a small gadget.' },
  medium: { label: 'Medium', sub: 'Carried in both hands: a microwave, a small TV, a box of items.' },
  large: { label: 'Large', sub: 'Needs tying on or a van: a fridge, a big TV, furniture.' },
}

export function defaultSizeFor(category: Category): PackageSize {
  return category === 'Phones' || category === 'Fashion' ? 'small' : category === 'Electronics' ? 'medium' : 'large'
}

export function packageSizeOf(l: Pick<Listing, 'category'> & { packageSize?: PackageSize | null }): PackageSize {
  return l.packageSize ?? defaultSizeFor(l.category)
}

export interface DeliveryArea {
  id: string
  name: string
  lat: number
  lng: number
}

export interface DeliveryPricing {
  areas: DeliveryArea[]
  /** The price for a small package, one row per pair of areas. */
  prices: { areaA: string; areaB: string; priceKobo: Kobo }[]
  sizeExtras: Record<PackageSize, Kobo>
}

/** The checked order matters: "Victoria Island" must find its own area before "Lagos Island". */
const AREAS: (DeliveryArea & { keywords: string[] })[] = [
  { id: 'ikeja', name: 'Ikeja and Maryland', lat: 6.59, lng: 3.35, keywords: ['ikeja', 'maryland', 'ogba', 'ojota', 'gbagada', 'magodo', 'ketu', 'anthony'] },
  { id: 'yaba', name: 'Yaba and Surulere', lat: 6.5, lng: 3.37, keywords: ['yaba', 'surulere', 'mushin', 'ebute', 'oshodi', 'isolo'] },
  { id: 'vi', name: 'Victoria Island and Ikoyi', lat: 6.43, lng: 3.43, keywords: ['victoria', 'ikoyi', 'oniru'] },
  { id: 'island', name: 'Lagos Island', lat: 6.455, lng: 3.39, keywords: ['island', 'marina', 'obalende'] },
  { id: 'lekki', name: 'Lekki and Ajah', lat: 6.45, lng: 3.49, keywords: ['lekki', 'ajah', 'chevron', 'sangotedo', 'ikate'] },
  { id: 'ikorodu', name: 'Ikorodu', lat: 6.62, lng: 3.51, keywords: ['ikorodu'] },
  { id: 'agege', name: 'Agege and Alimosho', lat: 6.62, lng: 3.3, keywords: ['agege', 'alimosho', 'iyana', 'egbeda', 'ikotun', 'iju'] },
  { id: 'apapa', name: 'Apapa and Festac', lat: 6.46, lng: 3.3, keywords: ['apapa', 'festac', 'amuwo', 'satellite', 'ojo', 'ajegunle'] },
  { id: 'badagry', name: 'Badagry', lat: 6.42, lng: 2.89, keywords: ['badagry'] },
  { id: 'epe', name: 'Epe', lat: 6.58, lng: 3.98, keywords: ['epe'] },
]
export const DELIVERY_AREAS: DeliveryArea[] = AREAS.map(({ id, name, lat, lng }) => ({ id, name, lat, lng }))
export const DEFAULT_AREA = 'ikeja'

/** The closest area to something typed, such as a seller's "Yaba". */
export function areaFromText(text: string): string {
  const t = text.toLowerCase()
  return AREAS.find((a) => a.keywords.some((k) => t.includes(k)))?.id ?? DEFAULT_AREA
}

export function sellerAreaOf(m: Pick<Merchant, 'area'> & { deliveryArea?: string | null }): string {
  return m.deliveryArea ?? areaFromText(m.area)
}

const COS_LAGOS = Math.cos((6.5 * Math.PI) / 180)

export function nearestArea(p: GeoPoint, areas: readonly DeliveryArea[]): string {
  let best = areas[0]
  let bestDistance = Infinity
  for (const a of areas) {
    const d = (a.lat - p.lat) ** 2 + ((a.lng - p.lng) * COS_LAGOS) ** 2
    if (d < bestDistance) {
      best = a
      bestDistance = d
    }
  }
  return best.id
}

/** Starting prices until real rider quotes replace them: ₦1,000 plus ₦600 per 10km, up to ₦3,500. */
export function placeholderPriceKobo(a: DeliveryArea, b: DeliveryArea): Kobo {
  const km = Math.sqrt(((a.lat - b.lat) * 111.32) ** 2 + ((a.lng - b.lng) * COS_LAGOS * 111.32) ** 2)
  return Math.min(350_000, MIN_DELIVERY_KOBO + Math.floor(km * 0.6 + 0.5) * 10_000)
}

export function placeholderPricing(): DeliveryPricing {
  const prices: DeliveryPricing['prices'] = []
  for (const a of DELIVERY_AREAS) {
    for (const b of DELIVERY_AREAS) {
      if (a.id <= b.id) prices.push({ areaA: a.id, areaB: b.id, priceKobo: placeholderPriceKobo(a, b) })
    }
  }
  return { areas: DELIVERY_AREAS, prices, sizeExtras: { small: 0, medium: 50_000, large: 150_000 } }
}

export function areaPairPrice(pricing: DeliveryPricing, from: string, to: string): Kobo {
  const [areaA, areaB] = from <= to ? [from, to] : [to, from]
  return pricing.prices.find((p) => p.areaA === areaA && p.areaB === areaB)?.priceKobo ?? MAX_DELIVERY_KOBO
}

export function deliveryFeeKobo(pricing: DeliveryPricing, from: string, to: GeoPoint, size: PackageSize): Kobo {
  return Math.min(MAX_DELIVERY_KOBO, areaPairPrice(pricing, from, nearestArea(to, pricing.areas)) + pricing.sizeExtras[size])
}

export interface SellerDeliveryFee {
  merchantId: string
  merchantName: string
  feeKobo: Kobo
}

type FeeListing = Pick<Listing, 'status' | 'category' | 'merchantId'> & { packageSize?: PackageSize | null; merchant: Pick<Merchant, 'name' | 'area'> & { deliveryArea?: string | null } }

/** One fee per seller, for their largest package. Cars and won items don't pay. */
export function checkoutDeliveryFees(listings: readonly FeeListing[], to: GeoPoint, pricing: DeliveryPricing): SellerDeliveryFee[] {
  const bySeller = new Map<string, FeeListing[]>()
  for (const l of listings) {
    if (l.status !== 'for_sale' || l.category === 'Cars') continue
    bySeller.set(l.merchantId, [...(bySeller.get(l.merchantId) ?? []), l])
  }
  return [...bySeller.entries()].map(([merchantId, lines]) => {
    const largest = PACKAGE_SIZES[Math.max(...lines.map((l) => PACKAGE_SIZES.indexOf(packageSizeOf(l))))]
    return { merchantId, merchantName: lines[0].merchant.name, feeKobo: deliveryFeeKobo(pricing, sellerAreaOf(lines[0].merchant), to, largest) }
  })
}

export function deliveryPriceError(priceKobo: Kobo): string | null {
  return Number.isInteger(priceKobo) && priceKobo >= MIN_DELIVERY_KOBO && priceKobo <= MAX_DELIVERY_KOBO ? null : 'A delivery price must be from ₦1,000 to ₦5,000.'
}

export function sizeExtraError(extraKobo: Kobo): string | null {
  return Number.isInteger(extraKobo) && extraKobo >= 0 && extraKobo <= MAX_SIZE_EXTRA_KOBO ? null : 'An extra must be from ₦0 to ₦4,000.'
}
