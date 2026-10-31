import { Link } from 'react-router'
import { ProductId } from '@/components/ProductId'
import { useCart, useRemoveFromCart } from '@/api/hooks'
import { CartIcon, TrophyIcon, XIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Badge, Card, EmptyState, ErrorState, IconButton, Notice, PageTitle, ProductImage, Skeleton, buttonClass, errorMessage } from '@/components/ui'
import { isWonPrize } from '@/domain/cart'
import { formatNaira } from '@/domain/money'

/** /cart: regular products, and draws the buyer has won, ready to come together. */
export function CartPage() {
  const q = useCart()
  const remove = useRemoveFromCart()
  const toast = useToast()

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Cart" sub="Items you’re buying and draws you’ve won, delivered together or collected in one trip.">
        Your cart
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState
          icon={CartIcon}
          title="Your cart is empty"
          body="Add regular products from any store, and draws you’ve won. Cars are arranged on their own."
          action={
            <Link to="/" className={buttonClass('primary')}>
              <span className="text-on-brand">Explore</span>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
          <Card className="divide-y divide-line overflow-hidden">
            {q.data.map(({ listing: l, amountKobo }) => {
              const prize = isWonPrize(l)
              return (
                <div key={l.id} className="flex items-center gap-3 p-4">
                  <ProductImage category={l.category} src={l.images[0]} alt="" size="sm" className="size-16 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Link to={`/listings/${l.id}`} className="truncate font-bold text-ink no-underline hover:underline">
                      {l.title}
                    </Link>
                    <span className="truncate text-xs text-subtle">{l.merchant.name}</span>
                    <ProductId code={l.productCode} />
                    {prize ? (
                      <Badge tone="ticket" className="w-fit">
                        <TrophyIcon size={12} /> You won this · free
                      </Badge>
                    ) : amountKobo === null ? (
                      <Badge tone="hot" className="w-fit">
                        No longer available
                      </Badge>
                    ) : (
                      <span className="text-sm font-extrabold tabular-nums">{formatNaira(amountKobo)}</span>
                    )}
                  </div>
                  <IconButton
                    aria-label={`Remove ${l.title} from your cart`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(l.id, { onError: (e) => toast(errorMessage(e), 'error') })}
                  >
                    <XIcon size={18} />
                  </IconButton>
                </div>
              )
            })}
          </Card>
          <CartSummary lines={q.data.map((l) => l.amountKobo)} />
        </div>
      )}
    </div>
  )
}

function CartSummary({ lines }: { lines: (number | null)[] }) {
  const ready = lines.filter((a): a is number => a !== null)
  const total = ready.reduce((s, a) => s + a, 0)
  const gone = lines.length - ready.length
  return (
    <Card className="flex flex-col gap-4 p-5 lg:sticky lg:top-24">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted">
          {ready.length} {ready.length === 1 ? 'item' : 'items'}
        </span>
        <span className="font-display text-3xl font-extrabold tabular-nums">{formatNaira(total)}</span>
      </div>
      {gone ? <Notice tone="neutral">Items no longer available won’t be included.</Notice> : null}
      {ready.length ? (
        <Link to="/checkout" className={buttonClass('primary', 'lg')}>
          <span className="text-on-brand">Continue to checkout</span>
        </Link>
      ) : null}
      <p className="text-xs text-subtle">Items in your cart aren’t held for you. Someone else can still buy them until you pay.</p>
    </Card>
  )
}
