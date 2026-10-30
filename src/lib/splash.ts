/**
 * The loading screen (#splash in index.html). It's up from the first paint of
 * every full page load; `SplashController` in App.tsx hides it once the app is
 * ready and shows it again after signing in.
 */

/** Stay up at least this long, so it never just flickers. */
const MIN_MS = 800
/** Never block the app longer than this, however long loading takes. */
const MAX_MS = 6000

let shownAt = 0 // performance.now() starts at page load, so a fresh load counts from there
let hideTimer: ReturnType<typeof setTimeout> | undefined
let maxTimer: ReturnType<typeof setTimeout> | undefined

const splash = () => (typeof document === 'undefined' ? null : document.getElementById('splash'))

function hideNow() {
  clearTimeout(hideTimer)
  clearTimeout(maxTimer)
  hideTimer = maxTimer = undefined
  const el = splash()
  if (!el) return
  el.setAttribute('data-hidden', '')
  el.inert = true
}

if (splash()) maxTimer = setTimeout(hideNow, MAX_MS)

const isShown = () => !!splash() && !splash()!.hasAttribute('data-hidden')

export function showSplash() {
  const el = splash()
  if (!el) return
  el.removeAttribute('data-hidden')
  el.inert = false
  shownAt = performance.now()
  clearTimeout(hideTimer)
  clearTimeout(maxTimer)
  hideTimer = undefined
  maxTimer = setTimeout(hideNow, MAX_MS)
}

/** Hides it once it has been up for the minimum time. */
export function hideSplash() {
  if (!isShown() || hideTimer) return
  hideTimer = setTimeout(hideNow, Math.max(0, shownAt + MIN_MS - performance.now()))
}

/** Something started loading again: keep it up (until the maximum time). */
export function holdSplash() {
  clearTimeout(hideTimer)
  hideTimer = undefined
}
