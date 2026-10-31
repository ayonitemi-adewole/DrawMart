import { useState } from 'react'
import { Link } from 'react-router'
import { NoProductMatch, ProductId, ProductSearch } from '@/components/ProductId'
import { matchesProductSearch } from '@/domain/productCode'
import { useListings, useResults } from '@/api/hooks'
import { ListingRow } from '@/components/ListingGrid'
import { ChevronRightIcon, HashIcon, LockIcon, TrophyIcon, UnlockIcon } from '@/components/icons'
import { Badge, EmptyState, ErrorState, PageTitle, Segmented, Skeleton, cx } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import { shortDate, ticketNo } from '@/lib/time'

const STEPS = [
  { icon: LockIcon, title: 'Lock', body: 'We publish a lock on a secret number before the first ticket is sold.' },
  { icon: HashIcon, title: 'Last ticket', body: 'The purchase that sells the last ticket adds a reference nobody could predict.' },
  { icon: UnlockIcon, title: 'Reveal', body: 'We reveal the secret. The winner is calculated from both, and anyone can re-check it.' },
]

type Filter = 'all' | 'mine' | 'won'

export function DrawsPage() {
  const results = useResults()
  const upcoming = useListings({ status: ['sold_out'] })
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const data = results.data ?? []
  const mine = data.filter((r) => r.myNumbers.length > 0)
  const won = data.filter((r) => r.iWon)
  const shown = (filter === 'mine' ? mine : filter === 'won' ? won : data).filter((r) => matchesProductSearch(search, r.productCode, r.listingTitle))

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Results" sub="Every finished draw, with everything you need to check it yourself.">
        Draw results
      </PageTitle>

      <section className="relative isolate overflow-hidden rounded-4xl bg-linear-to-br from-hero to-hero-2 p-6 text-on-hero shadow-lift sm:p-8">
        <div className="texture-dots absolute inset-0 -z-10" />
        <h2 className="mb-5 font-display text-xl font-extrabold">How every draw stays fair</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex animate-fade-up gap-3 sm:flex-col" style={{ animationDelay: `${i * 80}ms` }}>
              <span className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-ticket ring-1 ring-white/15">
                <s.icon size={22} />
                <span className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-ticket text-[11px] font-extrabold text-on-ticket">
                  {i + 1}
                </span>
              </span>
              <div className="flex flex-col gap-0.5">
                <strong>{s.title}</strong>
                <span className="text-sm leading-snug text-on-brand-muted">{s.body}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {upcoming.data?.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading" className="font-display text-2xl font-extrabold tracking-tight">
            Sold out, winner coming soon
          </h2>
          <ListingRow listings={upcoming.data} label="Sold-out draws waiting for a winner" />
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-extrabold">Finished draws</h2>
        <Segmented<Filter>
          label="Filter results"
          value={filter}
          onChange={setFilter}
          size="sm"
          options={[
            { value: 'all', label: 'All', count: data.length },
            { value: 'mine', label: 'I played', count: mine.length },
            { value: 'won', label: 'I won', count: won.length },
          ]}
        />
      </div>

      {data.length ? <ProductSearch value={search} onChange={setSearch} /> : null}

      {results.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : results.isError ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : shown.length === 0 && search.trim() ? (
        <NoProductMatch query={search} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={TrophyIcon}
          title={filter === 'won' ? 'No wins yet' : filter === 'mine' ? 'No finished draws for you yet' : 'No results yet'}
          body="Results appear here when a sold-out draw’s winner is announced."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((r, i) => (
            <Link
              key={r.listingId}
              to={`/draws/${r.listingId}`}
              style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
              className={cx(
                'group flex animate-fade-up items-center gap-4 rounded-3xl border bg-surface p-4 text-ink no-underline shadow-card transition hover:-translate-y-0.5 hover:shadow-lift',
                r.iWon ? 'border-ticket' : 'border-line',
              )}
            >
              {r.listingImage ? (
                <div className="relative shrink-0">
                  <img src={r.listingImage} alt="" loading="lazy" className="size-22 rounded-2xl bg-photo object-cover" />
                  <span
                    className={cx(
                      'absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 font-mono text-[11px] font-extrabold whitespace-nowrap shadow-card',
                      r.iWon ? 'bg-ticket text-on-ticket' : 'bg-ink text-ground',
                    )}
                  >
                    {ticketNo(r.winningNumber)}
                  </span>
                </div>
              ) : (
                <div
                  className={cx(
                    'flex size-22 shrink-0 flex-col items-center justify-center rounded-2xl',
                    r.iWon ? 'bg-ticket text-on-ticket' : 'bg-brand-soft text-brand-ink',
                  )}
                >
                  <TrophyIcon size={18} />
                  <span className="font-mono text-sm font-extrabold">{ticketNo(r.winningNumber)}</span>
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <strong className="truncate">{r.listingTitle}</strong>
                  {r.iWon ? <Badge tone="ticket">YOU WON</Badge> : null}
                </div>
                <span className="text-xs text-subtle">
                  {shortDate(r.drawnAt)} · {r.ticketCount.toLocaleString('en-NG')} tickets
                  {r.myNumbers.length && !r.iWon ? ` · you had ${r.myNumbers.length}` : ''}
                  {r.myCreditKobo > 0 ? ` · +${formatNaira(r.myCreditKobo)} credit` : ''}
                </span>
                <ProductId code={r.productCode} />
                <span className="truncate font-mono text-[11px] text-subtle">
                  lock {r.commitment.slice(0, 10)}… · ref {r.closingRef}
                </span>
              </div>
              <ChevronRightIcon className="shrink-0 text-subtle transition group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
