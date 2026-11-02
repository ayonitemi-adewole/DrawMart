/**
 * A new shop's getting-started checklist, worked out from what it already has: nothing
 * is stored except a skipped call number, which lives in the browser.
 */
import type { Merchant } from './types'

export type StartStep = 'verified' | 'payouts' | 'pickup' | 'profile' | 'calls' | 'listing'

export interface StartFacts {
  verified: boolean
  payoutAccount: boolean
  /** Where riders collect from (shopPickup.ts). */
  pickupSpot: boolean
  profile: boolean
  /** A call number set, or the step skipped. */
  callsDecided: boolean
  listed: boolean
}

const ORDER: StartStep[] = ['verified', 'payouts', 'pickup', 'profile', 'calls', 'listing']
const FACT: Record<StartStep, keyof StartFacts> = {
  verified: 'verified',
  payouts: 'payoutAccount',
  pickup: 'pickupSpot',
  profile: 'profile',
  calls: 'callsDecided',
  listing: 'listed',
}

export function startSteps(f: StartFacts): { step: StartStep; done: boolean }[] {
  return ORDER.map((step) => ({ step, done: f[FACT[step]] }))
}

/** The checklist goes once everything's done. */
export function startingDone(f: StartFacts): boolean {
  return startSteps(f).every((s) => s.done)
}

/** A logo or a few words about the shop (shopProfile.ts). */
export function profileStarted(m: Pick<Merchant, 'about' | 'logoUrl'>): boolean {
  return !!(m.about?.trim() || m.logoUrl)
}
