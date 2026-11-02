/**
 * Pricing tips for a new draw: how similar finished draws did. Mirrored in
 * supabase/migrations/…_draw_pricing_tips.sql. Only shown over enough draws, from
 * enough stores, that nobody can work out one store's sales from it.
 */
import { formatNaira } from './money'
import type { Category, ISODate, Kobo, ListingStatus } from './types'

/** The top of each ticket price band; anything above the last is the last band. */
export const TICKET_BAND_TOPS_KOBO: readonly Kobo[] = [50_000, 100_000, 250_000, 500_000, 1_000_000]
export const PRICING_MIN_DRAWS = 5
export const PRICING_MIN_STORES = 3
/** Raffles that have stopped selling, whether or not they sold out. */
export const FINISHED_DRAW_STATUSES: readonly ListingStatus[] = ['sold_out', 'drawn', 'refunded', 'for_sale', 'sold']
const DAY = 86_400_000

export function ticketBand(ticketKobo: Kobo): number {
  const i = TICKET_BAND_TOPS_KOBO.findIndex((top) => ticketKobo <= top)
  return i === -1 ? TICKET_BAND_TOPS_KOBO.length : i
}

export function ticketBandLabel(band: number): string {
  const tops = TICKET_BAND_TOPS_KOBO
  if (band <= 0) return `${formatNaira(tops[0])} or less`
  if (band >= tops.length) return `over ${formatNaira(tops[tops.length - 1])}`
  return `${formatNaira(tops[band - 1] + 100)}–${formatNaira(tops[band])}`
}

export interface PricingStats {
  category: Category
  band: number
  /** Null when there aren't enough draws or stores to show anything. */
  draws: number | null
  soldOut: number | null
  /** Over the ones that sold out. Null if none did. */
  avgDaysToSellOut: number | null
}

export interface FinishedDraw {
  merchantId: string
  category: Category
  ticketPriceKobo: Kobo
  status: ListingStatus
  soldOutAt: ISODate | null
  /** When it went on sale. Older draws don't have it: then their closing time less their length. */
  liveAt?: ISODate | null
  closesAt: ISODate
  durationDays: number
}

/** When a draw went on sale. */
export function liveStart(d: Pick<FinishedDraw, 'liveAt' | 'closesAt' | 'durationDays'>): number {
  return d.liveAt ? Date.parse(d.liveAt) : Date.parse(d.closesAt) - d.durationDays * DAY
}

export function pricingStats(draws: readonly FinishedDraw[], category: Category, band: number): PricingStats {
  const similar = draws.filter((d) => FINISHED_DRAW_STATUSES.includes(d.status) && d.category === category && ticketBand(d.ticketPriceKobo) === band)
  const enough = similar.length >= PRICING_MIN_DRAWS && new Set(similar.map((d) => d.merchantId)).size >= PRICING_MIN_STORES
  if (!enough) return { category, band, draws: null, soldOut: null, avgDaysToSellOut: null }
  const sold = similar.filter((d) => d.soldOutAt)
  const days = sold.map((d) => (Date.parse(d.soldOutAt!) - liveStart(d)) / DAY)
  return {
    category,
    band,
    draws: similar.length,
    soldOut: sold.length,
    avgDaysToSellOut: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
  }
}

/** The hint under the ticket price, or null when there's nothing to say. */
export function pricingTip(s: PricingStats): string | null {
  if (s.draws === null || s.soldOut === null) return null
  const which = `${s.category} draws with ${ticketBandLabel(s.band)} tickets`
  if (s.soldOut === 0) return `${which}: none of the last ${s.draws} sold out.`
  const days = s.avgDaysToSellOut ?? 0
  const when = days < 1 ? 'in under a day' : `in ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`
  return `${which}: ${s.soldOut} of ${s.draws} sold out, ${when} on average.`
}
