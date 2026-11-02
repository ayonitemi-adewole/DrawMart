import { useState } from 'react'
import { useClaimActions, useOpenClaims } from '@/api/hooks'
import type { ClaimReview } from '@/api/types'
import { CheckIcon } from '@/components/icons'
import { ProductId } from '@/components/ProductId'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, PageTitle, ProductImage, Skeleton, cx, errorMessage, inputCls } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import { CANCEL_REASON_TEXT } from '@/domain/orderCancel'

/** /admin/claims: faults buyers have reported, and failures sellers have contested. */
export function AdminClaimsPage() {
  const q = useOpenClaims()
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Admin" sub="Approving a fault sends a rider to collect it, and refunds the buyer when they have it. Approving a contest takes back the seller’s charge; the buyer keeps their refund either way.">
        Claims
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={CheckIcon} title="All caught up" body="New fault reports and contests will appear here." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data.map((c) => (
            <ClaimCard key={c.id} claim={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function Photos({ label, photos }: { label: string; photos: string[] }) {
  if (!photos.length) return null
  return (
    <div className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <div className="flex flex-wrap gap-2">
        {photos.map((src, i) => (
          <a key={i} href={src} target="_blank" rel="noreferrer">
            <img src={src} alt={`${label} ${i + 1}`} className="size-20 rounded-xl border border-line bg-photo object-cover" />
          </a>
        ))}
      </div>
    </div>
  )
}

function ClaimCard({ claim: c }: { claim: ClaimReview }) {
  const { review } = useClaimActions()
  const toast = useToast()
  const [note, setNote] = useState('')
  const contest = c.kind === 'contest'

  function decide(approve: boolean) {
    review
      .mutateAsync({ id: c.id, approve, note })
      .then(() => toast(approve ? 'Approved.' : 'Turned down.', approve ? 'success' : 'info'))
      .catch((e) => toast(errorMessage(e), 'error'))
  }

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex min-w-0 gap-3">
        <ProductImage category="Home" src={c.listingImage ?? undefined} alt="" size="sm" className="size-16 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <strong className="leading-tight">{c.listingTitle}</strong>
          <ProductId code={c.productCode} copy />
          <span className="text-xs text-subtle">{c.merchantName} · {formatNaira(c.priceKobo)}</span>
          <Badge tone={contest ? 'sky' : 'hot'} className="w-fit">{contest ? 'Seller contests' : 'Buyer reports a fault'}</Badge>
        </div>
      </div>
      {contest && c.cancelReason ? <p className="text-sm text-muted">{CANCEL_REASON_TEXT[c.cancelReason]}.</p> : null}
      <p className="rounded-xl bg-ground p-3 text-sm">“{c.description}”</p>
      <Photos label="Their photos" photos={c.photos} />
      <Photos label="The seller’s photo" photos={c.confirmPhoto ? [c.confirmPhoto] : []} />
      <Photos label="The rider’s photos" photos={[...c.collectionPhotos, ...(c.refusalPhoto ? [c.refusalPhoto] : [])]} />
      <Field label="Note (needed to turn it down)" htmlFor={`claim-note-${c.id}`}>
        <textarea id={`claim-note-${c.id}`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} rows={2} className={cx(inputCls, 'py-3')} />
      </Field>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" disabled={review.isPending} onClick={() => decide(false)}>
          Turn down
        </Button>
        <Button className="flex-1" disabled={review.isPending} onClick={() => decide(true)}>
          Approve
        </Button>
      </div>
    </Card>
  )
}
