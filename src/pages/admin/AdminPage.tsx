import { useState } from 'react'
import { usePendingListings, useReviewListing } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { CheckIcon, ClipboardIcon, LockIcon, XIcon } from '@/components/icons'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, PageTitle, ProductImage, Skeleton, cx, errorMessage } from '@/components/ui'
import { computeListingEconomics } from '@/domain/fees'
import { formatNaira } from '@/domain/money'

const CHECKS = [
  'Item has arrived at the escrow point',
  'Item matches the title and description',
  'Item photographed and condition logged',
  'Store’s CAC registration is current',
]

const FEE_MODE_TEXT = { seller: 'store pays', buyer: 'buyer pays', split: 'split 50/50' }

/** Admin queue: approve a listing only once the item is in escrow. */
export function AdminPage() {
  const q = usePendingListings()

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        eyebrow="Admin"
        sub="Approve only after the item has arrived at escrow and matches the listing. Tick each check to unlock approval."
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
          {q.data.map((l) => (
            <ReviewCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewCard({ listing: l }: { listing: ListingView }) {
  const review = useReviewListing()
  const toast = useToast()
  const [checked, setChecked] = useState<boolean[]>(() => CHECKS.map(() => false))
  const [confirmReject, setConfirmReject] = useState(false)
  const ready = checked.every(Boolean)
  const econ = computeListingEconomics(l)
  const busy = review.isPending

  function decide(approve: boolean) {
    review.mutate(
      { id: l.id, approve },
      {
        onSuccess: () => toast(approve ? `${l.title} is live.` : `${l.title} was rejected.`, approve ? 'success' : 'info'),
        onError: (e) => toast(errorMessage(e), 'error'),
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
            <span className="text-sm text-subtle">
              {l.merchant.name} · {l.merchant.area} · {l.merchant.cacNumber}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="neutral">{l.category}</Badge>
              <Badge tone="sky">{l.durationDays}-day draw</Badge>
              <Badge tone="violet">{l.unsoldPolicy === 'refund' ? 'Refund if unsold' : 'Extend once if unsold'}</Badge>
            </div>
          </div>
        </div>
        {l.description ? <p className="text-sm leading-relaxed text-muted">{l.description}</p> : null}
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Worth', formatNaira(l.priceKobo)],
            ['Tickets', `${l.ticketCount.toLocaleString('en-NG')} × ${formatNaira(l.buyerTicketPriceKobo)}`],
            ['Fee', `${l.feeBps / 100}% (${FEE_MODE_TEXT[l.feeMode]})`],
            ['Store payout', formatNaira(econ.sellerPayoutKobo)],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col rounded-2xl bg-ground p-3">
              <dt className="text-[11px] font-semibold text-subtle">{k}</dt>
              <dd className="text-sm font-bold">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-ground/60 p-4">
        <span className="flex items-center gap-2 text-sm font-bold">
          <ClipboardIcon size={16} className="text-brand" /> Escrow checklist
          <span className="ml-auto text-xs text-subtle">
            {checked.filter(Boolean).length}/{CHECKS.length}
          </span>
        </span>
        <ul className="flex flex-col gap-1">
          {CHECKS.map((c, i) => (
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
          <Button loading={busy && review.variables?.approve} disabled={!ready || busy} onClick={() => decide(true)}>
            <LockIcon size={16} /> {ready ? 'Approve and go live' : 'Complete the checklist'}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => setConfirmReject(true)}>
            <XIcon size={16} /> Reject
          </Button>
        </div>
      </div>

      <Sheet open={confirmReject} onClose={() => !busy && setConfirmReject(false)} title="Reject listing">
        <h2 className="pr-10 font-display text-2xl font-extrabold">Reject “{l.title}”?</h2>
        <p className="text-sm text-muted">The store will need to submit a new listing. This can’t be undone.</p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirmReject(false)} disabled={busy}>
            Keep in review
          </Button>
          <Button variant="danger" className="flex-1" loading={busy} onClick={() => decide(false)}>
            Reject listing
          </Button>
        </div>
      </Sheet>
    </Card>
  )
}
