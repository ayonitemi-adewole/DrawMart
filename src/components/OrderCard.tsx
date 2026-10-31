import { Link } from 'react-router'
import { useDispatchOrder } from '@/api/hooks'
import type { OrderView } from '@/api/types'
import { directionsUrl } from '@/domain/location'
import { formatNaira } from '@/domain/money'
import { dateTime } from '@/lib/time'
import { ProductId } from './ProductId'
import { DeliveryPin } from './DeliveryPin'
import { MapPinIcon, PhoneIcon, StoreIcon, TruckIcon } from './icons'
import { useToast } from './toast'
import { Badge, Button, Card, ProductImage, errorMessage, type Tone } from './ui'

function statusOf(o: OrderView): { label: string; tone: Tone } {
  const pickup = o.fulfilment === 'pickup'
  switch (o.status) {
    case 'paid':
      return { label: o.isPrize ? 'Being prepared' : 'Paid · being prepared', tone: 'ticket' }
    case 'dispatched':
      return { label: pickup ? 'On its way to the pickup location' : 'On the way', tone: 'sky' }
    case 'delivered':
      return { label: pickup ? 'Collected' : 'Delivered', tone: 'brand' }
  }
}

/**
 * One order. Whoever sends it (the store, or an admin for won items in escrow)
 * sees the details and readies it for a rider. Buyers see the PIN they give the
 * rider, the only way it can be marked delivered.
 */
export function OrderCard({ order: o, audience }: { order: OrderView; audience: 'buyer' | 'store' | 'admin' }) {
  const dispatch = useDispatchOrder()
  const toast = useToast()
  const s = statusOf(o)
  const pickup = o.fulfilment === 'pickup'
  const sender = audience !== 'buyer'
  const onError = (e: unknown) => toast(errorMessage(e), 'error')

  return (
    <Card className="flex min-w-0 animate-fade-up flex-col gap-4 p-4 sm:p-5">
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
          <ProductId code={o.productCode} copy />
          <span className="text-xs text-subtle">
            {audience === 'buyer' ? `${o.merchantName} · ` : ''}Ordered {dateTime(o.createdAt)}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={s.tone}>{s.label}</Badge>
            <span className="text-sm font-extrabold tabular-nums">{o.isPrize ? 'Won in a draw' : formatNaira(o.priceKobo)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 rounded-2xl bg-ground p-3 text-sm">
        {pickup && o.pickupPoint ? (
          <>
            <span className="flex items-start gap-2 text-muted">
              <StoreIcon size={14} className="mt-0.5 shrink-0" /> <span><strong className="text-ink">{audience === 'buyer' ? 'Collect from' : 'Send to'} {o.pickupPoint.name}</strong>, {o.pickupPoint.address}</span>
            </span>
            {audience === 'buyer' ? <span className="text-xs text-subtle">{o.pickupPoint.hours}</span> : null}
            <a href={directionsUrl(o.pickupPoint.location)} target="_blank" rel="noreferrer" className="flex min-h-11 w-fit items-center gap-2">
              <MapPinIcon size={14} /> Directions
            </a>
          </>
        ) : (
          <>
            <span className="flex items-start gap-2 text-muted">
              <MapPinIcon size={14} className="mt-0.5 shrink-0" /> {o.delivery.address}
            </span>
            {sender && o.delivery.location ? (
              <a href={directionsUrl(o.delivery.location)} target="_blank" rel="noreferrer" className="flex min-h-11 w-fit items-center gap-2">
                <MapPinIcon size={14} /> Directions to the pinned spot
              </a>
            ) : null}
          </>
        )}
        {sender ? (
          <a href={`tel:${o.delivery.contactPhone.replace(/\s/g, '')}`} className="flex min-h-11 w-fit items-center gap-2">
            <PhoneIcon size={14} /> {o.delivery.contactPhone}
          </a>
        ) : null}
        {audience === 'store' && !o.isPrize ? (
          <span className="text-xs text-subtle">
            Your payout {formatNaira(o.priceKobo - o.feeKobo)} after the {formatNaira(o.feeKobo)} platform fee, once it’s delivered.
          </span>
        ) : null}
      </div>

      {audience === 'buyer' && o.deliveryPin ? <DeliveryPin pin={o.deliveryPin} pickup={pickup} /> : null}
      {sender && o.status === 'paid' ? (
        <Button loading={dispatch.isPending} onClick={() => dispatch.mutate(o.id, { onSuccess: () => toast('A rider can now take it. They’ll confirm it with the buyer’s PIN.'), onError })}>
          <TruckIcon size={16} /> {pickup ? 'Ready to go to the pickup location' : 'Ready for a rider'}
        </Button>
      ) : null}
      {o.status === 'delivered' && o.deliveredAt ? <span className="text-xs text-subtle">{pickup ? 'Collected' : 'Delivered'} {dateTime(o.deliveredAt)}</span> : null}
    </Card>
  )
}
