import { useRiderPerformance } from '@/api/hooks'
import type { RiderPerformanceRow } from '@/api/types'
import { AlertIcon, PhoneIcon, TruckIcon } from '@/components/icons'
import { ProductId } from '@/components/ProductId'
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { RATING_REASONS, STATS_DAYS, followUpReasons, percent } from '@/domain/deliveryRatings'
import { shortDate } from '@/lib/time'

const reasonLabel = (r: string) => RATING_REASONS.find((x) => x.reason === r)?.label ?? r

/** Riders' last 30 days, the ones to call first (deliveryRatings.ts). Ratings never say which buyer. */
export function RiderPerformance() {
  const q = useRiderPerformance()
  const rows = (q.data ?? []).map((r) => ({ r, why: followUpReasons(r) })).sort((a, b) => b.why.length - a.why.length)
  const flagged = rows.filter((x) => x.why.length).length
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-extrabold">How riders are doing</h2>
        <p className="text-sm text-muted">
          The last {STATS_DAYS} days. {flagged ? `${flagged} ${flagged === 1 ? 'rider needs' : 'riders need'} a call.` : 'Nobody needs a call right now.'}
        </p>
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={TruckIcon} title="No riders yet" body="Riders’ jobs and buyers’ ratings appear here." />
      ) : (
        <Card className="divide-y divide-line">
          {rows.map(({ r, why }) => (
            <PerformanceRow key={r.rider.id} row={r} why={why} />
          ))}
        </Card>
      )}
    </section>
  )
}

function PerformanceRow({ row: r, why }: { row: RiderPerformanceRow; why: string[] }) {
  const rated = r.up + r.down
  return (
    <div className="flex flex-col gap-2 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <strong>{r.name}</strong>
        {why.map((w) => (
          <Badge key={w} tone="hot">
            <AlertIcon size={12} /> {w}
          </Badge>
        ))}
        {why.length && r.rider.phone ? (
          <a href={`tel:${r.rider.phone.replace(/\s/g, '')}`} className="flex min-h-11 items-center gap-1 font-bold">
            <PhoneIcon size={14} /> {r.rider.phone}
          </a>
        ) : null}
      </div>
      <span className="text-xs text-subtle">
        {r.completed} jobs · {r.onTimeShare === null ? 'on time unknown' : `${percent(r.onTimeShare)} on time`} · {rated ? `${r.up} good, ${r.down} not good` : 'no ratings'}
        {Object.keys(r.reasons).length ? ` · said: ${Object.entries(r.reasons).map(([k, n]) => `${reasonLabel(k).toLowerCase()} (${n})`).join(', ')}` : ''}
      </span>
      {why.length && r.recentDowns.length ? (
        <ul className="flex flex-col gap-1 text-xs">
          {r.recentDowns.map((d) => (
            <li key={d.orderId} className="flex flex-wrap items-center gap-2 text-muted">
              <ProductId code={d.productCode} copy />
              {shortDate(d.ratedAt)}
              {d.reasons.length ? ` · ${d.reasons.map(reasonLabel).join(', ')}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
