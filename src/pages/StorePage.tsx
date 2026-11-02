import { useState } from 'react'
import { useParams } from 'react-router'
import { useListings, useShop } from '@/api/hooks'
import { CheckIcon, ClockIcon, IdCardIcon, MapPinIcon, PhoneIcon, ShieldIcon, StoreIcon } from '@/components/icons'
import { ListingGrid } from '@/components/ListingGrid'
import { ShopRating, ShopReviewsSection } from '@/components/Reviews'
import { NoProductMatch, ProductSearch } from '@/components/ProductId'
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { listingMatchesSearch } from '@/domain/productCode'
import { BUYING_TERMS, verifiedSince } from '@/domain/shopProfile'

/** /stores/:id: a shop's public page, and everything it has on sale. */
export function StorePage({ merchantId }: { merchantId?: string }) {
  const params = useParams()
  const id = merchantId ?? params.id ?? ''
  const shop = useShop(id)
  const listings = useListings({ status: ['live', 'for_sale'], merchantId: id })
  const [search, setSearch] = useState('')

  if (shop.isPending) return <Skeleton className="h-96" />
  if (shop.isError) return <ErrorState error={shop.error} onRetry={() => shop.refetch()} />
  const m = shop.data
  const store = m.kind !== 'individual'
  const since = verifiedSince(m.verifiedAt)
  const found = (listings.data ?? []).filter((l) => listingMatchesSearch(l, search))

  return (
    <div className="flex flex-col gap-6">
      <div className="relative">
        <div className="aspect-[3/1] max-h-64 w-full overflow-hidden rounded-[28px] bg-linear-to-br from-hero to-hero-2">
          {m.coverUrl ? <img src={m.coverUrl} alt="" className="size-full object-cover" /> : null}
        </div>
        <div className="-mt-10 flex flex-wrap items-start gap-x-4 gap-y-3 px-4 sm:px-6">
          <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl border-4 border-ground bg-brand-soft font-display text-3xl font-extrabold text-brand-ink shadow-card">
            {m.logoUrl ? <img src={m.logoUrl} alt={`${m.name} logo`} className="size-full object-cover" /> : m.name.charAt(0)}
          </span>
          <div className="flex min-w-0 flex-col gap-1 sm:mt-12">
            <h1 className="font-display text-2xl leading-tight font-extrabold tracking-tight sm:text-3xl">{m.name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-subtle">
              {m.verified ? (
                <Badge>
                  {store ? <CheckIcon size={12} /> : <IdCardIcon size={12} />} {store ? 'Verified store' : 'ID-verified seller'}{since ? ` since ${since}` : ''}
                </Badge>
              ) : null}
              <span className="flex items-center gap-1">
                <MapPinIcon size={14} /> {m.area}, Lagos
              </span>
              <ShopRating merchantId={m.id} className="text-sm" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
        <Card className="flex flex-col gap-3 p-5 text-sm">
          <strong>About {m.name}</strong>
          <p className="whitespace-pre-line text-muted">{m.about || (store ? 'This store hasn’t written about itself yet.' : 'This seller hasn’t written about themselves yet.')}</p>
          {m.openingHours ? (
            <span className="flex items-center gap-2 text-muted">
              <ClockIcon size={14} className="shrink-0" /> {m.openingHours}
            </span>
          ) : null}
          {m.publicPhone ? (
            <a href={`tel:${m.publicPhone.replace(/\s/g, '')}`} className="flex min-h-11 w-fit items-center gap-2 font-bold">
              <PhoneIcon size={14} /> {m.publicPhone}
            </a>
          ) : null}
          {m.cacNumber ? (
            <span className="flex items-center gap-2 text-muted">
              <StoreIcon size={14} className="shrink-0" /> CAC registration {m.cacNumber}
            </span>
          ) : null}
        </Card>
        <Card className="flex flex-col gap-3 p-5 text-sm">
          <strong className="flex items-center gap-2">
            <ShieldIcon size={16} className="text-brand" /> Buying from {m.name}
          </strong>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted">
            {BUYING_TERMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {m.shopNote ? (
            <p className="rounded-xl bg-ground p-3 text-muted">
              <strong className="text-ink">From the seller: </strong>
              {m.shopNote}
            </p>
          ) : null}
        </Card>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-extrabold">On sale now</h2>
        {listings.data?.length ? <ProductSearch value={search} onChange={setSearch} /> : null}
        {listings.isPending ? (
          <Skeleton className="h-60" />
        ) : listings.isError ? (
          <ErrorState error={listings.error} onRetry={() => listings.refetch()} />
        ) : found.length ? (
          <ListingGrid listings={found} />
        ) : search.trim() ? (
          <NoProductMatch query={search} />
        ) : (
          <EmptyState icon={StoreIcon} title="Nothing on sale right now" body="Check back soon, or save something you like to hear when it’s back." />
        )}
      </section>

      <ShopReviewsSection merchantId={m.id} />
    </div>
  )
}
