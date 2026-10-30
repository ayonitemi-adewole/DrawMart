import { Link } from 'react-router'
import { useAddToCart, useCart, useListing, useMyOrders } from '@/api/hooks'
import { isCar, isWonPrize } from '@/domain/cart'
import { CartIcon, TruckIcon } from './icons'
import { useToast } from './toast'
import { Button, buttonClass, errorMessage } from './ui'

/**
 * What a winner can do with what they won: track it once it's arranged, add it
 * to their cart to come with other items, or arrange it now. Cars skip the cart.
 */
export function PrizeActions({ listingId }: { listingId: string }) {
  const q = useListing(listingId)
  const orders = useMyOrders()
  const cart = useCart()
  const add = useAddToCart()
  const toast = useToast()
  const l = q.data
  if (!l || !isWonPrize(l)) return null

  if (orders.data?.some((o) => o.listingId === l.id)) {
    return (
      <Link to="/tickets?view=orders" className={buttonClass('outline', 'lg', 'w-full')}>
        <TruckIcon size={18} /> Track your prize
      </Link>
    )
  }
  const arrange = (
    <Link to={`/checkout?item=${l.id}`} className={buttonClass(isCar(l) ? 'ticket' : 'outline', 'lg', 'w-full')}>
      <TruckIcon size={18} /> {isCar(l) ? 'Arrange delivery' : 'Arrange it now'}
    </Link>
  )
  if (isCar(l)) return arrange
  return (
    <div className="flex w-full flex-col gap-2">
      {cart.data?.some((c) => c.listing.id === l.id) ? (
        <Link to="/cart" className={buttonClass('ticket', 'lg', 'w-full')}>
          <CartIcon size={18} /> In your cart · view
        </Link>
      ) : (
        <Button variant="ticket" size="lg" className="w-full" loading={add.isPending} onClick={() => add.mutate(l.id, { onSuccess: () => toast('Added to your cart. It’ll come with anything else you buy.'), onError: (e) => toast(errorMessage(e), 'error') })}>
          <CartIcon size={18} /> Add to cart
        </Button>
      )}
      {arrange}
    </div>
  )
}
