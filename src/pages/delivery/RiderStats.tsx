import { useMyRiderStats } from '@/api/hooks'
import { CheckCircleIcon, ClockIcon, ThumbUpIcon } from '@/components/icons'
import { Skeleton, StatTile } from '@/components/ui'
import { ON_TIME_HOURS, RATINGS_SHOWN_FROM, RATING_REASONS, STATS_DAYS, percent } from '@/domain/deliveryRatings'

/** A rider's own last 30 days: totals only, never who rated what (deliveryRatings.ts). */
export function RiderStatsCard() {
  const q = useMyRiderStats()
  if (q.isPending) return <Skeleton className="h-32" />
  // Not worth an error box above their job list.
  if (q.isError) return null
  const s = q.data
  const r = s.ratings
  const rated = r ? r.up + r.down : 0
  const top = r
    ? RATING_REASONS.filter((x) => r.reasons[x.reason])
        .sort((a, b) => (r.reasons[b.reason] ?? 0) - (r.reasons[a.reason] ?? 0))
        .slice(0, 2)
        .map((x) => `${x.label.toLowerCase()} (${r.reasons[x.reason]})`)
    : []
  return (
    <section className="flex flex-col gap-2" aria-labelledby="rider-stats-title">
      <h2 id="rider-stats-title" className="text-sm font-bold text-muted">
        Your last {STATS_DAYS} days
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile icon={CheckCircleIcon} label="Jobs done" value={s.completed} hint="To buyers and pickup counters" />
        <StatTile
          icon={ClockIcon}
          tone="sky"
          label="On time"
          value={s.onTimeShare === null ? '–' : percent(s.onTimeShare)}
          hint={`In the buyer’s window, or within ${ON_TIME_HOURS} hours of collecting`}
        />
        <StatTile
          icon={ThumbUpIcon}
          tone="ticket"
          label="Buyers’ rating"
          value={r && rated ? `${percent(r.up / rated)} good` : '–'}
          hint={r ? `${rated} ratings${top.length ? `. Said: ${top.join(', ')}` : ''}` : `Shows once ${RATINGS_SHOWN_FROM} buyers have rated, the day after`}
        />
      </div>
    </section>
  )
}
