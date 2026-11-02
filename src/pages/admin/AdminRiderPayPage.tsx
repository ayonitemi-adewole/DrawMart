import { useState, type FormEvent } from 'react'
import { useRiderPayActions, useRiderPayDue } from '@/api/hooks'
import type { RiderPayDue } from '@/api/types'
import { CheckIcon, LockIcon, NairaIcon } from '@/components/icons'
import { ProductId } from '@/components/ProductId'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Button, Card, EmptyState, ErrorState, Field, Notice, PageTitle, Skeleton, errorMessage, inputCls } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import { MIN_REFERENCE_LENGTH, accountPayable } from '@/domain/payouts'
import { EARNING_KIND_TEXT } from '@/domain/riderPay'
import { dateTime } from '@/lib/time'

/** /admin/rider-pay: finished weeks riders are owed. Send the transfer, then record it. */
export function AdminRiderPayPage() {
  const q = useRiderPayDue()
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Admin" sub="What riders earned in weeks that have ended (Monday to Sunday). Send each transfer from the bank first, then record its reference. Rates are under Delivery prices.">
        Rider pay
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={CheckIcon} title="All caught up" body="Riders appear here once a week they worked in has ended." />
      ) : (
        q.data.map((r) => <RiderDue key={r.riderId} due={r} />)
      )}
    </div>
  )
}

function RiderDue({ due: r }: { due: RiderPayDue }) {
  const { markPaid } = useRiderPayActions()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [reference, setReference] = useState('')
  const [showError, setShowError] = useState(false)
  const total = r.lines.reduce((n, l) => n + l.amountKobo, 0)
  const a = r.account
  const held = a ? !accountPayable(a, Date.now()) : false
  const problem = reference.trim().length < MIN_REFERENCE_LENGTH ? 'Enter the transfer’s reference.' : null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (problem) {
      setShowError(true)
      return
    }
    // The rider leaves the list as soon as it refreshes, so wait on the promise.
    markPaid
      .mutateAsync({ riderId: r.riderId, reference })
      .then(() => toast(`Recorded ${formatNaira(total)} to ${r.riderName}.`))
      .catch((err) => toast(errorMessage(err), 'error'))
      .finally(() => setConfirming(false))
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <strong className="text-lg leading-tight">{r.riderName}</strong>
          <span className="text-sm text-subtle">
            {r.lines.length} {r.lines.length === 1 ? 'job' : 'jobs'}
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
          This rider needs to add one under Earnings before they can be paid.
        </Notice>
      )}
      {a && held ? (
        <Notice tone="ticket" icon={LockIcon} title={`On hold until ${dateTime(a.payableFrom)}`}>
          They changed this account recently. Don’t send anything to it yet.
        </Notice>
      ) : null}

      <ul className="flex flex-col divide-y divide-line text-sm">
        {r.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-bold">{EARNING_KIND_TEXT[l.kind]}: {l.listingTitle}</span>
              <ProductId code={l.productCode} copy />
              <span className="text-xs text-subtle">{dateTime(l.earnedAt)}</span>
            </span>
            <span className="font-bold tabular-nums">{formatNaira(l.amountKobo)}</span>
          </li>
        ))}
      </ul>

      <Button className="self-start" disabled={!a || held} onClick={() => setConfirming(true)}>
        <CheckIcon size={16} /> I’ve sent this
      </Button>

      <Sheet open={confirming} onClose={() => !markPaid.isPending && setConfirming(false)} title="Record rider pay">
        <h2 className="pr-10 font-display text-2xl font-extrabold">
          {formatNaira(total)} to {r.riderName}
        </h2>
        <p className="text-sm text-muted">Only record this after the bank has sent it. The rider is told straight away, and it can’t be undone here.</p>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field label="Transfer reference" htmlFor={`rider-ref-${r.riderId}`} error={showError && problem ? problem : undefined}>
            <input id={`rider-ref-${r.riderId}`} value={reference} autoComplete="off" onChange={(e) => setReference(e.target.value)} className={inputCls} placeholder="From your bank’s receipt" />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" disabled={markPaid.isPending} onClick={() => setConfirming(false)}>
              Not yet
            </Button>
            <Button type="submit" className="flex-1" loading={markPaid.isPending}>
              Mark paid
            </Button>
          </div>
        </form>
      </Sheet>
    </Card>
  )
}
