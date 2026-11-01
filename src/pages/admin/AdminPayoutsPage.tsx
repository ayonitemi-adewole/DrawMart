import { useState, type FormEvent } from 'react'
import { useDuePayouts, useMarkPayoutsPaid } from '@/api/hooks'
import type { DuePayoutGroup } from '@/api/types'
import { CheckIcon, LockIcon, NairaIcon } from '@/components/icons'
import { ProductId } from '@/components/ProductId'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Button, Card, EmptyState, ErrorState, Field, Notice, PageTitle, Skeleton, errorMessage, inputCls } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import { PAYOUT_KIND_TEXT, accountPayable, markPaidError } from '@/domain/payouts'
import { dateTime } from '@/lib/time'

/** /admin/payouts: what's due, per seller. Send the transfer yourself, then record it here. */
export function AdminPayoutsPage() {
  const q = useDuePayouts()
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Admin" sub="Delivered items that sellers are owed. Send each transfer from the bank first, then record its reference here.">
        Payouts
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={CheckIcon} title="All caught up" body="Payouts appear here once items are delivered." />
      ) : (
        q.data.map((g) => <SellerPayouts key={g.merchantId} group={g} />)
      )}
    </div>
  )
}

function SellerPayouts({ group: g }: { group: DuePayoutGroup }) {
  const mark = useMarkPayoutsPaid()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [reference, setReference] = useState('')
  const [showError, setShowError] = useState(false)
  const total = g.lines.reduce((sum, l) => sum + l.amountKobo, 0)
  const a = g.account
  const held = a ? !accountPayable(a, Date.now()) : false
  const problem = markPaidError(g.lines, a, reference, Date.now())

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (problem) {
      setShowError(true)
      return
    }
    // The group leaves the list as soon as it refreshes, so wait on the promise.
    mark
      .mutateAsync({ ids: g.lines.map((l) => l.id), reference })
      .then(() => toast(`Recorded ${formatNaira(total)} to ${g.merchantName}.`))
      .catch((err) => toast(errorMessage(err), 'error'))
      .finally(() => setConfirming(false))
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <strong className="text-lg leading-tight">{g.merchantName}</strong>
          <span className="text-sm text-subtle">
            {g.lines.length} {g.lines.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <strong className="font-display text-2xl tabular-nums">{formatNaira(total)}</strong>
      </div>

      {a ? (
        <dl className="grid gap-2 rounded-2xl bg-ground p-4 text-sm sm:grid-cols-3">
          {[
            ['Account name', a.accountName],
            ['Bank', a.bankName],
            ['Account number', a.accountNumber],
          ].map(([k, v]) => (
            <div key={k} className="flex min-w-0 flex-col">
              <dt className="text-xs text-subtle">{k}</dt>
              <dd className="font-bold break-words select-all">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <Notice tone="hot" icon={NairaIcon} title="No bank account yet">
          This seller needs to add one before they can be paid.
        </Notice>
      )}
      {a && held ? (
        <Notice tone="ticket" icon={LockIcon} title={`On hold until ${dateTime(a.payableFrom)}`}>
          They changed this account recently. Don’t send anything to it yet.
        </Notice>
      ) : null}

      <ul className="flex flex-col divide-y divide-line text-sm">
        {g.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-bold">{l.listingTitle}</span>
              <ProductId code={l.productCode} copy />
              <span className="text-xs text-subtle">{PAYOUT_KIND_TEXT[l.kind]}</span>
            </span>
            <span className="font-bold tabular-nums">{formatNaira(l.amountKobo)}</span>
          </li>
        ))}
      </ul>

      <Button className="self-start" disabled={!a || held} onClick={() => setConfirming(true)}>
        <CheckIcon size={16} /> I’ve sent this
      </Button>

      <Sheet open={confirming} onClose={() => !mark.isPending && setConfirming(false)} title="Record payout">
        <h2 className="pr-10 font-display text-2xl font-extrabold">
          {formatNaira(total)} to {g.merchantName}
        </h2>
        <p className="text-sm text-muted">Only record this after the bank has sent it. The seller is told straight away, and it can’t be undone here.</p>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field label="Transfer reference" htmlFor={`ref-${g.merchantId}`} error={showError && problem ? problem : undefined}>
            <input id={`ref-${g.merchantId}`} value={reference} autoComplete="off" onChange={(e) => setReference(e.target.value)} className={inputCls} placeholder="From your bank’s receipt" />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" disabled={mark.isPending} onClick={() => setConfirming(false)}>
              Not yet
            </Button>
            <Button type="submit" className="flex-1" loading={mark.isPending}>
              Mark paid
            </Button>
          </div>
        </form>
      </Sheet>
    </Card>
  )
}
