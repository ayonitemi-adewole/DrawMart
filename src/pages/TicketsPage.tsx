import { useState } from 'react'
import { Link } from 'react-router'
import { useMyListings } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { Countdown } from '@/components/Countdown'
import { ChevronRightIcon, CoinIcon, TicketIcon, TrophyIcon } from '@/components/icons'
import { TicketStub } from '@/components/TicketStub'
import { Badge, EmptyState, ErrorState, PageTitle, ProductImage, ProgressBar, Segmented, Skeleton, StatTile, buttonClass, type Tone } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import { ticketNo } from '@/lib/time'

function status(l: ListingView): { tone: Tone; label: string; detail: string } {
  if (l.status === 'drawn' && l.result?.iWon) return { tone: 'ticket', label: 'You won', detail: `Ticket ${ticketNo(l.result.winningNumber)} · we’ll arrange delivery` }
  if (l.status === 'drawn' && l.result)
    return { tone: 'neutral', label: 'Not this time', detail: `Winner ${ticketNo(l.result.winningNumber)} · ${formatNaira(l.result.myCreditKobo)} credit returned` }
  if (l.status === 'for_sale')
    return { tone: 'neutral', label: 'Refunded', detail: `Didn’t sell out; you were refunded. Now for sale at ${formatNaira(l.fallbackPriceKobo ?? l.priceKobo)}` }
  if (l.status === 'refunded') return { tone: 'neutral', label: 'Refunded', detail: 'Didn’t sell out in time; your money is back in your wallet' }
  return { tone: 'brand', label: `${(l.ticketCount - l.ticketsSold).toLocaleString('en-NG')} left`, detail: `Odds ${l.myNumbers.length} in ${l.ticketCount.toLocaleString('en-NG')}` }
}

type Tab = 'active' | 'finished'

export function TicketsPage() {
  const q = useMyListings()
  const live = q.data?.filter((l) => l.status === 'live') ?? []
  const past = q.data?.filter((l) => l.status !== 'live') ?? []
  const [tab, setTab] = useState<Tab>('active')
  const items = tab === 'active' ? live : past
  const ticketsHeld = live.reduce((s, l) => s + l.myNumbers.length, 0)
  const wins = past.filter((l) => l.result?.iWon).length
  const credit = past.reduce((s, l) => s + (l.result?.myCreditKobo ?? 0), 0)

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="My tickets" sub="Every ticket you hold, and how each draw turned out.">
        Your draws
      </PageTitle>

      {q.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-40" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState
          icon={TicketIcon}
          title="No tickets yet"
          body="Pick a live draw and get your first ticket. It takes less than a minute."
          action={
            <Link to="/" className={buttonClass('primary')}>
              Browse live draws
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile icon={TicketIcon} label="Tickets in play" value={ticketsHeld} hint={`${live.length} draw${live.length === 1 ? '' : 's'}`} />
            <StatTile icon={TrophyIcon} tone="ticket" label="Wins" value={wins} hint={`${past.length} finished`} />
            <StatTile icon={CoinIcon} tone="hot" label="Credit earned" value={formatNaira(credit)} className="col-span-2 sm:col-span-1" />
          </div>

          <Segmented<Tab>
            label="Show"
            value={tab}
            onChange={setTab}
            className="w-full sm:w-auto sm:self-start"
            options={[
              { value: 'active', label: 'Waiting for draw', count: live.length },
              { value: 'finished', label: 'Finished', count: past.length },
            ]}
          />

          {items.length === 0 ? (
            <EmptyState
              icon={tab === 'active' ? TicketIcon : TrophyIcon}
              title={tab === 'active' ? 'Nothing in play' : 'No finished draws yet'}
              body={tab === 'active' ? 'All your draws have finished. Fancy another go?' : 'Results land here once a draw sells out.'}
              action={
                tab === 'active' ? (
                  <Link to="/" className={buttonClass('primary')}>
                    Browse live draws
                  </Link>
                ) : null
              }
            />
          ) : (
            <div key={tab} className="grid gap-3 lg:grid-cols-2">
              {items.map((l, i) => (
                <TicketCard key={l.id} listing={l} index={i} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TicketCard({ listing: l, index }: { listing: ListingView; index: number }) {
  const s = status(l)
  return (
    <Link
      to={l.status === 'drawn' ? `/draws/${l.id}` : `/listings/${l.id}`}
      style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
      className="group flex animate-fade-up flex-col gap-4 rounded-3xl border border-line bg-surface p-4 text-ink no-underline shadow-card transition hover:-translate-y-0.5 hover:shadow-lift"
    >
      <div className="flex items-center gap-3">
        <ProductImage category={l.category} src={l.images[0]} alt={l.title} size="sm" className="size-18 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <strong className="leading-tight">{l.title}</strong>
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
          <span className="text-xs text-subtle">{s.detail}</span>
        </div>
        <ChevronRightIcon className="shrink-0 text-subtle transition group-hover:translate-x-0.5" />
      </div>
      {l.status === 'live' ? (
        <div className="flex flex-col gap-1.5">
          <ProgressBar value={l.ticketsSold} max={l.ticketCount} label="Tickets sold" size="sm" />
          <div className="flex justify-between text-xs text-subtle">
            <span>{Math.round((l.ticketsSold / l.ticketCount) * 100)}% sold</span>
            <Countdown closesAt={l.closesAt} className="font-bold" />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t border-dashed border-line px-1.5 pt-3">
        {l.myNumbers.slice(0, 12).map((n) => (
          <TicketStub key={n} number={n} size="sm" state={l.result ? (n === l.result.winningNumber ? 'winner' : 'lost') : 'default'} />
        ))}
        {l.myNumbers.length > 12 ? <span className="self-center text-xs font-bold text-subtle">+{l.myNumbers.length - 12} more</span> : null}
      </div>
    </Link>
  )
}
