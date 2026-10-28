import { Link } from 'react-router'
import { useResults } from '@/api/hooks'
import { Badge, ErrorState, PageTitle, Skeleton } from '@/components/ui'
import { shortDate, ticketNo } from '@/lib/time'

const STEPS = [
  'We publish a lock on a secret number before the first ticket is sold.',
  'The purchase that sells the last ticket adds a reference nobody could predict.',
  'We reveal the secret. The winner is calculated from both, and anyone can re-check it.',
]

export function DrawsPage() {
  const results = useResults()
  return (
    <div className="flex flex-col gap-5">
      <PageTitle>Draws</PageTitle>
      <div className="flex flex-col gap-3 rounded-2xl bg-brand-deep p-5 text-ground">
        <span className="font-extrabold">How every draw stays fair</span>
        {STEPS.map((s, i) => (
          <div key={i} className="flex gap-3 text-sm leading-snug">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ticket text-xs font-extrabold text-ink">{i + 1}</span>
            <span>{s}</span>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-extrabold">Results</h2>
      {results.isPending ? (
        <Skeleton className="h-40" />
      ) : results.isError ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          {results.data.map((r) => (
            <Link
              key={r.listingId}
              to={`/draws/${r.listingId}`}
              className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4 text-ink no-underline hover:border-line-strong"
            >
              <div className="flex items-center justify-between gap-2">
                <strong>{r.listingTitle}</strong>
                {r.iWon ? <Badge tone="ticket">YOU WON</Badge> : <span className="text-xs text-subtle">{shortDate(r.drawnAt)}</span>}
              </div>
              <span className="text-sm">
                Winning ticket <strong>{ticketNo(r.winningNumber)}</strong> of {r.ticketCount}
              </span>
              <span className="font-mono text-[11px] break-all text-subtle">
                lock {r.commitment.slice(0, 8)}… · ref {r.closingRef}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
