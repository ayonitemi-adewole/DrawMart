/**
 * Seller insights: how often a seller's listings are seen, and how often
 * that turns into a sale. The backend counts; these helpers summarise.
 *
 * A view is one visitor opening a listing page, counted at most once per
 * visitor per listing per day. The seller's own visits don't count.
 */
import type { Kobo } from './types'

export const METRIC_RANGES = [7, 30] as const
export type MetricRange = (typeof METRIC_RANGES)[number]

export interface ListingMetricsInput {
  /** Listing page views in the range (one per visitor per day). */
  views: number
  /** Different visitors in the range. */
  visitors: number
  /** Buyer chats started in the range. */
  chats: number
  /** Raffle tickets or product orders sold in the range. */
  units: number
  /** Different people who bought in the range. */
  buyers: number
  /** What buyers paid in the range. */
  salesKobo: Kobo
}

export interface DayMetrics {
  date: string // YYYY-MM-DD
  views: number
  salesKobo: Kobo
}

/** The Lagos calendar day (UTC+1, no daylight saving) of a moment, as YYYY-MM-DD. */
export function lagosDay(at: number | string): string {
  return new Date(new Date(at).getTime() + 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** Share of visitors who bought, in basis points (1250 = 12.5%). 0 with no visitors. */
export function conversionBps(buyers: number, visitors: number): number {
  if (visitors <= 0) return 0
  return Math.round((Math.min(buyers, visitors) / visitors) * 10_000)
}

export function formatRate(bps: number): string {
  const pct = bps / 100
  return `${pct >= 10 || Number.isInteger(pct) ? Math.round(pct) : pct.toFixed(1)}%`
}

export function sumMetrics(rows: ListingMetricsInput[]): ListingMetricsInput {
  return rows.reduce(
    (t, r) => ({
      views: t.views + r.views,
      visitors: t.visitors + r.visitors,
      chats: t.chats + r.chats,
      units: t.units + r.units,
      buyers: t.buyers + r.buyers,
      salesKobo: t.salesKobo + r.salesKobo,
    }),
    { views: 0, visitors: 0, chats: 0, units: 0, buyers: 0, salesKobo: 0 },
  )
}

/** One entry per day from `days - 1` days before `today` to `today`, filling gaps with zeros. */
export function fillDays(rows: DayMetrics[], days: number, today: string): DayMetrics[] {
  const byDate = new Map(rows.map((r) => [r.date, r]))
  const [y, m, d] = today.split('-').map(Number)
  const out: DayMetrics[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10)
    out.push(byDate.get(date) ?? { date, views: 0, salesKobo: 0 })
  }
  return out
}

export type InsightTip = 'not_seen' | 'seen_not_bought' | 'chats_not_bought' | 'converting'

/** Under this many visitors, a listing hasn't been seen enough to judge. */
export const MIN_VISITORS_FOR_TIP = 20

/** One plain-language nudge per live listing, or null when there's nothing useful to say. */
export function insightTip(m: ListingMetricsInput): InsightTip | null {
  if (m.visitors < MIN_VISITORS_FOR_TIP) return m.visitors === 0 ? 'not_seen' : null
  const rate = conversionBps(m.buyers, m.visitors)
  if (m.buyers === 0 && m.chats > 0) return 'chats_not_bought'
  if (rate < 100) return 'seen_not_bought' // under 1%
  if (rate >= 500) return 'converting' // 5% or more
  return null
}

export const INSIGHT_TIP_TEXT: Record<InsightTip, string> = {
  not_seen: 'No one has opened this yet. Share the link, and add clear photos so it stands out in the list.',
  seen_not_bought: 'Plenty of people look but few buy. Check the price against similar items, and add more photos or detail.',
  chats_not_bought: 'Buyers are asking questions but not buying yet. Answer quickly, and add those answers to the description.',
  converting: 'This one sells well for the attention it gets.',
}
