import { useListings } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { moreFromSeller, similarListings } from '@/domain/related'
import { ListingCard } from './ListingCard'
import { Skeleton } from './ui'

/** Under a listing: more from the same seller, then similar items from other sellers. */
export function RelatedListings({ listing }: { listing: ListingView }) {
  // Everything a buyer can act on, from the cache the home page already fills.
  const q = useListings({ status: ['live', 'for_sale'] })
  if (q.isPending) return <Skeleton className="h-80" />
  if (!q.data) return null // nice-to-have: stay quiet on errors

  const fromSeller = moreFromSeller(listing, q.data)
  const similar = similarListings(listing, q.data)
  if (!fromSeller.length && !similar.length) return null

  return (
    <div className="flex flex-col gap-10 border-t border-line pt-8">
      {fromSeller.length ? (
        <Row id="more-from-seller" eyebrow="Same seller" title={`More from ${listing.merchant.name}`} listings={fromSeller} />
      ) : null}
      {similar.length ? <Row id="similar-items" eyebrow={listing.category} title="Similar items" listings={similar} /> : null}
    </div>
  )
}

function Row({ id, eyebrow, title, listings }: { id: string; eyebrow: string; title: string; listings: ListingView[] }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby={id}>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">{eyebrow}</span>
        <h2 id={id} className="font-display text-2xl font-extrabold tracking-tight">
          {title}
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((l, i) => (
          <ListingCard key={l.id} listing={l} style={{ animationDelay: `${i * 50}ms` }} />
        ))}
      </div>
    </section>
  )
}
