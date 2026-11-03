import { useRef, useState } from 'react'
import { SearchIcon, XIcon } from '@/components/icons'
import { ProductSearch } from '@/components/ProductId'
import { WithRecentSearches } from '@/components/RecentSearches'
import { useExploreSearch } from '@/lib/useSearchParam'

/** The explore page's search, from anywhere on the page: an icon that opens a box over the top bar. */
export function HeaderSearch() {
  const search = useExploreSearch()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

  function close() {
    search.submit('')
    setOpen(false)
    // The box is about to go, so focus goes back to what opened it.
    requestAnimationFrame(() => button.current?.focus())
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search products"
        className="flex size-11 cursor-pointer items-center justify-center rounded-xl text-muted hover:bg-sunken hover:text-ink"
      >
        <SearchIcon size={20} />
      </button>
      {open ? (
        <div
          className="absolute inset-0 z-10 bg-ground"
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            // Enter searches (phones don't search while typing) and puts the keyboard away.
            if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
              search.submit()
              e.target.blur()
            }
          }}
        >
          <div className="mx-auto flex h-full max-w-2xl items-center gap-2 px-4 sm:px-6">
            <WithRecentSearches typed={search.text} onPick={(term) => search.submit(term)} className="min-w-0 flex-1">
              <ProductSearch id="header-search" value={search.text} onChange={search.change} placeholder="Search items or a product ID" autoFocus className="sm:max-w-none!" />
            </WithRecentSearches>
            <button
              type="button"
              onClick={close}
              aria-label="Close search"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted hover:bg-sunken hover:text-ink"
            >
              <XIcon size={20} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
