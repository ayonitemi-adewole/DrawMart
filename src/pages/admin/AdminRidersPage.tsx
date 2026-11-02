import { useState, type FormEvent } from 'react'
import { useAdminRiders, useRiderAdminActions, useRiderApplications, useRiderFleets, useRiderSignupsOpen } from '@/api/hooks'
import type { AdminRider, RiderApplicationView, RiderFleet } from '@/api/types'
import { CheckIcon, LockIcon, TruckIcon, UserIcon, UsersIcon, XIcon } from '@/components/icons'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, PageTitle, Skeleton, Switch, errorMessage, inputCls } from '@/components/ui'
import { NEW_RIDER_JOBS, VEHICLE_TEXT } from '@/domain/riderApplications'
import { areaName } from '@/domain/riderAlerts'
import { dateTime } from '@/lib/time'

/** /admin/riders: the sign-up switch, applications, fleets, and every rider. */
export function AdminRidersPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Admin" sub="Who can deliver for DrawMart. Keep sign-up closed until riders can be licensed and insured.">
        Riders
      </PageTitle>
      <SignupSwitch />
      <Applications />
      <Fleets />
      <RiderList />
    </div>
  )
}

function SignupSwitch() {
  const open = useRiderSignupsOpen()
  const { setOpen } = useRiderAdminActions()
  const toast = useToast()
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sunken text-muted">
        <LockIcon size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-sm">
        <strong id="rider-signups-label">Rider sign-up {open.data ? 'is open' : 'is closed'}</strong>
        <span className="text-xs text-subtle">
          {open.data ? 'Anyone with a new account can apply at /ride.' : 'Nobody can apply. Riders are only added by hand, e.g. a partner’s.'}
        </span>
      </span>
      <Switch
        checked={!!open.data}
        labelledBy="rider-signups-label"
        disabled={open.isPending || setOpen.isPending}
        onChange={() => setOpen.mutateAsync(!open.data).then(() => toast(open.data ? 'Rider sign-up closed.' : 'Rider sign-up is open.')).catch((e) => toast(errorMessage(e), 'error'))}
      />
    </Card>
  )
}

function Applications() {
  const q = useRiderApplications()
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-extrabold">Applications</h2>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={CheckIcon} title="Nothing to review" body="Applications appear here while sign-up is open." />
      ) : (
        q.data.map((a) => <Application key={a.id} application={a} />)
      )}
    </section>
  )
}

function Application({ application: a }: { application: RiderApplicationView }) {
  const { review } = useRiderAdminActions()
  const toast = useToast()
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const onError = (e: unknown) => toast(errorMessage(e), 'error')
  const rows: [string, string][] = [
    ['NIN', a.nin],
    ['Phone', a.phone],
    ['Address', a.address],
    ['Area', areaName(a.area)],
    ['Vehicle', `${VEHICLE_TEXT[a.vehicle]}${a.plate ? ` · ${a.plate}` : ''}`],
    ['Guarantor', `${a.guarantorName} (${a.guarantorRelationship}) · ${a.guarantorPhone}`],
  ]

  function onReject(e: FormEvent) {
    e.preventDefault()
    review
      .mutateAsync({ id: a.id, approve: false, note })
      .then(() => {
        setRejecting(false)
        toast('Sent back.', 'info')
      })
      .catch(onError)
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <strong className="text-lg leading-tight">{a.fullName}</strong>
        <span className="text-xs text-subtle">Sent {dateTime(a.updatedAt)}</span>
      </div>
      <dl className="grid gap-2 rounded-2xl bg-ground p-4 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col">
            <dt className="text-xs text-subtle">{k}</dt>
            <dd className="font-bold break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ['ID', a.idPhotoUrl],
          ['Selfie holding the ID', a.selfieUrl],
        ].map(([label, url]) => (
          <figure key={label} className="flex flex-col gap-1">
            {url ? <img src={url} alt={`${a.fullName}: ${label}`} className="aspect-[4/3] w-full rounded-xl border border-line bg-photo object-contain" /> : <Skeleton className="aspect-[4/3]" />}
            <figcaption className="text-xs text-subtle">{label}</figcaption>
          </figure>
        ))}
      </div>
      <Notice tone="neutral" icon={UserIcon}>
        Check the name and photo match the ID and the selfie, the NIN looks right, and call the guarantor.
      </Notice>
      <div className="flex flex-wrap gap-2">
        <Button loading={review.isPending && review.variables?.approve} onClick={() => review.mutateAsync({ id: a.id, approve: true }).then(() => toast('Approved. They’ve been told.')).catch(onError)}>
          <CheckIcon size={16} /> Approve
        </Button>
        <Button variant="outline" onClick={() => setRejecting(true)}>
          <XIcon size={16} /> Send back
        </Button>
      </div>
      <Sheet open={rejecting} onClose={() => !review.isPending && setRejecting(false)} title="Send back">
        <h2 className="pr-10 font-display text-2xl font-extrabold">Send back to {a.fullName}</h2>
        <form onSubmit={onReject} noValidate className="flex flex-col gap-4">
          <Field label="What to fix" htmlFor={`reject-${a.id}`} hint="They see this, and can send it again.">
            <textarea id={`reject-${a.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </Field>
          <Button type="submit" loading={review.isPending}>
            Send back
          </Button>
        </form>
      </Sheet>
    </Card>
  )
}

function Fleets() {
  const q = useRiderFleets()
  const { createFleet } = useRiderAdminActions()
  const toast = useToast()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  function onCreate(e: FormEvent) {
    e.preventDefault()
    createFleet
      .mutateAsync({ name, phone })
      .then(() => {
        setName('')
        setPhone('')
        toast('Fleet added. Assign riders to it below.')
      })
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-extrabold">Fleets</h2>
        <p className="text-sm text-muted">A partner company’s riders, grouped. A trusted fleet’s riders skip the new-rider limits, since the fleet vouches for them.</p>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data?.map((f) => <FleetRow key={f.id} fleet={f} />)}
      <Card className="p-4">
        <form onSubmit={onCreate} noValidate className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Fleet name" htmlFor="fleet-name">
            <input id="fleet-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. a logistics partner" />
          </Field>
          <Field label="Contact phone" htmlFor="fleet-phone">
            <input id="fleet-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="0803 123 4567" />
          </Field>
          <Button type="submit" loading={createFleet.isPending}>
            <UsersIcon size={16} /> Add fleet
          </Button>
        </form>
      </Card>
    </section>
  )
}

function FleetRow({ fleet: f }: { fleet: RiderFleet }) {
  const { setFleetTrusted } = useRiderAdminActions()
  const toast = useToast()
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex min-w-0 flex-1 flex-col text-sm">
        <strong id={`fleet-${f.id}`}>{f.name}</strong>
        <span className="text-xs text-subtle">
          {f.contactPhone} · {f.trusted ? 'Trusted' : 'Its riders start with the new-rider limits'}
        </span>
      </span>
      <Switch checked={f.trusted} labelledBy={`fleet-${f.id}`} disabled={setFleetTrusted.isPending} onChange={() => setFleetTrusted.mutateAsync({ id: f.id, trusted: !f.trusted }).catch((e) => toast(errorMessage(e), 'error'))} />
    </Card>
  )
}

function RiderList() {
  const q = useAdminRiders()
  const fleets = useRiderFleets()
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-extrabold">All riders</h2>
        <p className="text-sm text-muted">New riders can’t carry valuable orders or won items until {NEW_RIDER_JOBS} deliveries. Trust one to lift that now.</p>
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={TruckIcon} title="No riders yet" body="Approved applicants and accounts made by hand appear here." />
      ) : (
        <Card className="divide-y divide-line">
          {q.data.map((r) => (
            <RiderRow key={r.id} rider={r} fleets={fleets.data ?? []} />
          ))}
        </Card>
      )}
    </section>
  )
}

function RiderRow({ rider: r, fleets }: { rider: AdminRider; fleets: RiderFleet[] }) {
  const { setFleet, setTrusted } = useRiderAdminActions()
  const toast = useToast()
  const onError = (e: unknown) => toast(errorMessage(e), 'error')
  const fleetTrusted = !!fleets.find((f) => f.id === r.fleetId)?.trusted
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      {r.photo ? (
        <img src={r.photo} alt="" className="size-10 shrink-0 rounded-full border border-line bg-photo object-cover" />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-muted">
          <UserIcon size={18} />
        </span>
      )}
      <span className="flex min-w-40 flex-1 flex-col text-sm">
        <strong id={`rider-${r.id}`}>{r.name}</strong>
        <span className="flex flex-wrap items-center gap-2 text-xs text-subtle">
          {r.completed} delivered · holding {r.holding}
          {r.trusted || fleetTrusted || r.completed >= NEW_RIDER_JOBS ? <Badge tone="brand">Any job</Badge> : <Badge tone="ticket">New rider</Badge>}
        </span>
      </span>
      <label htmlFor={`rider-fleet-${r.id}`} className="sr-only">
        Fleet for {r.name}
      </label>
      <select
        id={`rider-fleet-${r.id}`}
        value={r.fleetId ?? ''}
        disabled={setFleet.isPending}
        onChange={(e) => setFleet.mutateAsync({ riderId: r.id, fleetId: e.target.value || null }).catch(onError)}
        className={`${inputCls} w-auto`}
      >
        <option value="">No fleet</option>
        {fleets.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="size-5 accent-brand" checked={r.trusted} disabled={setTrusted.isPending} onChange={() => setTrusted.mutateAsync({ riderId: r.id, trusted: !r.trusted }).catch(onError)} />
        Trusted
      </label>
    </div>
  )
}
