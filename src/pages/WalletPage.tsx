import { useState, type FormEvent } from 'react'
import { api } from '@/api'
import { useDemoActions, useMe, useSetWeeklyLimit, useTopUp, useUpdateProfile, useWallet } from '@/api/hooks'
import { useToast } from '@/components/toast'
import { Button, Card, ErrorState, PageTitle, ProgressBar, Skeleton, errorMessage } from '@/components/ui'
import { formatNaira, parseNairaInput } from '@/domain/money'
import { RULES } from '@/domain/rules'
import { dateTime } from '@/lib/time'

const TOP_UPS = [5_000_00, 20_000_00, 50_000_00]
const STATES = ['Lagos', 'Ogun', 'Oyo', 'FCT', 'Rivers', 'Kano']

export function WalletPage() {
  const wallet = useWallet()
  const topUp = useTopUp()
  const toast = useToast()

  if (wallet.isPending) return <Skeleton className="h-96" />
  if (wallet.isError) return <ErrorState error={wallet.error} onRetry={() => wallet.refetch()} />
  const w = wallet.data

  return (
    <div className="flex flex-col gap-5">
      <PageTitle>Wallet</PageTitle>

      <div className="flex flex-col gap-4 rounded-3xl bg-brand-deep p-5 text-ground">
        <div className="flex flex-col">
          <span className="text-xs text-on-brand-muted">Cash balance</span>
          <span className="font-display text-4xl font-extrabold">{formatNaira(w.balance.cashKobo)}</span>
        </div>
        <div className="flex justify-between border-t border-white/15 pt-3 text-sm">
          <span>Store credit</span>
          <strong className="text-ticket">{formatNaira(w.balance.creditKobo)}</strong>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {TOP_UPS.map((amt) => (
            <Button
              key={amt}
              variant="ticket"
              loading={topUp.isPending && topUp.variables === amt}
              onClick={() => topUp.mutate(amt, { onSuccess: () => toast(`${formatNaira(amt)} added (test money).`), onError: (e) => toast(errorMessage(e), 'error') })}
            >
              + {formatNaira(amt)}
            </Button>
          ))}
        </div>
        <span className="text-[11px] text-on-brand-muted">
          {api.testMode ? 'Test mode: no real money moves. The live version tops up by bank transfer or card.' : 'Top up by bank transfer or card.'}
        </span>
      </div>

      <LimitCard spent={w.spentThisWeekKobo} limit={w.weeklyLimitKobo} pending={w.pendingLimit} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold">Activity</h2>
        <Card className="divide-y divide-line">
          {w.entries.map((e) => {
            const amt = e.cashKobo + e.creditKobo
            return (
              <div key={e.id} className="flex justify-between gap-3 px-4 py-3 text-sm">
                <div className="flex min-w-0 flex-col">
                  <span className="font-semibold">{e.memo}</span>
                  <span className="text-[11px] text-subtle">
                    {dateTime(e.createdAt)}
                    {e.creditKobo !== 0 && e.cashKobo !== 0 ? ` · ${formatNaira(Math.abs(e.creditKobo))} in credit` : e.creditKobo !== 0 ? ' · store credit' : ''}
                  </span>
                </div>
                <strong className={amt > 0 ? 'shrink-0 text-brand' : 'shrink-0'}>{formatNaira(amt, { signed: true })}</strong>
              </div>
            )
          })}
        </Card>
      </section>

      <AccountCard />
    </div>
  )
}

function LimitCard({ spent, limit, pending }: { spent: number; limit: number; pending: { amountKobo: number; effectiveAt: string } | null }) {
  const setLimit = useSetWeeklyLimit()
  const toast = useToast()
  const [value, setValue] = useState('')

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const amount = parseNairaInput(value)
    setLimit.mutate(amount, {
      onSuccess: () => {
        setValue('')
        toast(amount <= limit ? 'Limit lowered.' : `Your new limit starts in ${RULES.limitIncreaseDelayHours} hours.`)
      },
      onError: (err) => toast(errorMessage(err), 'error'),
    })
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex justify-between text-sm">
        <strong>Weekly spending limit</strong>
        <span className="text-subtle">
          {formatNaira(spent)} of {formatNaira(limit)}
        </span>
      </div>
      <ProgressBar value={spent} max={limit} hot={spent / limit >= 0.8} label="Spent this week" />
      {pending ? (
        <p className="text-xs text-brand-ink">
          Rising to {formatNaira(pending.amountKobo)} on {dateTime(pending.effectiveAt)}.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor="limit" className="sr-only">
          New weekly limit in naira
        </label>
        <input
          id="limit"
          inputMode="numeric"
          placeholder="New limit, e.g. 30,000"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-ground px-3 text-sm"
        />
        <Button type="submit" variant="outline" loading={setLimit.isPending} disabled={!parseNairaInput(value)}>
          Set
        </Button>
      </form>
      <p className="text-xs text-subtle">Lowering your limit takes effect now. Raising it waits {RULES.limitIncreaseDelayHours} hours.</p>
    </Card>
  )
}

function AccountCard() {
  const me = useMe()
  const update = useUpdateProfile()
  const demo = useDemoActions()
  if (!me.data) return null
  return (
    <Card className="flex flex-col gap-3 p-4">
      <strong className="text-sm">Account</strong>
      <div className="flex items-center justify-between gap-3 text-sm">
        <label htmlFor="state">State of residence</label>
        <select
          id="state"
          value={me.data.state}
          onChange={(e) => update.mutate({ state: e.target.value })}
          className="min-h-11 rounded-xl border border-line-strong bg-ground px-3"
        >
          {STATES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <p className="text-xs text-subtle">
        Tickets can only be bought in states where we hold a licence ({RULES.licensedStates.join(', ')}). In production this is checked with KYC, not a dropdown.
      </p>
      {api.testMode ? (
        <Button variant="danger" size="sm" className="self-start" loading={demo.reset.isPending} onClick={() => demo.reset.mutate()}>
          Reset demo data
        </Button>
      ) : null}
    </Card>
  )
}
