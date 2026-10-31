import { useState } from 'react'
import { usePrizeOrders } from '@/api/hooks'
import { TrophyIcon } from '@/components/icons'
import { OrderCard } from '@/components/OrderCard'
import { NoProductMatch, ProductSearch } from '@/components/ProductId'
import { Badge, EmptyState, ErrorState, PageTitle, Skeleton } from '@/components/ui'
import { matchesProductSearch } from '@/domain/productCode'

/** Won items in DrawMart's escrow waiting to be sent. Won cars stay with the dealer, who sends those. */
export function AdminPrizesPage() {
  const q = usePrizeOrders()
  const toSend = q.data?.filter((o) => o.status === 'paid').length ?? 0
  const [search, setSearch] = useState('')
  const found = q.data?.filter((o) => matchesProductSearch(search, o.productCode, o.listingTitle, o.merchantName)) ?? []
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Admin" sub="Items winners have arranged. Get them ready in escrow, then mark them ready for a rider." action={q.data ? <Badge tone={toSend ? 'ticket' : 'brand'}>{toSend} to send</Badge> : null}>
        Won items
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={TrophyIcon} title="Nothing to send" body="When a winner arranges their item, it shows up here with their delivery details." />
      ) : (
        <div className="flex flex-col gap-4">
          <ProductSearch value={search} onChange={setSearch} placeholder="Search by product ID, name or seller" />
          {found.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {found.map((o) => (
                <OrderCard key={o.id} order={o} audience="admin" />
              ))}
            </div>
          ) : (
            <NoProductMatch query={search} />
          )}
        </div>
      )}
    </div>
  )
}
