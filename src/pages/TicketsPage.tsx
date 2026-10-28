import { Link } from 'react-router'
import { useMyListings } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { Badge, Card, ErrorState, PageTitle, Skeleton } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import { ticketNo, timeLeft } from '@/lib/time'

function status(l: ListingView) {
  if (l.status === 'drawn' && l.result?.iWon) return { tone: 'ticket' as const, label: 'You won', detail: `Ticket ${ticketNo(l.result.winningNumber)} · delivery from escrow` }
  if (l.status === 'drawn' && l.result)
    return { tone: 'neutral' as const, label: 'Not this time', detail: `Winner ${ticketNo(l.result.winningNumber)} · ${formatNaira(l.result.myCreditKobo)} credit returned` }
  if (l.status === 'refunded') return { tone: 'neutral' as const, label: 'Refunded', detail: 'Didn’t sell out in time; your money is back in your wallet' }
  return { tone: 'brand' as const, label: `${l.ticketCount - l.ticketsSold} left`, detail: `Odds ${l.myNumbers.length} in ${l.ticketCount} · closes in ${timeLeft(l.closesAt)}` }
}

export function TicketsPage() {
  const q = useMyListings()
  const live = q.data?.filter((l) => l.status === 'live') ?? []
  const past = q.data?.filter((l) => l.status !== 'live') ?? []

  return (
    <div className="flex flex-col gap-5">
      <PageTitle>My tickets</PageTitle>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <strong>No tickets yet</strong>
          <p className="text-sm text-subtle">Pick a live draw and get your first ticket.</p>
          <Link to="/" className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 font-bold text-white no-underline">
            Browse draws
          </Link>
        </Card>
      ) : (
        <>
          <Section title="Waiting for the draw" items={live} />
          <Section title="Finished" items={past} />
        </>
      )}
    </div>
  )
}

function Section({ title, items }: { title: string; items: ListingView[] }) {
  if (!items.length) return null
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-extrabold">{title}</h2>
      {items.map((l) => {
        const s = status(l)
        return (
          <Link
            key={l.id}
            to={l.status === 'drawn' ? `/draws/${l.id}` : `/listings/${l.id}`}
            className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-ink no-underline hover:border-line-strong"
          >
            <div className="flex justify-between gap-2">
              <strong>{l.title}</strong>
              <Badge tone={s.tone}>{s.label}</Badge>
            </div>
            <p className="font-mono text-sm text-muted">{l.myNumbers.map(ticketNo).join('  ')}</p>
            <p className="text-xs text-subtle">{s.detail}</p>
          </Link>
        )
      })}
    </section>
  )
}
