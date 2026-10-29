import { useState, type ReactNode } from 'react'
import { api } from '@/api'
import { isRecentPending, useBoostInsights, useBoostStatus, useBoosts, useBuyBoost, useCheckDeposit } from '@/api/hooks'
import type { BoostInsightsView, BoostView, DepositStatus, ListingView } from '@/api/types'
import { boostComparison, canBoost, isBoosted } from '@/domain/boosts'
import { lagosDay } from '@/domain/metrics'
import { formatNaira } from '@/domain/money'
import { dateTime, shortDate } from '@/lib/time'
import { ChartIcon, CheckIcon, ClockIcon, RefreshIcon, ShieldIcon, SparklesIcon, type IconComponent } from './icons'
import { Sheet } from './Sheet'
import { useToast } from './toast'
import { Badge, Button, ErrorState, Notice, Skeleton, cx, errorMessage } from './ui'

const RESULT: Record<DepositStatus, readonly [string, 'success' | 'info' | 'error']> = {
  successful: ['Boost started. Your listing now shows first, marked Sponsored.', 'success'],
  pending: ['Waiting for Flutterwave to confirm. The boost starts as soon as it does.', 'info'],
  cancelled: ['Boost cancelled. No money was taken.', 'info'],
  failed: ['That payment didn’t go through, so the boost didn’t start.', 'error'],
}

/**
 * On a seller's listing card: what's happening with its boost (payment
 * pending, running, or finished, with results), and a button to buy one.
 */
export function BoostRow({ listing: l }: { listing: ListingView }) {
  const status = useBoostStatus()
  const boosts = useBoosts()
  // The payment lives here, not in the sheet: the sheet closes before Flutterwave's
  // checkout opens (it would sit on top of it), and the result still needs a toast.
  const buy = useBuyBoost()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<BoostView | null>(null)
  const now = Date.now()
  const mine = (boosts.data ?? []).filter((b) => b.listingId === l.id)
  const pending = mine.find((b) => b.status === 'pending' && isRecentPending(b.createdAt))
  // Newest first: the boost running now, or else the last one that ran.
  const paid = mine.filter((b) => b.status === 'paid' && b.startsAt && Date.parse(b.startsAt) <= now)
  const running = paid.find((b) => Date.parse(b.endsAt!) > now)
  const last = running ?? paid[0]
  const canBuy = canBoost(l) && !!status.data?.unlocked && !pending && !buy.isPending

  function pay(packageId: string) {
    setOpen(false)
    buy.mutate({ listingId: l.id, packageId }, { onSuccess: (r) => toast(...RESULT[r]), onError: (e) => toast(errorMessage(e), 'error') })
  }

  if (!pending && !last && !canBuy && !buy.isPending) return null

  return (
    <div className="flex flex-col gap-2 border-t border-dashed border-line pt-3">
      {buy.isPending ? (
        <StateLine icon={ClockIcon} tone="text-muted">
          Finishing your boost payment…
        </StateLine>
      ) : pending ? (
        <PendingBoost boost={pending} />
      ) : isBoosted(l, now) ? (
        <StateLine icon={SparklesIcon} tone="text-ticket-ink">
          <strong>Boost active</strong> until {dateTime(l.boostedUntil!)}. Shown first, marked Sponsored.
        </StateLine>
      ) : last ? (
        <StateLine icon={SparklesIcon} tone="text-muted">
          Last boost ended {dateTime(last.endsAt!)}.
        </StateLine>
      ) : (
        <span className="text-xs text-subtle">Show it first to every buyer.</span>
      )}
      <div className="flex flex-wrap gap-2">
        {last ? (
          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setResults(last)}>
            <ChartIcon size={16} /> Boost results
          </Button>
        ) : null}
        {canBuy ? (
          <Button variant="outline" size="sm" className="ml-auto min-h-11" onClick={() => setOpen(true)}>
            <SparklesIcon size={16} /> {isBoosted(l, now) ? 'Extend boost' : 'Boost'}
          </Button>
        ) : null}
      </div>
      {open ? <BoostSheet listing={l} onClose={() => setOpen(false)} onPay={pay} /> : null}
      {results ? <BoostResultsSheet boost={results} onClose={() => setResults(null)} /> : null}
    </div>
  )
}

function StateLine({ icon: Icon, tone, children }: { icon: IconComponent; tone: string; children: ReactNode }) {
  return (
    <p className={cx('flex items-start gap-2 text-xs leading-snug', tone)}>
      <Icon size={16} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Paid, but Flutterwave hasn't confirmed yet (e.g. a bank transfer on its way). */
function PendingBoost({ boost: b }: { boost: BoostView }) {
  const check = useCheckDeposit()
  const toast = useToast()
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-ticket-soft p-3 text-ticket-ink">
      <StateLine icon={ClockIcon} tone="flex-1">
        <strong>Boost payment pending.</strong> Waiting for {api.payments?.provider ?? 'the payment provider'} to confirm your {formatNaira(b.priceKobo)}. The {b.days}-day boost
        starts on its own once it does.
      </StateLine>
      {api.payments ? (
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          loading={check.isPending}
          onClick={() =>
            check.mutate(b.txRef, {
              onSuccess: (r) => toast(...(r === 'pending' ? (['Still waiting for Flutterwave. Nothing to do; it starts on its own.', 'info'] as const) : RESULT[r])),
              onError: (e) => toast(errorMessage(e), 'error'),
            })
          }
        >
          <RefreshIcon size={14} /> Check now
        </Button>
      ) : null}
    </div>
  )
}

function BoostSheet({ listing: l, onClose, onPay }: { listing: ListingView; onClose: () => void; onPay: (packageId: string) => void }) {
  const status = useBoostStatus()
  const packages = status.data?.packages ?? []
  const [picked, setPicked] = useState(packages[1]?.id ?? packages[0]?.id ?? '')
  const pkg = packages.find((p) => p.id === picked)
  const full = (status.data?.slotsLeft ?? 0) === 0

  return (
    <Sheet open onClose={onClose} title="Boost a listing">
      <div className="flex flex-col gap-1 pr-10">
        <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">Boost</span>
        <h2 className="font-display text-2xl leading-tight font-extrabold">{l.title}</h2>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm text-muted">
        <li className="flex gap-2">
          <CheckIcon size={18} className="shrink-0 text-brand" /> Shown first on the home page and in its category, to every buyer.
        </li>
        <li className="flex gap-2">
          <CheckIcon size={18} className="shrink-0 text-brand" /> Marked “Sponsored” so buyers know it’s promoted.
        </li>
        <li className="flex gap-2">
          <CheckIcon size={18} className="shrink-0 text-brand" /> Only a few listings are boosted at once, so yours stands out.
        </li>
      </ul>
      {full ? (
        <Notice tone="hot">All boost slots are taken right now. Try again in a day or two.</Notice>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-bold">How long?</legend>
          <div className="grid grid-cols-3 gap-2">
            {packages.map((p) => (
              <label
                key={p.id}
                className={cx(
                  'flex min-h-20 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl border p-3 text-center transition',
                  picked === p.id ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line hover:border-line-strong',
                )}
              >
                <input type="radio" name="boost-package" value={p.id} checked={picked === p.id} onChange={() => setPicked(p.id)} className="sr-only" />
                <strong className="font-display text-lg">{p.days} days</strong>
                <span className="text-sm font-bold tabular-nums">{formatNaira(p.priceKobo)}</span>
              </label>
            ))}
          </div>
          {pkg && isBoosted(l, Date.now()) ? <span className="text-xs text-subtle">Adds {pkg.days} days after your current boost ends.</span> : null}
        </fieldset>
      )}
      <Button size="lg" disabled={!pkg || full} onClick={() => pkg && onPay(pkg.id)}>
        {pkg ? `Pay ${formatNaira(pkg.priceKobo)} and boost` : 'Pick a package'}
      </Button>
      <p className="flex items-start gap-2 text-xs text-subtle">
        <ShieldIcon size={14} className="mt-px shrink-0 text-brand" />
        {api.payments
          ? `Paid securely through ${api.payments.provider}. The boost starts once the payment is confirmed.`
          : api.testMode
            ? 'Test mode: no real money is charged.'
            : 'Paid by card or bank transfer.'}{' '}
        Boosts aren’t refunded if the item sells or the draw ends early.
      </p>
    </Sheet>
  )
}

// ------------------------------------------------------------- results

const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function Lift({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-subtle">new</span>
  const tone = value > 0 ? 'text-brand-ink' : value < 0 ? 'text-hot-ink' : 'text-muted'
  return (
    <span className={cx('text-xs font-bold tabular-nums', tone)}>
      {value > 0 ? '+' : value < 0 ? '−' : ''}
      {Math.abs(value)}%
    </span>
  )
}

/** A boost's numbers so far, against the same number of days just before it. */
export function BoostResultsSheet({ boost: b, onClose }: { boost: BoostView; onClose: () => void }) {
  const q = useBoostInsights(b.id)
  const running = !!b.endsAt && Date.parse(b.endsAt) > Date.now()

  return (
    <Sheet open onClose={onClose} title="Boost results">
      <div className="flex flex-col gap-1 pr-10">
        <span className="flex items-center gap-2 text-xs font-extrabold tracking-[0.14em] text-brand uppercase">
          Boost results {running ? <Badge tone="ticket">Active</Badge> : <Badge tone="neutral">Ended</Badge>}
        </span>
        <h2 className="font-display text-2xl leading-tight font-extrabold">{b.listingTitle}</h2>
        <span className="text-sm text-muted">
          {b.days}-day boost, {formatNaira(b.priceKobo)} · {shortDate(b.startsAt!)} – {shortDate(b.endsAt!)}
        </span>
      </div>
      {q.isPending ? <Skeleton className="h-72" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Results data={q.data} running={running} />}
    </Sheet>
  )
}

function Results({ data, running }: { data: BoostInsightsView; running: boolean }) {
  const { window: w, before, during, daily } = data
  const c = boostComparison(before, during, w.days)
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...daily.map((d) => d.views))
  const shown = active === null ? null : daily[active]
  const avg = (n: number) => (n >= 10 ? Math.round(n).toLocaleString('en-NG') : n.toFixed(1).replace(/\.0$/, ''))
  const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
  const rows: { label: string; before: string; during: string; lift: number | null }[] = [
    { label: 'Views a day', before: avg(c.views.before), during: avg(c.views.during), lift: c.views.lift },
    { label: 'People a day', before: avg(c.visitors.before), during: avg(c.visitors.during), lift: c.visitors.lift },
    { label: 'Buyer chats', before: String(before.chats), during: String(during.chats), lift: c.chats.lift },
    { label: 'Sold', before: String(before.units), during: String(during.units), lift: c.units.lift },
    { label: 'Sales', before: formatNaira(before.salesKobo), during: formatNaira(during.salesKobo), lift: c.salesKobo.lift },
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {running ? `${dayWord(w.days)} in so far` : `${dayWord(w.days)} boosted`}, against the {dayWord(w.days)} before it started.
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-extrabold tracking-wide text-subtle uppercase">
            <th scope="col" className="py-2">
              <span className="sr-only">Measure</span>
            </th>
            <th scope="col" className="py-2 text-right">Before</th>
            <th scope="col" className="py-2 text-right">During</th>
            <th scope="col" className="py-2 text-right">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="py-2.5 text-left font-semibold">
                {r.label}
              </th>
              <td className="py-2.5 text-right text-muted tabular-nums">{r.before}</td>
              <td className="py-2.5 text-right font-bold tabular-nums">{r.during}</td>
              <td className="py-2.5 text-right">
                <Lift value={r.lift} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col gap-2 rounded-2xl border border-line p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <strong className="text-sm">Views per day</strong>
          <span className="text-xs text-muted tabular-nums" aria-live="polite">
            {shown ? (
              <>
                {dayName(shown.date)}: <strong className="text-ink">{shown.views.toLocaleString('en-NG')} views</strong>
                {shown.date >= w.from ? ' (boosted)' : ''}
              </>
            ) : (
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-line-strong" /> Before
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-brand" /> Boosted
                </span>
              </span>
            )}
          </span>
        </div>
        <div className="flex h-32 items-end gap-0.5 border-b border-line-strong" role="list" aria-label="Views per day, before and during the boost" onMouseLeave={() => setActive(null)}>
          {daily.map((d, i) => {
            const boosted = d.date >= w.from
            return (
              <button
                key={d.date}
                type="button"
                role="listitem"
                aria-label={`${dayName(d.date)}${boosted ? ', boosted' : ''}: ${d.views} views`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="flex h-full min-w-0 flex-1 items-end focus-visible:outline-2 focus-visible:outline-brand"
              >
                <span
                  className={cx('w-full rounded-t-[4px]', boosted ? 'bg-brand' : 'bg-line-strong', active !== null && active !== i && 'opacity-45')}
                  style={{ height: d.views ? `max(3px, ${(d.views / max) * 100}%)` : 0 }}
                />
              </button>
            )
          })}
        </div>
        <div className="flex justify-between text-[10px] text-subtle">
          <span>{dayName(w.beforeFrom)}</span>
          <span>{w.to === lagosDay(Date.now()) ? 'Today' : dayName(w.to)}</span>
        </div>
      </div>
      <p className="text-xs text-subtle">
        Other things move these numbers too (price changes, sharing the link, the time of year), so read the change as a guide. “New” means there was nothing in the days before to
        compare with.
      </p>
    </div>
  )
}

/** Every boost this shop has paid for, newest first, with results. For the Insights page. */
export function BoostHistory() {
  const q = useBoosts()
  const [open, setOpen] = useState<BoostView | null>(null)
  const boosts = (q.data ?? []).filter((b) => b.status === 'paid' || (b.status === 'pending' && isRecentPending(b.createdAt)))
  if (!boosts.length) return null
  const now = Date.now()
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 font-bold">
        <SparklesIcon size={18} className="text-brand" /> Your boosts
      </h3>
      <div className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface">
        {boosts.map((b) => {
          const running = b.status === 'paid' && !!b.endsAt && Date.parse(b.endsAt) > now
          return (
            <div key={b.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
              <div className="flex min-w-0 flex-1 flex-col">
                <strong className="truncate">{b.listingTitle}</strong>
                <span className="text-xs text-subtle">
                  {b.days} days · {formatNaira(b.priceKobo)}
                  {b.endsAt ? ` · ${running ? 'until' : 'ended'} ${dateTime(b.endsAt)}` : ''}
                </span>
              </div>
              <Badge tone={b.status === 'pending' ? 'ticket' : running ? 'brand' : 'neutral'}>{b.status === 'pending' ? 'Payment pending' : running ? 'Active' : 'Ended'}</Badge>
              {b.status === 'paid' ? (
                <Button variant="outline" size="sm" className="min-h-11" onClick={() => setOpen(b)}>
                  <ChartIcon size={16} /> Results
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
      {open ? <BoostResultsSheet boost={open} onClose={() => setOpen(null)} /> : null}
    </section>
  )
}
