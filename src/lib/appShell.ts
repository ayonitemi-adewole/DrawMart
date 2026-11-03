/**
 * Keeps the app itself on a rider's phone (public/sw.js), so their saved jobs open
 * without signal (domain/offlineJobs.ts). Production builds only: in development the
 * worker would get in the way of reloading. Asks nothing of the rider.
 */
export function keepAppForOffline() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* without it the app still works, just not from a cold start offline */
  })
}
