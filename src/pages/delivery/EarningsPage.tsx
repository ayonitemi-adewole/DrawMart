import { useMyEarnings } from '@/api/hooks'
import { ClockIcon, DownloadIcon, NairaIcon, TruckIcon } from '@/components/icons'
import { ProductId } from '@/components/ProductId'
import { Badge, Button, Card, EmptyState, ErrorState, PageTitle, Skeleton, StatTile } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import { EARNING_KIND_TEXT, earningWeeks, earningsCsv, payableNow, weekStart, type EarningWeek } from '@/domain/riderPay'
import { dateTime, shortDate } from '@/lib/time'
import { BankAccount } from '../merchant/Payouts'

/** /delivery/earnings: what each job earned, week by week, and where it's paid. */
export function EarningsPage() {
  const q = useMyEarnings()
  const lines = q.data ?? []
  const now = Date.now()
  const thisWeek = weekStart(now)
  const due = payableNow(lines, now).reduce((n, l) => n + l.amountKobo, 0)
  const soFar = lines.filter((l) => l.earnedAt >= thisWeek).reduce((n, l) => n + l.amountKobo, 0)

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Delivery" sub="Each delivery, return and failed attempt earns a set amount. Weeks run Monday to Sunday, and we pay finished weeks to your bank account.">
        Earnings
      </PageTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile icon={ClockIcon} label="This week so far" value={formatNaira(soFar)} hint="Paid once the week ends" tone="sky" />
        <StatTile icon={NairaIcon} label="Due to you" value={formatNaira(due)} hint="From finished weeks" />
      </div>
      <BankAccount owed={due > 0} />
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : lines.length === 0 ? (
        <EmptyState icon={TruckIcon} title="Nothing earned yet" body="Each job you finish shows up here, with what it paid." />
      ) : (
        earningWeeks(lines).map((w) => <Week key={w.start} week={w} current={w.start === thisWeek} />)
      )}
    </div>
  )
}

function Week({ week: w, current }: { week: EarningWeek; current: boolean }) {
  const paid = w.paidKobo === w.totalKobo
  const reference = w.lines.find((l) => l.reference)?.reference

  function download() {
    const url = URL.createObjectURL(new Blob([earningsCsv(w)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `drawmart-earnings-${w.start.slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <strong>Week of {shortDate(new Date(Date.parse(w.start) + 3_600_000).toISOString())}</strong>
          <span className="flex flex-wrap items-center gap-2 text-xs text-subtle">
            {current ? <Badge tone="sky">This week</Badge> : paid ? <Badge tone="brand">Paid</Badge> : <Badge tone="ticket">Due</Badge>}
            {paid && reference ? `Reference ${reference}` : null}
          </span>
        </div>
        <strong className="font-display text-2xl tabular-nums">{formatNaira(w.totalKobo)}</strong>
      </div>
      <ul className="flex flex-col divide-y divide-line text-sm">
        {w.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-bold">{EARNING_KIND_TEXT[l.kind]}: {l.listingTitle}</span>
              <ProductId code={l.productCode} />
              <span className="text-xs text-subtle">{dateTime(l.earnedAt)}</span>
            </span>
            <span className="font-bold tabular-nums">{formatNaira(l.amountKobo)}</span>
          </li>
        ))}
      </ul>
      <Button variant="outline" className="self-start" onClick={download}>
        <DownloadIcon size={16} /> Statement
      </Button>
    </Card>
  )
}
