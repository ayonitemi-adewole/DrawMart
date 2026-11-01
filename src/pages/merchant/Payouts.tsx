import { useState } from 'react'
import { api } from '@/api'
import { useBanks, useLookupBankAccount, usePayoutAccount, usePayouts, useSavePayoutAccount } from '@/api/hooks'
import type { PayoutLineView } from '@/api/types'
import { CheckIcon, ClockIcon, DownloadIcon, LockIcon, NairaIcon, TicketIcon } from '@/components/icons'
import { NoProductMatch, ProductId, ProductSearch } from '@/components/ProductId'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, Segmented, Skeleton, StatTile, cx, errorMessage, inputCls, type Tone } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import {
  PAYOUT_ACCOUNT_HOLD_HOURS,
  PAYOUT_KIND_TEXT,
  PAYOUT_STATUS_TEXT,
  accountNumberError,
  accountPayable,
  maskAccountNumber,
  payoutTotals,
  statementCsv,
  statementMonths,
  type PayoutStatus,
} from '@/domain/payouts'
import { matchesProductSearch } from '@/domain/productCode'
import { dateTime } from '@/lib/time'

const STATUS_TONE: Record<PayoutStatus, Tone> = { waiting: 'ticket', due: 'sky', paid: 'brand' }

/** /store/payouts, and a tab of /sell: what each item has earned and where it's paid. */
export function Payouts() {
  const q = usePayouts()
  const [filter, setFilter] = useState<PayoutStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  if (q.isPending) return <Skeleton className="h-60" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />

  const totals = payoutTotals(q.data)
  const found = q.data.filter((l) => matchesProductSearch(search, l.productCode, l.listingTitle))
  const shown = filter === 'all' ? found : found.filter((l) => l.status === filter)
  const count = (s: PayoutStatus) => found.filter((l) => l.status === s).length

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile icon={ClockIcon} tone="ticket" label="Waiting for delivery" value={formatNaira(totals.waiting)} hint="Due once the buyer or winner has it" />
        <StatTile icon={NairaIcon} tone="sky" label="Due to you" value={formatNaira(totals.due)} hint="Delivered. We send these by bank transfer" />
        <StatTile icon={CheckIcon} label="Paid" value={formatNaira(totals.paid)} hint="All time" />
      </div>

      <BankAccount owed={totals.due > 0} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-extrabold">Item by item</h2>
          <Statement lines={q.data} />
        </div>
        {q.data.length ? (
          <>
            <Segmented<PayoutStatus | 'all'>
              label="Filter payouts"
              value={filter}
              onChange={setFilter}
              size="sm"
              options={[
                { value: 'all', label: 'All', count: found.length },
                { value: 'waiting', label: 'Waiting', count: count('waiting') },
                { value: 'due', label: 'Due', count: count('due') },
                { value: 'paid', label: 'Paid', count: count('paid') },
              ]}
            />
            <ProductSearch value={search} onChange={setSearch} />
          </>
        ) : null}
        {q.data.length === 0 ? (
          <EmptyState icon={TicketIcon} title="Nothing yet" body="When something sells, or a draw sells out, what you’ve earned shows up here." />
        ) : shown.length === 0 && search.trim() ? (
          <NoProductMatch query={search} />
        ) : shown.length === 0 ? (
          <EmptyState icon={TicketIcon} title="Nothing here" body="No payouts at this stage." />
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {shown.map((l) => (
              <PayoutRow key={l.id} line={l} />
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}

function PayoutRow({ line: l }: { line: PayoutLineView }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-4 text-sm">
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <strong className="leading-tight">{l.listingTitle}</strong>
        <ProductId code={l.productCode} copy />
        <span className="text-xs text-subtle">
          {PAYOUT_KIND_TEXT[l.kind]}
          {l.status === 'paid' && l.paidAt ? ` · Paid ${dateTime(l.paidAt)}` : l.status === 'due' && l.dueAt ? ` · Due since ${dateTime(l.dueAt)}` : ''}
        </span>
        {l.status === 'paid' && l.paidTo ? (
          <span className="text-xs text-subtle">
            To {l.paidTo}
            {l.reference ? ` · Ref ${l.reference}` : ''}
          </span>
        ) : null}
      </div>
      <div className="ml-auto flex flex-col items-end gap-1">
        <strong className="tabular-nums">{formatNaira(l.amountKobo)}</strong>
        <Badge tone={STATUS_TONE[l.status]}>{PAYOUT_STATUS_TEXT[l.status]}</Badge>
      </div>
    </div>
  )
}

/** A month's payments as a spreadsheet, made in the browser from what's already here. */
function Statement({ lines }: { lines: PayoutLineView[] }) {
  const months = statementMonths(lines)
  const [picked, setPicked] = useState<string | null>(null)
  const month = picked && months.includes(picked) ? picked : months[0]
  if (!month) return null

  function download() {
    const url = URL.createObjectURL(new Blob([statementCsv(lines, month)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `drawmart-statement-${month}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="statement-month" className="sr-only">
        Statement month
      </label>
      <select id="statement-month" value={month} onChange={(e) => setPicked(e.target.value)} className={cx(inputCls, 'w-auto')}>
        {months.map((m) => (
          <option key={m} value={m}>
            {new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })}
          </option>
        ))}
      </select>
      <Button variant="outline" onClick={download}>
        <DownloadIcon size={16} /> Statement
      </Button>
    </div>
  )
}

function BankAccount({ owed }: { owed: boolean }) {
  const account = usePayoutAccount()
  const [changing, setChanging] = useState(false)
  if (account.isPending) return <Skeleton className="h-32" />
  if (account.isError) return <ErrorState error={account.error} onRetry={() => account.refetch()} />
  const a = account.data
  const held = a ? !accountPayable(a, Date.now()) : false

  if (!a || changing) return <BankForm hasAccount={!!a} owed={owed} onDone={() => setChanging(false)} />

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5 text-sm">
          <span className="text-xs font-bold tracking-wider text-subtle uppercase">Paid to</span>
          <strong>{a.accountName}</strong>
          <span className="text-muted">
            {a.bankName} · {maskAccountNumber(a.accountNumber)}
          </span>
        </div>
        <Button variant="outline" onClick={() => setChanging(true)}>
          Change
        </Button>
      </div>
      {held ? (
        <Notice tone="ticket" icon={LockIcon} title={`Payouts are on hold until ${dateTime(a.payableFrom)}`}>
          You changed your bank account. If this wasn’t you, message DrawMart right away.
        </Notice>
      ) : null}
    </Card>
  )
}

/** Checks the account first and shows the bank's own name for it, then saves on a second tap. */
function BankForm({ hasAccount, owed, onDone }: { hasAccount: boolean; owed: boolean; onDone: () => void }) {
  const banks = useBanks()
  const lookup = useLookupBankAccount()
  const save = useSavePayoutAccount()
  const toast = useToast()
  const [bankCode, setBankCode] = useState('')
  const [number, setNumber] = useState('')
  const [name, setName] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const numberProblem = accountNumberError(number)

  function edit(apply: () => void) {
    apply()
    setName(null) // a different account needs checking again
  }

  function onCheck() {
    if (!bankCode || numberProblem) {
      setShowErrors(true)
      return
    }
    lookup.mutate({ bankCode, accountNumber: number }, { onSuccess: (r) => setName(r.accountName), onError: (e) => toast(errorMessage(e), 'error') })
  }

  function onSave() {
    save.mutate(
      { bankCode, accountNumber: number },
      {
        onSuccess: () => {
          toast(hasAccount ? 'Bank account changed.' : 'Bank account added.')
          onDone()
        },
        onError: (e) => toast(errorMessage(e), 'error'),
      },
    )
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-extrabold">{hasAccount ? 'Change your bank account' : 'Add your bank account'}</h2>
        <p className="text-sm text-muted">{owed && !hasAccount ? 'You have money due. We can’t send it until you add an account.' : 'Where we send what you’ve earned.'}</p>
      </div>
      {hasAccount ? (
        <Notice tone="ticket" icon={LockIcon} title={`Payouts stop for ${PAYOUT_ACCOUNT_HOLD_HOURS} hours`}>
          A new account is held for {PAYOUT_ACCOUNT_HOLD_HOURS} hours before we pay into it, so nobody can quietly redirect your money.
        </Notice>
      ) : null}
      {banks.isError ? (
        <ErrorState error={banks.error} onRetry={() => banks.refetch()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bank" htmlFor="payout-bank" error={showErrors && !bankCode ? 'Pick your bank.' : undefined}>
            <select id="payout-bank" value={bankCode} disabled={banks.isPending} onChange={(e) => edit(() => setBankCode(e.target.value))} className={inputCls}>
              <option value="">{banks.isPending ? 'Loading banks…' : 'Choose a bank'}</option>
              {banks.data?.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Account number" htmlFor="payout-number" error={showErrors && numberProblem ? numberProblem : undefined}>
            <input
              id="payout-number"
              inputMode="numeric"
              autoComplete="off"
              maxLength={10}
              value={number}
              onChange={(e) => edit(() => setNumber(e.target.value.replace(/\D/g, '')))}
              className={inputCls}
              placeholder="0123456789"
            />
          </Field>
        </div>
      )}
      {api.testMode ? <p className="text-xs text-subtle">Test mode. With Flutterwave test keys, use Access Bank and 0690000032.</p> : null}
      {name ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-ground p-4 text-sm">
          <span className="flex flex-col">
            <span className="text-xs text-subtle">The bank says this account belongs to</span>
            <strong className="text-base">{name}</strong>
          </span>
          <div className="flex flex-wrap gap-2">
            <Button loading={save.isPending} onClick={onSave}>
              <CheckIcon size={16} /> Yes, that’s mine
            </Button>
            <Button variant="ghost" disabled={save.isPending} onClick={() => setName(null)}>
              No, go back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button loading={lookup.isPending} onClick={onCheck}>
            Check account
          </Button>
          {hasAccount ? (
            <Button variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          ) : null}
        </div>
      )}
    </Card>
  )
}
