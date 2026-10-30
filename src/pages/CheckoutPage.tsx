import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAddressActions, useAddresses, useCart, useCheckout, useListing, useMe, usePickupPoints, useWallet } from '@/api/hooks'
import type { ListingView, OrderView } from '@/api/types'
import { AddressPicker } from '@/components/AddressPicker'
import { CheckCircleIcon, MapPinIcon, PhoneIcon, ShieldIcon, StoreIcon, TruckIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Button, Card, EmptyState, ErrorState, Field, Notice, PageTitle, ProductImage, Segmented, Skeleton, buttonClass, cx, errorMessage, inputCls } from '@/components/ui'
import { MAX_ADDRESS_LABEL, MAX_SAVED_ADDRESSES, SAVED_ADDRESS_ERROR_TEXT, preferredAddress, suggestedPhone, type SavedAddress } from '@/domain/addresses'
import { CHECKOUT_ERROR_TEXT, checkoutTotalKobo, isCar, isWonPrize, lineAmountKobo, validateCheckout } from '@/domain/cart'
import { directionsUrl } from '@/domain/location'
import { formatNaira } from '@/domain/money'
import { ORDER_ERROR_TEXT } from '@/domain/orders'
import { splitPayment } from '@/domain/rules'
import type { Delivery, Fulfilment } from '@/domain/types'

/** /checkout: the whole cart, or one item with ?item= (Buy now, or arranging a car). */
export function CheckoutPage() {
  const [params] = useSearchParams()
  const item = params.get('item')
  return item ? <SingleItem id={item} /> : <WholeCart />
}

function SingleItem({ id }: { id: string }) {
  const q = useListing(id)
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  return <CheckoutFlow items={[q.data]} />
}

function WholeCart() {
  const q = useCart()
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  return <CheckoutFlow items={q.data.filter((l) => l.amountKobo !== null).map((l) => l.listing)} />
}

type Step = 'where' | 'review'

/** Waits for saved addresses and the account phone, which the form starts from. */
function CheckoutFlow({ items }: { items: ListingView[] }) {
  const addresses = useAddresses()
  const me = useMe()
  if (addresses.isPending || me.isPending) return <Skeleton className="h-96" />
  // If they can't load, a new address still works.
  return <CheckoutForm items={items} addresses={addresses.data ?? []} accountPhone={me.data?.phone ?? null} />
}

/** Two steps: a saved or new address with a pin, or a pickup location; then review and pay. */
function CheckoutForm({ items, addresses, accountPhone }: { items: ListingView[]; addresses: SavedAddress[]; accountPhone: string | null }) {
  const wallet = useWallet()
  const points = usePickupPoints()
  const checkout = useCheckout()
  const toast = useToast()
  const { save: saveAddress } = useAddressActions()
  const phone = suggestedPhone(accountPhone, addresses)
  // null: a new address, typed in here.
  const [addressId, setAddressId] = useState<string | null>(preferredAddress(addresses)?.id ?? null)
  const [newDelivery, setNewDelivery] = useState<Delivery>({ address: '', location: null, contactPhone: phone })
  const [pickupPhone, setPickupPhone] = useState(phone)
  const canSave = addresses.length < MAX_SAVED_ADDRESSES
  const [saveNew, setSaveNew] = useState(canSave)
  const [newLabel, setNewLabel] = useState(addresses.length ? '' : 'Home')
  const [fulfilment, setFulfilment] = useState<Fulfilment>('delivery')
  const [pickupPointId, setPickupPointId] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const hasCar = items.some(isCar)
  const chosen = addresses.find((a) => a.id === addressId) ?? null
  const delivery: Delivery =
    fulfilment === 'pickup' ? { address: '', location: null, contactPhone: pickupPhone } : chosen ? { address: chosen.address, location: chosen.location, contactPhone: chosen.contactPhone } : newDelivery
  const details = { fulfilment, delivery, pickupPointId }
  const problems = validateCheckout(details, hasCar)
  const savingNew = fulfilment === 'delivery' && !chosen && saveNew
  const labelMissing = savingNew && !newLabel.trim()
  // With a saved address, buyers land on the review, ready to change it.
  const [step, setStep] = useState<Step>(problems.length ? 'where' : 'review')
  const [placed, setPlaced] = useState<OrderView[] | null>(null)

  if (placed) return <Placed orders={placed} />
  if (items.length === 0) {
    return (
      <EmptyState
        icon={StoreIcon}
        title="Nothing to check out"
        body="Your cart is empty, or its items are no longer available."
        action={
          <Link to="/cart" className={buttonClass('outline')}>
            Back to your cart
          </Link>
        }
      />
    )
  }

  const available = items.every((l) => lineAmountKobo(l) !== null)
  const total = checkoutTotalKobo(items)
  const balance = wallet.data?.balance
  const pay = balance ? splitPayment(total, balance) : null
  const short = balance ? balance.cashKobo + balance.creditKobo < total : false
  const point = points.data?.find((p) => p.id === pickupPointId)
  const err = (k: 'address_required' | 'phone_invalid' | 'pickup_point_required') => (showErrors && problems.includes(k) ? CHECKOUT_ERROR_TEXT[k] : undefined)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (step === 'where') {
      setShowErrors(true)
      if (!problems.length && !labelMissing) setStep('review')
      return
    }
    if (problems.length) {
      setStep('where')
      return
    }
    if (short || !available) return
    checkout.mutate(
      { listingIds: items.map((l) => l.id), ...details },
      {
        onSuccess: (orders) => {
          setPlaced(orders)
          if (savingNew) {
            // The order's placed either way, so a failure here is only worth a note.
            saveAddress.mutate({ ...newDelivery, label: newLabel }, { onError: () => toast('Your order’s placed, but we couldn’t save that address.', 'info') })
          }
        },
        onError: (error) => toast(errorMessage(error), 'error'),
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow={`Checkout · step ${step === 'where' ? 1 : 2} of 2`} sub={hasCar ? 'Cars are arranged on their own and delivered from the dealer.' : undefined}>
        {step === 'where' ? 'How should it reach you?' : 'Review and pay'}
      </PageTitle>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
        <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col gap-5">
          {step === 'where' ? (
            <>
              <Card className="flex flex-col gap-4 p-5 sm:p-6">
                {hasCar ? null : (
                  <Segmented<Fulfilment>
                    label="How should it reach you?"
                    value={fulfilment}
                    onChange={setFulfilment}
                    className="w-full"
                    options={[
                      { value: 'delivery', label: <><TruckIcon size={16} /> Deliver it</> },
                      { value: 'pickup', label: <><StoreIcon size={16} /> I’ll collect it</> },
                    ]}
                  />
                )}
                {fulfilment === 'delivery' ? (
                  <>
                    {addresses.length ? (
                      <fieldset className="flex flex-col gap-2">
                        <legend className="mb-1.5 flex w-full items-center justify-between gap-2 text-sm font-bold">
                          Deliver to
                          <Link to="/account" className="text-xs">
                            Manage addresses
                          </Link>
                        </legend>
                        {addresses.map((a) => (
                          <label key={a.id} className={cx('flex min-h-11 cursor-pointer gap-3 rounded-2xl border p-3.5 transition', addressId === a.id ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong')}>
                            <input type="radio" name="saved-address" checked={addressId === a.id} onChange={() => setAddressId(a.id)} className="mt-1 size-4 shrink-0 accent-brand" />
                            <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                              <strong>{a.label}</strong>
                              <span className="text-muted">{a.address}</span>
                              <span className="text-xs text-subtle">Rider calls {a.contactPhone}</span>
                            </span>
                          </label>
                        ))}
                        <label className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border p-3.5 text-sm font-bold transition', addressId === null ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong')}>
                          <input type="radio" name="saved-address" checked={addressId === null} onChange={() => setAddressId(null)} className="size-4 shrink-0 accent-brand" />
                          Use a new address
                        </label>
                      </fieldset>
                    ) : null}
                    {chosen ? null : (
                      <AddressPicker
                        id="delivery-address"
                        label="Delivery address"
                        hint="Add your flat, gate colour or a landmark to help the rider. Lagos only for now."
                        placeholder="e.g. 15 Awolowo Road, Ikoyi"
                        address={newDelivery.address}
                        onAddress={(address) => setNewDelivery((d) => ({ ...d, address }))}
                        location={newDelivery.location}
                        onLocation={(location) => setNewDelivery((d) => ({ ...d, location }))}
                        addressError={err('address_required')}
                        showPinError={showErrors}
                      />
                    )}
                  </>
                ) : (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1.5 text-sm font-bold">Choose a pickup location</legend>
                    {points.isPending ? <Skeleton className="h-40" /> : null}
                    {points.isError ? <ErrorState error={points.error} onRetry={() => points.refetch()} /> : null}
                    {points.data?.map((p) => (
                      <label key={p.id} className={cx('flex min-h-11 cursor-pointer gap-3 rounded-2xl border p-3.5 transition', pickupPointId === p.id ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong')}>
                        <input type="radio" name="pickup-point" checked={pickupPointId === p.id} onChange={() => setPickupPointId(p.id)} className="mt-1 size-4 shrink-0 accent-brand" />
                        <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                          <strong>{p.name}</strong>
                          <span className="text-muted">{p.address}</span>
                          <span className="text-xs text-subtle">{p.hours}</span>
                          <a href={directionsUrl(p.location)} target="_blank" rel="noreferrer" className="flex min-h-11 w-fit items-center gap-1 text-xs font-bold">
                            <MapPinIcon size={12} /> See on a map
                          </a>
                        </span>
                      </label>
                    ))}
                    {err('pickup_point_required') ? <span className="text-xs font-semibold text-hot-ink">{err('pickup_point_required')}</span> : null}
                  </fieldset>
                )}
                {fulfilment === 'delivery' && chosen ? null : (
                  <Field
                    label={<span className="flex items-center gap-1.5"><PhoneIcon size={14} /> {fulfilment === 'delivery' ? 'Phone for the rider' : 'Phone number'}</span>}
                    htmlFor="delivery-phone"
                    error={err('phone_invalid')}
                    hint={fulfilment === 'pickup' ? 'We’ll call when it’s ready to collect.' : undefined}
                  >
                    <input
                      id="delivery-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={delivery.contactPhone}
                      onChange={(e) => (fulfilment === 'pickup' ? setPickupPhone(e.target.value) : setNewDelivery((d) => ({ ...d, contactPhone: e.target.value })))}
                      placeholder="0803 123 4567"
                      className={inputCls}
                    />
                  </Field>
                )}
                {fulfilment === 'delivery' && !chosen && canSave ? (
                  <div className="flex flex-col gap-3 rounded-2xl bg-ground p-3.5">
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-bold">
                      <input type="checkbox" checked={saveNew} onChange={(e) => setSaveNew(e.target.checked)} className="size-5 shrink-0 accent-brand" />
                      Save this address for next time
                    </label>
                    {saveNew ? (
                      <Field label="Name for this address" htmlFor="new-address-label" error={showErrors && labelMissing ? SAVED_ADDRESS_ERROR_TEXT.label_required : undefined} hint="e.g. Home, Work, Mum’s house.">
                        <input id="new-address-label" value={newLabel} maxLength={MAX_ADDRESS_LABEL} onChange={(e) => setNewLabel(e.target.value)} className={inputCls} />
                      </Field>
                    ) : null}
                  </div>
                ) : null}
              </Card>
              <Button type="submit" size="lg">
                Continue to review
              </Button>
            </>
          ) : (
            <>
              <Card className="flex items-start gap-3 p-4 text-sm sm:p-5">
                {fulfilment === 'delivery' ? <TruckIcon size={18} className="mt-0.5 shrink-0 text-brand" /> : <StoreIcon size={18} className="mt-0.5 shrink-0 text-brand" />}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong>{fulfilment === 'delivery' ? `Delivering to${chosen ? ` ${chosen.label}` : ''}` : `Collecting from ${point?.name ?? 'your pickup location'}`}</strong>
                  <span className="text-muted">{fulfilment === 'delivery' ? delivery.address.trim() : point?.address}</span>
                  <span className="text-xs text-subtle">
                    {fulfilment === 'delivery' ? `Pinned on the map · rider calls ${delivery.contactPhone.trim()}` : `${point?.hours ?? ''} · we’ll call ${delivery.contactPhone.trim()} when it’s ready`}
                  </span>
                </div>
                <Button type="button" variant="ghost" size="sm" className="min-h-11 shrink-0" disabled={checkout.isPending} onClick={() => setStep('where')}>
                  Change
                </Button>
              </Card>

              {!available ? <Notice tone="hot">An item here is no longer available. Go back and remove it to continue.</Notice> : null}
              {short ? (
                <Notice tone="hot" action={<Link to="/wallet">Top up</Link>}>
                  {ORDER_ERROR_TEXT.insufficient_funds}
                </Notice>
              ) : null}

              <Button type="submit" size="lg" loading={checkout.isPending} disabled={!balance || short || !available}>
                {total > 0 ? `Pay ${formatNaira(total)}` : 'Confirm'}
              </Button>
              <p className="flex items-start gap-2 text-xs text-subtle">
                <ShieldIcon size={14} className="mt-px shrink-0 text-brand" />
                {fulfilment === 'delivery' ? 'Your address, pin and phone go only to whoever delivers each item.' : 'Your phone number goes only to whoever handles each item.'} Stores are paid once you confirm you have it.
              </p>
            </>
          )}
        </form>

        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
          <Card className="flex flex-col gap-3 p-5">
            <strong>
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </strong>
            <ul className="flex flex-col gap-3">
              {items.map((l) => (
                <li key={l.id} className="flex items-center gap-3 text-sm">
                  <ProductImage category={l.category} src={l.images[0]} alt="" size="sm" className="size-12 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-semibold">{l.title}</span>
                  <span className="shrink-0 font-bold tabular-nums">{isWonPrize(l) ? 'Won' : formatNaira(lineAmountKobo(l) ?? 0)}</span>
                </li>
              ))}
            </ul>
            <dl className="flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">{fulfilment === 'delivery' ? 'Delivery in Lagos' : 'Collection'}</dt>
                <dd className="font-bold">{fulfilment === 'delivery' ? 'Included' : 'Free'}</dd>
              </div>
              {pay && pay.fromCredit > 0 ? (
                <div className="flex justify-between text-ticket-ink">
                  <dt>From store credit</dt>
                  <dd className="font-bold tabular-nums">−{formatNaira(pay.fromCredit)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="font-bold">From wallet cash</dt>
                <dd className="font-extrabold tabular-nums">{formatNaira(pay ? pay.fromCash : total)}</dd>
              </div>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function Placed({ orders }: { orders: OrderView[] }) {
  const pickup = orders[0]?.pickupPoint
  return (
    <Card className="mx-auto flex w-full max-w-xl animate-fade-up flex-col items-center gap-5 p-6 text-center sm:p-8">
      <span className="flex size-16 animate-pop items-center justify-center rounded-3xl bg-brand text-on-brand shadow-glow">
        <CheckCircleIcon size={34} />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-extrabold">Order placed</h1>
        <p className="text-sm text-muted">{pickup ? `We’ll call you when it’s ready to collect from ${pickup.name}.` : 'We’ll get it on its way to you.'}</p>
      </div>
      <ul className="flex w-full flex-col gap-1 rounded-2xl bg-ground p-3 text-left text-sm">
        {orders.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-semibold">{o.listingTitle}</span>
            <span className="shrink-0 font-bold tabular-nums">{o.isPrize ? 'Won' : formatNaira(o.priceKobo)}</span>
          </li>
        ))}
      </ul>
      <Link to="/tickets?view=orders" className={buttonClass('primary', 'lg', 'w-full')}>
        <span className="text-on-brand">Track your order</span>
      </Link>
    </Card>
  )
}
