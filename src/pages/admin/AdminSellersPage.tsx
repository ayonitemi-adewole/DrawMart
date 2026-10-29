import { useState } from 'react'
import { useReviewSeller, useSellerApplications } from '@/api/hooks'
import type { SellerApplicationView } from '@/api/types'
import { CheckIcon, ClipboardIcon, IdCardIcon, ShieldIcon, XIcon } from '@/components/icons'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, PageTitle, Skeleton, cx, errorMessage, inputCls } from '@/components/ui'
import { dateTime } from '@/lib/time'

const CHECKS = [
  'The ID is genuine, readable and not expired',
  'The name on the ID matches the legal name',
  'The face in the selfie matches the ID photo',
  'The NIN has 11 digits and matches the ID (if shown)',
]

/** Admin queue: ID checks for individual sellers. */
export function AdminSellersPage() {
  const q = useSellerApplications()
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        eyebrow="Admin"
        sub="Individuals who want to sell regular products. Compare the ID with the selfie and the details, then approve to open their shop. They can never run raffles."
        action={q.data ? <Badge tone={q.data.length ? 'ticket' : 'brand'}>{q.data.length} waiting</Badge> : null}
      >
        Seller ID checks
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-72" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={CheckIcon} title="All caught up" body="New seller applications will appear here." />
      ) : (
        <div className="flex flex-col gap-4">
          {q.data.map((a) => (
            <ApplicationCard key={a.id} application={a} />
          ))}
        </div>
      )}
    </div>
  )
}

function ApplicationCard({ application: a }: { application: SellerApplicationView }) {
  const review = useReviewSeller()
  const toast = useToast()
  const [checked, setChecked] = useState(() => CHECKS.map(() => false))
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const ready = checked.every(Boolean)
  const busy = review.isPending

  function decide(approve: boolean) {
    review.mutate(
      { id: a.id, approve, note },
      {
        onSuccess: () => toast(approve ? `${a.shopName} is open for business.` : `${a.legalName} was asked to fix their application.`, approve ? 'success' : 'info'),
        onError: (e) => toast(errorMessage(e), 'error'),
        onSettled: () => setRejecting(false),
      },
    )
  }

  return (
    <Card className="grid animate-fade-up gap-5 p-5 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col">
            <strong className="text-lg leading-tight">{a.shopName}</strong>
            <span className="text-sm text-subtle">
              {a.area} · sent {dateTime(a.updatedAt)}
            </span>
          </div>
          <Badge tone="sky">
            <IdCardIcon size={12} /> Individual seller
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { src: a.idPhotoUrl, label: 'ID' },
            { src: a.selfieUrl, label: 'Selfie with ID' },
          ].map((p) => (
            <a
              key={p.label}
              href={p.src ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="group relative block h-48 overflow-hidden rounded-2xl border border-line bg-photo"
              aria-label={`Open ${p.label} full size`}
            >
              {p.src ? <img src={p.src} alt={p.label} className="size-full object-cover transition group-hover:scale-105" /> : null}
              <span className="absolute bottom-2 left-2 rounded-full bg-ink/75 px-2 py-0.5 text-[11px] font-bold text-ground">{p.label}</span>
            </a>
          ))}
        </div>
        <dl className="grid gap-2 sm:grid-cols-2">
          {[
            ['Legal name', a.legalName],
            ['NIN', a.nin.replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3')],
            ['Phone', a.phone],
            ['Address', a.address],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col rounded-2xl bg-ground p-3">
              <dt className="text-[11px] font-semibold text-subtle">{k}</dt>
              <dd className="text-sm font-bold break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-ground/60 p-4">
        <span className="flex items-center gap-2 text-sm font-bold">
          <ClipboardIcon size={16} className="text-brand" /> ID checklist
          <span className="ml-auto text-xs text-subtle">
            {checked.filter(Boolean).length}/{CHECKS.length}
          </span>
        </span>
        <ul className="flex flex-col gap-1">
          {CHECKS.map((c, i) => (
            <li key={c}>
              <label className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm transition hover:bg-surface', checked[i] && 'text-brand-ink')}>
                <input type="checkbox" checked={checked[i]} onChange={() => setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)))} className="size-5 shrink-0 accent-brand" />
                {c}
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-col gap-2 pt-1">
          <Button loading={busy && review.variables?.approve} disabled={!ready || busy} onClick={() => decide(true)}>
            <ShieldIcon size={16} /> {ready ? 'Approve and open shop' : 'Complete the checklist'}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => setRejecting(true)}>
            <XIcon size={16} /> Ask them to fix it
          </Button>
        </div>
      </div>

      <Sheet open={rejecting} onClose={() => !busy && setRejecting(false)} title="Reject application">
        <h2 className="pr-10 font-display text-2xl font-extrabold">What should {a.legalName.split(' ')[0]} fix?</h2>
        <Field label="Reason (the applicant sees this)" htmlFor={`note-${a.id}`} hint="e.g. “The selfie is blurry; retake it in good light.”">
          <textarea id={`note-${a.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={cx(inputCls, 'py-3')} />
        </Field>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setRejecting(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" className="flex-1" loading={busy} disabled={note.trim().length < 5} onClick={() => decide(false)}>
            Send back
          </Button>
        </div>
      </Sheet>
    </Card>
  )
}
