import { useState, type FormEvent } from 'react'
import { useBoostStatus, useBoosts, useSetBoostSettings } from '@/api/hooks'
import type { BoostSettings, BoostView } from '@/api/types'
import { TrendingUpIcon, UsersIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, PageTitle, ProgressBar, Skeleton, errorMessage, inputCls } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import { dateTime } from '@/lib/time'

/** /admin/boosts: when paid promotion unlocks, how many run at once, and every boost. */
export function AdminBoostsPage() {
  const status = useBoostStatus()
  const admin = status.data?.admin

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        eyebrow="Admin"
        sub="Sellers can pay to show a listing first, marked Sponsored. Boosts open once enough buyers are active, or when you switch them on."
        action={status.data ? <Badge tone={status.data.unlocked ? 'brand' : 'neutral'}>{status.data.unlocked ? 'Open to sellers' : 'Locked'}</Badge> : null}
      >
        Boosts
      </PageTitle>
      {status.isPending ? (
        <Skeleton className="h-60" />
      ) : status.isError ? (
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      ) : admin ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
          <div className="flex min-w-0 flex-col gap-5">
            <Card className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-sky-soft text-sky">
                  <UsersIcon size={20} />
                </span>
                <div className="flex flex-col">
                  <strong>Active buyers, last 30 days</strong>
                  <span className="text-xs text-subtle">Bought a ticket or an item, or topped up by card or bank.</span>
                </div>
              </div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-display text-3xl font-extrabold tabular-nums">{admin.activeBuyers.toLocaleString('en-NG')}</span>
                <span className="text-subtle">of {admin.minActiveBuyers.toLocaleString('en-NG')} to unlock</span>
              </div>
              <ProgressBar value={Math.min(admin.activeBuyers, admin.minActiveBuyers)} max={Math.max(1, admin.minActiveBuyers)} label="Active buyers towards the unlock threshold" />
              <span className="text-xs text-subtle">
                {status.data.slotsLeft} of {admin.maxActive} boost slots free. Packages:{' '}
                {status.data.packages.map((p) => `${p.days} days ${formatNaira(p.priceKobo)}`).join(' · ')} (change prices in the boost_packages table).
              </span>
            </Card>
            <BoostList />
          </div>
          <SettingsForm current={admin} />
        </div>
      ) : null}
    </div>
  )
}

function SettingsForm({ current }: { current: BoostSettings }) {
  const save = useSetBoostSettings()
  const toast = useToast()
  const [min, setMin] = useState(String(current.minActiveBuyers))
  const [max, setMax] = useState(String(current.maxActive))
  const [forced, setForced] = useState(current.forcedOn)
  const minN = Number(min)
  const maxN = Number(max)
  const valid = Number.isInteger(minN) && minN >= 0 && Number.isInteger(maxN) && maxN >= 1

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    save.mutate({ minActiveBuyers: minN, forcedOn: forced, maxActive: maxN }, { onSuccess: () => toast('Boost settings saved.'), onError: (err) => toast(errorMessage(err), 'error') })
  }

  return (
    <Card className="flex flex-col gap-4 p-5 lg:sticky lg:top-8">
      <strong>Settings</strong>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Active buyers needed to unlock" htmlFor="boost-min">
          <input id="boost-min" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} className={inputCls} />
        </Field>
        <Field label="Boosts running at once" htmlFor="boost-max" hint="Keep it small so Sponsored stays useful to buyers and worth paying for.">
          <input id="boost-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} className={inputCls} />
        </Field>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl bg-ground p-3 text-sm">
          <input type="checkbox" checked={forced} onChange={(e) => setForced(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
          <span>
            <strong>Open boosts now</strong>
            <span className="block text-xs text-subtle">Let sellers buy boosts before the threshold is reached.</span>
          </span>
        </label>
        <Button type="submit" loading={save.isPending} disabled={!valid}>
          Save settings
        </Button>
      </form>
    </Card>
  )
}

const STATUS: Record<BoostView['status'], string> = { pending: 'Awaiting payment', paid: 'Paid', failed: 'Payment failed', cancelled: 'Cancelled' }

function BoostList() {
  const q = useBoosts()
  const now = new Date().toISOString()
  if (q.isPending) return <Skeleton className="h-40" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (q.data.length === 0) return <EmptyState icon={TrendingUpIcon} title="No boosts yet" body="Paid boosts will show up here." />
  return (
    <Card className="divide-y divide-line overflow-hidden">
      {q.data.map((b) => {
        const running = b.status === 'paid' && !!b.endsAt && b.endsAt > now
        return (
          <div key={b.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <div className="flex min-w-0 flex-1 flex-col">
              <strong className="truncate">{b.listingTitle}</strong>
              <span className="text-xs text-subtle">
                {b.merchantName} · {b.days} days · {formatNaira(b.priceKobo)}
                {b.endsAt ? ` · ${running ? 'until' : 'ended'} ${dateTime(b.endsAt)}` : ''}
              </span>
            </div>
            <Badge tone={running ? 'ticket' : b.status === 'failed' ? 'hot' : 'neutral'}>{running ? 'Running' : b.status === 'paid' ? 'Finished' : STATUS[b.status]}</Badge>
          </div>
        )
      })}
    </Card>
  )
}
