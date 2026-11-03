/**
 * The admin dispatch board: every active delivery and return, by stage, with the
 * stuck ones flagged. A job is stuck when it has waited in the pool longer than
 * STUCK_WAITING_HOURS, or a rider has been carrying it (to the buyer, or back to
 * the seller) longer than STUCK_CARRYING_HOURS. These are the defaults of
 * app_settings.dispatch_waiting_hours / dispatch_carrying_hours.
 *
 * Admins can give a waiting job to a rider, within that rider's limits (riderLimits.ts,
 * riderApplications.ts), or take back one a rider hasn't collected yet. Never one
 * that's been collected: the item is in the rider's hands, so it stays theirs until
 * it's handed over. Mirrored in public.dispatch_board, assign_job and unassign_job.
 */
import { windowOpens } from './deliveryWindows'
import { MAX_RIDER_JOBS } from './riderLimits'
import type { ClaimStatus } from './types'

export const STUCK_WAITING_HOURS = 3
export const STUCK_CARRYING_HOURS = 6

export type DispatchStage = 'waiting' | 'taken' | 'carrying' | 'at_counter' | 'failed' | 'returning'

export const DISPATCH_STAGES: { stage: DispatchStage; label: string; hint: string }[] = [
  { stage: 'waiting', label: 'Waiting', hint: 'In the pool, nobody has taken it' },
  { stage: 'taken', label: 'Taken', hint: 'A rider has it on their list but hasn’t collected it' },
  { stage: 'carrying', label: 'Collected', hint: 'On its way to the buyer or a pickup location' },
  { stage: 'at_counter', label: 'At a counter', hint: 'Waiting for the buyer at a pickup location' },
  { stage: 'failed', label: 'Failed attempt', hint: 'The rider couldn’t reach the buyer' },
  { stage: 'returning', label: 'Returning', hint: 'On its way back to the seller' },
]

export interface StuckLimits {
  waitingHours: number
  carryingHours: number
}
export const DEFAULT_STUCK_LIMITS: StuckLimits = { waitingHours: STUCK_WAITING_HOURS, carryingHours: STUCK_CARRYING_HOURS }

/** `since` is when the job reached its stage. */
export function dispatchStuck(stage: DispatchStage, since: string | null, nowMs: number, limits: StuckLimits = DEFAULT_STUCK_LIMITS): boolean {
  const hours = stage === 'waiting' ? limits.waitingHours : stage === 'carrying' || stage === 'returning' ? limits.carryingHours : null
  return hours !== null && since !== null && Date.parse(since) + hours * 3_600_000 <= nowMs
}

export interface StageAt {
  stage: DispatchStage
  since: string | null
}

export interface DispatchOrderFacts {
  status: string
  hasRider: boolean
  riderTakenAt: string | null
  dispatchedAt: string | null
  collectedAt: string | null
  atCounterAt: string | null
  counterOutAt: string | null
  returnState: 'returning' | 'returned' | null
  failedAttempts: number
  lastFailedAt: string | null
  cancelledAt: string | null
  /** The buyer's delivery window: riders can't take it before its day (deliveryWindows.ts). */
  windowStart?: string | null
}

/** Where an order is, or null when nobody needs to move it. */
export function orderStage(o: DispatchOrderFacts): StageAt | null {
  if (o.returnState === 'returning') {
    // An uncollected item still on the counter's shelf waits for a rider like any other job.
    if (o.atCounterAt && !o.counterOutAt) return o.hasRider ? { stage: 'taken', since: o.riderTakenAt } : { stage: 'waiting', since: o.cancelledAt }
    return { stage: 'returning', since: o.counterOutAt ?? o.cancelledAt }
  }
  if (o.status !== 'dispatched') return null
  if (o.atCounterAt) return { stage: 'at_counter', since: o.atCounterAt }
  // Waiting counts from when riders could take it: a job for a later day isn't stuck yet.
  if (!o.hasRider) return { stage: 'waiting', since: o.windowStart && o.dispatchedAt && Date.parse(windowOpens(o.windowStart)) > Date.parse(o.dispatchedAt) ? windowOpens(o.windowStart) : o.dispatchedAt }
  if (!o.collectedAt) return { stage: 'taken', since: o.riderTakenAt }
  if (o.failedAttempts > 0) return { stage: 'failed', since: o.lastFailedAt }
  return { stage: 'carrying', since: o.collectedAt }
}

export interface DispatchClaimFacts {
  status: ClaimStatus
  hasRider: boolean
  riderTakenAt: string | null
  openedAt: string | null
  pickedUpAt: string | null
}

/** A buyer's return: collected from them and brought back to the seller. */
export function claimStage(c: DispatchClaimFacts): StageAt | null {
  if (c.status === 'awaiting_pickup') return c.hasRider ? { stage: 'taken', since: c.riderTakenAt } : { stage: 'waiting', since: c.openedAt }
  if (c.status === 'returning') return { stage: 'returning', since: c.pickedUpAt }
  return null
}

export const canAssign = (stage: DispatchStage) => stage === 'waiting'

/** Like takeJobError, for the admin choosing the rider (assign_job). */
export function assignJobError(held: number, max = MAX_RIDER_JOBS): string | null {
  return held >= max ? `This rider has ${max} jobs, the most they can hold. Choose another, or take one back from them first.` : null
}
/** Only before collection: once collected, it's in the rider's hands. */
export const canTakeBack = (stage: DispatchStage) => stage === 'taken'

/** "45 min", "3 h 20 min", "2 days". */
export function waitedText(since: string, nowMs: number): string {
  const mins = Math.max(0, Math.floor((nowMs - Date.parse(since)) / 60_000))
  if (mins < 60) return `${mins} min`
  if (mins < 48 * 60) return mins % 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins / 60} h`
  return `${Math.floor(mins / 1440)} days`
}
