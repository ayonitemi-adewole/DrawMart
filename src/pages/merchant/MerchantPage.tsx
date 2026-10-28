import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useCreateListing, useMerchant, useMerchantListings } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { CATEGORY_STYLE } from '@/components/category'
import { Countdown } from '@/components/Countdown'
import { ClipboardIcon, CoinIcon, LayoutIcon, LockIcon, MapPinIcon, PlusIcon, TicketIcon, TrophyIcon, TruckIcon, CheckIcon, XIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, ProductImage, ProgressBar, Segmented, Skeleton, StatTile, cx, errorMessage, inputCls, type Tone } from '@/components/ui'
import { LISTING_ERROR_TEXT, computeListingEconomics, validateListingEconomics, type ListingValidationError } from '@/domain/fees'
import { formatNaira, nairaToKobo, parseNairaInput } from '@/domain/money'
import { RULES } from '@/domain/rules'
import { CATEGORIES, type Category, type FeeMode, type UnsoldPolicy } from '@/domain/types'
import { photoToDataUrl } from '@/lib/image'

const FEE_MODES: { id: FeeMode; label: string; hint: string }[] = [
  { id: 'seller', label: 'Store pays', hint: 'Recommended for launch: buyers see exactly the ticket price, and the fee comes out of your payout.' },
  { id: 'buyer', label: 'Buyer pays', hint: 'The fee is added to each ticket, so buyers pay a little more than the ticket price.' },
  { id: 'split', label: 'Split 50/50', hint: 'Half the fee is added to each ticket and half comes out of your payout.' },
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
  const awaiting = data.filter((l) => l.status === 'drawn').reduce((s, l) => s + computeListingEconomics(l).sellerPayoutKobo, 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
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
        <StatTile icon={ClipboardIcon} tone="ticket" label="In review" value={review.length} hint="Waiting on escrow check" />
        <StatTile icon={TrophyIcon} tone="sky" label="Tickets sold" value={sold.toLocaleString('en-NG')} />
        <StatTile icon={CoinIcon} tone="violet" label="Payout after delivery" value={formatNaira(awaiting)} />
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
        {tab === 'new' ? <ListingForm onDone={() => setTab('draws')} /> : <MerchantListings onNew={() => setTab('new')} />}
      </div>
    </div>
  )
}

const ERROR_FIELD: Record<ListingValidationError, 'title' | 'price' | 'ticket' | 'fee'> = {
  title_required: 'title',
  price_required: 'price',
  ticket_too_cheap: 'ticket',
  ticket_above_price: 'ticket',
  too_many_tickets: 'ticket',
  fee_out_of_range: 'fee',
}

function ListingForm({ onDone }: { onDone: () => void }) {
  const create = useCreateListing()
  const toast = useToast()
  const merchant = useMerchant()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<Category>('Phones')
  const [price, setPrice] = useState('')
  const [ticket, setTicket] = useState('')
  const [feeMode, setFeeMode] = useState<FeeMode>('seller')
  const [feePct, setFeePct] = useState(RULES.defaultFeeBps / 100)
  const [durationDays, setDurationDays] = useState(7)
  const [unsoldPolicy, setUnsoldPolicy] = useState<UnsoldPolicy>('refund')
  const [showErrors, setShowErrors] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])

  const input = { title, priceKobo: parseNairaInput(price), ticketPriceKobo: parseNairaInput(ticket), feeBps: feePct * 100, feeMode }
  const econ = computeListingEconomics(input)
  const errors = validateListingEconomics(input)
  const fieldError = (f: (typeof ERROR_FIELD)[ListingValidationError]) => {
    if (!showErrors) return undefined
    const e = errors.find((x) => ERROR_FIELD[x] === f)
    return e ? LISTING_ERROR_TEXT[e] : undefined
  }

  // Suggested ticket prices that give a sensible number of tickets for this item.
  const suggestions = input.priceKobo > 0 ? [100, 250, 500, 1000].map((count) => Math.max(nairaToKobo(100), Math.ceil(input.priceKobo / count / 10000) * 10000)) : []
  const uniqueSuggestions = [...new Set(suggestions)].filter((k) => k <= input.priceKobo)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (errors.length) {
      setShowErrors(true)
      toast('A few details need fixing before you submit.', 'error')
      return
    }
    create.mutate(
      { ...input, description, category, images: photos, durationDays, unsoldPolicy },
      {
        onSuccess: () => {
          toast('Sent for review. Deliver the item to escrow and we’ll publish it.')
          onDone()
        },
        onError: (err) => toast(errorMessage(err), 'error'),
      },
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
      <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col gap-5">
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
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
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
                    input.ticketPriceKobo === k ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong hover:border-ink/40',
                  )}
                >
                  {formatNaira(k)} · {Math.ceil(input.priceKobo / k).toLocaleString('en-NG')} tickets
                </button>
              ))}
            </div>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-bold">Who pays the platform fee?</legend>
            <Segmented<FeeMode> label="Who pays the platform fee" value={feeMode} onChange={setFeeMode} options={FEE_MODES.map((m) => ({ value: m.id, label: m.label }))} />
            <p className="text-xs text-subtle">{FEE_MODES.find((m) => m.id === feeMode)!.hint}</p>
          </fieldset>

          <Field label={`Platform fee: ${feePct}%`} htmlFor="fee" hint="Set by DrawMart per category. Shown here so you can see the effect." error={fieldError('fee')}>
            <input
              id="fee"
              type="range"
              min={5}
              max={20}
              value={feePct}
              onChange={(e) => setFeePct(Number(e.target.value))}
              className="range w-full"
              style={{ '--fill': `${((feePct - 5) / 15) * 100}%` } as React.CSSProperties}
            />
          </Field>
        </Section>

        <Section n={3} title="Draw rules" sub="How long tickets are on sale, and what happens if they don’t sell out.">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-bold">Draw deadline</legend>
            <Segmented<string>
              label="Draw deadline"
              value={String(durationDays)}
              onChange={(v) => setDurationDays(Number(v))}
              options={RULES.listingDurationsDays.map((d) => ({ value: String(d), label: `${d} days` }))}
            />
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-bold">If tickets don’t sell out</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { id: 'refund', title: 'Refund buyers', body: 'Everyone gets their money back in their wallet.' },
                  { id: 'extend_once', title: `Extend once by ${RULES.extensionDays} days`, body: 'One more chance to sell out, then refund.' },
                ] as const
              ).map((o) => (
                <label
                  key={o.id}
                  className={cx(
                    'flex min-h-11 cursor-pointer gap-3 rounded-2xl border p-3.5 transition',
                    unsoldPolicy === o.id ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong',
                  )}
                >
                  <input type="radio" name="unsold" value={o.id} checked={unsoldPolicy === o.id} onChange={() => setUnsoldPolicy(o.id)} className="mt-1 size-4 accent-brand" />
                  <span className="flex flex-col">
                    <strong className="text-sm">{o.title}</strong>
                    <span className="text-xs text-subtle">{o.body}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Notice icon={LockIcon} title="Escrow comes first">
            Before tickets go on sale, deliver the item to a DrawMart escrow point. We verify and photograph it, and only then publish the draw.
          </Notice>
        </Section>

        {showErrors && errors.length ? (
          <ul className="list-disc rounded-2xl bg-hot-soft py-3 pr-3 pl-8 text-sm text-hot-ink" role="alert">
            {errors.map((e) => (
              <li key={e}>{LISTING_ERROR_TEXT[e]}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" loading={create.isPending}>
            Submit for review
          </Button>
          <Button type="button" size="lg" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>

      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-8">
        <div className="relative isolate flex flex-col gap-4 overflow-hidden rounded-[28px] bg-linear-to-br from-hero to-hero-2 p-6 text-on-hero shadow-lift">
          <div className="texture-dots absolute inset-0 -z-10" />
          <span className="text-xs font-extrabold tracking-[0.15em] text-ticket">HOW THIS DRAW ADDS UP</span>
          <div className="flex flex-col">
            <span className="text-sm text-on-brand-muted">You receive</span>
            <span key={econ.sellerPayoutKobo} className="animate-fade-in font-display text-4xl font-extrabold tabular-nums">
              {formatNaira(econ.sellerPayoutKobo)}
            </span>
          </div>
          <dl className="flex flex-col border-t border-white/15 text-sm">
            {[
              ['Tickets to sell', econ.ticketCount.toLocaleString('en-NG')],
              ['Buyer pays per ticket', formatNaira(econ.buyerTicketKobo)],
              ['Total ticket sales', formatNaira(econ.poolKobo)],
              ['Platform keeps', formatNaira(econ.platformKobo)],
              ['Odds per ticket', econ.ticketCount ? `1 in ${econ.ticketCount.toLocaleString('en-NG')}` : '–'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-white/15 py-2.5">
                <dt className="text-on-brand-muted">{k}</dt>
                <dd className="font-bold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="flex gap-2 text-xs leading-relaxed text-on-brand-muted">
            <TruckIcon size={16} className="shrink-0 text-ticket" />
            No buyer money reaches you until the winner has the item. Unsold draws follow the rule you picked.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-extrabold tracking-wider text-subtle uppercase">Buyer preview</span>
          <Card className="flex flex-col gap-3 p-3">
            <ProductImage category={category} src={photos[0]} alt="Cover photo preview" className="h-40" />
            <div className="flex flex-col gap-0.5 px-1">
              <strong className="leading-tight">{title.trim() || 'Your item name'}</strong>
              <span className="text-xs text-subtle">
                {merchant.data?.name ?? 'Your store'} · Worth {formatNaira(input.priceKobo)}
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
      <span className="text-xs text-subtle">Up to {MAX_PHOTOS}. The first is the cover. Escrow staff add their own photos when the item is checked in.</span>
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

const STATUS: Record<ListingView['status'], { label: string; tone: Tone }> = {
  pending_review: { label: 'In review', tone: 'ticket' },
  live: { label: 'Live', tone: 'brand' },
  drawn: { label: 'Drawn · awaiting delivery', tone: 'sky' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'hot' },
}

type StatusFilter = 'all' | 'live' | 'pending_review' | 'done'

function MerchantListings({ onNew }: { onNew: () => void }) {
  const q = useMerchantListings()
  const [filter, setFilter] = useState<StatusFilter>('all')
  if (q.isPending) return <Skeleton className="h-60" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />

  const items = q.data.filter((l) =>
    filter === 'all' ? true : filter === 'done' ? !['live', 'pending_review'].includes(l.status) : l.status === filter,
  )
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
          body="Create a listing, drop the item at escrow, and we’ll publish it."
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
                <div className="flex flex-col gap-1.5">
                  <ProgressBar value={l.ticketsSold} max={l.ticketCount} label={`${l.title}: tickets sold`} size="sm" />
                  <div className="flex justify-between text-xs text-subtle">
                    <span>
                      {l.ticketsSold.toLocaleString('en-NG')} / {l.ticketCount.toLocaleString('en-NG')} sold
                    </span>
                    {l.status === 'live' ? (
                      <Countdown closesAt={l.closesAt} className="font-bold" />
                    ) : l.status === 'pending_review' ? (
                      <span>{l.durationDays} days after approval</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-dashed border-line pt-3 text-sm">
                  <span className="text-subtle">Your payout</span>
                  <strong className="tabular-nums">{formatNaira(econ.sellerPayoutKobo)}</strong>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}
