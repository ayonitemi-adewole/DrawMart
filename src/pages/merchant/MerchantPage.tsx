import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { api } from '@/api'
import { useCreateListing, useCreateListingBatch, useSavePickupItems, useSavedPickup, useMerchant, useMerchantListings, useMerchantOrders } from '@/api/hooks'
import type { ListingView, PickupItemInput } from '@/api/types'
import { Countdown } from '@/components/Countdown'
import {
  BackIcon,
  CalendarIcon,
  CarIcon,
  CheckCircleIcon,
  CheckIcon,
  ClipboardIcon,
  NairaIcon,
  LayoutIcon,
  LockIcon,
  MapPinIcon,
  PlusIcon,
  ShieldIcon,
  StoreIcon,
  TicketIcon,
  TruckIcon,
} from '@/components/icons'
import { BoostRow } from '@/components/BoostControl'
import { AddressPicker } from '@/components/AddressPicker'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, ProductImage, ProgressBar, Segmented, Skeleton, StatTile, cx, errorMessage, inputCls, type Tone } from '@/components/ui'
import { LISTING_ERROR_TEXT, computeListingEconomics, platformFeeBps, validateListingEconomics, type ListingValidationError } from '@/domain/fees'
import {
  HANDOVER_ERROR_TEXT,
  LISTING_TERMS_ERROR_TEXT,
  TIME_SLOTS,
  addDays,
  PICKUP_ERROR_TEXT,
  cautionFeesDue,
  pickupCautionFee,
  savedPickupDaysLeft,
  daysBetween,
  handoverDateRange,
  handoverMethodFor,
  localDate,
  validateHandover,
  validateListingTerms,
  type HandoverError,
  type ListingTermsError,
} from '@/domain/listing'
import { directionsUrl } from '@/domain/location'
import { formatNaira, nairaToKobo, parseNairaInput } from '@/domain/money'
import { saleEconomics, salePriceKobo } from '@/domain/orders'
import { RULES } from '@/domain/rules'
import { type Category, type GeoPoint, type FeeMode, type TimeSlot, type UnsoldPolicy } from '@/domain/types'
import { calendarDay, dateTime } from '@/lib/time'
import { NoProductMatch, ProductId, ProductSearch } from '@/components/ProductId'
import { listingMatchesSearch } from '@/domain/productCode'
import { ListingKindChooser, MerchantOrders, NewProduct } from './NewProduct'
import { CategoryPicker, PhotoPicker, Section } from './parts'

const FEE_MODES: { id: FeeMode; label: string; hint: string }[] = [
  { id: 'seller', label: 'Store pays', hint: 'Recommended for launch: buyers see exactly the ticket price, and the fee comes out of your payout.' },
  { id: 'buyer', label: 'Buyer pays', hint: 'The fee is added to each ticket, so buyers pay a little more than the ticket price.' },
  { id: 'split', label: 'Split 50/50', hint: 'Half the fee is added to each ticket and half comes out of your payout.' },
]

const UNSOLD_OPTIONS: { id: UnsoldPolicy; title: string; body: string }[] = [
  { id: 'refund', title: 'Refund buyers', body: 'Everyone gets their money back and the listing closes.' },
  { id: 'extend_once', title: `Extend once by ${RULES.extensionDays} days`, body: 'One more chance to sell out, then refund.' },
  { id: 'convert_to_sale', title: 'Keep selling it', body: 'Buyers are refunded and the item stays on DrawMart at a fixed price you set.' },
]

type Tab = 'draws' | 'orders' | 'new'
const TABS: Tab[] = ['draws', 'orders', 'new']

/** Taking tickets, sold out and waiting for the winner, or on sale at a fixed price. */
const isActive = (l: ListingView) => l.status === 'live' || l.status === 'sold_out' || l.status === 'for_sale'

export function MerchantPage() {
  const merchant = useMerchant()
  const listings = useMerchantListings()
  const orders = useMerchantOrders()
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.find((t) => t === params.get('tab')) ?? 'draws'
  const kindParam = params.get('kind')
  const kind = kindParam === 'raffle' || kindParam === 'product' ? kindParam : null
  const setTab = (t: Tab, k?: string) => setParams(t === 'draws' ? {} : k ? { tab: t, kind: k } : { tab: t }, { replace: true })

  const data = listings.data ?? []
  const active = data.filter(isActive)
  const review = data.filter((l) => l.status === 'pending_review')
  const toSend = orders.data?.filter((o) => o.status === 'paid').length ?? 0
  // Drawn raffles pay out the price plus the caution fee back once it's delivered to the winner;
  // orders pay out the price less the fee once it's delivered.
  const awaiting =
    data
      .filter((l) => l.status === 'drawn' || l.status === 'sold_out')
      .reduce((s, l) => s + computeListingEconomics(l).sellerPayoutKobo, 0) +
    cautionFeesDue(data.filter((l) => l.status === 'drawn')) +
    (orders.data ?? []).filter((o) => o.status !== 'delivered').reduce((s, o) => s + o.priceKobo - o.feeKobo, 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex animate-fade-up flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">Store dashboard</span>
          <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">{merchant.data ? `Hello, ${merchant.data.name}` : 'Your store'}</h1>
          {merchant.data ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-subtle">
              <span className="flex items-center gap-1">
                <MapPinIcon size={14} /> {merchant.data.area}
              </span>
              <span>{merchant.data.cacNumber}</span>
              {merchant.data.verified ? (
                <Badge>
                  <CheckIcon size={12} /> Verified
                </Badge>
              ) : (
                <Badge tone="ticket">Verification pending</Badge>
              )}
            </p>
          ) : null}
        </div>
        {tab !== 'new' ? (
          <Button onClick={() => setTab('new')}>
            <PlusIcon size={18} /> New listing
          </Button>
        ) : null}
      </div>

      {!(tab === 'new' && kind === 'raffle') ? <SavedPickupReminder onContinue={() => setTab('new', 'raffle')} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={TicketIcon} label="Live & on sale" value={active.length} hint={`${active.filter((l) => l.kind === 'raffle').length} draws`} />
        <StatTile icon={ClipboardIcon} tone="ticket" label="In review" value={review.length} hint="Waiting on review, pickup or inspection" />
        <StatTile icon={TruckIcon} tone="sky" label="Orders to send" value={toSend} hint={`${orders.data?.length ?? 0} orders in all`} />
        <StatTile icon={NairaIcon} tone="violet" label="Payout after delivery" value={formatNaira(awaiting)} hint="Includes caution fees back" />
      </div>

      <Segmented<Tab>
        label="Section"
        value={tab}
        onChange={setTab}
        className="w-full sm:w-auto sm:self-start"
        options={[
          { value: 'draws', label: <><LayoutIcon size={16} /> Your listings</>, count: data.length },
          { value: 'orders', label: <><TruckIcon size={16} /> Orders</>, count: toSend || undefined },
          { value: 'new', label: <><PlusIcon size={16} /> New listing</> },
        ]}
      />

      <div key={tab} className="animate-fade-in">
        {tab === 'orders' ? (
          <MerchantOrders />
        ) : tab !== 'new' ? (
          <MerchantListings onNew={() => setTab('new')} />
        ) : kind === 'product' ? (
          <NewProduct onBack={() => setTab('new')} onDone={() => setTab('draws')} />
        ) : kind === 'raffle' ? (
          <NewListing onDone={() => setTab('draws')} />
        ) : (
          <ListingKindChooser onPick={(k) => setTab('new', k)} />
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ new listing

type DetailsField = 'title' | 'price' | 'ticket' | 'duration' | 'fallback'

const ERROR_FIELD: Record<ListingValidationError | ListingTermsError, DetailsField> = {
  title_required: 'title',
  price_required: 'price',
  ticket_too_cheap: 'ticket',
  ticket_above_price: 'ticket',
  too_many_tickets: 'ticket',
  duration_out_of_range: 'duration',
  fallback_price_required: 'fallback',
}

const errorText = (e: ListingValidationError | ListingTermsError) =>
  e in LISTING_ERROR_TEXT ? LISTING_ERROR_TEXT[e as ListingValidationError] : LISTING_TERMS_ERROR_TEXT[e as ListingTermsError]

type Step = 'details' | 'handover' | 'done'

/** An item waiting to go in a pickup: everything but the pickup booking. */
type DraftItem = PickupItemInput

const payoutOf = (d: DraftItem) => computeListingEconomics({ ...d, feeBps: platformFeeBps(d.priceKobo) }).sellerPayoutKobo

/**
 * Two steps: describe the draw (or several, to share one pickup and one fee),
 * then book the pickup (or inspection) and pay the caution fee.
 */
function NewListing({ onDone }: { onDone: () => void }) {
  const create = useCreateListing()
  const createBatch = useCreateListingBatch()
  const sending = create.isPending || createBatch.isPending
  const savedPickup = useSavedPickup()
  const savePickup = useSavePickupItems()
  const toast = useToast()
  const merchant = useMerchant()
  const [today] = useState(() => localDate(new Date()))
  const [step, setStep] = useState<Step>('details')
  const top = useRef<HTMLDivElement>(null)

  // Step 1: the draw
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<Category>('Phones')
  const [photos, setPhotos] = useState<string[]>([])
  const [price, setPrice] = useState('')
  const [ticket, setTicket] = useState('')
  const [feeMode, setFeeMode] = useState<FeeMode>('seller')
  const [durationDays, setDurationDays] = useState(14)
  const [customDeadline, setCustomDeadline] = useState(false)
  const [unsoldPolicy, setUnsoldPolicy] = useState<UnsoldPolicy>('refund')
  const [fallbackPrice, setFallbackPrice] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  // Items already saved for this pickup. Empty while listing a single item.
  const [batch, setBatch] = useState<DraftItem[]>([])
  const [restored, setRestored] = useState(false)

  // Coming back: pick up the items saved earlier.
  useEffect(() => {
    if (restored || savedPickup.isPending) return
    setRestored(true)
    if (savedPickup.data) setBatch(savedPickup.data.items)
  }, [restored, savedPickup.isPending, savedPickup.data])

  // Step 2: handover
  const [address, setAddress] = useState('')
  const [location, setLocation] = useState<GeoPoint | null>(null)
  const [phone, setPhone] = useState('')
  const [date, setDate] = useState(() => addDays(today, 2))
  const [slot, setSlot] = useState<TimeSlot>('morning')
  const [agreed, setAgreed] = useState(false)
  const [showHandoverErrors, setShowHandoverErrors] = useState(false)
  const [created, setCreated] = useState<ListingView[] | null>(null)

  const economics = { title, priceKobo: parseNairaInput(price), ticketPriceKobo: parseNairaInput(ticket), feeMode }
  const fallbackPriceKobo = parseNairaInput(fallbackPrice)
  const terms = { durationDays, unsoldPolicy, fallbackPriceKobo }
  // DrawMart sets the rate from the item's value; the store only picks who carries it.
  const econ = computeListingEconomics({ ...economics, feeBps: platformFeeBps(economics.priceKobo) })
  const errors = [...validateListingEconomics(economics), ...validateListingTerms(terms)]
  const fieldError = (f: DetailsField) => {
    if (!showErrors) return undefined
    const e = errors.find((x) => ERROR_FIELD[x] === f)
    return e ? errorText(e) : undefined
  }

  const draft: DraftItem = {
    ...economics,
    description,
    category,
    images: photos,
    durationDays,
    unsoldPolicy,
    fallbackPriceKobo: unsoldPolicy === 'convert_to_sale' ? fallbackPriceKobo : undefined,
  }
  const formBlank = !title.trim() && !price.trim() && !ticket.trim()
  const sharing = batch.length > 0
  const batchFull = batch.length >= RULES.maxPickupItems
  // What gets sent: the saved items, or just this one.
  const items = sharing ? batch : [draft]
  const method = sharing ? 'pickup' : handoverMethodFor(category)
  // One fee for the pickup, including the item being written (cars can't join a pickup).
  const cautionFee = pickupCautionFee([...items.map((i) => i.category), ...(sharing && !formBlank && category !== 'Cars' ? [category] : [])])
  const handover = { address, location, contactPhone: phone, date, slot }
  const handoverErrors = validateHandover(handover, today)
  const handoverError = (e: HandoverError) => (showHandoverErrors && handoverErrors.includes(e) ? HANDOVER_ERROR_TEXT[e] : undefined)

  // Suggested ticket prices that give a sensible number of tickets for this item.
  const suggestions = economics.priceKobo > 0 ? [100, 250, 500, 1000].map((count) => Math.max(nairaToKobo(100), Math.ceil(economics.priceKobo / count / 10000) * 10000)) : []
  const uniqueSuggestions = [...new Set(suggestions)].filter((k) => k <= economics.priceKobo)

  function go(next: Step) {
    setStep(next)
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function clearItemForm() {
    setTitle('')
    setDescription('')
    setPhotos([])
    setPrice('')
    setTicket('')
    setUnsoldPolicy('refund')
    setFallbackPrice('')
    setShowErrors(false)
  }

  /** Stores the list on the server, so it's there when the seller comes back. */
  async function persist(next: DraftItem[]) {
    try {
      const saved = await savePickup.mutateAsync(next)
      setBatch(saved?.items ?? [])
      return true
    } catch (err) {
      toast(errorMessage(err), 'error')
      return false
    }
  }

  /** Checks the item being written and saves it to the pickup. False if it can't go in. */
  async function saveToPickup() {
    if (errors.length) {
      setShowErrors(true)
      toast('A few details need fixing first.', 'error')
      return false
    }
    if (category === 'Cars') {
      toast(PICKUP_ERROR_TEXT.cars_not_allowed, 'error')
      return false
    }
    if (batchFull) {
      toast(PICKUP_ERROR_TEXT.too_many_items, 'error')
      return false
    }
    if (!(await persist([...batch, draft]))) return false
    clearItemForm()
    return true
  }

  async function onAddAnother() {
    if (!(await saveToPickup())) return
    toast(`${title.trim()} saved. Now the next item.`)
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function onSaveForLater() {
    if (!formBlank && !(await saveToPickup())) return
    toast(`Saved for ${RULES.savedPickupDays} days. Come back to add more or book the pickup.`, 'info')
    onDone()
  }

  /** Puts a saved item back in the form to change it. Its saved copy stays until the next save. */
  function editSaved(index: number) {
    if (!formBlank) {
      toast('Add or clear the item you’re writing first.', 'error')
      return
    }
    const d = batch[index]
    setTitle(d.title)
    setDescription(d.description)
    setCategory(d.category)
    setPhotos(d.images ?? [])
    setPrice(String(d.priceKobo / 100))
    setTicket(String(d.ticketPriceKobo / 100))
    setFeeMode(d.feeMode)
    setDurationDays(d.durationDays)
    setUnsoldPolicy(d.unsoldPolicy)
    setFallbackPrice(d.fallbackPriceKobo ? String(d.fallbackPriceKobo / 100) : '')
    setBatch(batch.filter((_, i) => i !== index))
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function onContinue(e: FormEvent) {
    e.preventDefault()
    if (sharing && formBlank) {
      go('handover')
      return
    }
    if (sharing) {
      if (await saveToPickup()) go('handover')
      return
    }
    if (errors.length) {
      setShowErrors(true)
      toast('A few details need fixing before you continue.', 'error')
      return
    }
    go('handover')
  }

  function onSend(e: FormEvent) {
    e.preventDefault()
    if (handoverErrors.length || !agreed) {
      setShowHandoverErrors(true)
      if (!handoverErrors.length) toast('Tick the box to accept the caution fee terms.', 'error')
      return
    }
    const onError = (err: unknown) => toast(errorMessage(err), 'error')
    const onSent = (listings: ListingView[]) => {
      setCreated(listings)
      if (savedPickup.data) savePickup.mutate([]) // sent, so nothing is saved any more
      go('done')
    }
    if (items.length > 1) createBatch.mutate({ items, handover }, { onSuccess: onSent, onError })
    else create.mutate({ ...items[0], handover }, { onSuccess: (l) => onSent([l]), onError })
  }

  return (
    <div ref={top} className="flex scroll-mt-6 flex-col gap-5">
      <Stepper step={step} method={method} />

      {step === 'done' && created ? (
        <SentForReview listings={created} onDone={onDone} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
          {step === 'details' ? (
            <form onSubmit={onContinue} noValidate className="flex min-w-0 flex-col gap-5">
              {sharing ? <PickupItems items={batch} fee={cautionFee} expiresAt={savedPickup.data?.expiresAt} busy={savePickup.isPending} onEdit={editSaved} onRemove={(i) => void persist(batch.filter((_, j) => j !== i))} /> : null}
              <Section n={1} title="The item" sub="What buyers are trying to win.">
                <Field label="Item name" htmlFor="title" error={fieldError('title')}>
                  <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Smartphone, 256GB" />
                </Field>
                <Field label="Description" htmlFor="desc" hint={`${description.length}/400`}>
                  <textarea
                    id="desc"
                    value={description}
                    maxLength={400}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className={cx(inputCls, 'py-3')}
                    placeholder="Condition, warranty, what’s in the box"
                  />
                </Field>
                <CategoryPicker value={category} onChange={setCategory} />
                <PhotoPicker photos={photos} onChange={setPhotos} />
              </Section>

              <Section n={2} title="Pricing" sub="Your price sets the prize. Ticket price sets how many tickets there are.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Your price (₦)" htmlFor="price" error={fieldError('price')}>
                    <input id="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} placeholder="1,000,000" />
                  </Field>
                  <Field label="Ticket price (₦)" htmlFor="ticket" error={fieldError('ticket')} hint="At least ₦100.">
                    <input id="ticket" inputMode="numeric" value={ticket} onChange={(e) => setTicket(e.target.value)} className={inputCls} placeholder="5,000" />
                  </Field>
                </div>
                {uniqueSuggestions.length ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-subtle">Try:</span>
                    {uniqueSuggestions.map((k) => (
                      <button
                        type="button"
                        key={k}
                        onClick={() => setTicket(String(k / 100))}
                        className={cx(
                          'min-h-11 rounded-xl border px-3 text-xs font-bold transition',
                          economics.ticketPriceKobo === k ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong hover:border-ink/40',
                        )}
                      >
                        {formatNaira(k)} · {Math.ceil(economics.priceKobo / k).toLocaleString('en-NG')} tickets
                      </button>
                    ))}
                  </div>
                ) : null}

                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1.5 text-sm font-bold">Who pays the platform fee?</legend>
                  <Segmented<FeeMode> label="Who pays the platform fee" value={feeMode} onChange={setFeeMode} options={FEE_MODES.map((m) => ({ value: m.id, label: m.label }))} />
                  <p className="text-xs text-subtle">
                    {FEE_MODES.find((m) => m.id === feeMode)!.hint} DrawMart sets the fee from the item’s value; you’ll see exactly what you receive on the right.
                  </p>
                </fieldset>
              </Section>

              <Section n={3} title="Draw rules" sub="How long tickets are on sale, and what happens if they don’t sell out.">
                <DeadlinePicker
                  today={today}
                  days={durationDays}
                  custom={customDeadline}
                  onChange={(days, custom) => {
                    setDurationDays(days)
                    setCustomDeadline(custom)
                  }}
                  error={fieldError('duration')}
                />

                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1.5 text-sm font-bold">If tickets don’t sell out</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {UNSOLD_OPTIONS.map((o) => (
                      <label
                        key={o.id}
                        className={cx(
                          'flex min-h-11 cursor-pointer gap-3 rounded-2xl border p-3.5 transition',
                          unsoldPolicy === o.id ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong',
                        )}
                      >
                        <input type="radio" name="unsold" value={o.id} checked={unsoldPolicy === o.id} onChange={() => setUnsoldPolicy(o.id)} className="mt-1 size-4 shrink-0 accent-brand" />
                        <span className="flex flex-col">
                          <strong className="text-sm">{o.title}</strong>
                          <span className="text-xs text-subtle">{o.body}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {unsoldPolicy === 'convert_to_sale' ? (
                  <div className="flex animate-fade-up flex-col gap-2 rounded-2xl border border-line bg-ground p-4">
                    <Field
                      label="Fixed price after the draw (₦)"
                      htmlFor="fallback"
                      error={fieldError('fallback')}
                      hint="Buyers see this price if the draw ends without selling out. You can match your draw price or set a different one."
                    >
                      <input
                        id="fallback"
                        inputMode="numeric"
                        value={fallbackPrice}
                        onChange={(e) => setFallbackPrice(e.target.value)}
                        className={cx(inputCls, 'bg-surface')}
                        placeholder={economics.priceKobo ? (economics.priceKobo / 100).toLocaleString('en-NG') : '1,000,000'}
                      />
                    </Field>
                    {economics.priceKobo > 0 && !fallbackPrice ? (
                      <button type="button" onClick={() => setFallbackPrice(String(economics.priceKobo / 100))} className="min-h-11 self-start rounded-xl px-2 text-sm font-bold text-brand hover:bg-brand-soft">
                        Use my draw price ({formatNaira(economics.priceKobo)})
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {sharing && category === 'Cars' ? <Notice tone="hot" icon={CarIcon}>{PICKUP_ERROR_TEXT.cars_not_allowed}</Notice> : null}
                <HandoverNotice method={handoverMethodFor(category)} cautionFee={cautionFee} sharing={sharing} />
              </Section>

              {showErrors && errors.length ? (
                <ul className="list-disc rounded-2xl bg-hot-soft py-3 pr-3 pl-8 text-sm text-hot-ink" role="alert">
                  {errors.map((e) => (
                    <li key={e}>{errorText(e)}</li>
                  ))}
                </ul>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="lg" disabled={savePickup.isPending}>
                  {method === 'inspection'
                    ? 'Continue to book inspection'
                    : sharing && formBlank
                      ? `Continue with ${batch.length} ${batch.length === 1 ? 'item' : 'items'}`
                      : sharing
                        ? 'Add and continue to pickup details'
                        : 'Continue to pickup details'}
                </Button>
                {category !== 'Cars' && !batchFull ? (
                  <Button type="button" size="lg" variant="outline" loading={savePickup.isPending} onClick={() => void onAddAnother()} disabled={formBlank}>
                    <PlusIcon size={18} /> Save and add another
                  </Button>
                ) : null}
                {category !== 'Cars' ? (
                  <Button type="button" size="lg" variant="outline" disabled={savePickup.isPending || (formBlank && !sharing)} onClick={() => void onSaveForLater()}>
                    Save for later
                  </Button>
                ) : null}
                <Button type="button" size="lg" variant="ghost" onClick={onDone}>
                  {sharing ? 'Close' : 'Cancel'}
                </Button>
              </div>
              {category !== 'Cars' ? (
                <p className="text-xs text-subtle">Saved items stay here for {RULES.savedPickupDays} days from your first save, then they’re removed. Nothing is paid or reviewed until you send them.</p>
              ) : null}
            </form>
          ) : (
            <form onSubmit={onSend} noValidate className="flex min-w-0 animate-fade-in flex-col gap-5">
              <button
                type="button"
                onClick={() => go('details')}
                className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-xl px-2 text-sm font-bold text-muted hover:bg-sunken hover:text-ink"
              >
                <BackIcon size={18} /> {sharing ? 'Add or change items' : 'Edit listing'}
              </button>

              <Section
                n={4}
                title={method === 'inspection' ? 'Book an inspection' : items.length > 1 ? `Pickup details for ${items.length} items` : 'Pickup details'}
                sub={
                  method === 'inspection'
                    ? 'Cars are too big for escrow, so a DrawMart inspector comes to you. The car stays with you until the winner collects it.'
                    : items.length > 1
                      ? 'A DrawMart rider collects them all in one trip and brings them to escrow, where we check and photograph each one.'
                      : 'A DrawMart rider collects the item and brings it to escrow, where we check and photograph it.'
                }
              >
                <HandoverSteps method={method} />
                <AddressPicker
                  id="address"
                  label={method === 'inspection' ? 'Where is the car?' : 'Pickup address'}
                  hint={method === 'inspection' ? 'Showroom or yard address. The inspector needs space to check the car.' : 'Street, building and area in Lagos.'}
                  placeholder={merchant.data ? `e.g. 12 Allen Avenue, ${merchant.data.area}` : 'e.g. 12 Allen Avenue, Ikeja'}
                  address={address}
                  onAddress={setAddress}
                  location={location}
                  onLocation={setLocation}
                  addressError={handoverError('address_required')}
                  showPinError={showHandoverErrors}
                />
                <Field label="Contact phone on the day" htmlFor="phone" error={handoverError('phone_invalid')}>
                  <input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={inputCls}
                    placeholder="0803 123 4567"
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={method === 'inspection' ? 'Inspection day' : 'Pickup day'} htmlFor="handover-date" error={handoverError('date_out_of_range')}>
                    <input
                      id="handover-date"
                      type="date"
                      value={date}
                      min={handoverDateRange(today).min}
                      max={handoverDateRange(today).max}
                      onChange={(e) => setDate(e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="mb-1.5 text-sm font-bold">Time window</legend>
                    <Segmented<TimeSlot>
                      label="Time window"
                      value={slot}
                      onChange={setSlot}
                      className="w-full"
                      options={(Object.keys(TIME_SLOTS) as TimeSlot[]).map((s) => ({ value: s, label: TIME_SLOTS[s] }))}
                    />
                  </fieldset>
                </div>
              </Section>

              <Card className="flex flex-col gap-4 p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <h2 className="font-display text-lg font-extrabold">{method === 'inspection' ? 'Inspection caution fee' : 'Delivery caution fee'}</h2>
                    <p className="text-sm text-muted">
                      {items.length > 1 ? `One fee for all ${items.length} items, the highest among them. Held by DrawMart until the draws end.` : 'Paid now, held by DrawMart until your draw ends.'}
                    </p>
                  </div>
                  <span className="font-display text-3xl font-extrabold tabular-nums">{formatNaira(cautionFee)}</span>
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  <li className="flex gap-2.5">
                    <CheckCircleIcon size={18} className="mt-px shrink-0 text-brand" />
                    <span>
                      {items.length > 1 ? (
                        <>
                          <strong>All {items.length} draws sell out:</strong> refunded in full with your payouts of {formatNaira(items.reduce((s, i) => s + payoutOf(i), 0))}.
                        </>
                      ) : (
                        <>
                          <strong>Sells out:</strong> refunded in full with your payout of {formatNaira(payoutOf(items[0]))}.
                        </>
                      )}
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <TruckIcon size={18} className="mt-px shrink-0 text-hot" />
                    <span>
                      <strong>{items.length > 1 ? 'Any one doesn’t sell out or isn’t approved:' : 'Doesn’t sell out or isn’t approved:'}</strong> {items.length > 1 ? 'the whole fee is' : ''} kept to cover {method === 'inspection' ? 'the inspection visit' : 'pickup and return delivery'}.
                    </span>
                  </li>
                </ul>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl bg-ground p-3 text-sm">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
                  <span>{items.length > 1 ? 'I understand the caution fee is only refunded if every ticket in every draw sells.' : 'I understand the caution fee is only refunded if every ticket sells.'}</span>
                </label>
                {showHandoverErrors && !agreed ? (
                  <span className="text-xs font-semibold text-hot-ink" role="alert">
                    Accept the caution fee terms to continue.
                  </span>
                ) : null}
                {api.testMode ? <span className="text-xs text-subtle">Test mode: no real money is charged.</span> : null}
              </Card>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="lg" loading={sending}>
                  <ShieldIcon size={18} /> Pay {formatNaira(cautionFee)} and send for review
                </Button>
                <Button type="button" size="lg" variant="ghost" onClick={() => go('details')} disabled={sending}>
                  Back
                </Button>
              </div>
            </form>
          )}

          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-8">
            {sharing && formBlank ? <PickupSummary items={batch} fee={cautionFee} /> : null}
            <div className={cx('relative isolate flex flex-col gap-4 overflow-hidden rounded-[28px] bg-linear-to-br from-hero to-hero-2 p-6 text-on-hero shadow-lift', sharing && formBlank && 'hidden')}>
              <div className="texture-dots absolute inset-0 -z-10" />
              <span className="text-xs font-extrabold tracking-[0.15em] text-ticket">HOW THIS DRAW ADDS UP</span>
              <div className="flex flex-col">
                <span className="text-sm text-on-brand-muted">You receive on a sell-out</span>
                <span key={econ.sellerPayoutKobo} className="animate-fade-in font-display text-4xl font-extrabold tabular-nums">
                  {formatNaira(econ.sellerPayoutKobo + (econ.sellerPayoutKobo && !sharing ? cautionFee : 0))}
                </span>
                {econ.sellerPayoutKobo && !sharing ? (
                  <span className="text-xs text-on-brand-muted">
                    {formatNaira(econ.sellerPayoutKobo)} payout + {formatNaira(cautionFee)} caution fee back
                  </span>
                ) : null}
              </div>
              <dl className="flex flex-col border-t border-white/15 text-sm">
                {[
                  ['Tickets to sell', econ.ticketCount.toLocaleString('en-NG')],
                  ['Buyer pays per ticket', formatNaira(econ.buyerTicketKobo)],
                  ['Total ticket sales', formatNaira(econ.poolKobo)],
                  ['Platform keeps', formatNaira(econ.platformKobo)],
                  [sharing ? 'Fee for the whole pickup' : 'Caution fee due now', formatNaira(cautionFee)],
                  ['On sale for', `${durationDays} days after approval`],
                  ...(unsoldPolicy === 'convert_to_sale' && fallbackPriceKobo ? [['Fixed price if unsold', formatNaira(fallbackPriceKobo)]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-white/15 py-2.5">
                    <dt className="text-on-brand-muted">{k}</dt>
                    <dd className="text-right font-bold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="flex gap-2 text-xs leading-relaxed text-on-brand-muted">
                <TruckIcon size={16} className="shrink-0 text-ticket" />
                No buyer money reaches you until the winner has the item.
              </p>
            </div>

            <div className={cx('flex flex-col gap-2', sharing && formBlank && 'hidden')}>
              <span className="text-xs font-extrabold tracking-wider text-subtle uppercase">Buyer preview</span>
              <Card className="flex flex-col gap-3 p-3">
                <ProductImage category={category} src={photos[0]} alt="Cover photo preview" className="h-40" />
                <div className="flex flex-col gap-0.5 px-1">
                  <strong className="leading-tight">{title.trim() || 'Your item name'}</strong>
                  <span className="text-xs text-subtle">
                    {merchant.data?.name ?? 'Your store'} · Worth {formatNaira(economics.priceKobo)}
                  </span>
                </div>
                <ProgressBar value={0} max={1} label="Preview progress" size="sm" />
                <div className="flex justify-between px-1 text-sm">
                  <span>
                    <strong>{formatNaira(econ.buyerTicketKobo)}</strong> <span className="text-xs text-subtle">/ ticket</span>
                  </span>
                  <span className="text-xs text-subtle">{durationDays} days</span>
                </div>
              </Card>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function Stepper({ step, method }: { step: Step; method: 'pickup' | 'inspection' }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'details', label: 'Listing details' },
    { id: 'handover', label: method === 'inspection' ? 'Book inspection' : 'Pickup & caution fee' },
    { id: 'done', label: 'Sent for review' },
  ]
  const at = steps.findIndex((s) => s.id === step)
  return (
    <ol className="flex items-center gap-2 text-xs font-bold sm:text-sm" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.id} className="flex flex-1 items-center gap-2" aria-current={i === at ? 'step' : undefined}>
          <span
            className={cx(
              'flex size-7 shrink-0 items-center justify-center rounded-full transition',
              i < at ? 'bg-brand text-on-brand' : i === at ? 'bg-ink text-ground' : 'bg-sunken text-subtle',
            )}
          >
            {i < at ? <CheckIcon size={14} /> : i + 1}
          </span>
          <span className={cx('hidden sm:inline', i === at ? 'text-ink' : 'text-subtle')}>{s.label}</span>
          {i < steps.length - 1 ? <span className={cx('h-0.5 flex-1 rounded-full', i < at ? 'bg-brand' : 'bg-line')} /> : null}
        </li>
      ))}
    </ol>
  )
}

function DeadlinePicker({
  today,
  days,
  custom,
  onChange,
  error,
}: {
  today: string
  days: number
  custom: boolean
  onChange: (days: number, custom: boolean) => void
  error?: string
}) {
  const min = addDays(today, RULES.minDurationDays)
  const max = addDays(today, RULES.maxDurationDays)
  const value = custom ? 'custom' : String(days)
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-bold">Draw deadline</legend>
      <Segmented<string>
        label="Draw deadline"
        value={value}
        onChange={(v) => (v === 'custom' ? onChange(days, true) : onChange(Number(v), false))}
        options={[...RULES.durationPresetsDays.map((d) => ({ value: String(d), label: `${d} days` })), { value: 'custom', label: <><CalendarIcon size={14} /> Custom</> }]}
      />
      {custom ? (
        <div className="flex animate-fade-up flex-col gap-1.5">
          <label htmlFor="deadline" className="text-xs font-bold text-muted">
            Ends on (if approved today)
          </label>
          <input
            id="deadline"
            type="date"
            min={min}
            max={max}
            value={addDays(today, days)}
            onChange={(e) => e.target.value && onChange(daysBetween(today, e.target.value), true)}
            className={cx(inputCls, 'sm:max-w-xs')}
          />
        </div>
      ) : null}
      {error ? (
        <span className="text-xs font-semibold text-hot-ink">{error}</span>
      ) : (
        <span className="text-xs text-subtle">
          {days} days on sale, between {RULES.minDurationDays} and {RULES.maxDurationDays}. The clock starts when your draw goes live; approved today, it ends {calendarDay(addDays(today, days))}.
        </span>
      )}
    </fieldset>
  )
}

function HandoverNotice({ method, cautionFee, sharing }: { method: 'pickup' | 'inspection'; cautionFee: number; sharing: boolean }) {
  if (sharing && method === 'pickup')
    return (
      <Notice icon={TruckIcon} title="One pickup, one fee">
        Everything here goes in one trip for one {formatNaira(cautionFee)} caution fee, the highest among the items. It’s refunded only if every draw in the pickup sells out.
      </Notice>
    )
  return method === 'inspection' ? (
    <Notice icon={CarIcon} title="Cars are inspected, not stored">
      Next you’ll book a day for a DrawMart inspector to check the car and its papers where it is. A {formatNaira(cautionFee)} caution fee covers the visit and is
      refunded if the draw sells out.
    </Notice>
  ) : (
    <Notice icon={LockIcon} title="We collect the item into escrow first">
      Next you’ll book a pickup. We check and photograph the item in escrow before the draw goes live. A {formatNaira(cautionFee)} caution fee covers delivery and is
      refunded if the draw sells out. Sending more than one item? Add them to this pickup and pay one fee.
    </Notice>
  )
}

function HandoverSteps({ method }: { method: 'pickup' | 'inspection' }) {
  const steps =
    method === 'inspection'
      ? ['An inspector visits on the day you pick', 'They check the car, VIN and papers, and take photos', 'An admin approves it and your draw goes live']
      : ['A rider collects the item on the day you pick', 'We check, photograph and store it in escrow', 'An admin approves it and your draw goes live']
  return (
    <ol className="grid gap-2 sm:grid-cols-3">
      {steps.map((s, i) => (
        <li key={s} className="flex gap-2.5 rounded-2xl bg-ground p-3 text-xs leading-snug text-muted">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft font-extrabold text-brand-ink">{i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  )
}

/** On the dashboard: items saved earlier are waiting, and until when. */
function SavedPickupReminder({ onContinue }: { onContinue: () => void }) {
  const saved = useSavedPickup()
  if (!saved.data) return null
  const count = saved.data.items.length
  const left = savedPickupDaysLeft(saved.data.expiresAt, Date.now())
  return (
    <Notice
      tone={left <= 2 ? 'hot' : 'ticket'}
      icon={TruckIcon}
      title={`${count} saved ${count === 1 ? 'item' : 'items'} waiting`}
      action={
        <Button size="sm" className="min-h-11" onClick={onContinue}>
          Continue
        </Button>
      }
    >
      Add more or book the pickup by {dateTime(saved.data.expiresAt)}. After that {count === 1 ? 'it’s' : 'they’re'} removed.
    </Notice>
  )
}

/** The items saved for a pickup so far. */
function PickupItems({ items, fee, expiresAt, busy, onEdit, onRemove }: { items: DraftItem[]; fee: number; expiresAt?: string; busy: boolean; onEdit: (i: number) => void; onRemove: (i: number) => void }) {
  const urgent = expiresAt ? savedPickupDaysLeft(expiresAt, Date.now()) <= 2 : false
  return (
    <Card className="flex flex-col gap-3 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-extrabold">
          <TruckIcon size={18} className="text-brand" /> In this pickup ({items.length})
        </h2>
        <span className="text-sm text-muted">
          One fee: <strong className="text-ink tabular-nums">{formatNaira(fee)}</strong>
        </span>
      </div>
      {expiresAt ? (
        <p className={cx('text-xs', urgent ? 'font-semibold text-hot-ink' : 'text-subtle')}>Saved until {dateTime(expiresAt)}. Send them by then, or they’ll be removed.</p>
      ) : null}
      <ul className="flex flex-col divide-y divide-line">
        {items.map((d, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <div className="flex min-w-0 flex-1 flex-col">
              <strong className="truncate">{d.title.trim()}</strong>
              <span className="text-xs text-subtle">
                {d.category} · {formatNaira(d.priceKobo)} · {d.durationDays} days
              </span>
            </div>
            <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => onEdit(i)}>
              Edit
            </Button>
            <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={() => onRemove(i)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Side panel once the items are saved: what the whole pickup adds up to. */
function PickupSummary({ items, fee }: { items: DraftItem[]; fee: number }) {
  const payouts = items.reduce((s, i) => s + payoutOf(i), 0)
  return (
    <div className="relative isolate flex flex-col gap-4 overflow-hidden rounded-[28px] bg-linear-to-br from-hero to-hero-2 p-6 text-on-hero shadow-lift">
      <div className="texture-dots absolute inset-0 -z-10" />
      <span className="text-xs font-extrabold tracking-[0.15em] text-ticket">HOW THIS PICKUP ADDS UP</span>
      <div className="flex flex-col">
        <span className="text-sm text-on-brand-muted">You receive if all sell out</span>
        <span className="font-display text-4xl font-extrabold tabular-nums">{formatNaira(payouts + fee)}</span>
        <span className="text-xs text-on-brand-muted">
          {formatNaira(payouts)} payouts + {formatNaira(fee)} caution fee back
        </span>
      </div>
      <dl className="flex flex-col border-t border-white/15 text-sm">
        {items.map((d, i) => (
          <div key={i} className="flex justify-between gap-3 border-b border-white/15 py-2.5">
            <dt className="min-w-0 truncate text-on-brand-muted">{d.title.trim()}</dt>
            <dd className="shrink-0 text-right font-bold tabular-nums">{formatNaira(payoutOf(d))}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 py-2.5">
          <dt className="text-on-brand-muted">Caution fee due now</dt>
          <dd className="text-right font-bold tabular-nums">{formatNaira(fee)}</dd>
        </div>
      </dl>
    </div>
  )
}

function SentForReview({ listings, onDone }: { listings: ListingView[]; onDone: () => void }) {
  const l = listings[0]
  const h = l.handover
  const shared = listings.length > 1
  return (
    <Card className="mx-auto flex w-full max-w-xl animate-fade-up flex-col items-center gap-5 p-6 text-center sm:p-8">
      <span className="flex size-16 animate-pop items-center justify-center rounded-3xl bg-brand text-on-brand shadow-glow">
        <CheckIcon size={34} strokeWidth={3} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-extrabold">Sent for review</h2>
        <p className="text-sm text-muted">
          {shared ? `${listings.length} items` : l.title} · {formatNaira(l.cautionFee.amountKobo)} caution fee paid
        </p>
      </div>
      {shared ? (
        <ul className="flex w-full flex-col gap-1 rounded-2xl bg-ground p-3 text-left text-sm">
          {listings.map((x) => (
            <li key={x.id} className="flex items-center gap-2">
              <CheckIcon size={14} className="shrink-0 text-brand" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{x.title}</span>
                <ProductId code={x.productCode} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {h ? (
        <dl className="grid w-full gap-2 text-left text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-0.5 rounded-2xl bg-ground p-3">
            <dt className="text-[11px] font-semibold text-subtle">{h.method === 'inspection' ? 'Inspection' : 'Pickup'}</dt>
            <dd className="font-bold">
              {calendarDay(h.date)}, {TIME_SLOTS[h.slot]}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 rounded-2xl bg-ground p-3">
            <dt className="text-[11px] font-semibold text-subtle">Contact</dt>
            <dd className="font-bold">{h.contactPhone}</dd>
          </div>
          <div className="flex flex-col gap-0.5 rounded-2xl bg-ground p-3 sm:col-span-2">
            <dt className="text-[11px] font-semibold text-subtle">Address</dt>
            <dd className="font-bold">{h.address}</dd>
          </div>
        </dl>
      ) : null}
      {h?.location ? (
        <a href={directionsUrl(h.location)} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-1.5 text-sm font-bold">
          <MapPinIcon size={14} /> Check the pin on a map
        </a>
      ) : null}
      <p className="text-xs text-subtle">
        We’ll call the number above to confirm.{' '}
        {shared
          ? 'Each item is checked into escrow and approved on its own. Each draw then goes live for the days you picked. The caution fee comes back only if every draw sells out.'
          : `Once the item is ${h?.method === 'inspection' ? 'inspected' : 'checked into escrow'} and approved, your draw goes live for ${l.durationDays} days.`}
      </p>
      <Button size="lg" className="w-full" onClick={onDone}>
        View your draws
      </Button>
    </Card>
  )
}

// ----------------------------------------------------------- your draws

const STATUS: Record<ListingView['status'], { label: string; tone: Tone }> = {
  pending_review: { label: 'In review', tone: 'ticket' },
  live: { label: 'Live', tone: 'brand' },
  sold_out: { label: 'Sold out · winner coming', tone: 'ticket' },
  drawn: { label: 'Drawn · awaiting delivery', tone: 'sky' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  for_sale: { label: 'On sale · draw ended', tone: 'violet' },
  sold: { label: 'Sold · see orders', tone: 'sky' },
  rejected: { label: 'Rejected', tone: 'hot' },
}

const statusFor = (l: ListingView) => (l.kind === 'product' && l.status === 'for_sale' ? { label: 'On sale', tone: 'brand' as Tone } : STATUS[l.status])

const CAUTION_TEXT: Record<ListingView['cautionFee']['status'], string> = {
  held: 'held',
  refunded: 'back with payout',
  kept: 'kept for delivery',
  none: '',
}

type StatusFilter = 'all' | 'live' | 'pending_review' | 'done'

export function MerchantListings({ onNew, emptyBody }: { onNew: () => void; emptyBody?: string }) {
  const q = useMerchantListings()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  if (q.isPending) return <Skeleton className="h-60" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />

  const inFilter = (l: ListingView, f: StatusFilter) =>
    f === 'all' ? true : f === 'live' ? isActive(l) : f === 'pending_review' ? l.status === 'pending_review' : !isActive(l) && l.status !== 'pending_review'
  const found = q.data.filter((l) => listingMatchesSearch(l, search))
  const items = found.filter((l) => inFilter(l, filter))
  const count = (f: StatusFilter) => found.filter((l) => inFilter(l, f)).length

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<StatusFilter>
          label="Filter listings"
          value={filter}
          onChange={setFilter}
          size="sm"
          options={[
            { value: 'all', label: 'All', count: found.length },
            { value: 'live', label: 'Live & on sale', count: count('live') },
            { value: 'pending_review', label: 'In review', count: count('pending_review') },
            { value: 'done', label: 'Finished', count: count('done') },
          ]}
        />
      </div>
      {q.data.length ? <ProductSearch value={search} onChange={setSearch} /> : null}
      {items.length === 0 && search.trim() ? (
        <NoProductMatch query={search} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={TicketIcon}
          title="Nothing here"
          body={emptyBody ?? "List a raffle draw or a regular product. We publish it once it’s been checked."}
          action={
            <Button onClick={onNew}>
              <PlusIcon size={18} /> New listing
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((l) => {
            if (l.kind === 'product') return <ProductCard key={l.id} listing={l} />
            const econ = computeListingEconomics(l)
            const s = statusFor(l)
            const h = l.handover
            return (
              <Card key={l.id} className="flex animate-fade-up flex-col gap-4 p-4">
                <div className="flex items-start gap-3">
                  <ProductImage category={l.category} src={l.images[0]} alt={l.title} size="sm" className="size-16 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-start justify-between gap-2">
                      <strong className="leading-tight">{l.title}</strong>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                    <ProductId code={l.productCode} copy />
                    <span className="text-xs text-subtle">
                      {formatNaira(l.buyerTicketPriceKobo)} / ticket · {l.ticketCount.toLocaleString('en-NG')} tickets
                    </span>
                  </div>
                </div>
                {l.status === 'pending_review' && h ? (
                  <div className="flex items-center gap-2 rounded-2xl bg-ground p-3 text-xs">
                    {h.method === 'inspection' ? <CarIcon size={16} className="shrink-0 text-brand" /> : <TruckIcon size={16} className="shrink-0 text-brand" />}
                    <span>
                      <strong>{h.method === 'inspection' ? 'Inspection' : 'Pickup'}</strong> {calendarDay(h.date)}, {TIME_SLOTS[h.slot]} · {l.durationDays} days once live
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <ProgressBar value={l.ticketsSold} max={l.ticketCount} label={`${l.title}: tickets sold`} size="sm" />
                    <div className="flex justify-between text-xs text-subtle">
                      <span>
                        {l.ticketsSold.toLocaleString('en-NG')} / {l.ticketCount.toLocaleString('en-NG')} sold
                      </span>
                      {l.status === 'live' ? <Countdown closesAt={l.closesAt} className="font-bold" /> : null}
                      {l.status === 'sold_out' && l.drawAt ? <span className="font-bold">Winner {dateTime(l.drawAt)}</span> : null}
                    </div>
                  </div>
                )}
                <dl className="flex flex-col gap-1 border-t border-dashed border-line pt-3 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-subtle">{l.status === 'for_sale' ? 'Fixed price' : 'Your payout'}</dt>
                    <dd className="font-bold tabular-nums">{formatNaira(salePriceKobo(l) ?? econ.sellerPayoutKobo)}</dd>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <dt className="text-subtle">{l.pickupBatchId ? 'Caution fee (shared pickup)' : 'Caution fee'}</dt>
                    <dd className={cx('font-semibold', l.cautionFee.status === 'refunded' ? 'text-brand' : l.cautionFee.status === 'kept' ? 'text-hot-ink' : 'text-muted')}>
                      {formatNaira(l.cautionFee.amountKobo)} {CAUTION_TEXT[l.cautionFee.status]}
                    </dd>
                  </div>
                </dl>
                <BoostRow listing={l} />
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** A regular product: no tickets, so just its price, payout and status. */
function ProductCard({ listing: l }: { listing: ListingView }) {
  const s = statusFor(l)
  const { payoutKobo } = saleEconomics(l.priceKobo, l.feeBps)
  return (
    <Card className="flex animate-fade-up flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <ProductImage category={l.category} src={l.images[0]} alt={l.title} size="sm" className="size-16 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <strong className="leading-tight">{l.title}</strong>
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
          <ProductId code={l.productCode} copy />
          <span className="flex items-center gap-1 text-xs text-subtle">
            <StoreIcon size={12} /> Regular product · no draw
          </span>
        </div>
      </div>
      <dl className="flex flex-col gap-1 border-t border-dashed border-line pt-3 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-subtle">Price</dt>
          <dd className="font-bold tabular-nums">{formatNaira(l.priceKobo)}</dd>
        </div>
        <div className="flex items-center justify-between text-xs">
          <dt className="text-subtle">Your payout after the platform fee</dt>
          <dd className="font-semibold tabular-nums">{formatNaira(payoutKobo)}</dd>
        </div>
      </dl>
      <BoostRow listing={l} />
    </Card>
  )
}
