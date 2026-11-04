import { useListings } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { cartSuggestions, moreFromSeller, similarListings } from '@/domain/related'
import { browseHref } from '@/pages/BrowsePage'
import { ListingRow, SeeAllLink } from './ListingGrid'
import { Skeleton } from './ui'

/** Under a listing: a scrolling row from the same seller, then one of similar items, each linking to the full list. */
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
          seeAll={{ to: `/stores/${listing.merchant.id}`, label: `All from ${listing.merchant.name}` }}
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

/** Under the cart: the cart sellers' other items (same delivery), then items like what's in it. */
export function CartSuggestions({ cart }: { cart: ListingView[] }) {
  const q = useListings({ status: ['live', 'for_sale'] })
  if (q.isPending) return <Skeleton className="h-80" />
  if (!q.data) return null // nice-to-have: stay quiet on errors

  const { fromCartSellers, similar } = cartSuggestions(cart, q.data)
  if (!fromCartSellers.length && !similar.length) return null
  const onlySeller = new Set(fromCartSellers.map((l) => l.merchant.id)).size === 1 ? fromCartSellers[0].merchant : null

  return (
    <div className="flex flex-col gap-10 border-t border-line pt-8">
      {fromCartSellers.length ? (
        <Row
          id="cart-same-seller"
          eyebrow="Comes in the same delivery"
          title={onlySeller ? `More from ${onlySeller.name}` : 'More from these sellers'}
          listings={fromCartSellers}
          seeAll={onlySeller ? { to: `/stores/${onlySeller.id}`, label: `All from ${onlySeller.name}` } : undefined}
        />
      ) : null}
      {similar.length ? <Row id="cart-similar" eyebrow="Goes with your cart" title="You might also like" listings={similar} /> : null}
    </div>
  )
}

function Row({ id, eyebrow, title, listings, seeAll }: { id: string; eyebrow: string; title: string; listings: ListingView[]; seeAll?: { to: string; label: string } }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby={id}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">{eyebrow}</span>
          <h2 id={id} className="font-display text-2xl font-extrabold tracking-tight">
            {title}
          </h2>
        </div>
        {seeAll ? <SeeAllLink to={seeAll.to} label={seeAll.label} /> : null}
      </div>
      <ListingRow listings={listings} label={title} />
    </section>
  )
}
