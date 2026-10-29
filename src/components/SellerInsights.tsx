import { useState } from 'react'
import { useMerchantMetrics } from '@/api/hooks'
import { BoostHistory } from './BoostControl'
import type { ListingMetrics } from '@/api/types'
import { formatNaira } from '@/domain/money'
import { INSIGHT_TIP_TEXT, conversionBps, formatRate, insightTip, sumMetrics, type DayMetrics, type MetricRange } from '@/domain/metrics'
import { ChartIcon, ChatIcon, NairaIcon, EyeIcon, SparklesIcon, UsersIcon } from './icons'
import { Badge, Card, EmptyState, ErrorState, ProductImage, Segmented, Skeleton, StatTile, cx } from './ui'

const STATUS_TEXT: Partial<Record<ListingMetrics['status'], string>> = {
  live: 'Live',
  for_sale: 'On sale',
  sold: 'Sold',
  drawn: 'Drawn',
  refunded: 'Refunded',
  pending_review: 'In review',
}

/** Views and sales of the signed-in shop's listings. Used by the store app and by individual sellers. */
export function SellerInsights() {
  const [days, setDays] = useState<MetricRange>(30)
  const q = useMerchantMetrics(days)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">A view is one person opening a listing, counted once a day. Your own visits don’t count.</p>
        <Segmented<string>
          label="Time range"
          size="sm"
          value={String(days)}
          onChange={(v) => setDays(Number(v) as MetricRange)}
          options={[
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
          ]}
        />
      </div>
      {q.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-60" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.listings.length === 0 ? (
        <EmptyState icon={ChartIcon} title="Nothing to measure yet" body="Once a listing goes live, you’ll see how many people look at it and how many buy." />
      ) : (
        <Report listings={q.data.listings} daily={q.data.daily} days={days} />
      )}
    </div>
  )
}

function Report({ listings, daily, days }: { listings: ListingMetrics[]; daily: DayMetrics[]; days: MetricRange }) {
  const t = sumMetrics(listings)
  const hasProducts = listings.some((l) => l.kind === 'product')
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={EyeIcon} label="Views" value={t.views.toLocaleString('en-NG')} hint={`${t.visitors.toLocaleString('en-NG')} people`} />
        <StatTile icon={NairaIcon} tone="violet" label="Sales" value={formatNaira(t.salesKobo)} hint={`${t.units.toLocaleString('en-NG')} ${hasProducts ? 'tickets & items' : 'tickets'} sold`} />
        <StatTile icon={UsersIcon} tone="sky" label="Visitors who bought" value={formatRate(conversionBps(t.buyers, t.visitors))} hint={`${t.buyers.toLocaleString('en-NG')} buyers`} />
        <StatTile icon={ChatIcon} tone="ticket" label="Buyer chats" value={t.chats.toLocaleString('en-NG')} hint={hasProducts ? 'Questions about your items' : 'Chats are for regular products'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DailyBars title="Views per day" daily={daily} value={(d) => d.views} format={(n) => `${n.toLocaleString('en-NG')} ${n === 1 ? 'view' : 'views'}`} days={days} />
        <DailyBars title="Sales per day" daily={daily} value={(d) => d.salesKobo} format={(n) => formatNaira(n)} days={days} />
      </div>

      <ListingTable listings={listings} />
      <BoostHistory />
    </>
  )
}

const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * One series of daily bars on a zero baseline. Each bar is a focusable hit
 * target taller than the mark, with a tooltip on hover or focus.
 */
function DailyBars({ title, daily, value, format, days }: { title: string; daily: DayMetrics[]; value: (d: DayMetrics) => number; format: (n: number) => string; days: MetricRange }) {
  const [active, setActive] = useState<number | null>(null)
  const values = daily.map(value)
  const max = Math.max(...values, 1)
  const total = values.reduce((a, b) => a + b, 0)
  const shown = active === null ? null : daily[active]

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-bold">{title}</h3>
        <span className="text-sm text-muted tabular-nums" aria-live="polite">
          {shown ? (
            <>
              <span className="text-subtle">{dayName(shown.date)} · </span>
              <strong className="text-ink">{format(value(shown))}</strong>
            </>
          ) : (
            <>
              <strong className="text-ink">{format(total)}</strong> in {days} days
            </>
          )}
        </span>
      </div>
      <div className="relative">
        {/* Recessive guide at the top value; the baseline is the bars' bottom edge. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 text-[10px] text-subtle">
          <span className="h-px flex-1 border-t border-dashed border-line" />
          <span className="tabular-nums">{format(max === 1 && total === 0 ? 0 : max)}</span>
        </div>
        <div className="flex h-40 items-end gap-0.5 border-b border-line-strong pt-4" role="list" aria-label={title} onMouseLeave={() => setActive(null)}>
          {daily.map((d, i) => {
            const v = value(d)
            return (
              <button
                key={d.date}
                type="button"
                role="listitem"
                aria-label={`${dayName(d.date)}: ${format(v)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="group flex h-full min-w-0 flex-1 items-end rounded-t-sm focus-visible:outline-2 focus-visible:outline-brand"
              >
                <span
                  className={cx('w-full rounded-t-[4px] transition-colors', v ? 'bg-brand' : 'bg-transparent', active !== null && active !== i && 'opacity-45')}
                  style={{ height: v ? `max(3px, ${(v / max) * 100}%)` : 0 }}
                />
              </button>
            )
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-subtle">
          <span>{dayName(daily[0].date)}</span>
          <span>Today</span>
        </div>
      </div>
    </Card>
  )
}

function ListingTable({ listings }: { listings: ListingMetrics[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <SparklesIcon size={18} className="text-brand" />
        <h3 className="font-bold">By listing</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-160 text-sm">
          <thead>
            <tr className="text-left text-[11px] font-extrabold tracking-wide text-subtle uppercase">
              <th scope="col" className="px-5 py-2.5">Listing</th>
              <th scope="col" className="px-3 py-2.5 text-right">Views</th>
              <th scope="col" className="px-3 py-2.5 text-right">People</th>
              <th scope="col" className="px-3 py-2.5 text-right">Chats</th>
              <th scope="col" className="px-3 py-2.5 text-right">Sold</th>
              <th scope="col" className="px-3 py-2.5 text-right">Sales</th>
              <th scope="col" className="px-5 py-2.5 text-right">Bought</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {listings.map((l) => {
              const tip = ['live', 'for_sale'].includes(l.status) ? insightTip(l) : null
              return (
                <tr key={l.listingId} className="align-top">
                  <td className="px-5 py-3">
                    <div className="flex gap-3">
                      <ProductImage category={l.category} src={l.image ?? undefined} alt="" size="sm" className="size-12 shrink-0" />
                      <div className="flex min-w-0 flex-col gap-1">
                        <strong className="leading-tight">{l.title}</strong>
                        <span className="flex flex-wrap gap-1">
                          <Badge tone="neutral">{l.kind === 'raffle' ? 'Raffle' : 'Product'}</Badge>
                          {STATUS_TEXT[l.status] ? <Badge tone={l.status === 'live' || l.status === 'for_sale' ? 'brand' : 'neutral'}>{STATUS_TEXT[l.status]}</Badge> : null}
                        </span>
                        {tip ? <span className={cx('max-w-sm text-xs', tip === 'converting' ? 'text-brand-ink' : 'text-muted')}>{INSIGHT_TIP_TEXT[tip]}</span> : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-bold tabular-nums">{l.views.toLocaleString('en-NG')}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{l.visitors.toLocaleString('en-NG')}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{l.kind === 'product' ? l.chats.toLocaleString('en-NG') : '–'}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{l.units.toLocaleString('en-NG')}</td>
                  <td className="px-3 py-3 text-right font-bold tabular-nums">{formatNaira(l.salesKobo)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{l.visitors ? formatRate(conversionBps(l.buyers, l.visitors)) : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-5 py-3 text-xs text-subtle">“Bought” is the share of people who viewed a listing and then bought from it. Sales on a draw that was refunded don’t count.</p>
    </Card>
  )
}
