import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useCreateListing, useMerchant, useMerchantListings } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { LockIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, ErrorState, Skeleton, cx, errorMessage } from '@/components/ui'
import { LISTING_ERROR_TEXT, computeListingEconomics, validateListingEconomics } from '@/domain/fees'
import { formatNaira, parseNairaInput } from '@/domain/money'
import { RULES } from '@/domain/rules'
import { CATEGORIES, type Category, type FeeMode, type UnsoldPolicy } from '@/domain/types'
import { timeLeft } from '@/lib/time'

const FEE_MODES: { id: FeeMode; label: string; hint: string }[] = [
  { id: 'seller', label: 'Store pays', hint: 'Recommended for launch: buyers see exactly the ticket price, and the fee comes out of your payout.' },
  { id: 'buyer', label: 'Buyer pays', hint: 'The fee is added to each ticket, so buyers pay a little more than the ticket price.' },
  { id: 'split', label: 'Split 50/50', hint: 'Half the fee is added to each ticket and half comes out of your payout.' },
]

const inputCls = 'min-h-11 w-full rounded-xl border border-line-strong bg-ground px-3 text-sm'

export function MerchantPage() {
  const merchant = useMerchant()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">New draw listing</h1>
        <p className="text-muted">Set your price and ticket size. You get paid once the winner confirms delivery.</p>
        {merchant.data ? (
          <p className="text-xs text-subtle">
            {merchant.data.name} · {merchant.data.cacNumber} · {merchant.data.verified ? 'Verified' : 'Verification pending'}
          </p>
        ) : null}
      </div>
      <ListingForm />
      <MerchantListings />
    </div>
  )
}

function ListingForm() {
  const create = useCreateListing()
  const toast = useToast()
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

  const input = { title, priceKobo: parseNairaInput(price), ticketPriceKobo: parseNairaInput(ticket), feeBps: feePct * 100, feeMode }
  const econ = computeListingEconomics(input)
  const errors = validateListingEconomics(input)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (errors.length) {
      setShowErrors(true)
      return
    }
    create.mutate(
      { ...input, description, category, durationDays, unsoldPolicy },
      {
        onSuccess: () => {
          toast('Sent for review. Deliver the item to escrow and we’ll publish it.')
          setTitle('')
          setDescription('')
          setPrice('')
          setTicket('')
          setShowErrors(false)
        },
        onError: (err) => toast(errorMessage(err), 'error'),
      },
    )
  }

  return (
    <div className="flex flex-wrap items-start gap-6">
      <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-[999_1_520px] flex-col gap-5 rounded-3xl border border-line bg-surface p-6">
        <Field label="Item name" htmlFor="title">
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Smartphone, 256GB" />
        </Field>
        <Field label="Description" htmlFor="desc">
          <textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={cx(inputCls, 'py-2')} placeholder="Condition, warranty, what’s in the box" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Category" htmlFor="cat">
            <select id="cat" value={category} onChange={(e) => setCategory(e.target.value as Category)} className={inputCls}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Your price (₦)" htmlFor="price">
            <input id="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} placeholder="1,000,000" />
          </Field>
          <Field label="Ticket price (₦)" htmlFor="ticket">
            <input id="ticket" inputMode="numeric" value={ticket} onChange={(e) => setTicket(e.target.value)} className={inputCls} placeholder="5,000" />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-bold">Who pays the platform fee?</legend>
          <div className="flex flex-wrap gap-2">
            {FEE_MODES.map((m) => (
              <button
                type="button"
                key={m.id}
                aria-pressed={feeMode === m.id}
                onClick={() => setFeeMode(m.id)}
                className={cx('min-h-11 rounded-full border px-4 text-sm font-bold', feeMode === m.id ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface')}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-subtle">{FEE_MODES.find((m) => m.id === feeMode)!.hint}</p>
        </fieldset>

        <Field label={`Platform fee: ${feePct}%`} htmlFor="fee" hint="Set by DrawMart per category. Shown here so you can see the effect.">
          <input id="fee" type="range" min={5} max={20} value={feePct} onChange={(e) => setFeePct(Number(e.target.value))} className="w-full accent-brand" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Draw deadline" htmlFor="days">
            <select id="days" value={durationDays} onChange={(e) => setDurationDays(Number(e.target.value))} className={inputCls}>
              {RULES.listingDurationsDays.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </Field>
          <Field label="If tickets don’t sell out" htmlFor="unsold">
            <select id="unsold" value={unsoldPolicy} onChange={(e) => setUnsoldPolicy(e.target.value as UnsoldPolicy)} className={inputCls}>
              <option value="refund">Refund buyers to wallet</option>
              <option value="extend_once">Extend once by {RULES.extensionDays} days, then refund</option>
            </select>
          </Field>
        </div>

        <div className="flex gap-2.5 rounded-xl bg-brand-soft p-3.5 text-sm leading-snug text-brand-ink">
          <LockIcon className="shrink-0" />
          <span>Before tickets go on sale, deliver the item to a DrawMart escrow point. We verify and photograph it, and only then publish the draw.</span>
        </div>

        {showErrors && errors.length ? (
          <ul className="list-disc rounded-xl bg-hot-soft py-3 pr-3 pl-8 text-sm text-hot-ink" role="alert">
            {errors.map((e) => (
              <li key={e}>{LISTING_ERROR_TEXT[e]}</li>
            ))}
          </ul>
        ) : null}

        <Button type="submit" size="lg" className="self-start" loading={create.isPending}>
          Submit for review
        </Button>
      </form>

      <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 rounded-3xl bg-brand-deep p-6 text-ground md:sticky md:top-6">
        <span className="text-xs font-extrabold tracking-[0.15em] text-ticket">HOW THIS DRAW ADDS UP</span>
        <div className="flex flex-col">
          <span className="text-sm text-on-brand-muted">You receive</span>
          <span className="font-display text-4xl font-extrabold">{formatNaira(econ.sellerPayoutKobo)}</span>
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
              <dd className="font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs leading-relaxed text-on-brand-muted">No buyer money reaches you until the winner has the item. Unsold draws follow the rule you picked.</p>
      </aside>
    </div>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-bold">
        {label}
      </label>
      {children}
      {hint ? <span className="text-xs text-subtle">{hint}</span> : null}
    </div>
  )
}

const STATUS: Record<ListingView['status'], { label: string; tone: 'brand' | 'ticket' | 'neutral' | 'hot' }> = {
  pending_review: { label: 'In review', tone: 'ticket' },
  live: { label: 'Live', tone: 'brand' },
  drawn: { label: 'Drawn · awaiting delivery', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'hot' },
}

function MerchantListings() {
  const q = useMerchantListings()
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-extrabold">Your draws</h2>
        <Link to="/admin" className="text-sm">
          Admin review →
        </Link>
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-subtle">
                {['Item', 'Status', 'Tickets sold', 'Your payout', 'Closes'].map((h) => (
                  <th key={h} className="px-4 py-3 font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.map((l) => {
                const econ = computeListingEconomics(l)
                return (
                  <tr key={l.id} className="border-t border-line">
                    <td className="px-4 py-3.5 font-bold">{l.title}</td>
                    <td className="px-4 py-3.5">
                      <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                    </td>
                    <td className="px-4 py-3.5">
                      {l.ticketsSold} / {l.ticketCount}
                    </td>
                    <td className="px-4 py-3.5">{formatNaira(econ.sellerPayoutKobo)}</td>
                    <td className="px-4 py-3.5 text-subtle">
                      {l.status === 'live' ? `in ${timeLeft(l.closesAt)}` : l.status === 'pending_review' ? `${l.durationDays} days after approval` : '–'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  )
}
