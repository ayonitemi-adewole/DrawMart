/**
 * Delivery windows. At checkout a delivery buyer can pick a morning, afternoon or
 * evening on one of WINDOW_DAYS days, or leave it as soon as it's ready. Windows count
 * from the latest the seller can mark the order ready (a confirm deadline, then a ready
 * deadline, each CONFIRM_HOURS of the seller's day: orderConfirm.ts), so a buyer is never
 * promised a time the seller can still miss. Riders can take a job from
 * WINDOW_POOL_OPENS on its window's day, and those jobs come first in the pool.
 * Mirrored in private.window_times, private.window_error, private.window_opens and take_group.
 */
import { addConfirmTime, CONFIRM_HOURS } from './orderConfirm'

export type WindowPart = 'morning' | 'afternoon' | 'evening'

/** Lagos hours. */
export const WINDOW_PARTS: { part: WindowPart; label: string; from: number; to: number }[] = [
  { part: 'morning', label: 'Morning', from: 9, to: 12 },
  { part: 'afternoon', label: 'Afternoon', from: 12, to: 16 },
  { part: 'evening', label: 'Evening', from: 16, to: 20 },
]
/** How many days a buyer can choose from. */
export const WINDOW_DAYS = 3
/** Riders can take a job from this Lagos hour on its window's day, and are told then. */
export const WINDOW_POOL_OPENS = 7

/** `day` is a Lagos calendar date, YYYY-MM-DD. */
export interface DeliveryWindow {
  day: string
  part: WindowPart
}

export interface WindowTimes {
  start: string
  end: string
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Lagos is always UTC+1. */
const LAGOS = HOUR

export const lagosDay = (ms: number) => new Date(ms + LAGOS).toISOString().slice(0, 10)
const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00Z`) - LAGOS

export function windowTimes(w: DeliveryWindow): WindowTimes {
  const p = WINDOW_PARTS.find((x) => x.part === w.part)!
  const day = dayStartMs(w.day)
  return { start: new Date(day + p.from * HOUR).toISOString(), end: new Date(day + p.to * HOUR).toISOString() }
}

/** The latest a seller can have it ready: confirming, then readying, both at the last minute. */
export const latestReadyMs = (orderedAtMs: number) => addConfirmTime(addConfirmTime(orderedAtMs, CONFIRM_HOURS), CONFIRM_HOURS)

/** What a buyer can pick, soonest first: windows starting once the seller must be ready, on the first WINDOW_DAYS days with one. */
export function offeredWindows(nowMs: number): DeliveryWindow[] {
  const from = latestReadyMs(nowMs)
  const out: DeliveryWindow[] = []
  const days = new Set<string>()
  for (let d = 0; days.size < WINDOW_DAYS || out.length === 0; d++) {
    const day = lagosDay(from + d * DAY)
    for (const p of WINDOW_PARTS) {
      if (Date.parse(windowTimes({ day, part: p.part }).start) < from) continue
      if (days.size === WINDOW_DAYS && !days.has(day)) break
      days.add(day)
      out.push({ day, part: p.part })
    }
  }
  return out
}

export function windowError(w: DeliveryWindow | null | undefined, nowMs: number): string | null {
  if (!w) return null
  return offeredWindows(nowMs).some((o) => o.day === w.day && o.part === w.part) ? null : 'Pick one of the times shown.'
}

/** When riders can take it: WINDOW_POOL_OPENS on the window's day. */
export const windowOpens = (start: string) => new Date(dayStartMs(lagosDay(Date.parse(start))) + WINDOW_POOL_OPENS * HOUR).toISOString()

/** No window, or its day has come. */
export const canTakeYet = (windowStart: string | null, nowMs: number) => !windowStart || Date.parse(windowOpens(windowStart)) <= nowMs

/** Why a rider can't take it yet, as take_group says. */
export function takeTooSoonError(windowStart: string | null, nowMs: number): string | null {
  if (canTakeYet(windowStart, nowMs)) return null
  const d = new Date(`${lagosDay(Date.parse(windowStart!))}T00:00:00Z`)
  return `This one is for ${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}. It can be taken from 7am that day.`
}

/** For the pool: 0 for a window today (or overdue), 1 for no window, 2 for a later day. */
export function windowRank(windowStart: string | null, nowMs: number): 0 | 1 | 2 {
  if (!windowStart) return 1
  return lagosDay(Date.parse(windowStart)) <= lagosDay(nowMs) ? 0 : 2
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Today", "Tomorrow" or "Wed 5 Nov", in Lagos. */
export function windowDayText(day: string, nowMs: number): string {
  if (day === lagosDay(nowMs)) return 'Today'
  if (day === lagosDay(nowMs + DAY)) return 'Tomorrow'
  const d = new Date(`${day}T00:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

const hourText = (ms: number) => {
  const h = new Date(ms + LAGOS).getUTCHours()
  return h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`
}

/** "9am–12pm". */
export const windowHoursText = (t: WindowTimes) => `${hourText(Date.parse(t.start))}–${hourText(Date.parse(t.end))}`

/** "Tomorrow, 9am–12pm". */
export const windowText = (t: WindowTimes, nowMs: number) => `${windowDayText(lagosDay(Date.parse(t.start)), nowMs)}, ${windowHoursText(t)}`
