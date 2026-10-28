import { usePendingListings, useReviewListing } from '@/api/hooks'
import { useToast } from '@/components/toast'
import { Button, Card, ErrorState, Skeleton, errorMessage } from '@/components/ui'
import { formatNaira } from '@/domain/money'

/** Minimal admin queue: approve a listing once the item is in escrow. */
export function AdminPage() {
  const q = usePendingListings()
  const review = useReviewListing()
  const toast = useToast()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Listings to review</h1>
        <p className="text-muted">Approve only after the item has arrived at escrow and matches the listing.</p>
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">Nothing waiting. New merchant listings will appear here.</Card>
      ) : (
        <div className="flex flex-col gap-3">
          {q.data.map((l) => (
            <Card key={l.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex min-w-0 flex-col gap-1">
                <strong>{l.title}</strong>
                <span className="text-sm text-subtle">
                  {l.merchant.name} · {l.category} · worth {formatNaira(l.priceKobo)} · {l.ticketCount} tickets at {formatNaira(l.buyerTicketPriceKobo)}
                </span>
                <span className="text-xs text-subtle">
                  {l.durationDays}-day draw · {l.unsoldPolicy === 'refund' ? 'refund if unsold' : 'extend once if unsold'} · fee {l.feeBps / 100}% ({l.feeMode} pays)
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  loading={review.isPending && review.variables?.id === l.id && !review.variables.approve}
                  onClick={() => review.mutate({ id: l.id, approve: false }, { onError: (e) => toast(errorMessage(e), 'error') })}
                >
                  Reject
                </Button>
                <Button
                  loading={review.isPending && review.variables?.id === l.id && review.variables.approve}
                  onClick={() =>
                    review.mutate({ id: l.id, approve: true }, { onSuccess: () => toast(`${l.title} is live.`), onError: (e) => toast(errorMessage(e), 'error') })
                  }
                >
                  Item in escrow: approve
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
