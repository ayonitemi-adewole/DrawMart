import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useCancelOrder, useClaimActions, useDispatchOrder, useSellerConfirmOrder, useShopPickup, useStoreRole } from '@/api/hooks'
import { canDo } from '@/domain/team'
import { canClaim, canContest, claimError, claimStatusText, contestError, returnFeeKobo, returnFeePercent, CLAIM_WINDOW_HOURS } from '@/domain/claims'
import type { ClaimKind, GeoPoint } from '@/domain/types'
import { AddressPicker } from './AddressPicker'
import { RiderPhotos } from './RiderPhotos'
import { ShopPickupSheet } from './ShopPickup'
import { needsConfirming } from '@/domain/orderConfirm'
import { collectFromCounterBy } from '@/domain/counter'
import { windowText } from '@/domain/deliveryWindows'
import { isPhoneOrTablet, thisDevice } from '@/lib/device'
import type { OrderView } from '@/api/types'
import { APOLOGY_CREDIT_KOBO, COLLECTION_PROBLEM_TEXT } from '@/domain/deliveryChecks'
import { directionsUrl } from '@/domain/location'
import { CANCEL_NOTE_MAX, CANCEL_REASONS, CANCEL_REASON_FOR_BUYER, CANCEL_REASON_TEXT, CANCEL_STOCK_TEXT, canCancelOrder, cancelError } from '@/domain/orderCancel'
import type { CancelReason } from '@/domain/types'
import { formatNaira } from '@/domain/money'
import { dateTime } from '@/lib/time'
import { ProductId } from './ProductId'
import { DeliveryPin } from './DeliveryPin'
import { Rebook } from './Rebook'
import { DeliveryTracker } from './DeliveryTracker'
import { CameraCapture } from './CameraCapture'
import { ReviewSheet } from './ReviewSheet'
import { Stars } from './Stars'
import { canEditReview, canReview } from '@/domain/reviews'
import { StarIcon, AlertIcon, CameraIcon, ClockIcon, CopyIcon, MapPinIcon, PhoneIcon, StoreIcon, TruckIcon, XIcon } from './icons'
import { Sheet } from './Sheet'
import { useToast } from './toast'
import { Badge, Button, Card, Field, Notice, ProductImage, buttonClass, cx, errorMessage, inputCls, type Tone } from './ui'

function statusOf(o: OrderView, audience: 'buyer' | 'store' | 'admin'): { label: string; tone: Tone } {
  const pickup = o.fulfilment === 'pickup'
  switch (o.status) {
    case 'paid':
      if (needsConfirming(o)) return { label: audience === 'buyer' ? 'Paid · waiting for the seller' : 'Paid · confirm it', tone: 'ticket' }
      return { label: o.isPrize ? 'Being prepared' : o.confirmedAt ? 'Confirmed · being prepared' : 'Paid · being prepared', tone: 'ticket' }
    case 'dispatched':
      if (pickup && o.atCounterAt) return { label: 'Ready to collect', tone: 'brand' }
      return { label: pickup ? 'On its way to the pickup location' : 'On the way', tone: 'sky' }
    case 'delivered':
      return { label: pickup ? 'Collected' : 'Delivered', tone: 'brand' }
    case 'cancelled':
      return { label: 'Cancelled', tone: 'hot' }
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
  const s = statusOf(o, audience)
  const pickup = o.fulfilment === 'pickup'
  const sender = audience !== 'buyer'
  const onError = (e: unknown) => toast(errorMessage(e), 'error')
  const cancelled = o.status === 'cancelled'
  const [cancelling, setCancelling] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [addingPickup, setAddingPickup] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [contesting, setContesting] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const claimText = o.claim ? claimStatusText(o.claim.kind, o.claim.status, audience === 'buyer' ? 'buyer' : 'seller') : null
  const pickupDetails = useShopPickup()
  const needsPickupDetails = audience === 'store' && pickupDetails.data === null
  const waiting = needsConfirming(o)
  // Cancelling and contesting are for owners and managers; orders-only staff confirm and send.
  const canShop = canDo(useStoreRole().data ?? null, 'shop')
  const failedOrRefused = o.cancelReason === 'failed_check' || o.cancelReason === 'refused_wrong' || o.cancelReason === 'refused_damaged'

  return (
    <Card className="flex min-w-0 animate-fade-up flex-col gap-4 p-4 sm:p-5">
      <div className="flex gap-4">
        <ProductImage category={o.category} src={o.listingImage ?? undefined} alt={o.listingTitle} size="sm" className="size-18 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {audience === 'buyer' ? (
            <Link to={`/listings/${o.listingId}`} className="truncate font-bold text-ink no-underline hover:underline">
              {o.listingTitle}
              {o.quantity > 1 ? ` × ${o.quantity}` : ''}
            </Link>
          ) : (
            <strong className="truncate">
              {o.listingTitle}
              {o.quantity > 1 ? ` × ${o.quantity}` : ''}
            </strong>
          )}
          <ProductId code={o.productCode} copy />
          <span className="text-xs text-subtle">
            {audience === 'buyer' ? `${o.merchantName} · ` : ''}Ordered {dateTime(o.createdAt)}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={s.tone}>{s.label}</Badge>
            <span className="text-sm font-extrabold tabular-nums">{o.isPrize ? 'Won in a draw' : formatNaira(o.priceKobo)}</span>
            {audience === 'buyer' && o.deliveryFeeKobo > 0 && !cancelled ? <span className="text-xs text-subtle">+ {formatNaira(o.deliveryFeeKobo)} delivery</span> : null}
            {o.discountKobo ? <span className="text-xs text-subtle">{audience === 'buyer' ? 'You saved' : 'Your discount'} {formatNaira(o.discountKobo)}</span> : null}
          </div>
        </div>
      </div>

      {cancelled && o.cancelReason ? (
        <Notice tone="neutral" icon={XIcon} title={audience === 'buyer' ? `Refunded ${formatNaira(o.priceKobo + o.deliveryFeeKobo)} to your wallet` : `Buyer refunded ${formatNaira(o.priceKobo)}`}>
          {audience === 'buyer' ? CANCEL_REASON_FOR_BUYER[o.cancelReason] : CANCEL_REASON_TEXT[o.cancelReason]}
          {o.cancelNote ? ` “${o.cancelNote}”` : ''}
        </Notice>
      ) : null}

      {cancelled && o.collectionProblems?.length ? (
        <p className="text-sm text-muted">The rider found: {o.collectionProblems.map((p) => COLLECTION_PROBLEM_TEXT[p]).join(', ')}.</p>
      ) : null}
      {cancelled && audience === 'buyer' && failedOrRefused ? (
        <div className="flex flex-wrap gap-2">
          <Link to={`/listings/${o.listingId}`} className={buttonClass('outline')}>
            See this item again
          </Link>
          <Link to={`/browse?category=${encodeURIComponent(o.category)}`} className={buttonClass('outline')}>
            See similar items
          </Link>
        </div>
      ) : null}
      {cancelled && audience === 'buyer' && failedOrRefused ? <p className="text-xs text-subtle">We’ve also added {formatNaira(APOLOGY_CREDIT_KOBO)} of store credit to say sorry.</p> : null}
      {cancelled && audience === 'store' && o.returnState ? (
        <Notice tone="neutral" icon={TruckIcon} title={o.returnState === 'returned' ? 'It’s back with you' : 'A rider is bringing it back'}>
          {o.returnedAt ? `Returned ${dateTime(o.returnedAt)}.` : 'Expect them soon.'}
        </Notice>
      ) : null}
      {cancelled && audience !== 'buyer' && (o.collectionPhotos?.length || o.refusalPhoto) ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {[...(o.collectionPhotos ?? []), ...(o.refusalPhoto ? [o.refusalPhoto] : [])].map((src, i) => (
            <img key={i} src={src} alt="The rider’s photo" className="size-16 rounded-xl border border-line bg-photo object-cover" />
          ))}
          The rider’s photos.
        </div>
      ) : null}

      {cancelled ? null : <div className="flex flex-col gap-1.5 rounded-2xl bg-ground p-3 text-sm">
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
        {!pickup && o.windowStart && o.windowEnd && o.status !== 'delivered' && !o.redeliverAt ? (
          <span className="flex items-center gap-2 font-bold">
            <ClockIcon size={14} className="shrink-0" /> {audience === 'buyer' ? 'Arriving' : 'The buyer wants it'} {windowText({ start: o.windowStart, end: o.windowEnd }, Date.now()).replace(/^(Today|Tomorrow)/, (d) => d.toLowerCase())}
          </span>
        ) : null}
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
      </div>}

      {waiting && o.confirmBy ? (
        <Notice tone="ticket" icon={ClockIcon} title={audience === 'buyer' ? `The seller has until ${dateTime(o.confirmBy)} to confirm` : `Confirm by ${dateTime(o.confirmBy)}`}>
          {audience === 'buyer' ? 'They’ll send a photo of your item. If they don’t, you’re refunded automatically.' : 'Take a fresh photo of the item on your phone. If you don’t, the order cancels, the buyer is refunded and the product is paused. Your time doesn’t run from 10pm to 9am.'}
        </Notice>
      ) : null}
      {audience === 'store' && o.status === 'paid' && o.readyBy && !waiting ? (
        <Notice tone="ticket" icon={ClockIcon} title={`Mark it ready by ${dateTime(o.readyBy)}`}>
          If you don’t, the order cancels, the buyer is refunded and the product is paused.
        </Notice>
      ) : null}
      {o.confirmPhoto && !cancelled ? (
        <div className="flex items-center gap-3 text-sm text-muted">
          <img src={o.confirmPhoto} alt="The seller’s photo of this item" className="size-16 rounded-xl border border-line bg-photo object-cover" />
          {audience === 'buyer' ? 'The seller’s photo of your item.' : 'Your photo for this order.'}
        </div>
      ) : null}
      {audience === 'buyer' && pickup && o.status === 'dispatched' && o.atCounterAt ? (
        <Notice tone="brand" icon={StoreIcon} title={`Ready at ${o.pickupPoint?.name ?? 'the pickup location'}`}>
          It arrived {dateTime(o.atCounterAt)}. Bring your PIN, and open it there before you give it.
          {o.isPrize ? '' : ` Collect it by ${dateTime(collectFromCounterBy(o.atCounterAt))}, or it goes back to the seller and you’re refunded, less delivery.`}
        </Notice>
      ) : null}
      {audience === 'buyer' ? <DeliveryTracker order={o} /> : null}
      {audience === 'buyer' ? <Rebook order={o} /> : null}
      {audience === 'buyer' && o.deliveryPin ? <DeliveryPin pin={o.deliveryPin} pickup={pickup} /> : null}
      {sender && waiting ? (
        <Button onClick={() => setConfirming(true)}>
          <CameraIcon size={16} /> Confirm with a photo
        </Button>
      ) : null}
      {confirming ? <ConfirmSheet order={o} onClose={() => setConfirming(false)} /> : null}
      {addingPickup ? <ShopPickupSheet onClose={() => setAddingPickup(false)} /> : null}
      {sender && o.status === 'paid' && !waiting && needsPickupDetails ? (
        <Button onClick={() => setAddingPickup(true)}>
          <MapPinIcon size={16} /> Add where riders collect from
        </Button>
      ) : null}
      {sender && o.status === 'paid' && !waiting && !needsPickupDetails ? (
        <Button loading={dispatch.isPending} onClick={() => dispatch.mutate(o.id, { onSuccess: () => toast('A rider can now take it. They’ll confirm it with the buyer’s PIN.'), onError })}>
          <TruckIcon size={16} /> {pickup ? 'Ready to go to the pickup location' : 'Ready for a rider'}
        </Button>
      ) : null}
      {audience === 'store' && canShop && canCancelOrder(o) ? (
        <Button variant="ghost" onClick={() => setCancelling(true)}>
          <XIcon size={16} /> I can’t fulfil this
        </Button>
      ) : null}
      {cancelling ? <CancelSheet order={o} onClose={() => setCancelling(false)} /> : null}
      {claimText && (audience !== 'buyer' || o.claim?.kind !== 'contest') ? (
        <Notice tone={o.claim?.status === 'declined' || o.claim?.status === 'pickup_failed' ? 'hot' : 'ticket'} icon={ClockIcon} title={claimText.title}>
          {claimText.body}
          {o.claim?.reviewNote ? ` “${o.claim.reviewNote}”` : ''}
          {o.claim?.kind === 'change_of_mind' && audience === 'buyer' && (o.claim.status === 'returning' || o.claim.status === 'returned') ? ` We kept a ${formatNaira(o.claim.returnFeeKobo)} return fee.` : ''}
        </Notice>
      ) : null}
      {audience === 'buyer' && !o.claim && canClaim(o, Date.now()) ? (
        <Button variant="ghost" onClick={() => setClaiming(true)}>
          <AlertIcon size={16} /> Problem with it, or want to return it?
        </Button>
      ) : null}
      {claiming ? <ClaimSheet order={o} onClose={() => setClaiming(false)} /> : null}
      {audience === 'store' && canShop && !o.claim && canContest(o, Date.now()) ? (
        <Button variant="ghost" onClick={() => setContesting(true)}>
          <AlertIcon size={16} /> I don’t think this is right
        </Button>
      ) : null}
      {contesting ? <ContestSheet order={o} onClose={() => setContesting(false)} /> : null}
      {o.status === 'delivered' && o.deliveredAt ? <span className="text-xs text-subtle">{pickup ? 'Collected' : 'Delivered'} {dateTime(o.deliveredAt)}</span> : null}
      {o.review && audience !== 'admin' ? (
        <div className="flex flex-col gap-1 rounded-2xl bg-ground p-3 text-sm">
          <span className="flex flex-wrap items-center gap-2">
            <strong>{audience === 'buyer' ? 'Your review' : 'The buyer’s review'}</strong>
            <Stars rating={o.review.rating} size={14} />
          </span>
          {o.review.sellerComment ? <p className="text-muted">{o.review.sellerComment}</p> : null}
          {o.review.productComment ? <p className="text-muted">{o.review.productComment}</p> : null}
          {o.review.reply ? <p className="text-muted"><strong className="text-ink">The seller replied: </strong>{o.review.reply}</p> : null}
          {o.review.hidden ? <p className="text-xs text-subtle">DrawMart has hidden this review from other buyers.</p> : null}
          {audience === 'store' && !o.review.reply && !o.review.hidden ? (
            <Link to="/store/reviews" className="flex min-h-11 w-fit items-center font-bold">Reply</Link>
          ) : null}
        </div>
      ) : null}
      {audience === 'buyer' && (o.review ? canEditReview(o, o.review, Date.now()) : canReview(o, Date.now())) ? (
        <Button variant={o.review ? 'ghost' : 'outline'} onClick={() => setReviewing(true)}>
          <StarIcon size={16} /> {o.review ? 'Change your review' : 'Rate this order'}
        </Button>
      ) : null}
      {reviewing ? <ReviewSheet order={o} onClose={() => setReviewing(false)} /> : null}
      {audience === 'buyer' && o.isPrize && o.status === 'delivered' ? (
        <Link to={`/draws/${o.listingId}`} className="flex min-h-11 w-fit items-center text-sm">
          Choose whether to show this on the Winners page
        </Link>
      ) : null}
    </Card>
  )
}

function ClaimSheet({ order: o, onClose }: { order: OrderView; onClose: () => void }) {
  const { open } = useClaimActions()
  const toast = useToast()
  const [kind, setKind] = useState<ClaimKind | null>(null)
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [unused, setUnused] = useState(false)
  const [address, setAddress] = useState(o.delivery.address)
  const [location, setLocation] = useState<GeoPoint | null>(o.delivery.location)
  const [showError, setShowError] = useState(false)
  const needsAddress = !o.delivery.address
  const fee = returnFeeKobo(o.priceKobo, o.quantity)
  const problem = claimError(kind, description, photos) ?? (kind === 'change_of_mind' && !unused ? 'Confirm it’s unused to return it.' : null)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (problem || !kind) {
      setShowError(true)
      return
    }
    open
      .mutateAsync({ id: o.id, input: { kind, description, photos, address, location, phone: o.delivery.contactPhone } })
      .then(() => {
        toast(kind === 'fault' ? 'Sent. DrawMart will look at it.' : 'A rider will come to collect it. You’re refunded when they have it.')
        onClose()
      })
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <Sheet open onClose={() => !open.isPending && onClose()} title="Problem or return">
      <h2 className="pr-10 font-display text-2xl font-extrabold">What’s happened?</h2>
      <p className="text-sm text-muted">You have {CLAIM_WINDOW_HOURS} hours from delivery. {o.listingTitle}{o.quantity > 1 ? ` × ${o.quantity}` : ''}.</p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">What’s happened</legend>
          {([['fault', 'It’s faulty or not as described'], ['change_of_mind', 'I’ve changed my mind']] as const).map(([value, label]) => (
            <label key={value} className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm transition', kind === value ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong')}>
              <input type="radio" name={`claim-${o.id}`} checked={kind === value} onChange={() => setKind(value)} className="size-4 shrink-0 accent-brand" />
              {label}
            </label>
          ))}
        </fieldset>
        {kind === 'fault' ? (
          <>
            <Field label="What’s wrong?" htmlFor={`claim-text-${o.id}`}>
              <textarea id={`claim-text-${o.id}`} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} rows={3} className={cx(inputCls, 'py-3')} />
            </Field>
            <RiderPhotos photos={photos} onChange={setPhotos} label="Add a photo of the problem" />
            <p className="text-xs text-subtle">DrawMart checks it first. If it’s accepted, a rider collects it and you get everything back, delivery included.</p>
          </>
        ) : null}
        {kind === 'change_of_mind' ? (
          <>
            <Notice tone="ticket" icon={AlertIcon} title={`You’d get back ${formatNaira(o.priceKobo - fee)}`}>
              A {returnFeePercent(Math.floor(o.priceKobo / o.quantity))}% return fee of {formatNaira(fee)} comes off, and the delivery fee isn’t refunded.
            </Notice>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" checked={unused} onChange={(e) => setUnused(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
              It’s unused, complete and in its packaging. If it isn’t, the rider won’t take it and I won’t be refunded.
            </label>
          </>
        ) : null}
        {kind && needsAddress ? (
          <AddressPicker id={`claim-address-${o.id}`} label="Where should the rider collect it?" address={address} onAddress={setAddress} location={location} onLocation={setLocation} showPinError={showError} />
        ) : null}
        {showError && problem ? <p className="text-sm font-semibold text-hot-ink" role="alert">{problem}</p> : null}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={open.isPending}>
            Go back
          </Button>
          <Button type="submit" className="flex-1" loading={open.isPending}>
            {kind === 'change_of_mind' ? 'Return it' : 'Send'}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function ContestSheet({ order: o, onClose }: { order: OrderView; onClose: () => void }) {
  const { contest } = useClaimActions()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [showError, setShowError] = useState(false)
  const problem = contestError(note)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (problem) {
      setShowError(true)
      return
    }
    contest
      .mutateAsync({ id: o.id, note })
      .then(() => {
        toast('Sent. DrawMart will look at it.')
        onClose()
      })
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <Sheet open onClose={() => !contest.isPending && onClose()} title="Contest this">
      <h2 className="pr-10 font-display text-2xl font-extrabold">What happened?</h2>
      <p className="text-sm text-muted">If DrawMart agrees, your charge is taken back and this won’t count against your shop. The buyer keeps their refund either way.</p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Your side" htmlFor={`contest-${o.id}`} error={showError && problem ? problem : undefined}>
          <textarea id={`contest-${o.id}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} rows={4} className={cx(inputCls, 'py-3')} />
        </Field>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={contest.isPending}>
            Go back
          </Button>
          <Button type="submit" className="flex-1" loading={contest.isPending}>
            Send
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

/** The photo is proof the seller has the item now, so it's taken live on a phone: nothing can be uploaded. */
function ConfirmSheet({ order: o, onClose }: { order: OrderView; onClose: () => void }) {
  const confirm = useSellerConfirmOrder()
  const toast = useToast()
  const [photo, setPhoto] = useState<string | null>(null)
  const [onPhone] = useState(() => isPhoneOrTablet(thisDevice()))
  const link = `${window.location.origin}${window.location.pathname}?tab=orders`

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!photo) {
      toast('Take the photo first.', 'error')
      return
    }
    confirm
      .mutateAsync({ id: o.id, photo })
      .then(() => {
        toast('Confirmed. Mark it ready when a rider can collect it.')
        onClose()
      })
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  function copyLink() {
    navigator.clipboard
      .writeText(link)
      .then(() => toast('Link copied.'))
      .catch(() => toast('Couldn’t copy it. Type the address into your phone instead.', 'error'))
  }

  if (!onPhone)
    return (
      <Sheet open onClose={onClose} title="Confirm order">
        <h2 className="pr-10 font-display text-2xl font-extrabold">Switch to your phone</h2>
        <p className="text-sm text-muted">
          You confirm {o.listingTitle}{o.quantity > 1 ? ` × ${o.quantity}` : ''} with a photo taken right now on your phone or tablet, so the buyer knows you have it. Photos can’t be uploaded from a computer.
        </p>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          <li>Open this address on your phone and sign in with the same account:</li>
        </ol>
        <p className="rounded-xl bg-sunken p-3 text-sm font-bold break-all">{link}</p>
        <ol start={2} className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          <li>Tap “Confirm with a photo” on this order.</li>
        </ol>
        {o.confirmBy ? <p className="text-xs text-subtle">You have until {dateTime(o.confirmBy)}.</p> : null}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Close
          </Button>
          <Button type="button" className="flex-1" onClick={copyLink}>
            <CopyIcon size={16} /> Copy the link
          </Button>
        </div>
      </Sheet>
    )

  return (
    <Sheet open onClose={() => !confirm.isPending && onClose()} title="Confirm order">
      <h2 className="pr-10 font-display text-2xl font-extrabold">Confirm you have it</h2>
      <p className="text-sm text-muted">
        Take a photo of {o.listingTitle}{o.quantity > 1 ? ` × ${o.quantity}` : ''} now. The buyer will see it, so make sure it’s the actual item.
      </p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <CameraCapture photo={photo} onChange={setPhoto} />
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={confirm.isPending}>
            Not yet
          </Button>
          <Button type="submit" className="flex-1" loading={confirm.isPending}>
            Confirm order
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

/** This card moves to another tab as soon as the list refreshes, so wait on the promise. */
function CancelSheet({ order: o, onClose }: { order: OrderView; onClose: () => void }) {
  const cancel = useCancelOrder()
  const toast = useToast()
  const [reason, setReason] = useState<CancelReason | null>(null)
  const [note, setNote] = useState('')
  const [showError, setShowError] = useState(false)
  const problem = cancelError({ reason, note })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (problem || !reason) {
      setShowError(true)
      return
    }
    cancel
      .mutateAsync({ id: o.id, reason, note })
      .then(() => {
        toast('Order cancelled. The buyer has been refunded and told why.', 'info')
        onClose()
      })
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <Sheet open onClose={() => !cancel.isPending && onClose()} title="Cancel order">
      <h2 className="pr-10 font-display text-2xl font-extrabold">Cancel this order?</h2>
      <p className="text-sm text-muted">
        {o.listingTitle}{o.quantity > 1 ? ` × ${o.quantity}` : ''}. The buyer gets {formatNaira(o.priceKobo)} back straight away, plus any delivery fee they no longer need and sees your reason. This can’t be undone, and cancelling often affects your standing.
      </p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1.5 text-sm font-bold">Why?</legend>
          {CANCEL_REASONS.map((r) => (
            <label key={r} className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm transition', reason === r ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong')}>
              <input type="radio" name={`cancel-${o.id}`} checked={reason === r} onChange={() => setReason(r)} className="size-4 shrink-0 accent-brand" />
              {CANCEL_REASON_TEXT[r]}
            </label>
          ))}
        </fieldset>
        {reason ? <p className="text-xs text-subtle">{CANCEL_STOCK_TEXT[reason]}</p> : null}
        <Field
          label={reason === 'other' ? 'Tell the buyer why' : 'Note for the buyer (optional)'}
          htmlFor={`cancel-note-${o.id}`}
          hint={`${note.length}/${CANCEL_NOTE_MAX}`}
          error={showError && problem ? problem : undefined}
        >
          <textarea id={`cancel-note-${o.id}`} value={note} maxLength={CANCEL_NOTE_MAX} onChange={(e) => setNote(e.target.value)} rows={2} className={cx(inputCls, 'py-3')} />
        </Field>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={cancel.isPending}>
            Keep the order
          </Button>
          <Button type="submit" variant="danger" className="flex-1" loading={cancel.isPending}>
            Cancel and refund
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
