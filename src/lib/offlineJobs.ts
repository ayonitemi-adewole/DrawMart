import { savedJobsFor, type SavedJobs } from '@/domain/offlineJobs'

/**
 * The rider's own unfinished jobs, kept on this phone so they open without signal
 * (domain/offlineJobs.ts). They hold buyers' addresses and numbers, so they're only
 * the rider's own, expire after a day, and go on sign-out. Storage can be missing or
 * full: then the app just works as before.
 */
const PREFIX = 'drawmart.offline.'

export function loadSavedJobs<T>(name: 'deliveries' | 'returns', userId: string | null): SavedJobs<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + name)
    return savedJobsFor(raw ? (JSON.parse(raw) as SavedJobs<T>) : null, userId, Date.now())
  } catch {
    return null
  }
}

export function saveJobs<T>(name: 'deliveries' | 'returns', userId: string, jobs: T[]) {
  try {
    if (jobs.length) localStorage.setItem(PREFIX + name, JSON.stringify({ userId, savedAt: Date.now(), jobs } satisfies SavedJobs<T>))
    else localStorage.removeItem(PREFIX + name)
  } catch {
    /* full or blocked: nothing kept, nothing broken */
  }
}

export function clearSavedJobs() {
  try {
    for (const name of ['deliveries', 'returns']) localStorage.removeItem(PREFIX + name)
  } catch {
    /* nothing to clear */
  }
}
