import { useState } from 'react'
import { useIncidentActions, useOpenIncidents } from '@/api/hooks'
import type { OpenIncident } from '@/api/types'
import { AlertIcon, MapPinIcon, PhoneIcon } from '@/components/icons'
import { ProductId } from '@/components/ProductId'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, Field, Notice, cx, errorMessage, inputCls } from '@/components/ui'
import { INCIDENT_OUTCOMES, incidentLabel, resolveIncidentError, type IncidentOutcome } from '@/domain/incidents'
import { directionsUrl } from '@/domain/location'
import { dateTime } from '@/lib/time'

/** Top of the dispatch board: riders' open reports, oldest first (incidents.ts). */
export function IncidentList() {
  const q = useOpenIncidents()
  if (!q.data?.length) return null
  return (
    <section className="flex flex-col gap-3" aria-labelledby="incidents-title">
      <h2 id="incidents-title" className="flex items-center gap-2 font-display text-xl font-extrabold text-hot-ink">
        <AlertIcon size={20} /> {q.data.length === 1 ? 'A rider reported a problem' : `${q.data.length} riders reported problems`}
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {q.data.map((i) => (
          <IncidentCard key={i.id} incident={i} />
        ))}
      </div>
    </section>
  )
}

function IncidentCard({ incident: i }: { incident: OpenIncident }) {
  const [closing, setClosing] = useState(false)
  return (
    <Card className="flex flex-col gap-3 border-hot p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="hot">
          <AlertIcon size={12} /> {incidentLabel(i.type)}
        </Badge>
        {i.kind === 'return' ? <Badge tone="violet">Buyer’s return</Badge> : null}
        {i.isPrize ? <Badge tone="ticket">Won item</Badge> : null}
        <span className="text-xs text-subtle">{dateTime(i.createdAt)}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <strong className="leading-tight">{i.listingTitle}</strong>
        <ProductId code={i.productCode} copy />
        <span className="text-xs text-subtle">{i.collected ? 'The rider had collected it.' : 'Not collected yet.'}</span>
      </div>
      {i.note ? <p className="rounded-2xl bg-ground p-3">{i.note}</p> : null}
      {i.photo ? <img src={i.photo} alt="The rider’s photo" className="max-h-48 w-fit rounded-xl border border-line bg-photo object-cover" /> : null}
      <div className="flex flex-wrap gap-x-4">
        {i.rider?.phone ? (
          <a href={`tel:${i.rider.phone.replace(/\s/g, '')}`} className="flex min-h-11 items-center gap-1 font-bold">
            <PhoneIcon size={14} /> Call {i.rider.name}
          </a>
        ) : i.rider ? <span className="flex min-h-11 items-center">{i.rider.name}</span> : null}
        {i.location ? (
          <a href={directionsUrl(i.location)} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-1 font-bold">
            <MapPinIcon size={14} /> Where they were
          </a>
        ) : null}
      </div>
      <Button variant="outline" className="w-fit" onClick={() => setClosing(true)}>
        Close this report
      </Button>
      <CloseIncident incident={i} open={closing} onClose={() => setClosing(false)} />
    </Card>
  )
}

function CloseIncident({ incident: i, open, onClose }: { incident: OpenIncident; open: boolean; onClose: () => void }) {
  const { resolve } = useIncidentActions()
  const toast = useToast()
  const [outcome, setOutcome] = useState<IncidentOutcome>('carry_on')
  const [note, setNote] = useState('')
  const problem = resolveIncidentError(outcome, { kind: i.kind, isPrize: i.isPrize, status: i.orderStatus })
  return (
    <Sheet open={open} onClose={onClose} title="Close this report">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (problem) return
          resolve.mutateAsync({ id: i.id, outcome, note }).then(
            () => {
              toast(outcome === 'refund' ? 'Buyer refunded and report closed.' : 'Report closed.')
              onClose()
            },
            (err) => toast(errorMessage(err), 'error'),
          )
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-bold">What happens next?</legend>
          {INCIDENT_OUTCOMES.map((o) => (
            <label key={o.outcome} className={cx('flex min-h-11 cursor-pointer gap-3 rounded-2xl border p-3.5 text-sm transition', outcome === o.outcome ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong')}>
              <input type="radio" name="incident-outcome" checked={outcome === o.outcome} onChange={() => setOutcome(o.outcome)} className="mt-1 size-4 shrink-0 accent-brand" />
              <span className="flex flex-col gap-0.5">
                <strong>{o.label}</strong>
                <span className="text-xs text-subtle">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {problem ? <Notice tone="ticket">{problem}</Notice> : null}
        <Field label="Note for the record (optional)" htmlFor="incident-resolution">
          <textarea id="incident-resolution" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        </Field>
        <Button type="submit" loading={resolve.isPending} disabled={!!problem} variant={outcome === 'refund' ? 'danger' : 'primary'}>
          {outcome === 'refund' ? 'Refund the buyer and close' : 'Close the report'}
        </Button>
      </form>
    </Sheet>
  )
}
