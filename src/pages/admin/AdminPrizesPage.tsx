import { usePrizeOrders } from '@/api/hooks'
import { TrophyIcon } from '@/components/icons'
import { OrderCard } from '@/components/OrderCard'
import { Badge, EmptyState, ErrorState, PageTitle, Skeleton } from '@/components/ui'

/** Won items in DrawMart's escrow waiting to be sent. Won cars stay with the dealer, who sends those. */
export function AdminPrizesPage() {
  const q = usePrizeOrders()
  const toSend = q.data?.filter((o) => o.status === 'paid').length ?? 0
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Admin" sub="Items winners have arranged. Send them from escrow, then mark them as sent." action={q.data ? <Badge tone={toSend ? 'ticket' : 'brand'}>{toSend} to send</Badge> : null}>
        Won items
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={TrophyIcon} title="Nothing to send" body="When a winner arranges their item, it shows up here with their delivery details." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {q.data.map((o) => (
            <OrderCard key={o.id} order={o} audience="admin" />
          ))}
        </div>
      )}
    </div>
  )
}
