import { useCancelRates, useLiftSuspension } from '@/api/hooks'
import { useToast } from '@/components/toast'
import { CheckIcon } from '@/components/icons'
import { Badge, Button, Card, EmptyState, ErrorState, PageTitle, Skeleton, errorMessage } from '@/components/ui'
import { CANCEL_FLAG_MIN, CANCEL_FLAG_PERCENT, cancelRateFlagged } from '@/domain/orderCancel'

/** /admin/cancellations: frequent cancellations hurt buyers, so sellers above the line get a follow-up. */
export function AdminCancellationsPage() {
  const q = useCancelRates()
  const lift = useLiftSuspension()
  const toast = useToast()
  const share = (r: { orders: number; cancelled: number }) => (r.orders ? r.cancelled / r.orders : 0)
  const rows = (q.data ?? []).filter((r) => r.cancelled > 0 || r.suspended).sort((a, b) => Number(b.suspended) - Number(a.suspended) || share(b) - share(a))

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
                  {r.cancelled} of {r.orders} {r.orders === 1 ? 'order' : 'orders'} cancelled ({Math.round(share(r) * 100)}%){r.failed ? `, ${r.failed} failed a check or refused` : ''}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {cancelRateFlagged(r.orders, r.cancelled) ? <Badge tone="hot">Needs a follow-up</Badge> : null}
                {r.suspended ? <Badge tone="hot">Suspended</Badge> : null}
                {r.suspended ? (
                  <Button variant="outline" size="sm" className="min-h-11" loading={lift.isPending} onClick={() => lift.mutate(r.merchantId, { onSuccess: () => toast('Suspension lifted. They can resume their products.'), onError: (e) => toast(errorMessage(e), 'error') })}>
                    Lift suspension
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
