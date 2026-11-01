import { useCancelRates } from '@/api/hooks'
import { CheckIcon } from '@/components/icons'
import { Badge, Card, EmptyState, ErrorState, PageTitle, Skeleton } from '@/components/ui'
import { CANCEL_FLAG_MIN, CANCEL_FLAG_PERCENT, cancelRateFlagged } from '@/domain/orderCancel'

/** /admin/cancellations: frequent cancellations hurt buyers, so sellers above the line get a follow-up. */
export function AdminCancellationsPage() {
  const q = useCancelRates()
  const rows = (q.data ?? []).filter((r) => r.cancelled > 0).sort((a, b) => b.cancelled / b.orders - a.cancelled / a.orders)

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Admin" sub={`Sellers’ cancelled orders in the last 30 days. We flag anyone with at least ${CANCEL_FLAG_MIN} cancellations and ${CANCEL_FLAG_PERCENT}% of their orders.`}>
        Cancellations
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={CheckIcon} title="No cancellations" body="No seller has cancelled an order in the last 30 days." />
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {rows.map((r) => (
            <div key={r.merchantId} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
              <div className="flex min-w-0 flex-col gap-0.5">
                <strong className="truncate">{r.merchantName}</strong>
                <span className="text-muted">
                  {r.cancelled} of {r.orders} {r.orders === 1 ? 'order' : 'orders'} cancelled ({Math.round((r.cancelled / r.orders) * 100)}%)
                </span>
              </div>
              {cancelRateFlagged(r.orders, r.cancelled) ? <Badge tone="hot">Needs a follow-up</Badge> : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
