import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api } from '@/api'
import { useBuyTickets, useDemoActions, useListing, useMe } from '@/api/hooks'
import { ApiError, type ListingView } from '@/api/types'
import { BackIcon, CheckIcon, CoinIcon, LockIcon, MinusIcon, PlusIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, ErrorState, ProductImage, ProgressBar, Skeleton, cx, errorMessage } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import { RULES, maxPurchasable } from '@/domain/rules'
import { ticketNo, timeLeft } from '@/lib/time'

export function ListingPage() {
  const { id = '' } = useParams()
  const listing = useListing(id)

  if (listing.isPending) return <Skeleton className="h-[70vh]" />
  if (listing.isError) return <ErrorState error={listing.error} onRetry={() => listing.refetch()} />
  return <ListingDetail listing={listing.data} />
}

function ListingDetail({ listing: l }: { listing: ListingView }) {
  const navigate = useNavigate()
  const left = l.ticketCount - l.ticketsSold
  const statusLine =
    l.status === 'live' ? `Closes in ${timeLeft(l.closesAt)} or when sold out` : l.status === 'drawn' ? 'Drawn' : l.status === 'refunded' ? 'Refunded: didn’t sell out' : 'Not on sale'

  return (
    <div className="flex flex-col gap-4">
      <button onClick={() => navigate(-1)} className="flex min-h-11 w-fit items-center gap-1 text-sm font-bold text-muted hover:text-ink">
        <BackIcon size={18} /> Back
      </button>

      <div className="grid gap-5 md:grid-cols-[1fr_340px] md:items-start">
        <div className="flex flex-col gap-4">
          <ProductImage category={l.category} className="h-56 md:h-80" />
          <div className="flex flex-wrap gap-1.5">
            {l.merchant.verified ? (
              <Badge>
                <CheckIcon size={12} /> Verified store
              </Badge>
            ) : null}
            <Badge>
              <LockIcon size={12} /> Item held in escrow
            </Badge>
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-3xl leading-tight font-extrabold tracking-tight">{l.title}</h1>
            <p className="text-sm text-subtle">
              {l.merchant.name} · Worth {formatNaira(l.priceKobo)}
            </p>
          </div>
          {l.description ? <p className="text-sm leading-relaxed text-muted">{l.description}</p> : null}

          <Card className="flex flex-col gap-2 p-4">
            <div className="flex justify-between gap-3 text-sm">
              <strong>
                {l.ticketsSold} of {l.ticketCount} tickets sold
              </strong>
              <span className="text-subtle">{statusLine}</span>
            </div>
            <ProgressBar value={l.ticketsSold} max={l.ticketCount} hot={l.status === 'live' && l.ticketsSold / l.ticketCount >= 0.85} label="Tickets sold" />
            <p className="text-xs text-subtle">
              The draw runs the moment the last ticket sells.{' '}
              {l.unsoldPolicy === 'refund'
                ? 'If it doesn’t sell out by the deadline, everyone is refunded to their wallet.'
                : `If it doesn’t sell out, the deadline is extended once by ${RULES.extensionDays} days, then everyone is refunded.`}
            </p>
          </Card>

          {l.myNumbers.length > 0 ? (
            <Card className="flex flex-col gap-1.5 p-4">
              <strong className="text-sm">Your tickets ({l.myNumbers.length})</strong>
              <p className="font-mono text-sm text-muted">{l.myNumbers.map(ticketNo).join('  ')}</p>
            </Card>
          ) : null}

          <Card className="flex flex-col gap-2 p-4">
            <strong className="text-sm">Provably fair draw</strong>
            <p className="text-xs leading-relaxed text-muted">
              Before sales opened we published a lock on a secret number. After sell-out we reveal it, and the winning ticket is calculated from it and the
              final purchase. Anyone can re-check the maths.
            </p>
            <code className="rounded-lg bg-ground p-2 text-xs break-all">Lock: {l.commitment}</code>
          </Card>
        </div>

        <div className="md:sticky md:top-20">
          <BuyPanel listing={l} left={left} />
        </div>
      </div>
    </div>
  )
}

function BuyPanel({ listing: l, left }: { listing: ListingView; left: number }) {
  const navigate = useNavigate()
  const toast = useToast()
  const me = useMe()
  const buy = useBuyTickets()
  const demo = useDemoActions()
  const max = maxPurchasable(l, l.myNumbers.length)
  const [qty, setQty] = useState(1)
  const q = Math.max(1, Math.min(qty, Math.max(1, max)))
  const [lastError, setLastError] = useState<ApiError | null>(null)

  if (l.status === 'drawn' && l.result) {
    return (
      <Card className="flex flex-col gap-3 p-4">
        <strong>Draw complete</strong>
        <p className="text-sm text-muted">Winning ticket {ticketNo(l.result.winningNumber)}.</p>
        <Link to={`/draws/${l.id}`} className="inline-flex min-h-13 items-center justify-center rounded-xl bg-ticket font-extrabold text-ink no-underline">
          See result and verify
        </Link>
      </Card>
    )
  }
  if (l.status !== 'live') {
    return (
      <Card className="p-4 text-sm text-muted">
        {l.status === 'refunded' ? 'This draw didn’t sell out in time. Everyone who bought a ticket was refunded.' : 'This listing isn’t on sale.'}
      </Card>
    )
  }

  const notLicensed = me.data && !RULES.licensedStates.includes(me.data.state)

  async function onBuy() {
    setLastError(null)
    try {
      const r = await buy.mutateAsync({ listingId: l.id, quantity: q })
      setQty(1)
      if (r.drawn) {
        navigate(`/draws/${l.id}`)
      } else {
        toast(`Done! Your ${r.numbers.length === 1 ? 'ticket is' : 'tickets are'} ${r.numbers.map(ticketNo).join(', ')}.`)
      }
    } catch (e) {
      if (e instanceof ApiError) setLastError(e)
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="font-extrabold">Tickets</span>
            <span className="text-xs text-subtle">
              {formatNaira(l.buyerTicketPriceKobo)} each · max {RULES.maxTicketsPerUserPerListing} per person
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setQty(q - 1)}
              disabled={q <= 1}
              aria-label="Fewer tickets"
              className="flex size-11 items-center justify-center rounded-xl border border-line-strong bg-ground disabled:opacity-40"
            >
              <MinusIcon />
            </button>
            <output className="min-w-9 text-center text-lg font-extrabold" aria-live="polite">
              {q}
            </output>
            <button
              onClick={() => setQty(q + 1)}
              disabled={q >= max}
              aria-label="More tickets"
              className="flex size-11 items-center justify-center rounded-xl border border-line-strong bg-ground disabled:opacity-40"
            >
              <PlusIcon />
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          {[1, 5, 10].map((n) => (
            <button
              key={n}
              onClick={() => setQty(n)}
              disabled={n > max}
              aria-pressed={q === n}
              className={cx(
                'min-h-10 flex-1 rounded-full border text-sm font-bold disabled:opacity-40',
                q === n ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="text-sm">
          Your odds after this: <strong>{l.myNumbers.length + q} in {l.ticketCount}</strong>
          <span className="text-subtle"> · {left} left</span>
        </p>
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex flex-col">
            <span className="text-xs text-subtle">Total</span>
            <span className="text-xl font-extrabold">{formatNaira(q * l.buyerTicketPriceKobo)}</span>
          </div>
          <Button size="lg" className="flex-1" onClick={onBuy} loading={buy.isPending} disabled={max <= 0 || !!notLicensed}>
            {max <= 0 ? 'Ticket limit reached' : `Get ${q} ${q === 1 ? 'ticket' : 'tickets'}`}
          </Button>
        </div>
        {notLicensed ? <p className="text-xs text-hot-ink">DrawMart is only available to Lagos residents for now.</p> : null}
        {lastError?.code === 'insufficient_funds' ? (
          <Link to="/wallet" className="text-sm font-bold">
            Top up your wallet →
          </Link>
        ) : null}
      </Card>

      <div className="flex gap-2.5 rounded-2xl bg-ticket-soft p-4 text-sm leading-snug text-ticket-ink">
        <CoinIcon className="shrink-0" />
        <span>
          <strong>Didn’t win?</strong> {RULES.consolationCreditBps / 100}% of what you spent comes back as store credit for any draw or buy-now.
        </span>
      </div>

      <Button variant="outline" onClick={() => toast('Buy-now checkout is coming next: pay the full price and the store delivers.')}>
        Skip the draw: buy now for {formatNaira(l.priceKobo)}
      </Button>

      {api.testMode ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-line-strong p-3">
          <span className="text-xs font-bold text-subtle">Demo controls</span>
          <Button
            variant="ghost"
            size="sm"
            loading={demo.sellOut.isPending}
            onClick={() => demo.sellOut.mutateAsync(l.id).then(() => navigate(`/draws/${l.id}`), (e) => toast(errorMessage(e), 'error'))}
          >
            Sell remaining tickets and run the draw
          </Button>
          <Button variant="ghost" size="sm" loading={demo.expire.isPending} onClick={() => demo.expire.mutate(l.id, { onError: (e) => toast(errorMessage(e), 'error') })}>
            Skip to deadline (unsold)
          </Button>
        </div>
      ) : null}
    </div>
  )
}
