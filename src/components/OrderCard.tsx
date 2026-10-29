import { Link } from 'react-router'
import { useConfirmOrder, useDispatchOrder } from '@/api/hooks'
import type { OrderView } from '@/api/types'
import { formatNaira } from '@/domain/money'
import type { OrderStatus } from '@/domain/types'
import { dateTime } from '@/lib/time'
import { CheckCircleIcon, MapPinIcon, PhoneIcon, TruckIcon } from './icons'
import { useToast } from './toast'
import { Badge, Button, Card, ProductImage, errorMessage, type Tone } from './ui'

const STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  paid: { label: 'Paid · being prepared', tone: 'ticket' },
  dispatched: { label: 'On the way', tone: 'sky' },
  delivered: { label: 'Delivered', tone: 'brand' },
}

/**
 * One fixed-price order. Buyers confirm delivery; stores see the delivery
 * details, their payout, and mark the order as sent.
 */
export function OrderCard({ order: o, audience }: { order: OrderView; audience: 'buyer' | 'store' }) {
  const confirm = useConfirmOrder()
  const dispatch = useDispatchOrder()
  const toast = useToast()
  const s = STATUS[o.status]
  const onError = (e: unknown) => toast(errorMessage(e), 'error')

  return (
    <Card className="flex animate-fade-up flex-col gap-4 p-4 sm:p-5">
      <div className="flex gap-4">
        <ProductImage category={o.category} src={o.listingImage ?? undefined} alt={o.listingTitle} size="sm" className="size-18 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {audience === 'buyer' ? (
            <Link to={`/listings/${o.listingId}`} className="truncate font-bold text-ink no-underline hover:underline">
              {o.listingTitle}
            </Link>
          ) : (
            <strong className="truncate">{o.listingTitle}</strong>
          )}
          <span className="text-xs text-subtle">
            {audience === 'buyer' ? `${o.merchantName} · ` : ''}Ordered {dateTime(o.createdAt)}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={s.tone}>{s.label}</Badge>
            <span className="text-sm font-extrabold tabular-nums">{formatNaira(o.priceKobo)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 rounded-2xl bg-ground p-3 text-sm">
        <span className="flex items-start gap-2 text-muted">
          <MapPinIcon size={14} className="mt-0.5 shrink-0" /> {o.delivery.address}
        </span>
        {audience === 'store' ? (
          <a href={`tel:${o.delivery.contactPhone.replace(/\s/g, '')}`} className="flex min-h-11 w-fit items-center gap-2">
            <PhoneIcon size={14} /> {o.delivery.contactPhone}
          </a>
        ) : null}
        {audience === 'store' ? (
          <span className="text-xs text-subtle">
            Your payout {formatNaira(o.priceKobo - o.feeKobo)} after the {formatNaira(o.feeKobo)} platform fee, once the buyer confirms delivery.
          </span>
        ) : null}
      </div>

      {audience === 'buyer' && o.status !== 'delivered' ? (
        <Button variant={o.status === 'dispatched' ? 'primary' : 'outline'} loading={confirm.isPending} onClick={() => confirm.mutate(o.id, { onSuccess: () => toast('Thanks! Delivery confirmed.'), onError })}>
          <CheckCircleIcon size={16} /> I’ve received it
        </Button>
      ) : null}
      {audience === 'store' && o.status === 'paid' ? (
        <Button loading={dispatch.isPending} onClick={() => dispatch.mutate(o.id, { onSuccess: () => toast('Marked as sent. The buyer will confirm when it arrives.'), onError })}>
          <TruckIcon size={16} /> Mark as sent
        </Button>
      ) : null}
      {o.status === 'delivered' && o.deliveredAt ? <span className="text-xs text-subtle">Delivered {dateTime(o.deliveredAt)}</span> : null}
    </Card>
  )
}
