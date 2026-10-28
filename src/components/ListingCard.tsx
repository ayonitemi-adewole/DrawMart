import { Link } from 'react-router'
import type { ListingView } from '@/api/types'
import { formatNaira } from '@/domain/money'
import { timeLeft } from '@/lib/time'
import { Badge, ProductImage, ProgressBar } from './ui'

export function isAlmostGone(l: ListingView) {
  return l.status === 'live' && l.ticketsSold / l.ticketCount >= 0.85
}

export function ListingCard({ listing: l }: { listing: ListingView }) {
  const left = l.ticketCount - l.ticketsSold
  const hot = isAlmostGone(l)
  return (
    <Link
      to={`/listings/${l.id}`}
      className="flex gap-3 rounded-2xl border border-line bg-surface p-3 text-ink no-underline transition hover:border-line-strong hover:shadow-sm"
    >
      <ProductImage category={l.category} className="size-21 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <span className="leading-tight font-bold">{l.title}</span>
          {hot ? <Badge tone="hot">ALMOST GONE</Badge> : null}
          {l.status === 'drawn' ? <Badge>DRAWN</Badge> : null}
          {l.myNumbers.length > 0 && l.status === 'live' ? <Badge tone="ticket">{l.myNumbers.length} YOURS</Badge> : null}
        </div>
        <span className="truncate text-xs text-subtle">
          Worth {formatNaira(l.priceKobo)} · {l.merchant.area}
        </span>
        <ProgressBar value={l.ticketsSold} max={l.ticketCount} hot={hot} label={`${l.ticketsSold} of ${l.ticketCount} tickets sold`} />
        <div className="flex justify-between text-sm">
          <span>
            <strong>{formatNaira(l.buyerTicketPriceKobo)}</strong> <span className="text-subtle">/ ticket</span>
          </span>
          <span className="text-subtle">{l.status === 'live' ? `${left} left · ${timeLeft(l.closesAt)}` : 'Draw complete'}</span>
        </div>
      </div>
    </Link>
  )
}
