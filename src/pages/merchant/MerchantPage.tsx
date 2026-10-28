import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api } from '@/api'
import { useCreateListing, useMerchant, useMerchantListings } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { CATEGORY_STYLE } from '@/components/category'
import { Countdown } from '@/components/Countdown'
import {
  BackIcon,
  CalendarIcon,
  CarIcon,
  CheckCircleIcon,
  CheckIcon,
  ClipboardIcon,
  CoinIcon,
  LayoutIcon,
  LockIcon,
  MapPinIcon,
  PlusIcon,
  ShieldIcon,
  TicketIcon,
  TrophyIcon,
  TruckIcon,
  XIcon,
} from '@/components/icons'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, ProductImage, ProgressBar, Segmented, Skeleton, StatTile, cx, errorMessage, inputCls, type Tone } from '@/components/ui'
import { LISTING_ERROR_TEXT, MAX_FEE_BPS, MIN_FEE_BPS, computeListingEconomics, validateListingEconomics, type ListingValidationError } from '@/domain/fees'
import {
  HANDOVER_ERROR_TEXT,
  LISTING_TERMS_ERROR_TEXT,
  TIME_SLOTS,
  addDays,
  cautionFeeFor,
  daysBetween,
  handoverDateRange,
  handoverMethodFor,
  localDate,
  validateHandover,
  validateListingTerms,
  type HandoverError,
  type ListingTermsError,
} from '@/domain/listing'
import { formatNaira, nairaToKobo, parseNairaInput } from '@/domain/money'
import { RULES } from '@/domain/rules'
import { CATEGORIES, type Category, type FeeMode, type TimeSlot, type UnsoldPolicy } from '@/domain/types'
import { photoToDataUrl } from '@/lib/image'
import { calendarDay } from '@/lib/time'

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

type Tab = 'draws' | 'new'

export function MerchantPage() {
  const merchant = useMerchant()
  const listings = useMerchantListings()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'new' ? 'new' : 'draws'
  const setTab = (t: Tab) => setParams(t === 'new' ? { tab: 'new' } : {}, { replace: true })

  const data = listings.data ?? []
  const live = data.filter((l) => l.status === 'live')
  const review = data.filter((l) => l.status === 'pending_review')
  const sold = data.filter((l) => l.status === 'live' || l.status === 'drawn').reduce((s, l) => s + l.ticketsSold, 0)
  // Drawn listings pay out the price plus the caution fee back once the winner confirms delivery.
  const awaiting = data
    .filter((l) => l.status === 'drawn')
    .reduce((s, l) => s + computeListingEconomics(l).sellerPayoutKobo + (l.cautionFee.status === 'refunded' ? l.cautionFee.amountKobo : 0), 0)

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
        {tab === 'draws' ? (
          <Button onClick={() => setTab('new')}>
            <PlusIcon size={18} /> New draw listing
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={TicketIcon} label="Live draws" value={live.length} />
        <StatTile icon={ClipboardIcon} tone="ticket" label="In review" value={review.length} hint="Waiting on pickup or inspection" />
        <StatTile icon={TrophyIcon} tone="sky" label="Tickets sold" value={sold.toLocaleString('en-NG')} />
        <StatTile icon={CoinIcon} tone="violet" label="Payout after delivery" value={formatNaira(awaiting)} hint="Includes caution fees back" />
      </div>

      <Segmented<Tab>
        label="Section"
        value={tab}
        onChange={setTab}
        className="w-full sm:w-auto sm:self-start"
        options={[
          { value: 'draws', label: <><LayoutIcon size={16} /> Your draws</>, count: data.length },
          { value: 'new', label: <><PlusIcon size={16} /> New listing</> },
        ]}
      />

      <div key={tab} className="animate-fade-in">
        {tab === 'new' ? <NewListing onDone={() => setTab('draws')} /> : <MerchantListings onNew={() => setTab('new')} />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ new listing

type DetailsField = 'title' | 'price' | 'ticket' | 'fee' | 'duration' | 'fallback'

const ERROR_FIELD: Record<ListingValidationError | ListingTermsError, DetailsField> = {
  title_required: 'title',
  price_required: 'price',
  ticket_too_cheap: 'ticket',
  ticket_above_price: 'ticket',
  too_many_tickets: 'ticket',
  fee_out_of_range: 'fee',
  duration_out_of_range: 'duration',
  fallback_price_required: 'fallback',
}

const errorText = (e: ListingValidationError | ListingTermsError) =>
  e in LISTING_ERROR_TEXT ? LISTING_ERROR_TEXT[e as ListingValidationError] : LISTING_TERMS_ERROR_TEXT[e as ListingTermsError]

type Step = 'details' | 'handover' | 'done'

/** Two steps: describe the draw, then book the pickup (or inspection) and pay the caution fee. */
function NewListing({ onDone }: { onDone: () => void }) {
  const create = useCreateListing()
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
  const [feePct, setFeePct] = useState(Math.max(RULES.defaultFeeBps, MIN_FEE_BPS) / 100)
  const [durationDays, setDurationDays] = useState(14)
  const [customDeadline, setCustomDeadline] = useState(false)
  const [unsoldPolicy, setUnsoldPolicy] = useState<UnsoldPolicy>('refund')
  const [fallbackPrice, setFallbackPrice] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  // Step 2: handover
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [date, setDate] = useState(() => addDays(today, 2))
  const [slot, setSlot] = useState<TimeSlot>('morning')
  const [agreed, setAgreed] = useState(false)
  const [showHandoverErrors, setShowHandoverErrors] = useState(false)
  const [created, setCreated] = useState<ListingView | null>(null)

  const economics = { title, priceKobo: parseNairaInput(price), ticketPriceKobo: parseNairaInput(ticket), feeBps: feePct * 100, feeMode }
  const fallbackPriceKobo = parseNairaInput(fallbackPrice)
  const terms = { durationDays, unsoldPolicy, fallbackPriceKobo }
  const econ = computeListingEconomics(economics)
  const errors = [...validateListingEconomics(economics), ...validateListingTerms(terms)]
  const fieldError = (f: DetailsField) => {
    if (!showErrors) return undefined
    const e = errors.find((x) => ERROR_FIELD[x] === f)
    return e ? errorText(e) : undefined
  }

  const method = handoverMethodFor(category)
  const cautionFee = cautionFeeFor(category)
  const handover = { address, contactPhone: phone, date, slot }
  const handoverErrors = validateHandover(handover, today)
  const handoverError = (e: HandoverError) => (showHandoverErrors && handoverErrors.includes(e) ? HANDOVER_ERROR_TEXT[e] : undefined)

  // Suggested ticket prices that give a sensible number of tickets for this item.
  const suggestions = economics.priceKobo > 0 ? [100, 250, 500, 1000].map((count) => Math.max(nairaToKobo(100), Math.ceil(economics.priceKobo / count / 10000) * 10000)) : []
  const uniqueSuggestions = [...new Set(suggestions)].filter((k) => k <= economics.priceKobo)

  function go(next: Step) {
    setStep(next)
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function onContinue(e: FormEvent) {
    e.preventDefault()
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
    create.mutate(
      {
        ...economics,
        description,
        category,
        images: photos,
        durationDays,
        unsoldPolicy,
        fallbackPriceKobo: unsoldPolicy === 'convert_to_sale' ? fallbackPriceKobo : undefined,
        handover,
      },
      {
        onSuccess: (listing) => {
          setCreated(listing)
          go('done')
        },
        onError: (err) => toast(errorMessage(err), 'error'),
      },
    )
  }

  return (
    <div ref={top} className="flex scroll-mt-6 flex-col gap-5">
      <Stepper step={step} method={method} />

      {step === 'done' && created ? (
        <SentForReview listing={created} onDone={onDone} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
          {step === 'details' ? (
            <form onSubmit={onContinue} noValidate className="flex min-w-0 flex-col gap-5">
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
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1.5 text-sm font-bold">Category</legend>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {CATEGORIES.map((c) => {
                      const Icon = CATEGORY_STYLE[c].icon
                      const active = c === category
                      return (
                        <button
                          type="button"
                          key={c}
                          aria-pressed={active}
                          onClick={() => setCategory(c)}
                          className={cx(
                            'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-bold transition active:scale-95',
                            active ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface text-muted hover:border-line-strong',
                          )}
                        >
                          <Icon size={20} />
                          {c}
                        </button>
                      )
                    })}
                  </div>
                  <span className="text-xs text-subtle">Perishable goods like food can’t be listed: items may wait in escrow for weeks.</span>
                </fieldset>
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
                  <p className="text-xs text-subtle">{FEE_MODES.find((m) => m.id === feeMode)!.hint}</p>
                </fieldset>

                <Field
                  label={`Platform fee: ${feePct}%`}
                  htmlFor="fee"
                  hint={`Minimum ${MIN_FEE_BPS / 100}%. Set by DrawMart per category; shown here so you can see the effect.`}
                  error={fieldError('fee')}
                >
                  <input
                    id="fee"
                    type="range"
                    min={MIN_FEE_BPS / 100}
                    max={MAX_FEE_BPS / 100}
                    value={feePct}
                    onChange={(e) => setFeePct(Number(e.target.value))}
                    className="range w-full"
                    style={{ '--fill': `${((feePct - MIN_FEE_BPS / 100) / ((MAX_FEE_BPS - MIN_FEE_BPS) / 100)) * 100}%` } as React.CSSProperties}
                  />
                </Field>
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

                <HandoverNotice method={method} cautionFee={cautionFee} />
              </Section>

              {showErrors && errors.length ? (
                <ul className="list-disc rounded-2xl bg-hot-soft py-3 pr-3 pl-8 text-sm text-hot-ink" role="alert">
                  {errors.map((e) => (
                    <li key={e}>{errorText(e)}</li>
                  ))}
                </ul>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="lg">
                  {method === 'inspection' ? 'Continue to book inspection' : 'Continue to pickup details'}
                </Button>
                <Button type="button" size="lg" variant="ghost" onClick={onDone}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={onSend} noValidate className="flex min-w-0 animate-fade-in flex-col gap-5">
              <button
                type="button"
                onClick={() => go('details')}
                className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-xl px-2 text-sm font-bold text-muted hover:bg-sunken hover:text-ink"
              >
                <BackIcon size={18} /> Edit listing
              </button>

              <Section
                n={4}
                title={method === 'inspection' ? 'Book an inspection' : 'Pickup details'}
                sub={
                  method === 'inspection'
                    ? 'Cars are too big for escrow, so a DrawMart inspector comes to you. The car stays with you until the winner collects it.'
                    : 'A DrawMart rider collects the item and brings it to escrow, where we check and photograph it.'
                }
              >
                <HandoverSteps method={method} />
                <Field
                  label={method === 'inspection' ? 'Where is the car?' : 'Pickup address'}
                  htmlFor="address"
                  error={handoverError('address_required')}
                  hint={method === 'inspection' ? 'Showroom or yard address. The inspector needs space to check the car.' : 'Street, building and area in Lagos.'}
                >
                  <textarea
                    id="address"
                    rows={2}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className={cx(inputCls, 'py-3')}
                    placeholder={merchant.data ? `e.g. 12 Allen Avenue, ${merchant.data.area}` : 'e.g. 12 Allen Avenue, Ikeja'}
                    autoComplete="street-address"
                  />
                </Field>
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
                      Paid now, held by DrawMart until your draw ends.
                    </p>
                  </div>
                  <span className="font-display text-3xl font-extrabold tabular-nums">{formatNaira(cautionFee)}</span>
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  <li className="flex gap-2.5">
                    <CheckCircleIcon size={18} className="mt-px shrink-0 text-brand" />
                    <span>
                      <strong>Sells out:</strong> refunded in full with your payout of {formatNaira(econ.sellerPayoutKobo)}.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <TruckIcon size={18} className="mt-px shrink-0 text-hot" />
                    <span>
                      <strong>Doesn’t sell out or isn’t approved:</strong> kept to cover {method === 'inspection' ? 'the inspection visit' : 'pickup and return delivery'}.
                    </span>
                  </li>
                </ul>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl bg-ground p-3 text-sm">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
                  <span>I understand the caution fee is only refunded if every ticket sells.</span>
                </label>
                {showHandoverErrors && !agreed ? (
                  <span className="text-xs font-semibold text-hot-ink" role="alert">
                    Accept the caution fee terms to continue.
                  </span>
                ) : null}
                {api.testMode ? <span className="text-xs text-subtle">Test mode: no real money is charged.</span> : null}
              </Card>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="lg" loading={create.isPending}>
                  <ShieldIcon size={18} /> Pay {formatNaira(cautionFee)} and send for review
                </Button>
                <Button type="button" size="lg" variant="ghost" onClick={() => go('details')} disabled={create.isPending}>
                  Back
                </Button>
              </div>
            </form>
          )}

          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-8">
            <div className="relative isolate flex flex-col gap-4 overflow-hidden rounded-[28px] bg-linear-to-br from-hero to-hero-2 p-6 text-on-hero shadow-lift">
              <div className="texture-dots absolute inset-0 -z-10" />
              <span className="text-xs font-extrabold tracking-[0.15em] text-ticket">HOW THIS DRAW ADDS UP</span>
              <div className="flex flex-col">
                <span className="text-sm text-on-brand-muted">You receive on a sell-out</span>
                <span key={econ.sellerPayoutKobo} className="animate-fade-in font-display text-4xl font-extrabold tabular-nums">
                  {formatNaira(econ.sellerPayoutKobo + (econ.sellerPayoutKobo ? cautionFee : 0))}
                </span>
                {econ.sellerPayoutKobo ? (
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
                  ['Caution fee due now', formatNaira(cautionFee)],
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

            <div className="flex flex-col gap-2">
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

function HandoverNotice({ method, cautionFee }: { method: 'pickup' | 'inspection'; cautionFee: number }) {
  return method === 'inspection' ? (
    <Notice icon={CarIcon} title="Cars are inspected, not stored">
      Next you’ll book a day for a DrawMart inspector to check the car and its papers where it is. A {formatNaira(cautionFee)} caution fee covers the visit and is
      refunded if the draw sells out.
    </Notice>
  ) : (
    <Notice icon={LockIcon} title="We collect the item into escrow first">
      Next you’ll book a pickup. We check and photograph the item in escrow before the draw goes live. A {formatNaira(cautionFee)} caution fee covers delivery and is
      refunded if the draw sells out.
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

function SentForReview({ listing: l, onDone }: { listing: ListingView; onDone: () => void }) {
  const h = l.handover
  return (
    <Card className="mx-auto flex w-full max-w-xl animate-fade-up flex-col items-center gap-5 p-6 text-center sm:p-8">
      <span className="flex size-16 animate-pop items-center justify-center rounded-3xl bg-brand text-on-brand shadow-glow">
        <CheckIcon size={34} strokeWidth={3} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-extrabold">Sent for review</h2>
        <p className="text-sm text-muted">
          {l.title} · {formatNaira(l.cautionFee.amountKobo)} caution fee paid
        </p>
      </div>
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
      <p className="text-xs text-subtle">
        We’ll call the number above to confirm. Once the item is {h?.method === 'inspection' ? 'inspected' : 'checked into escrow'} and approved, your draw goes live
        for {l.durationDays} days.
      </p>
      <Button size="lg" className="w-full" onClick={onDone}>
        View your draws
      </Button>
    </Card>
  )
}

const MAX_PHOTOS = 4

function PhotoPicker({ photos, onChange }: { photos: string[]; onChange: (p: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function add(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    try {
      const picked = [...files].filter((f) => f.type.startsWith('image/')).slice(0, MAX_PHOTOS - photos.length)
      onChange([...photos, ...(await Promise.all(picked.map((f) => photoToDataUrl(f))))])
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold">Photos</span>
      <div className="flex flex-wrap gap-2">
        {photos.map((src, i) => (
          <div key={i} className="relative">
            <img src={src} alt={`Photo ${i + 1}`} className="size-24 rounded-2xl border border-line bg-photo object-cover" />
            {i === 0 ? <span className="absolute bottom-1.5 left-1.5 rounded-full bg-ink/75 px-2 py-0.5 text-[10px] font-bold text-ground">Cover</span> : null}
            <button
              type="button"
              onClick={() => onChange(photos.filter((_, j) => j !== i))}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute -top-2 -right-2 flex size-11 items-center justify-center"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-ink text-ground shadow-card">
                <XIcon size={14} />
              </span>
            </button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS ? (
          <label
            className={cx(
              'flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line-strong text-xs font-bold text-muted transition hover:border-brand hover:text-brand',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            <PlusIcon size={20} />
            {busy ? 'Adding…' : 'Add photo'}
            <input ref={input} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => add(e.target.files)} />
          </label>
        ) : null}
      </div>
      <span className="text-xs text-subtle">Up to {MAX_PHOTOS}. The first is the cover. DrawMart adds its own photos at escrow or inspection.</span>
    </div>
  )
}

function Section({ n, title, sub, children }: { n: number; title: string; sub: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink font-display font-extrabold text-ground">{n}</span>
        <div className="flex flex-col">
          <h2 className="font-display text-lg font-extrabold">{title}</h2>
          <p className="text-xs text-subtle">{sub}</p>
        </div>
      </div>
      {children}
    </Card>
  )
}

// ----------------------------------------------------------- your draws

const STATUS: Record<ListingView['status'], { label: string; tone: Tone }> = {
  pending_review: { label: 'In review', tone: 'ticket' },
  live: { label: 'Live', tone: 'brand' },
  drawn: { label: 'Drawn · awaiting delivery', tone: 'sky' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  for_sale: { label: 'On sale · draw ended', tone: 'violet' },
  rejected: { label: 'Rejected', tone: 'hot' },
}

const CAUTION_TEXT: Record<ListingView['cautionFee']['status'], string> = {
  held: 'held',
  refunded: 'back with payout',
  kept: 'kept for delivery',
}

type StatusFilter = 'all' | 'live' | 'pending_review' | 'done'

function MerchantListings({ onNew }: { onNew: () => void }) {
  const q = useMerchantListings()
  const [filter, setFilter] = useState<StatusFilter>('all')
  if (q.isPending) return <Skeleton className="h-60" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />

  const items = q.data.filter((l) => (filter === 'all' ? true : filter === 'done' ? !['live', 'pending_review'].includes(l.status) : l.status === filter))
  const count = (f: StatusFilter) => q.data.filter((l) => (f === 'done' ? !['live', 'pending_review'].includes(l.status) : l.status === f)).length

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<StatusFilter>
          label="Filter listings"
          value={filter}
          onChange={setFilter}
          size="sm"
          options={[
            { value: 'all', label: 'All', count: q.data.length },
            { value: 'live', label: 'Live', count: count('live') },
            { value: 'pending_review', label: 'In review', count: count('pending_review') },
            { value: 'done', label: 'Finished', count: count('done') },
          ]}
        />
        <Link to="/admin" className="text-sm">
          Admin review →
        </Link>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={TicketIcon}
          title="No draws here"
          body="Create a listing, book a pickup or inspection, and we’ll publish it once it’s checked."
          action={
            <Button onClick={onNew}>
              <PlusIcon size={18} /> New draw listing
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((l) => {
            const econ = computeListingEconomics(l)
            const s = STATUS[l.status]
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
                    </div>
                  </div>
                )}
                <dl className="flex flex-col gap-1 border-t border-dashed border-line pt-3 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-subtle">{l.status === 'for_sale' ? 'Fixed price' : 'Your payout'}</dt>
                    <dd className="font-bold tabular-nums">{formatNaira(l.status === 'for_sale' && l.fallbackPriceKobo ? l.fallbackPriceKobo : econ.sellerPayoutKobo)}</dd>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <dt className="text-subtle">Caution fee</dt>
                    <dd className={cx('font-semibold', l.cautionFee.status === 'refunded' ? 'text-brand' : l.cautionFee.status === 'kept' ? 'text-hot-ink' : 'text-muted')}>
                      {formatNaira(l.cautionFee.amountKobo)} {CAUTION_TEXT[l.cautionFee.status]}
                    </dd>
                  </div>
                </dl>
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}

