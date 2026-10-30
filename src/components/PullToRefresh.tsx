import { useEffect, useRef } from 'react'
import { isSplashShown, showSplash } from '@/lib/splash'
import { RefreshIcon } from './icons'

/** How far (after resistance) the indicator must be pulled to reload. */
const THRESHOLD = 72
/** The indicator never comes down further than this. */
const MAX = 110
const SIZE = 40

/** Rubber band: the indicator follows the finger, then slows as it nears MAX. */
const resist = (dy: number) => MAX * (1 - Math.exp(-dy / (MAX * 1.2)))

/**
 * Opened from the home screen, without browser controls. Browser tabs keep the
 * browser's own pull-to-refresh. iOS also reports this as navigator.standalone.
 */
const isHomeScreenApp = () =>
  matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

/** True when the touch is somewhere a downward drag means something else. */
function blocked(target: EventTarget | null) {
  if (window.scrollY > 0 || isSplashShown() || document.querySelector('dialog[open]')) return true
  // Inside a box that is scrolled down: the drag scrolls that box back up.
  for (let n = target instanceof Element ? target : null; n && n !== document.body; n = n.parentElement) {
    if (n.scrollTop > 0) return true
  }
  return false
}

/**
 * Swipe down from the top of any page to reload it, in the app added to the
 * home screen, which has no reload button. The page's overscroll bounce is
 * switched off there in index.css so it doesn't fight the pull. Decorative and
 * hidden from screen readers.
 */
export function PullToRefresh() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isHomeScreenApp()) return
    const el = ref.current!
    const icon = el.querySelector<HTMLElement>('[data-icon]')!
    let start: { x: number; y: number } | null = null
    let pulling = false
    let offset = 0

    // Styles are set directly, so following the finger doesn't re-render React.
    const place = (y: number, animate: boolean) => {
      el.style.transition = animate ? 'transform 0.25s ease, opacity 0.25s ease' : 'none'
      el.style.transform = `translate(-50%, ${y - SIZE}px)`
      el.style.opacity = String(Math.min(1, y / THRESHOLD))
      el.toggleAttribute('data-ready', y >= THRESHOLD)
      icon.style.transform = `rotate(${y * 3}deg)`
    }

    const onStart = (e: TouchEvent) => {
      start = e.touches.length === 1 && !blocked(e.target) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null
      pulling = false
    }

    const onMove = (e: TouchEvent) => {
      if (!start) return
      const dx = e.touches[0].clientX - start.x
      const dy = e.touches[0].clientY - start.y
      if (!pulling) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        // Sideways (photo swipers, scrolling rows) or upwards: not a pull.
        if (dy <= 0 || Math.abs(dx) > dy || window.scrollY > 0) {
          start = null
          return
        }
        pulling = true
      }
      offset = resist(Math.max(0, dy))
      place(offset, false)
    }

    const onEnd = (e: TouchEvent) => {
      if (pulling && offset >= THRESHOLD && e.type === 'touchend') {
        el.setAttribute('data-refreshing', '')
        place(THRESHOLD, true)
        showSplash()
        window.location.reload()
      } else if (pulling) {
        place(0, true)
      }
      start = null
      pulling = false
      offset = 0
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="group pointer-events-none fixed top-[max(env(safe-area-inset-top),8px)] left-1/2 z-[80] opacity-0"
    >
      <span className="flex size-10 items-center justify-center rounded-full border border-line bg-raised text-brand shadow-lift transition-colors group-data-ready:border-brand group-data-ready:bg-brand group-data-ready:text-on-brand">
        <span data-icon className="flex group-data-refreshing:motion-safe:animate-spin">
          <RefreshIcon size={20} strokeWidth={2.4} />
        </span>
      </span>
    </div>
  )
}
