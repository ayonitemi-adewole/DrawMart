import { useState, type ReactNode } from 'react'
import { ClockIcon, XIcon } from '@/components/icons'
import { cx } from '@/components/ui'
import { recentSearchSuggestions } from '@/domain/feed'
import { clearSearches, recentSearches, removeSearch } from '@/lib/feedHistory'

/**
 * Wraps a search box: while it has focus, this device's recent searches show
 * under it (feedHistory.ts), each with a button to remove it, and a Clear all.
 * `inline` puts the list in the page's flow, for boxes inside something that
 * clips overflow (the explore hero); otherwise it drops over what's below.
 */
export function WithRecentSearches({ typed, onPick, inline, className, children }: { typed: string; onPick: (term: string) => void; inline?: boolean; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState<string[]>([])
  const shown = open ? recentSearchSuggestions(all, typed) : []

  function pick(term: string) {
    setOpen(false)
    onPick(term)
    // Puts the phone keyboard away so the results can be seen.
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  function remove(term: string) {
    removeSearch(term)
    setAll(recentSearches())
  }

  function clear() {
    clearSearches()
    setAll([])
  }

  return (
    <div
      className={cx('relative', className)}
      onFocus={() => {
        setAll(recentSearches())
        setOpen(true)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
        if (e.key === 'Enter') setOpen(false)
      }}
    >
      {children}
      {shown.length ? (
        <div
          // Taps on the list keep focus in the box, so it doesn't close before the tap lands.
          onMouseDown={(e) => e.preventDefault()}
          className={cx('z-30 overflow-hidden rounded-2xl bg-surface text-ink shadow-lift ring-1 ring-line', inline ? 'mt-2' : 'absolute top-full right-0 left-0 mt-2')}
        >
          <div className="flex items-center justify-between gap-2 pr-1 pl-4">
            <span className="text-xs font-extrabold tracking-wider text-subtle uppercase">Recent searches</span>
            <button type="button" onClick={clear} className="flex min-h-11 cursor-pointer items-center rounded-xl px-3 text-sm font-bold text-brand hover:bg-brand-soft">
              Clear all
            </button>
          </div>
          <ul aria-label="Recent searches" className="flex flex-col pb-1">
            {shown.map((term) => (
              <li key={term} className="flex items-center">
                <button type="button" onClick={() => pick(term)} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 text-left hover:bg-sunken">
                  <ClockIcon size={16} className="shrink-0 text-subtle" />
                  <span className="truncate">{term}</span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(term)}
                  aria-label={`Remove “${term}” from recent searches`}
                  className="mr-1 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-subtle hover:bg-sunken hover:text-ink"
                >
                  <XIcon size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
