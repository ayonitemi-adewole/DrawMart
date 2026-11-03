/**
 * Jobs that work without signal. A rider's own unfinished jobs (address, map pin,
 * contact, checklist) are kept on their phone for OFFLINE_KEEP_HOURS, so a poor-signal
 * area doesn't strand them; nothing in the pool and nothing finished is kept, and it's
 * wiped on sign-out. Actions wait for signal and retry on their own (TanStack Query
 * pauses mutations offline), and a delivery is never shown as confirmed until the
 * server has checked the PIN.
 */
export const OFFLINE_KEEP_HOURS = 24

export interface SavedJobs<T> {
  userId: string
  savedAt: number
  jobs: T[]
}

/** Only what the rider has and still needs: on its way, or a refused item going back. */
export function deliveryJobsToKeep<T extends { mine: boolean; status: string; atCounterAt: string | null; returning: boolean }>(jobs: readonly T[]): T[] {
  return jobs.filter((j) => j.mine && !j.atCounterAt && (j.status === 'dispatched' || j.returning))
}

/** A buyer's return the rider is collecting or taking back. */
export function returnJobsToKeep<T extends { mine: boolean; status: string }>(jobs: readonly T[]): T[] {
  return jobs.filter((j) => j.mine && (j.status === 'awaiting_pickup' || j.status === 'returning'))
}

/** Saved for this account, and recent enough to trust. */
export function savedJobsFor<T>(saved: SavedJobs<T> | null, userId: string | null, nowMs: number): SavedJobs<T> | null {
  if (!saved || !userId || saved.userId !== userId) return null
  if (nowMs - saved.savedAt > OFFLINE_KEEP_HOURS * 3_600_000) return null
  return saved
}
