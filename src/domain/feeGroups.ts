/**
 * Rider pay follows the delivery fee the buyer paid. Orders from one seller in one
 * checkout share a single fee (deliveryFees.ts), so they travel as one job: taking or
 * assigning one takes every one of them that's ready, an order made ready later joins
 * the rider if they haven't collected yet, and the group counts as one job towards the
 * limit. The trip pays the rider once, at its largest package, as the buyer was charged;
 * a failed attempt at the door pays once per visit. An order made ready after the rider
 * has collected the rest is its own trip and pays on its own, so it still gets carried.
 * Won items have no fee and are always their own job.
 * Mirrored in private.fee_group, private.take_group, private.trip_size and private.trip_paid.
 */
import { PACKAGE_SIZES } from './deliveryFees'
import type { PackageSize } from './types'

/** Two failed attempts on one trip this close together are the same visit. */
export const ATTEMPT_VISIT_MINUTES = 30

export interface FeeGroupOrder {
  id: string
  checkoutId: string | null
  merchantId: string
  isPrize: boolean
}

export const feeGroupOf = (o: FeeGroupOrder) => (o.isPrize || !o.checkoutId ? o.id : `${o.checkoutId}:${o.merchantId}`)

export const largestSize = (sizes: readonly PackageSize[]): PackageSize => PACKAGE_SIZES[Math.max(0, ...sizes.map((s) => PACKAGE_SIZES.indexOf(s)))]

/** One pool card per group, where its first job was. */
export function mergeFeeGroups<T extends { feeGroup: string }>(jobs: readonly T[]): { lead: T; jobs: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const j of jobs) groups.set(j.feeGroup, [...(groups.get(j.feeGroup) ?? []), j])
  return [...groups.values()].map((g) => ({ lead: g[0], jobs: g }))
}

/** An earning already made on a trip: the same group, rider and moment it was taken. */
export interface TripEarning {
  feeGroup: string
  riderId: string
  takenAt: string | null
  kind: 'delivery' | 'return' | 'failed_attempt'
  at: string
}

export function tripAlreadyPaid(paid: readonly TripEarning[], next: TripEarning): boolean {
  return paid.some(
    (p) =>
      p.kind === next.kind &&
      p.feeGroup === next.feeGroup &&
      p.riderId === next.riderId &&
      p.takenAt === next.takenAt &&
      (next.kind !== 'failed_attempt' || Math.abs(Date.parse(next.at) - Date.parse(p.at)) <= ATTEMPT_VISIT_MINUTES * 60_000),
  )
}
