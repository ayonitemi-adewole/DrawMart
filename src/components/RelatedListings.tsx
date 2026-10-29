import { useListings } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { moreFromSeller, similarListings } from '@/domain/related'
import { browseHref } from '@/pages/BrowsePage'
import { CappedListingGrid, SeeAllLink } from './ListingGrid'
import { Skeleton } from './ui'

/** Under a listing: one row from the same seller, then one row of similar items, each linking to the full list. */
export function RelatedListings({ listing }: { listing: ListingView }) {
  // Everything a buyer can act on, from the cache the home page already fills.
  const q = useListings({ status: ['live', 'for_sale'] })
  if (q.isPending) return <Skeleton className="h-80" />
  if (!q.data) return null // nice-to-have: stay quiet on errors

  const fromSeller = moreFromSeller(listing, q.data, Infinity)
  const similar = similarListings(listing, q.data, Infinity)
  if (!fromSeller.length && !similar.length) return null

  return (
    <div className="flex flex-col gap-10 border-t border-line pt-8">
      {fromSeller.length ? (
        <Row
          id="more-from-seller"
          eyebrow="Same seller"
          title={`More from ${listing.merchant.name}`}
          listings={fromSeller}
          seeAll={{ to: browseHref({ seller: listing.merchant.id }), label: `All from ${listing.merchant.name}` }}
        />
      ) : null}
      {similar.length ? (
        <Row
          id="similar-items"
          eyebrow={listing.category}
          title="Similar items"
          listings={similar}
          seeAll={{ to: browseHref({ category: listing.category }), label: `All ${listing.category.toLowerCase()}` }}
        />
      ) : null}
    </div>
  )
}

function Row({ id, eyebrow, title, listings, seeAll }: { id: string; eyebrow: string; title: string; listings: ListingView[]; seeAll: { to: string; label: string } }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby={id}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">{eyebrow}</span>
          <h2 id={id} className="font-display text-2xl font-extrabold tracking-tight">
            {title}
          </h2>
        </div>
        <SeeAllLink to={seeAll.to} label={seeAll.label} />
      </div>
      <CappedListingGrid listings={listings} rows={1} seeAll={{ ...seeAll, label: 'See all' }} />
    </section>
  )
}
