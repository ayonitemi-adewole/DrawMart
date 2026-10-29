import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { useAccess, useBuyNow, useMyOrders, useWallet } from '@/api/hooks'
import type { ListingView, OrderView } from '@/api/types'
import { handoverMethodFor } from '@/domain/listing'
import { formatNaira } from '@/domain/money'
import { DELIVERY_ERROR_TEXT, ORDER_ERROR_TEXT, checkOrder, salePriceKobo, validateDelivery } from '@/domain/orders'
import { splitPayment } from '@/domain/rules'
import type { Delivery } from '@/domain/types'
import { CheckCircleIcon, LockIcon, MapPinIcon, PhoneIcon, ShieldIcon, TruckIcon } from './icons'
import { Sheet } from './Sheet'
import { useToast } from './toast'
import { Button, Card, Field, Notice, buttonClass, cx, errorMessage, inputCls } from './ui'

const DELIVERY_KEY = 'drawmart:delivery'

/** The last delivery details, so repeat buyers don't retype them. Only in this browser. */
function savedDelivery(): Delivery {
  try {
    const d = JSON.parse(localStorage.getItem(DELIVERY_KEY) ?? 'null') as Delivery | null
    if (d && typeof d.address === 'string' && typeof d.contactPhone === 'string') return d
  } catch {
    /* storage blocked */
  }
  return { address: '', contactPhone: '' }
}

function saveDelivery(d: Delivery) {
  try {
    localStorage.setItem(DELIVERY_KEY, JSON.stringify(d))
  } catch {
    /* storage blocked */
  }
}

/** Fixed-price checkout for regular products and for draws that ended unsold. */
export function BuyNowPanel({ listing: l }: { listing: ListingView }) {
  const access = useAccess()
  const { pathname } = useLocation()
  const orders = useMyOrders()
  const [open, setOpen] = useState(false)
  const [placed, setPlaced] = useState<OrderView | null>(null)
  const price = salePriceKobo(l)
  const mine = placed ?? orders.data?.find((o) => o.listingId === l.id)

  if (mine) return <OrderPlaced order={mine} fresh={!!placed} />

  if (price === null)
    return (
      <Card className="p-5">
        <Notice tone="neutral" title={l.status === 'sold' ? 'Sold' : 'Not on sale'}>
          {l.status === 'sold' ? 'Someone has already bought this item.' : 'This item isn’t on sale right now.'}
        </Notice>
      </Card>
    )

  const product = l.kind === 'product'

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">{product ? 'Buy now · no draw' : 'Draw ended · now for sale'}</span>
        <span className="font-display text-4xl font-extrabold tabular-nums">{formatNaira(price)}</span>
        <span className="text-sm text-muted">
          {product
            ? `Sold by ${l.merchant.name} at a fixed price. Pay from your wallet; the store delivers anywhere in Lagos.`
            : `The draw didn’t sell out, so everyone was refunded. ${l.merchant.name} is selling it at a fixed price instead.`}
        </span>
      </div>
      {access.ready && !access.signedIn ? (
        <Link to={`/login?next=${encodeURIComponent(pathname)}`} className={buttonClass('primary', 'lg')}>
          <span className="text-on-brand">Sign in to buy</span>
        </Link>
      ) : (
        <Button size="lg" onClick={() => setOpen(true)}>
          Buy now for {formatNaira(price)}
        </Button>
      )}
      <Notice icon={product ? ShieldIcon : LockIcon}>
        {product ? `Admin-reviewed listing from ${l.merchant.kind === 'individual' ? 'an ID-verified seller' : 'a verified store'}.` : handoverMethodFor(l.category) === 'inspection' ? 'Inspected by DrawMart.' : 'Still held in DrawMart escrow.'} The store is
        paid only after you confirm delivery.
      </Notice>
      {open ? (
        <Checkout
          listing={l}
          price={price}
          onClose={() => setOpen(false)}
          onPlaced={(o) => {
            setOpen(false)
            setPlaced(o)
          }}
        />
      ) : null}
    </Card>
  )
}

function Checkout({ listing: l, price, onClose, onPlaced }: { listing: ListingView; price: number; onClose: () => void; onPlaced: (o: OrderView) => void }) {
  const wallet = useWallet()
  const buy = useBuyNow()
  const toast = useToast()
  const [delivery, setDelivery] = useState(savedDelivery)
  const [showErrors, setShowErrors] = useState(false)
  const problems = validateDelivery(delivery)
  const balance = wallet.data?.balance
  const pay = balance ? splitPayment(price, balance) : null
  const blocker = balance ? checkOrder(l, balance) : null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setShowErrors(true)
    if (problems.length || blocker) return
    buy.mutate(
      { listingId: l.id, delivery },
      {
        onSuccess: (o) => {
          saveDelivery(delivery)
          onPlaced(o)
        },
        onError: (err) => toast(errorMessage(err), 'error'),
      },
    )
  }

  const err = (k: 'address_required' | 'phone_invalid') => (showErrors && problems.includes(k) ? DELIVERY_ERROR_TEXT[k] : undefined)

  return (
    <Sheet open onClose={() => !buy.isPending && onClose()} title="Checkout">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 pr-10">
          <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">Checkout</span>
          <h2 className="font-display text-2xl leading-tight font-extrabold">{l.title}</h2>
          <span className="text-sm text-muted">From {l.merchant.name}</span>
        </div>

        <Field label={<span className="flex items-center gap-1.5"><MapPinIcon size={14} /> Delivery address</span>} htmlFor="delivery-address" error={err('address_required')} hint="Lagos only for now.">
          <textarea
            id="delivery-address"
            rows={2}
            autoComplete="street-address"
            value={delivery.address}
            onChange={(e) => setDelivery({ ...delivery, address: e.target.value })}
            placeholder="e.g. 15 Awolowo Road, Ikoyi"
            className={cx(inputCls, 'min-h-20 py-3')}
          />
        </Field>
        <Field label={<span className="flex items-center gap-1.5"><PhoneIcon size={14} /> Phone for the rider</span>} htmlFor="delivery-phone" error={err('phone_invalid')}>
          <input
            id="delivery-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={delivery.contactPhone}
            onChange={(e) => setDelivery({ ...delivery, contactPhone: e.target.value })}
            placeholder="0803 123 4567"
            className={inputCls}
          />
        </Field>

        <dl className="flex flex-col gap-1.5 rounded-2xl bg-ground p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Item</dt>
            <dd className="font-bold tabular-nums">{formatNaira(price)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Delivery in Lagos</dt>
            <dd className="font-bold">Included</dd>
          </div>
          {pay && pay.fromCredit > 0 ? (
            <div className="flex justify-between text-ticket-ink">
              <dt>From store credit</dt>
              <dd className="font-bold tabular-nums">−{formatNaira(pay.fromCredit)}</dd>
            </div>
          ) : null}
          <div className="mt-1 flex justify-between border-t border-line pt-2">
            <dt className="font-bold">From wallet cash</dt>
            <dd className="font-extrabold tabular-nums">{formatNaira(pay ? pay.fromCash : price)}</dd>
          </div>
        </dl>

        {blocker ? (
          <Notice tone="hot" action={blocker === 'insufficient_funds' ? <Link to="/wallet">Top up</Link> : undefined}>
            {ORDER_ERROR_TEXT[blocker]}
          </Notice>
        ) : null}

        <Button type="submit" size="lg" loading={buy.isPending} disabled={!balance || !!blocker}>
          Pay {formatNaira(price)}
        </Button>
        <p className="flex items-start gap-2 text-xs text-subtle">
          <ShieldIcon size={14} className="mt-px shrink-0 text-brand" />
          Your address and phone go only to {l.merchant.name} for this delivery. The store is paid once you confirm it arrived.
        </p>
      </form>
    </Sheet>
  )
}

const ORDER_STEP: Record<OrderView['status'], string> = {
  paid: 'Paid. The store is preparing your delivery.',
  dispatched: 'On the way. Confirm when it arrives.',
  delivered: 'Delivered. Enjoy!',
}

function OrderPlaced({ order: o, fresh }: { order: OrderView; fresh: boolean }) {
  return (
    <Card className="flex flex-col items-center gap-4 p-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-brand-soft text-brand-ink">
        {o.status === 'delivered' ? <CheckCircleIcon size={32} /> : <TruckIcon size={32} />}
      </span>
      <div className="flex flex-col gap-1">
        <strong className="font-display text-2xl">{fresh ? 'Order placed' : 'You bought this'}</strong>
        <p className="text-sm text-muted">
          {formatNaira(o.priceKobo)} paid from your wallet. {ORDER_STEP[o.status]}
        </p>
      </div>
      <Link to="/tickets?view=orders" className={buttonClass('outline', 'lg', 'w-full')}>
        Track your order
      </Link>
    </Card>
  )
}
