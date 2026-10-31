import { Link, useLocation } from 'react-router'
import { useAccess, useAddToCart, useCart, useConversations, useMerchant, useMyOrders } from '@/api/hooks'
import type { ListingView, OrderView } from '@/api/types'
import { isCar } from '@/domain/cart'
import { handoverMethodFor } from '@/domain/listing'
import { formatNaira } from '@/domain/money'
import { salePriceKobo } from '@/domain/orders'
import { CartIcon, ChatIcon, CheckCircleIcon, LockIcon, ShieldIcon, TruckIcon } from './icons'
import { useToast } from './toast'
import { Button, Card, Notice, buttonClass, errorMessage } from './ui'

/** Fixed-price checkout for regular products and for draws that ended unsold. */
export function BuyNowPanel({ listing: l }: { listing: ListingView }) {
  const access = useAccess()
  const { pathname } = useLocation()
  const orders = useMyOrders()
  const cart = useCart()
  const add = useAddToCart()
  const shop = useMerchant()
  const toast = useToast()
  const price = salePriceKobo(l)
  const mine = orders.data?.find((o) => o.listingId === l.id)
  const inCart = cart.data?.some((c) => c.listing.id === l.id)
  const ownItem = shop.data?.id === l.merchantId

  if (mine) return <OrderPlaced order={mine} listing={l} />

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
        <>
          {/* Cars are arranged one at a time, so they skip the cart. */}
          {isCar(l) || ownItem ? null : inCart ? (
            <Link to="/cart" className={buttonClass('primary', 'lg')}>
              <span className="flex items-center gap-2 text-on-brand">
                <CartIcon size={18} /> In your cart · view
              </span>
            </Link>
          ) : (
            <Button size="lg" loading={add.isPending} onClick={() => add.mutate(l.id, { onSuccess: () => toast('Added to your cart.'), onError: (e) => toast(errorMessage(e), 'error') })}>
              <CartIcon size={18} /> Add to cart
            </Button>
          )}
          {ownItem ? null : (
            <Link to={`/checkout?item=${l.id}`} className={buttonClass(isCar(l) ? 'primary' : 'outline', 'lg')}>
              {isCar(l) ? <span className="text-on-brand">Buy now for {formatNaira(price)}</span> : `Buy now for ${formatNaira(price)}`}
            </Link>
          )}
        </>
      )}
      <MessageSellerButton listing={l} />
      <Notice icon={product ? ShieldIcon : LockIcon}>
        {product ? `Admin-reviewed listing from ${l.merchant.kind === 'individual' ? 'an ID-verified seller' : 'a verified store'}.` : handoverMethodFor(l.category) === 'inspection' ? 'Inspected by DrawMart.' : 'Still held in DrawMart escrow.'} The store is
        paid only after it’s delivered to you.
      </Notice>
    </Card>
  )
}

const ORDER_STEP: Record<OrderView['status'], string> = {
  paid: 'Paid. The store is getting it ready.',
  dispatched: 'On its way. Give the rider your PIN once you have it.',
  delivered: 'You have it. Enjoy!',
}

/** Products only: raffle items are held and checked by DrawMart, so there's nobody to ask. */
function MessageSellerButton({ listing: l }: { listing: ListingView }) {
  const access = useAccess()
  const shop = useMerchant()
  const conversations = useConversations()
  const { pathname } = useLocation()
  // The chat itself only appears once the first message is sent.
  const existing = conversations.data?.find((c) => c.listingId === l.id && c.me === 'buyer')
  if (l.kind !== 'product' || shop.data?.id === l.merchantId) return null
  if (access.ready && !access.signedIn)
    return (
      <Link to={`/login?next=${encodeURIComponent(pathname)}`} className={buttonClass('outline', 'lg', 'w-full')}>
        <ChatIcon size={18} /> Sign in to message the seller
      </Link>
    )
  return (
    <Link to={existing ? `/messages/${existing.id}` : `/messages/new/${l.id}`} className={buttonClass('outline', 'lg', 'w-full')}>
      <ChatIcon size={18} /> {existing ? 'Open your chat' : `Message ${l.merchant.kind === 'individual' ? 'the seller' : l.merchant.name}`}
    </Link>
  )
}

function OrderPlaced({ order: o, listing }: { order: OrderView; listing: ListingView }) {
  return (
    <Card className="flex flex-col items-center gap-4 p-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-brand-soft text-brand-ink">
        {o.status === 'delivered' ? <CheckCircleIcon size={32} /> : <TruckIcon size={32} />}
      </span>
      <div className="flex flex-col gap-1">
        <strong className="font-display text-2xl">You bought this</strong>
        <p className="text-sm text-muted">
          {formatNaira(o.priceKobo)} paid from your wallet. {ORDER_STEP[o.status]}
        </p>
      </div>
      <Link to="/tickets?view=orders" className={buttonClass('outline', 'lg', 'w-full')}>
        Track your order
      </Link>
      <MessageSellerButton listing={listing} />
    </Card>
  )
}
