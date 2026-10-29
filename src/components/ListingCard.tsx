import { Link } from 'react-router'
import type { ListingView } from '@/api/types'
import { formatNaira } from '@/domain/money'
import { salePriceKobo } from '@/domain/orders'
import { isBoosted } from '@/domain/boosts'
import { Countdown } from './Countdown'
import { CheckIcon, FlameIcon, MapPinIcon, SparklesIcon, TicketIcon } from './icons'
import { Badge, ProductImage, ProgressBar, cx } from './ui'

export function isAlmostGone(l: ListingView) {
  return l.status === 'live' && l.ticketCount > 0 && l.ticketsSold / l.ticketCount >= 0.85
}

/** "60×" — how many times cheaper a ticket is than the item. */
export function valueMultiple(l: Pick<ListingView, 'priceKobo' | 'buyerTicketPriceKobo'>) {
  return Math.round(l.priceKobo / l.buyerTicketPriceKobo)
}

export function ListingCard({ listing: l, className, style }: { listing: ListingView; className?: string; style?: React.CSSProperties }) {
  const left = l.ticketCount - l.ticketsSold
  const hot = isAlmostGone(l)
  const pct = Math.round((l.ticketsSold / l.ticketCount) * 100)
  const mine = l.myNumbers.length
  const price = salePriceKobo(l)
  // Fixed-price cards: regular products, and draws that ended unsold.
  const forSale = l.kind === 'product' || price !== null

  return (
    <Link
      to={`/listings/${l.id}`}
      style={style}
      className={cx(
        'group flex animate-fade-up flex-col overflow-hidden rounded-3xl border border-line bg-surface text-ink no-underline shadow-card transition duration-200 hover:-translate-y-1 hover:border-line-strong hover:shadow-lift',
        className,
      )}
    >
      <div className="relative p-2 pb-0">
        <ProductImage
          category={l.category}
          src={l.images[0]}
          alt={l.title}
          className="h-52"
          imgClassName="transition-transform duration-500 ease-out group-hover:scale-105"
        />
        {l.images.length > 1 ? (
          <span className="absolute bottom-2 left-4 flex gap-1" aria-hidden="true">
            {l.images.map((src, i) => (
              <span key={src} className={cx('h-1.5 rounded-full', i === 0 ? 'w-4 bg-ink/70' : 'w-1.5 bg-ink/25')} />
            ))}
          </span>
        ) : null}
        <div className="absolute inset-x-4 top-4 flex flex-wrap items-start justify-between gap-1.5">
          <span className="flex flex-wrap gap-1.5">
            <Badge tone="neutral" className="bg-surface/85 backdrop-blur">
              {l.category}
            </Badge>
            {isBoosted(l, Date.now()) ? (
              <Badge tone="ticket" className="shadow-card">
                <SparklesIcon size={12} /> Sponsored
              </Badge>
            ) : null}
          </span>
          <div className="flex flex-wrap justify-end gap-1.5">
            {hot ? (
              <Badge tone="hot" className="shadow-card">
                <FlameIcon size={12} /> ALMOST GONE
              </Badge>
            ) : null}
            {mine > 0 && l.status === 'live' ? (
              <Badge tone="ticket" className="shadow-card">
                <TicketIcon size={12} /> {mine} YOURS
              </Badge>
            ) : null}
            {l.status === 'drawn' ? <Badge tone="neutral">DRAWN</Badge> : null}
            {l.status === 'sold' ? <Badge tone="hot">SOLD</Badge> : forSale ? <Badge tone="sky">BUY NOW</Badge> : null}
          </div>
        </div>
        {forSale ? null : (
          <span className="absolute right-4 bottom-2 rounded-full bg-ink px-2.5 py-1 text-[11px] font-extrabold text-ground shadow-card">
            {valueMultiple(l)}× cheaper
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-[17px] leading-tight font-extrabold">{l.title}</span>
          <span className="flex items-center gap-1 truncate text-xs text-subtle">
            {l.merchant.verified ? <CheckIcon size={13} className="text-brand" /> : null}
            {l.merchant.name}
            <span aria-hidden="true">·</span>
            <MapPinIcon size={12} /> {l.merchant.area}
          </span>
        </div>

        {forSale ? (
          <p className="text-xs text-subtle">
            {l.kind === 'product'
              ? 'Sold by the store at a fixed price. No tickets, no draw. Delivered in Lagos.'
              : 'The draw ended unsold and everyone was refunded. The store is now selling it at a fixed price.'}
          </p>
        ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs font-semibold">
            <span className={hot ? 'text-hot-ink' : 'text-muted'}>{pct}% sold</span>
            <span className="text-subtle">{l.status === 'live' ? `${left.toLocaleString('en-NG')} left` : 'Draw complete'}</span>
          </div>
          <ProgressBar value={l.ticketsSold} max={l.ticketCount} hot={hot} label={`${l.ticketsSold} of ${l.ticketCount} tickets sold`} />
        </div>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 border-t border-dashed border-line pt-3">
          {forSale ? (
            <div className="flex flex-col">
              <span className="text-[11px] text-subtle">{l.status === 'sold' ? 'Sold for' : 'Buy now'}</span>
              <span className="text-lg leading-tight font-extrabold">{formatNaira(price ?? l.fallbackPriceKobo ?? l.priceKobo)}</span>
            </div>
          ) : (
            <div className="flex flex-col">
              <span className="text-[11px] text-subtle line-through decoration-subtle/50">Worth {formatNaira(l.priceKobo)}</span>
              <span className="text-lg leading-tight font-extrabold">
                {formatNaira(l.buyerTicketPriceKobo)}
                <span className="text-xs font-semibold text-subtle"> / ticket</span>
              </span>
            </div>
          )}
          {l.status === 'live' ? <Countdown closesAt={l.closesAt} className="rounded-full bg-sunken px-2.5 py-1 text-xs font-bold" /> : null}
        </div>
      </div>
    </Link>
  )
}
