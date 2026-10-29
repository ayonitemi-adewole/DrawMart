import { Link } from 'react-router'
import type { ListingView } from '@/api/types'
import { useColumns } from '@/lib/useColumns'
import { ArrowRightIcon } from './icons'
import { ListingCard } from './ListingCard'
import { buttonClass } from './ui'

/** The listing grid used across the buyer app: 1, 2 or 3 cards a row by screen width. */
export function ListingGrid({ listings }: { listings: ListingView[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {listings.map((l, i) => (
        <ListingCard key={l.id} listing={l} style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }} />
      ))}
    </div>
  )
}

/**
 * At most `rows` rows of cards (so the count follows the screen width), and a
 * "See all" link when there are more.
 */
export function CappedListingGrid({ listings, rows, seeAll }: { listings: ListingView[]; rows: number; seeAll: { to: string; label: string } }) {
  const cap = rows * useColumns()
  const more = listings.length > cap
  return (
    <div className="flex flex-col gap-4">
      <ListingGrid listings={listings.slice(0, cap)} />
      {more ? (
        <Link to={seeAll.to} className={buttonClass('outline', 'md', 'self-center')}>
          {seeAll.label} ({listings.length.toLocaleString('en-NG')}) <ArrowRightIcon size={16} />
        </Link>
      ) : null}
    </div>
  )
}

/** "See all" for a section heading, shown whether or not the grid is full. */
export function SeeAllLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="flex min-h-11 shrink-0 items-center gap-1 text-sm font-bold no-underline">
      {label} <ArrowRightIcon size={16} />
    </Link>
  )
}
