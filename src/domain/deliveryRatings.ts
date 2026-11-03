/**
 * Buyers rate the delivery itself, separately from the seller review: thumbs up or
 * down, with optional reasons for a down. They rate the delivery, never a named
 * rider, and riders only ever see totals: from RATINGS_SHOWN_FROM ratings, and only
 * ones given before today (Lagos), so a rider can't tell which buyer gave which.
 * On time is worked out from the order's own times. Admins see riders who need a
 * follow-up. Mirrored in public.rate_delivery, private.delivered_on_time,
 * public.my_rider_stats and public.rider_performance.
 */
import { REDELIVERY_WINDOW_HOURS } from './deliveryAttempts'
import { lagosDay } from './deliveryWindows'

export const RATE_WITHIN_DAYS = 7
/** Without a window, on time means handed over within this long of collecting. */
export const ON_TIME_HOURS = 4
/** Riders' and admins' numbers cover this many days. */
export const STATS_DAYS = 30
export const RATINGS_SHOWN_FROM = 5
/** A rider needs a follow-up from FOLLOW_UP_MIN_JOBS jobs or ratings in STATS_DAYS. */
export const FOLLOW_UP_MIN_JOBS = 5
export const FOLLOW_UP_ON_TIME_BELOW = 0.8
export const FOLLOW_UP_DOWN_ABOVE = 0.2

export type DeliveryRatingReason = 'late' | 'no_call' | 'rude' | 'careless' | 'unsafe'

export const RATING_REASONS: { reason: DeliveryRatingReason; label: string }[] = [
  { reason: 'late', label: 'Late' },
  { reason: 'no_call', label: 'Didn’t call first' },
  { reason: 'rude', label: 'Rude' },
  { reason: 'careless', label: 'Careless with the package' },
  { reason: 'unsafe', label: 'Made me feel unsafe' },
]
/** Any one of these is worth a call, whatever the totals. */
export const SERIOUS_REASONS: DeliveryRatingReason[] = ['rude', 'unsafe']

export interface DeliveryRating {
  good: boolean
  reasons: DeliveryRatingReason[]
  ratedAt: string
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Brought to the buyer's door by a rider, in the last RATE_WITHIN_DAYS. Pickup orders and cars aren't. */
export function canRateDelivery(o: { status: string; fulfilment: string; deliveredAt: string | null; category: string }, nowMs: number): boolean {
  return o.status === 'delivered' && o.fulfilment === 'delivery' && o.category !== 'Cars' && !!o.deliveredAt && Date.parse(o.deliveredAt) + RATE_WITHIN_DAYS * DAY > nowMs
}

export function ratingError(good: boolean, reasons: readonly string[]): string | null {
  if (good && reasons.length) return 'Reasons are only for a thumbs down.'
  if (new Set(reasons).size !== reasons.length || reasons.some((r) => !RATING_REASONS.some((x) => x.reason === r))) return 'Pick from the reasons shown.'
  return null
}

export interface TimedJob {
  collectedAt: string | null
  /** Handed to the buyer, or to a pickup counter. */
  doneAt: string
  windowEnd: string | null
  redeliverAt: string | null
}

/** Null when it can't be told (collected before this was recorded). */
export function deliveredOnTime(j: TimedJob): boolean | null {
  const done = Date.parse(j.doneAt)
  if (j.redeliverAt) return done <= Date.parse(j.redeliverAt) + REDELIVERY_WINDOW_HOURS * HOUR
  if (j.windowEnd) return done <= Date.parse(j.windowEnd)
  if (!j.collectedAt) return null
  return done - Date.parse(j.collectedAt) <= ON_TIME_HOURS * HOUR
}

export interface RiderStats {
  /** In the last STATS_DAYS. */
  completed: number
  /** Share from 0 to 1, or null with nothing to tell from. */
  onTimeShare: number | null
  /** Null until there are RATINGS_SHOWN_FROM. */
  ratings: { up: number; down: number; reasons: Partial<Record<DeliveryRatingReason, number>> } | null
}

const recent = (at: string, nowMs: number) => Date.parse(at) > nowMs - STATS_DAYS * DAY

function tally(ratings: readonly Pick<DeliveryRating, 'good' | 'reasons'>[]) {
  const reasons: Partial<Record<DeliveryRatingReason, number>> = {}
  for (const r of ratings) for (const x of r.reasons) reasons[x] = (reasons[x] ?? 0) + 1
  return { up: ratings.filter((r) => r.good).length, down: ratings.filter((r) => !r.good).length, reasons }
}

function onTimeShare(jobs: readonly TimedJob[]): number | null {
  const told = jobs.map(deliveredOnTime).filter((x): x is boolean => x !== null)
  return told.length ? told.filter(Boolean).length / told.length : null
}

/** What a rider sees about themselves. Ratings given today wait until tomorrow. */
export function riderStats(jobs: readonly TimedJob[], ratings: readonly DeliveryRating[], nowMs: number): RiderStats {
  const mine = jobs.filter((j) => recent(j.doneAt, nowMs))
  const today = lagosDay(nowMs)
  const shown = ratings.filter((r) => recent(r.ratedAt, nowMs) && lagosDay(Date.parse(r.ratedAt)) < today)
  return { completed: mine.length, onTimeShare: onTimeShare(mine), ratings: shown.length >= RATINGS_SHOWN_FROM ? tally(shown) : null }
}

export interface RiderPerformance {
  completed: number
  onTimeShare: number | null
  up: number
  down: number
  reasons: Partial<Record<DeliveryRatingReason, number>>
}

/** For admins: every rating counts, straight away. */
export function riderPerformance(jobs: readonly TimedJob[], ratings: readonly DeliveryRating[], nowMs: number): RiderPerformance {
  const mine = jobs.filter((j) => recent(j.doneAt, nowMs))
  return { completed: mine.length, onTimeShare: onTimeShare(mine), ...tally(ratings.filter((r) => recent(r.ratedAt, nowMs))) }
}

/** Why an admin should call this rider, if they should. */
export function followUpReasons(p: RiderPerformance): string[] {
  const out: string[] = []
  const serious = SERIOUS_REASONS.reduce((n, r) => n + (p.reasons[r] ?? 0), 0)
  if (serious) out.push(`${serious} ${serious === 1 ? 'buyer' : 'buyers'} said rude or unsafe`)
  if (p.completed >= FOLLOW_UP_MIN_JOBS && p.onTimeShare !== null && p.onTimeShare < FOLLOW_UP_ON_TIME_BELOW) out.push(`${percent(p.onTimeShare)} on time`)
  const rated = p.up + p.down
  if (rated >= FOLLOW_UP_MIN_JOBS && p.down / rated > FOLLOW_UP_DOWN_ABOVE) out.push(`${p.down} of ${rated} thumbs down`)
  return out
}

export const percent = (share: number) => `${Math.round(share * 100)}%`
