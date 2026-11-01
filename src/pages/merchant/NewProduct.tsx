import { useState, type FormEvent } from 'react'
import { api } from '@/api'
import { NoProductMatch, ProductId, ProductSearch } from '@/components/ProductId'
import { matchesProductSearch } from '@/domain/productCode'
import { useCreateProduct, useMerchant, useMerchantOrders, useResubmitListing, useUpdateListing } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { CheckIcon, ClipboardIcon, ShieldIcon, StoreIcon, TicketIcon, TruckIcon, type IconComponent } from '@/components/icons'
import { OrderCard } from '@/components/OrderCard'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, ProductImage, Segmented, Skeleton, cx, errorMessage, inputCls } from '@/components/ui'
import { platformFeeBps } from '@/domain/fees'
import { formatNaira, parseNairaInput } from '@/domain/money'
import { PRODUCT_ERROR_TEXT, saleEconomics, validateProduct, type ProductError } from '@/domain/orders'
import type { Category, ListingKind, OrderStatus } from '@/domain/types'
import { CategoryPicker, FormStartNotice, PhotoPicker, Section, type ListingForm } from './parts'

const KINDS: { kind: ListingKind; icon: IconComponent; title: string; body: string; points: string[] }[] = [
  {
    kind: 'raffle',
    icon: TicketIcon,
    title: 'Raffle draw',
    body: 'Buyers get numbered tickets and one wins the item.',
    points: ['You set the price and ticket price', 'We collect it into escrow (cars: inspection)', 'Caution fee, refunded on a sell-out'],
  },
  {
    kind: 'product',
    icon: StoreIcon,
    title: 'Regular product',
    body: 'Sell it outright at a fixed price, like any shop.',
    points: ['One clean price for buyers', 'Stays with you; ship it when it sells', 'No caution fee, just an admin review'],
  },
]

/** First step of a new listing: raffle or regular product. */
export function ListingKindChooser({ onPick }: { onPick: (k: ListingKind) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-extrabold">What are you listing?</h2>
        <p className="text-sm text-muted">Pick how you want to sell this item. Both are reviewed by DrawMart before buyers see them.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => onPick(k.kind)}
            className="group flex animate-fade-up flex-col gap-4 rounded-3xl border border-line bg-surface p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand hover:shadow-lift"
          >
            <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-ink transition group-hover:bg-brand group-hover:text-on-brand">
              <k.icon size={24} />
            </span>
            <span className="flex flex-col gap-1">
              <strong className="font-display text-xl">{k.title}</strong>
              <span className="text-sm text-muted">{k.body}</span>
            </span>
            <ul className="flex flex-col gap-1.5 text-sm">
              {k.points.map((p) => (
                <li key={p} className="flex gap-2">
                  <CheckIcon size={16} className="mt-0.5 shrink-0 text-brand" /> {p}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>
    </div>
  )
}

const FIELD: Record<ProductError, 'title' | 'price' | 'stock'> = { title_required: 'title', price_too_low: 'price', stock_invalid: 'stock' }

/** `form` starts from an existing product: to fix and resend it, edit it in review, or copy it. */
export function NewProduct({ onBack, onDone, form }: { onBack: () => void; onDone: () => void; form?: ListingForm | null }) {
  const create = useCreateProduct()
  const resubmit = useResubmitListing()
  const update = useUpdateListing()
  const sending = create.isPending || resubmit.isPending || update.isPending
  const source = form?.listing
  const changing = form && form.mode !== 'copy' ? form.listing : undefined
  const merchant = useMerchant()
  const toast = useToast()
  const [title, setTitle] = useState(source?.title ?? '')
  const [description, setDescription] = useState(source?.description ?? '')
  const [category, setCategory] = useState<Category>(source?.category ?? 'Phones')
  const [photos, setPhotos] = useState<string[]>(source?.images ?? [])
  const [price, setPrice] = useState(source ? String(source.priceKobo / 100) : '')
  const [stock, setStock] = useState(String(source && source.stock > 0 ? source.stock : 1))
  const [showErrors, setShowErrors] = useState(false)
  const [created, setCreated] = useState<ListingView | null>(null)

  const input = { title, priceKobo: parseNairaInput(price), stock: Number(stock.replace(/,/g, '').trim() || NaN) }
  const errors = validateProduct(input)
  const fieldError = (f: 'title' | 'price' | 'stock') => {
    const e = showErrors ? errors.find((x) => FIELD[x] === f) : undefined
    return e ? PRODUCT_ERROR_TEXT[e] : undefined
  }
  // DrawMart sets the rate from the price; the seller never picks it.
  const { feeKobo, payoutKobo } = saleEconomics(input.priceKobo, platformFeeBps(input.priceKobo))

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (errors.length) {
      setShowErrors(true)
      toast('A few details need fixing first.', 'error')
      return
    }
    const details = { title, description, category, images: photos, priceKobo: input.priceKobo, stock: input.stock }
    if (changing) {
      // The listing leaves the rejected list as soon as this lands, so don't rely on this form still being there.
      ;(form?.mode === 'edit' ? update : resubmit)
        .mutateAsync({ id: changing.id, input: details })
        .then(() => {
          toast(form?.mode === 'edit' ? `${title.trim()} is updated.` : `${title.trim()} is back in review.`)
          onDone()
        })
        .catch((err) => toast(errorMessage(err), 'error'))
      return
    }
    create.mutate(
      details,
      { onSuccess: setCreated, onError: (err) => toast(errorMessage(err), 'error') },
    )
  }

  if (created) return <ProductSent listing={created} onDone={onDone} />

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
      <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col gap-5">
        {form ? <FormStartNotice form={form} /> : null}
        <Section n={1} title="The product" sub="What buyers are getting.">
          <Field label="Product name" htmlFor="p-title" error={fieldError('title')}>
            <input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Office chair, mesh back" />
          </Field>
          <Field label="Description" htmlFor="p-desc" hint={`${description.length}/400`}>
            <textarea
              id="p-desc"
              value={description}
              maxLength={400}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={cx(inputCls, 'py-3')}
              placeholder="Condition, warranty, what’s in the box, delivery time"
            />
          </Field>
          <CategoryPicker value={category} onChange={setCategory} />
          <PhotoPicker photos={photos} onChange={setPhotos} />
        </Section>

        <Section n={2} title="Price and stock" sub="Buyers pay exactly this. DrawMart’s fee, set from the price, comes out of your payout.">
          <Field label="Price (₦)" htmlFor="p-price" error={fieldError('price')} hint="Delivery in Lagos is included in this price.">
            <input id="p-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} placeholder="250,000" />
          </Field>
          <Field label="How many do you have?" htmlFor="p-stock" error={fieldError('stock')} hint="Each order takes one. It shows as sold out when they’re gone.">
            <input id="p-stock" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} className={inputCls} />
          </Field>
        </Section>

        <Notice icon={ShieldIcon} title="No escrow, no caution fee">
          The product stays with you. A DrawMart admin reviews the listing, then it goes on sale. When someone buys it, you get their delivery address here and send it.
        </Notice>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" loading={sending}>
            <ClipboardIcon size={18} /> {form?.mode === 'edit' ? 'Save changes' : form?.mode === 'fix' ? 'Send for review again' : 'Send for review'}
          </Button>
          <Button type="button" size="lg" variant="ghost" onClick={onBack} disabled={sending}>
            Back
          </Button>
        </div>
      </form>

      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-8">
        <div className="relative isolate flex flex-col gap-4 overflow-hidden rounded-[28px] bg-linear-to-br from-hero to-hero-2 p-6 text-on-hero shadow-lift">
          <div className="texture-dots absolute inset-0 -z-10" />
          <span className="text-xs font-extrabold tracking-[0.15em] text-ticket">HOW THIS SALE ADDS UP</span>
          <div className="flex flex-col">
            <span className="text-sm text-on-brand-muted">You receive per sale</span>
            <span key={payoutKobo} className="animate-fade-in font-display text-4xl font-extrabold tabular-nums">
              {formatNaira(payoutKobo)}
            </span>
          </div>
          <dl className="flex flex-col border-t border-white/15 text-sm">
            {[
              ['Buyer pays', formatNaira(input.priceKobo)],
              ['Platform fee', formatNaira(feeKobo)],
              ['Caution fee', 'None'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-white/15 py-2.5">
                <dt className="text-on-brand-muted">{k}</dt>
                <dd className="text-right font-bold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="flex gap-2 text-xs leading-relaxed text-on-brand-muted">
            <TruckIcon size={16} className="shrink-0 text-ticket" />
            Paid once it’s delivered to the buyer.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-extrabold tracking-wider text-subtle uppercase">Buyer preview</span>
          <Card className="flex flex-col gap-3 p-3">
            <ProductImage category={category} src={photos[0]} alt="Cover photo preview" className="h-40" />
            <div className="flex flex-col gap-0.5 px-1">
              <strong className="leading-tight">{title.trim() || 'Your product name'}</strong>
              <span className="text-xs text-subtle">{merchant.data?.name ?? 'Your store'}</span>
            </div>
            <div className="flex items-end justify-between px-1">
              <span className="text-lg font-extrabold">{formatNaira(input.priceKobo)}</span>
              <Badge tone="sky">BUY NOW</Badge>
            </div>
          </Card>
        </div>
      </aside>
    </div>
  )
}

function ProductSent({ listing: l, onDone }: { listing: ListingView; onDone: () => void }) {
  return (
    <Card className="mx-auto flex w-full max-w-xl animate-fade-up flex-col items-center gap-5 p-6 text-center sm:p-8">
      <span className="flex size-16 animate-pop items-center justify-center rounded-3xl bg-brand text-on-brand shadow-glow">
        <CheckIcon size={34} strokeWidth={3} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-extrabold">Sent for review</h2>
        <p className="text-sm text-muted">
          {l.title} · {formatNaira(l.priceKobo)}
        </p>
        <ProductId code={l.productCode} copy className="mx-auto" />
      </div>
      <p className="text-xs text-subtle">An admin checks the listing, usually within a day. Once approved it goes on sale straight away. No pickup or caution fee needed.</p>
      {api.testMode ? <span className="text-xs text-subtle">Test mode: approve it yourself from an admin account.</span> : null}
      <Button size="lg" className="w-full" onClick={onDone}>
        View your listings
      </Button>
    </Card>
  )
}

/** Orders for this store's fixed-price items. */
const ORDER_TABS: { value: OrderTab; label: string; has: (s: OrderStatus) => boolean; empty: string }[] = [
  { value: 'send', label: 'To send', has: (s) => s === 'paid', empty: 'Nothing waiting to be sent.' },
  { value: 'way', label: 'On the way', has: (s) => s === 'dispatched', empty: 'Nothing on the way.' },
  { value: 'done', label: 'Delivered', has: (s) => s === 'delivered', empty: 'Nothing delivered yet.' },
  { value: 'cancelled', label: 'Cancelled', has: (s) => s === 'cancelled', empty: 'Nothing cancelled.' },
]
type OrderTab = 'send' | 'way' | 'done' | 'cancelled'

export function MerchantOrders() {
  const q = useMerchantOrders()
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<OrderTab | null>(null)
  if (q.isPending) return <Skeleton className="h-60" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (q.data.length === 0)
    return <EmptyState icon={TruckIcon} title="No orders yet" body="When a buyer buys one of your fixed-price items, it shows up here with their delivery address." />
  const toSend = q.data.filter((o) => o.status === 'paid')
  const searched = q.data.filter((o) => matchesProductSearch(search, o.productCode, o.listingTitle))
  // Opens on the first tab with something in it.
  const tab = ORDER_TABS.find((t) => t.value === chosen) ?? ORDER_TABS.find((t) => q.data.some((o) => t.has(o.status))) ?? ORDER_TABS[0]
  const found = searched.filter((o) => tab.has(o.status))
  return (
    <section className="flex flex-col gap-4">
      {toSend.length ? (
        <Notice tone="ticket" icon={TruckIcon}>
          {toSend.length === 1 ? '1 order is' : `${toSend.length} orders are`} waiting. Mark each one ready once a rider can collect it.
        </Notice>
      ) : null}
      <Segmented<OrderTab>
        label="Show orders"
        value={tab.value}
        onChange={setChosen}
        size="sm"
        options={ORDER_TABS.map((t) => ({ value: t.value, label: t.label, count: searched.filter((o) => t.has(o.status)).length }))}
      />
      <ProductSearch value={search} onChange={setSearch} />
      {found.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {found.map((o) => (
            <OrderCard key={o.id} order={o} audience="store" />
          ))}
        </div>
      ) : search.trim() ? (
        <NoProductMatch query={search} />
      ) : (
        <p className="py-6 text-center text-sm text-muted">{tab.empty}</p>
      )}
    </section>
  )
}
