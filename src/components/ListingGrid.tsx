import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { ListingView } from '@/api/types'
import { ArrowRightIcon, BackIcon, ChevronRightIcon } from './icons'
import { ListingCard } from './ListingCard'

/** The listing grid used on full lists (/browse): 1, 2 or 3 cards a row by screen width. */
export function ListingGrid({ listings }: { listings: ListingView[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {listings.map((l, i) => (
        <ListingCard key={l.id} listing={l} style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }} />
      ))}
    </div>
  )
}

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * One row of cards that scrolls sideways. At most 4 cards show at once on
 * large screens (3 whole, the 4th three-quarters in, so it's clear there's
 * more), 2 + ¾ on tablets and 1 + ¾ on phones. Swipe on touch screens;
 * arrow buttons on larger ones. Widths: `.listing-row-item` in index.css.
 */
export function ListingRow({ listings, label }: { listings: ListingView[]; label: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 })
  }, [])

  useEffect(() => {
    measure()
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, listings.length])

  const page = (dir: 1 | -1) => {
    const el = scroller.current
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  const arrow = 'absolute top-1/2 z-10 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-lift transition hover:scale-105 md:flex'

  return (
    <div className="relative">
      <div
        ref={scroller}
        onScroll={measure}
        role="list"
        aria-label={label}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pt-1 pb-3 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0"
      >
        {listings.map((l, i) => (
          <div key={l.id} role="listitem" className="listing-row-item flex shrink-0 snap-start">
            <ListingCard listing={l} compact className="w-full" style={{ animationDelay: `${Math.min(i, 4) * 50}ms` }} />
          </div>
        ))}
      </div>
      {!edges.start ? (
        <button type="button" onClick={() => page(-1)} aria-label={`Scroll ${label} back`} className={`${arrow} -left-3`}>
          <BackIcon size={20} />
        </button>
      ) : null}
      {!edges.end ? (
        <button type="button" onClick={() => page(1)} aria-label={`Scroll ${label} forward`} className={`${arrow} -right-3`}>
          <ChevronRightIcon size={20} />
        </button>
      ) : null}
    </div>
  )
}

/** "See all" for a row's heading: opens the full list. */
export function SeeAllLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="flex min-h-11 shrink-0 items-center gap-1 text-sm font-bold no-underline">
      {label} <ArrowRightIcon size={16} />
    </Link>
  )
}
