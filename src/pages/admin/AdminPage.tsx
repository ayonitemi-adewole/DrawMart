import { useState, type FormEvent } from 'react'
import { usePendingListings, useReviewListing } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { CalendarIcon, CarIcon, CheckIcon, ClipboardIcon, LockIcon, MapPinIcon, TruckIcon, XIcon } from '@/components/icons'
import { NoProductMatch, ProductId, ProductSearch } from '@/components/ProductId'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, PageTitle, ProductImage, Skeleton, cx, errorMessage, inputCls } from '@/components/ui'
import { computeListingEconomics } from '@/domain/fees'
import { REJECTION_ERROR_TEXT, REJECTION_NOTE_MAX, rejectionError, rejectionReasonsFor, rejectionReasonText } from '@/domain/rejection'
import type { RejectionReason } from '@/domain/types'
import { saleEconomics } from '@/domain/orders'
import { listingMatchesSearch } from '@/domain/productCode'
import { TIME_SLOTS, UNSOLD_POLICY_LABEL } from '@/domain/listing'
import { directionsUrl } from '@/domain/location'
import { formatNaira } from '@/domain/money'
import type { HandoverMethod } from '@/domain/types'
import { calendarDay } from '@/lib/time'

const CHECKS: Record<HandoverMethod, string[]> = {
  pickup: [
    'Item collected and checked into escrow',
    'Item matches the title and description',
    'Item photographed and condition logged',
    'Store’s CAC registration is current',
  ],
  inspection: [
    'Car inspected at the booked visit',
    'VIN, papers and ownership match the listing',
    'Car photographed and condition logged',
    'Store’s CAC registration is current',
  ],
}

/** Regular products stay with the store, so the review is of the listing itself. */
const PRODUCT_CHECKS = [
  'Photos and description show a real, specific item',
  'Price is in line with the market',
  'Category is right and the item isn’t perishable',
  'Seller’s CAC registration (stores) or ID check (individuals) is current',
]

const FEE_MODE_TEXT = { seller: 'store pays', buyer: 'buyer pays', split: 'split 50/50' }

/** Admin queue: approve a listing only once the item is in escrow. */
export function AdminPage() {
  const q = usePendingListings()
  const [search, setSearch] = useState('')
  const found = q.data?.filter((l) => listingMatchesSearch(l, search)) ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        eyebrow="Admin"
        sub="Raffles: approve only after the item is in escrow (or the car has passed inspection) and matches the listing. Regular products: check the listing itself. Tick each check to unlock approval."
        action={q.data ? <Badge tone={q.data.length ? 'ticket' : 'brand'}>{q.data.length} waiting</Badge> : null}
      >
        Listings to review
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={CheckIcon} title="All caught up" body="Nothing waiting. New merchant listings will appear here." />
      ) : (
        <div className="flex flex-col gap-4">
          <ProductSearch value={search} onChange={setSearch} placeholder="Search by product ID, name or seller" />
          {found.length ? null : <NoProductMatch query={search} />}
          {/* Hidden, not removed: a half-finished checklist shouldn't reset because of a search. */}
          {q.data.map((l) => (
            <div key={l.id} hidden={!found.includes(l)}>
              <ReviewCard listing={l} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewCard({ listing: l }: { listing: ListingView }) {
  const review = useReviewListing()
  const toast = useToast()
  const method = l.handover?.method ?? 'pickup'
  const product = l.kind === 'product'
  const checks = product ? PRODUCT_CHECKS : CHECKS[method]
  const [checked, setChecked] = useState<boolean[]>(() => checks.map(() => false))
  const [confirmReject, setConfirmReject] = useState(false)
  const [reason, setReason] = useState<RejectionReason | null>(null)
  const [note, setNote] = useState('')
  const [showRejectError, setShowRejectError] = useState(false)
  const rejectProblem = rejectionError(l.kind, { reason, note })
  const ready = checked.every(Boolean)
  const econ = computeListingEconomics(l)
  const busy = review.isPending

  function approve() {
    review.mutate(
      { id: l.id, approve: true },
      {
        onSuccess: () => toast(`${l.title} is live.`),
        onError: (e) => toast(errorMessage(e), 'error'),
      },
    )
  }

  function reject(e: FormEvent) {
    e.preventDefault()
    if (rejectProblem || !reason) {
      setShowRejectError(true)
      return
    }
    review.mutate(
      { id: l.id, approve: false, reason, note },
      {
        onSuccess: () => toast(`${l.title} was rejected. The store can see why.`, 'info'),
        onError: (err) => toast(errorMessage(err), 'error'),
        onSettled: () => setConfirmReject(false),
      },
    )
  }

  return (
    <Card className="grid animate-fade-up gap-5 p-5 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex gap-4">
          <ProductImage category={l.category} src={l.images[0]} alt={l.title} size="sm" className="size-24 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <strong className="text-lg leading-tight">{l.title}</strong>
            <ProductId code={l.productCode} copy />
            <span className="text-sm text-subtle">
              {l.merchant.name} · {l.merchant.area} · {l.merchant.cacNumber}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="neutral">{l.category}</Badge>
              {product ? (
                <Badge tone="brand">Regular product</Badge>
              ) : (
                <>
                  <Badge tone="sky">{l.durationDays}-day draw</Badge>
                  <Badge tone="violet">{UNSOLD_POLICY_LABEL[l.unsoldPolicy]}</Badge>
                  {l.pickupBatchId ? <Badge tone="ticket">Shared pickup</Badge> : null}
                </>
              )}
            </div>
          </div>
        </div>
        {l.description ? <p className="text-sm leading-relaxed text-muted">{l.description}</p> : null}
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(product
            ? [
                ['Price', formatNaira(l.priceKobo)],
                ['Fee', `${l.feeBps / 100}% (store pays)`],
                ['Store payout', formatNaira(saleEconomics(l.priceKobo, l.feeBps).payoutKobo)],
                ['Caution fee', 'None'],
              ]
            : [
            ['Worth', formatNaira(l.priceKobo)],
            ['Tickets', `${l.ticketCount.toLocaleString('en-NG')} × ${formatNaira(l.buyerTicketPriceKobo)}`],
            ['Fee', `${l.feeBps / 100}% (${FEE_MODE_TEXT[l.feeMode]})`],
            ['Store payout', formatNaira(econ.sellerPayoutKobo)],
            [l.pickupBatchId ? 'Caution fee (shared)' : 'Caution fee', `${formatNaira(l.cautionFee.amountKobo)} ${l.cautionFee.status}`],
            ...(l.fallbackPriceKobo ? [['Fixed price if unsold', formatNaira(l.fallbackPriceKobo)]] : []),
          ]).map(([k, v]) => (
            <div key={k} className="flex flex-col rounded-2xl bg-ground p-3">
              <dt className="text-[11px] font-semibold text-subtle">{k}</dt>
              <dd className="text-sm font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        {l.handover ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-line p-4 text-sm">
            <span className="flex items-center gap-2 font-bold">
              {method === 'inspection' ? <CarIcon size={16} className="text-brand" /> : <TruckIcon size={16} className="text-brand" />}
              {method === 'inspection' ? 'Inspection booking' : 'Pickup booking'}
            </span>
            <span className="flex items-center gap-2 text-muted">
              <CalendarIcon size={14} className="shrink-0" /> {calendarDay(l.handover.date)}, {TIME_SLOTS[l.handover.slot]}
            </span>
            <span className="flex items-start gap-2 text-muted">
              <MapPinIcon size={14} className="mt-0.5 shrink-0" /> {l.handover.address}
            </span>
            {l.handover.location ? (
              <a href={directionsUrl(l.handover.location)} target="_blank" rel="noreferrer" className="flex min-h-11 w-fit items-center">
                Directions to the pinned spot
              </a>
            ) : null}
            <a href={`tel:${l.handover.contactPhone.replace(/\s/g, '')}`} className="flex min-h-11 w-fit items-center">
              {l.handover.contactPhone}
            </a>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-ground/60 p-4">
        <span className="flex items-center gap-2 text-sm font-bold">
          <ClipboardIcon size={16} className="text-brand" /> {product ? 'Listing checklist' : method === 'inspection' ? 'Inspection checklist' : 'Escrow checklist'}
          <span className="ml-auto text-xs text-subtle">
            {checked.filter(Boolean).length}/{checks.length}
          </span>
        </span>
        <ul className="flex flex-col gap-1">
          {checks.map((c, i) => (
            <li key={c}>
              <label className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm transition hover:bg-surface', checked[i] && 'text-brand-ink')}>
                <input
                  type="checkbox"
                  checked={checked[i]}
                  onChange={() => setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)))}
                  className="size-5 shrink-0 accent-brand"
                />
                {c}
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-col gap-2 pt-1">
          <Button loading={busy && review.variables?.approve} disabled={!ready || busy} onClick={approve}>
            <LockIcon size={16} /> {ready ? (product ? 'Approve and put on sale' : 'Approve and go live') : 'Complete the checklist'}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => setConfirmReject(true)}>
            <XIcon size={16} /> Reject
          </Button>
        </div>
      </div>

      <Sheet open={confirmReject} onClose={() => !busy && setConfirmReject(false)} title="Reject listing">
        <h2 className="pr-10 font-display text-2xl font-extrabold">Reject “{l.title}”?</h2>
        <p className="text-sm text-muted">
          The store sees your reason and can fix the listing and send it again
          {product
            ? '.'
            : l.pickupBatchId
              ? `. This item shares a pickup, so unless they do, the store loses the whole ${formatNaira(l.cautionFee.amountKobo)} caution fee, even if its other draws sell out.`
              : `. Unless they do, its ${formatNaira(l.cautionFee.amountKobo)} caution fee is kept to cover the ${method === 'inspection' ? 'inspection visit' : 'pickup and return'}.`}{' '}
        </p>
        <form onSubmit={reject} noValidate className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1.5 text-sm font-bold">Reason</legend>
            {rejectionReasonsFor(l.kind).map((r) => (
              <label key={r} className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm transition', reason === r ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong')}>
                <input type="radio" name={`reason-${l.id}`} checked={reason === r} onChange={() => setReason(r)} className="size-4 shrink-0 accent-brand" />
                {rejectionReasonText(r, l.category)}
              </label>
            ))}
            {showRejectError && rejectProblem === 'reason_required' ? (
              <span className="text-xs font-semibold text-hot-ink" role="alert">
                {REJECTION_ERROR_TEXT.reason_required}
              </span>
            ) : null}
          </fieldset>
          <Field
            label={reason === 'other' ? 'What’s wrong?' : 'Note for the store (optional)'}
            htmlFor={`reject-note-${l.id}`}
            hint={`${note.length}/${REJECTION_NOTE_MAX}`}
            error={showRejectError && rejectProblem && rejectProblem !== 'reason_required' ? REJECTION_ERROR_TEXT[rejectProblem] : undefined}
          >
            <textarea id={`reject-note-${l.id}`} value={note} maxLength={REJECTION_NOTE_MAX} onChange={(e) => setNote(e.target.value)} rows={3} className={cx(inputCls, 'py-3')} placeholder="e.g. The cover photo is too dark to see the screen." />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmReject(false)} disabled={busy}>
              Keep in review
            </Button>
            <Button type="submit" variant="danger" className="flex-1" loading={busy}>
              Reject listing
            </Button>
          </div>
        </form>
      </Sheet>
    </Card>
  )
}
