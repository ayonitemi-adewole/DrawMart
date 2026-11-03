import { useState } from 'react'
import { useAdminRiders, useDispatchActions, useDispatchBoard } from '@/api/hooks'
import type { DispatchJob } from '@/api/types'
import { AlertIcon, CheckIcon, ClockIcon, PhoneIcon, TruckIcon, UserIcon } from '@/components/icons'
import { NoProductMatch, ProductId, ProductSearch } from '@/components/ProductId'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, PageTitle, Segmented, Skeleton, errorMessage } from '@/components/ui'
import { DISPATCH_STAGES, canAssign, canTakeBack, waitedText, type DispatchStage } from '@/domain/dispatch'
import { matchesProductSearch } from '@/domain/productCode'
import { NEW_RIDER_JOBS } from '@/domain/riderApplications'
import { areaName } from '@/domain/riderAlerts'
import { windowText } from '@/domain/deliveryWindows'
import { dateTime } from '@/lib/time'

type Filter = 'stuck' | 'all' | DispatchStage

const stageOf = (s: DispatchStage) => DISPATCH_STAGES.find((x) => x.stage === s)!

/** /admin/dispatch: every delivery and return on the move, with stuck ones first. */
export function AdminDispatchPage() {
  const q = useDispatchBoard()
  const [picked, setPicked] = useState<Filter | null>(null)
  const [search, setSearch] = useState('')
  const jobs = q.data?.jobs ?? []
  const stuck = jobs.filter((j) => j.stuck).length
  // Opens on the stuck jobs while there are any.
  const filter = picked ?? (stuck ? 'stuck' : 'all')
  const shown = jobs
    .filter((j) => (filter === 'all' ? true : filter === 'stuck' ? j.stuck : j.stage === filter))
    .filter((j) => matchesProductSearch(search, j.productCode, j.listingTitle, j.shopName, j.rider?.name ?? ''))

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        eyebrow="Admin"
        sub={
          q.data
            ? `Every delivery and return on the move. Flagged when waiting over ${q.data.waitingHours} hours for a rider, or carried for over ${q.data.carryingHours} without arriving. Updates every 30 seconds.`
            : 'Every delivery and return on the move.'
        }
        action={q.data ? <Badge tone={stuck ? 'hot' : 'brand'}>{stuck} stuck</Badge> : null}
      >
        Dispatch
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : jobs.length === 0 ? (
        <EmptyState icon={TruckIcon} title="Nothing on the move" body="Orders appear here once a seller marks them ready for a rider, and returns once they’re approved." />
      ) : (
        <div className="flex flex-col gap-4">
          <Segmented<Filter>
            label="Show"
            value={filter}
            onChange={setPicked}
            options={[
              { value: 'stuck', label: 'Stuck', count: stuck },
              { value: 'all', label: 'All', count: jobs.length },
              ...DISPATCH_STAGES.map((s) => ({ value: s.stage, label: s.label, count: jobs.filter((j) => j.stage === s.stage).length })),
            ]}
          />
          <ProductSearch value={search} onChange={setSearch} placeholder="Search by product ID, name, seller or rider" />
          {shown.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {shown.map((j) => (
                <JobCard key={`${j.kind}-${j.id}`} job={j} maxJobs={q.data.maxJobs} />
              ))}
            </div>
          ) : search.trim() ? (
            <NoProductMatch query={search} />
          ) : (
            <EmptyState icon={CheckIcon} title={filter === 'stuck' ? 'Nothing stuck' : 'None at this stage'} body="Choose another view to see the rest." />
          )}
        </div>
      )}
    </div>
  )
}

function JobCard({ job: j, maxJobs }: { job: DispatchJob; maxJobs: number }) {
  const [assigning, setAssigning] = useState(false)
  const [takingBack, setTakingBack] = useState(false)
  const stage = stageOf(j.stage)
  const to = j.kind === 'delivery' && j.fulfilment === 'pickup' && j.pickupPointName ? j.pickupPointName : areaName(j.toArea)

  return (
    <Card className={`flex flex-col gap-3 p-4 ${j.stuck ? 'ring-2 ring-hot' : ''}`}>
      <div className="flex items-start gap-3">
        {j.listingImage ? (
          <img src={j.listingImage} alt="" className="size-14 shrink-0 rounded-xl border border-line bg-photo object-cover" />
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-sunken text-muted">
            <TruckIcon size={20} />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {j.stuck ? (
              <Badge tone="hot">
                <AlertIcon size={12} /> Stuck
              </Badge>
            ) : null}
            <Badge tone="neutral">{stage.label}</Badge>
            {j.kind === 'return' ? <Badge tone="violet">Buyer’s return</Badge> : null}
            {j.isPrize ? <Badge tone="ticket">Won item</Badge> : null}
          </div>
          <strong className="truncate leading-tight">{j.listingTitle}</strong>
          <ProductId code={j.productCode} copy />
        </div>
      </div>

      <dl className="grid gap-1.5 text-sm">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-subtle">Route</dt>
          <dd className="min-w-0">
            {j.kind === 'return' ? `A buyer in ${areaName(j.fromArea)} → ${j.shopName}, ${areaName(j.toArea)}` : `${j.shopName}, ${areaName(j.fromArea)} → ${to}`}
          </dd>
        </div>
        {j.windowStart && j.windowEnd ? (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-subtle">Window</dt>
            <dd className="min-w-0">{windowText({ start: j.windowStart, end: j.windowEnd }, Date.now())}</dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-subtle">Status</dt>
          <dd className="flex min-w-0 flex-col">
            <span>
              {stage.hint}
              {j.since && Date.parse(j.since) > Date.now() ? (
                <span className="text-muted"> · from {dateTime(j.since)}, the buyer’s day</span>
              ) : j.since ? (
                <span className={j.stuck ? 'font-bold text-hot-ink' : 'text-muted'}>
                  {' '}
                  · <ClockIcon size={12} className="inline align-[-1px]" /> {waitedText(j.since, Date.now())}
                </span>
              ) : null}
            </span>
            {j.stage === 'failed' ? (
              <span className="text-xs text-subtle">
                {j.awaitingBuyer ? 'Waiting for the buyer to choose a new time or a pickup location.' : j.redeliverAt ? `Rebooked for ${dateTime(j.redeliverAt)}.` : 'The buyer chose a pickup location.'}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-subtle">Rider</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-3">
            {j.rider ? (
              <>
                <span>{j.rider.name}</span>
                {j.rider.phone ? (
                  <a href={`tel:${j.rider.phone.replace(/\s/g, '')}`} className="-my-2 flex min-h-11 items-center gap-1 font-bold text-brand-ink">
                    <PhoneIcon size={14} /> {j.rider.phone}
                  </a>
                ) : null}
              </>
            ) : (
              <span className="text-muted">Nobody yet</span>
            )}
          </dd>
        </div>
      </dl>

      {canAssign(j.stage) ? (
        <Button variant={j.stuck ? 'primary' : 'outline'} onClick={() => setAssigning(true)}>
          <UserIcon size={16} /> Assign a rider
        </Button>
      ) : canTakeBack(j.stage) ? (
        <Button variant="outline" onClick={() => setTakingBack(true)}>
          Take it back
        </Button>
      ) : null}
      {assigning ? <AssignSheet job={j} maxJobs={maxJobs} onClose={() => setAssigning(false)} /> : null}
      {takingBack ? <TakeBackSheet job={j} onClose={() => setTakingBack(false)} /> : null}
    </Card>
  )
}

function AssignSheet({ job: j, maxJobs, onClose }: { job: DispatchJob; maxJobs: number; onClose: () => void }) {
  const riders = useAdminRiders()
  const { assign } = useDispatchActions()
  const toast = useToast()
  const [choosing, setChoosing] = useState<string | null>(null)

  function pick(riderId: string, name: string) {
    setChoosing(riderId)
    // The card changes stage on refresh, so wait on the promise.
    assign
      .mutateAsync({ kind: j.kind, id: j.id, riderId })
      .then(() => {
        toast(`Given to ${name}. They’ve been told.`)
        onClose()
      })
      .catch((e) => toast(errorMessage(e), 'error'))
      .finally(() => setChoosing(null))
  }

  // Least busy first.
  const list = [...(riders.data ?? [])].sort((a, b) => a.holding - b.holding || a.name.localeCompare(b.name))
  return (
    <Sheet open onClose={() => !assign.isPending && onClose()} title="Assign a rider">
      <h2 className="pr-10 font-display text-2xl font-extrabold">Who should take it?</h2>
      <p className="text-sm text-muted">
        {j.listingTitle}, from {areaName(j.fromArea)}. They have the usual time to collect it, and new riders still can’t carry valuable orders or won items until {NEW_RIDER_JOBS} deliveries.
      </p>
      {riders.isPending ? (
        <Skeleton className="h-40" />
      ) : riders.isError ? (
        <ErrorState error={riders.error} onRetry={() => riders.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={TruckIcon} title="No riders yet" body="Add riders under Riders first." />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((r) => {
            const full = r.holding >= maxJobs
            return (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={full || assign.isPending}
                  onClick={() => pick(r.id, r.name)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {r.photo ? (
                    <img src={r.photo} alt="" className="size-10 shrink-0 rounded-full border border-line bg-photo object-cover" />
                  ) : (
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-muted">
                      <UserIcon size={18} />
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col text-sm">
                    <strong>{r.name}</strong>
                    <span className="text-xs text-subtle">
                      Holding {r.holding} of {maxJobs} · {r.completed} delivered
                    </span>
                  </span>
                  {choosing === r.id ? <span className="text-xs font-bold text-muted">Assigning…</span> : full ? <Badge tone="neutral">Full</Badge> : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Sheet>
  )
}

function TakeBackSheet({ job: j, onClose }: { job: DispatchJob; onClose: () => void }) {
  const { takeBack } = useDispatchActions()
  const toast = useToast()
  return (
    <Sheet open onClose={() => !takeBack.isPending && onClose()} title="Take this job back">
      <h2 className="pr-10 font-display text-2xl font-extrabold">Take it back from {j.rider?.name ?? 'the rider'}?</h2>
      <p className="text-sm text-muted">They haven’t collected it yet. It goes back in the pool for any rider, and they’re told they don’t need to collect it.</p>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" disabled={takeBack.isPending} onClick={onClose}>
          Leave it
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          loading={takeBack.isPending}
          onClick={() =>
            takeBack
              .mutateAsync({ kind: j.kind, id: j.id })
              .then(() => {
                toast('Back in the pool.', 'info')
                onClose()
              })
              .catch((e) => toast(errorMessage(e), 'error'))
          }
        >
          Take it back
        </Button>
      </div>
    </Sheet>
  )
}
