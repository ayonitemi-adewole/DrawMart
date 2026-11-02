/**
 * How much a rider can hold, and for how long. At most MAX_RIDER_JOBS jobs at
 * once, deliveries and returns together, and a job not collected within
 * COLLECT_WITHIN_MINUTES of being taken goes back to the pool, so nobody sits on
 * work others could do. Once collected there's no limit: it's in their hands.
 * These are the defaults of app_settings.rider_max_jobs / rider_collect_minutes,
 * which admins can tune (private.require_job_room, private.release_late_jobs).
 */
export const MAX_RIDER_JOBS = 5
export const COLLECT_WITHIN_MINUTES = 120
/** The job shows a warning this long before it goes back. */
export const COLLECT_WARNING_MINUTES = 30

export function takeJobError(held: number, max = MAX_RIDER_JOBS): string | null {
  return held >= max ? `You have ${max} jobs, the most you can hold at once. Deliver or hand one back first.` : null
}

/** When a job taken at takenAt goes back to the pool if it hasn't been collected. */
export const collectBy = (takenAt: string, minutes = COLLECT_WITHIN_MINUTES) => new Date(Date.parse(takenAt) + minutes * 60_000).toISOString()

export const collectionOverdue = (collectByAt: string, nowMs: number) => Date.parse(collectByAt) <= nowMs

/** Time to warn the rider: it goes back soon. */
export const collectSoon = (collectByAt: string, nowMs: number) => !collectionOverdue(collectByAt, nowMs) && Date.parse(collectByAt) - nowMs <= COLLECT_WARNING_MINUTES * 60_000
