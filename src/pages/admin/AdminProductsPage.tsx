import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useListings } from '@/api/hooks'
import { HashIcon } from '@/components/icons'
import { Pagination } from '@/components/Pagination'
import { NoProductMatch, ProductId, ProductSearch } from '@/components/ProductId'
import { Badge, Card, EmptyState, ErrorState, PageTitle, ProductImage, Skeleton, type Tone } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import { listingMatchesSearch } from '@/domain/productCode'
import type { ListingStatus } from '@/domain/types'
import { paginate } from '@/lib/paginate'
import { useSearchParam } from '@/lib/useSearchParam'
import { shortDate } from '@/lib/time'

const PAGE_SIZE = 20

const STATUS: Record<ListingStatus, { label: string; tone: Tone }> = {
  pending_review: { label: 'In review', tone: 'ticket' },
  live: { label: 'Live draw', tone: 'brand' },
  sold_out: { label: 'Sold out, winner coming', tone: 'ticket' },
  drawn: { label: 'Drawn', tone: 'sky' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  for_sale: { label: 'On sale', tone: 'brand' },
  sold: { label: 'Sold', tone: 'sky' },
  rejected: { label: 'Rejected', tone: 'hot' },
}
const ALL_STATUSES = Object.keys(STATUS) as ListingStatus[]

/** /admin/products: every product in any state, to find one from its ID. */
export function AdminProductsPage() {
  const q = useListings({ status: ALL_STATUSES })
  const [params] = useSearchParams()
  const search = useSearchParam()
  const query = params.get('q') ?? ''
  const page = Number(params.get('page') ?? '1')

  const matching = useMemo(() => (q.data ?? []).filter((l) => listingMatchesSearch(l, query)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [q.data, query])
  const current = paginate(matching, page, PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Admin" sub="Every product on DrawMart, in any state. Paste a product ID to find one." action={q.data ? <Badge tone="neutral">{q.data.length.toLocaleString('en-NG')} products</Badge> : null}>
        All products
      </PageTitle>
      <ProductSearch value={search.text} onChange={search.change} placeholder="Search by product ID, name or seller" />
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={HashIcon} title="No products yet" body="Every listing shows up here as soon as it’s submitted." />
      ) : matching.length === 0 ? (
        <NoProductMatch query={query} />
      ) : (
        <>
          <Card className="divide-y divide-line overflow-hidden">
            {current.items.map((l) => (
              <div key={l.id} className="flex items-center gap-3 p-4">
                <ProductImage category={l.category} src={l.images[0]} alt="" size="sm" className="size-14 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="min-w-0 truncate">{l.title}</strong>
                    <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                  </div>
                  <ProductId code={l.productCode} copy />
                  <span className="text-xs text-subtle">
                    {l.merchant.name} · {l.kind === 'raffle' ? 'Raffle' : 'Regular product'} · {formatNaira(l.priceKobo)} · added {shortDate(l.createdAt)}
                  </span>
                </div>
              </div>
            ))}
          </Card>
          <Pagination page={current.page} pages={current.pages} />
        </>
      )}
    </div>
  )
}
