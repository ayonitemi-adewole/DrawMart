import { useState } from 'react'
import { useIncidentActions, useMyOpenIncidents } from '@/api/hooks'
import type { DispatchJobKind } from '@/api/types'
import { AlertIcon, PhoneIcon } from '@/components/icons'
import { RiderPhotos } from '@/components/RiderPhotos'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Button, Field, Notice, buttonClass, cx, errorMessage, inputCls } from '@/components/ui'
import { EMERGENCY_NUMBER, INCIDENT_NOTE_MAX, INCIDENT_TYPES, incidentLabel, incidentNoteError, type IncidentType } from '@/domain/incidents'
import type { GeoPoint } from '@/domain/types'

/** Where the phone is, if it can tell quickly. Never holds up the report itself. */
function whereAmI(): Promise<GeoPoint | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  })
}

const CallEmergency = () => (
  <a href={`tel:${EMERGENCY_NUMBER}`} className={cx(buttonClass('danger'), 'w-full no-underline')}>
    <PhoneIcon size={16} /> Call {EMERGENCY_NUMBER} (emergency)
  </a>
)

/** On a job page: one tap tells DrawMart something's wrong (incidents.ts). Details can follow. */
export function ReportProblem({ kind, id }: { kind: DispatchJobKind; id: string }) {
  const mine = useMyOpenIncidents()
  const { report } = useIncidentActions()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reportedId, setReportedId] = useState<string | null>(null)
  const existing = mine.data?.[id]

  function send(type: IncidentType) {
    const sent = report.mutateAsync({ kind, id, type, at: null })
    sent.then(setReportedId, (e) => toast(errorMessage(e), 'error'))
    return sent
  }

  return (
    <>
      {existing ? (
        <Notice tone="hot" icon={AlertIcon} title={`Paused: you reported “${incidentLabel(existing.type)}”`}>
          <span className="flex flex-col gap-3">
            <span>DrawMart has been told and will call you. Carry on with this job only if it’s safe.</span>
            <Button variant="outline" size="sm" className="min-h-11 w-fit" onClick={() => { setReportedId(existing.id); setOpen(true) }}>
              Add a note or photo
            </Button>
          </span>
        </Notice>
      ) : (
        <Button variant="danger" className="w-full" onClick={() => setOpen(true)}>
          <AlertIcon size={16} /> Report a problem
        </Button>
      )}
      <Sheet open={open} onClose={() => { setOpen(false); setReportedId(null) }} title={reportedId ? 'DrawMart has been told' : 'What happened?'}>
        {reportedId ? <Details incidentId={reportedId} onDone={() => { setOpen(false); setReportedId(null) }} /> : <Choose onChoose={send} pending={report.isPending} />}
      </Sheet>
    </>
  )
}

/** One tap each: nothing else to fill in before DrawMart knows. */
function Choose({ onChoose, pending }: { onChoose: (t: IncidentType) => Promise<string>; pending: boolean }) {
  const { addDetails } = useIncidentActions()
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Tap one and we’re told straight away. You can add more after.</p>
      {INCIDENT_TYPES.map((t) => (
        <Button
          key={t.type}
          variant="outline"
          size="lg"
          className="min-h-14 w-full justify-start"
          disabled={pending}
          onClick={() => {
            const sent = onChoose(t.type)
            // Where they are follows on its own, if the phone can tell.
            void Promise.all([sent, whereAmI()]).then(([incidentId, at]) => (at ? addDetails.mutate({ id: incidentId, details: { at } }) : undefined), () => undefined)
          }}
        >
          <AlertIcon size={18} className="text-hot" /> {t.label}
        </Button>
      ))}
      <CallEmergency />
    </div>
  )
}

function Details({ incidentId, onDone }: { incidentId: string; onDone: () => void }) {
  const { addDetails } = useIncidentActions()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const problem = incidentNoteError(note)
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="hot" icon={AlertIcon}>If you’re hurt or in danger, call {EMERGENCY_NUMBER} first. DrawMart will call you. The job is paused, so nothing runs out while we sort it.</Notice>
      <CallEmergency />
      <Field label="What happened? Optional" htmlFor="incident-note" error={problem ?? undefined}>
        <textarea id="incident-note" rows={3} maxLength={INCIDENT_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
      </Field>
      <RiderPhotos photos={photos} onChange={setPhotos} max={1} label="Add a photo" />
      <Button
        loading={addDetails.isPending}
        disabled={!!problem}
        onClick={() => {
          if (!note.trim() && !photos.length) return onDone()
          addDetails.mutateAsync({ id: incidentId, details: { note, photo: photos[0] } }).then(
            () => {
              toast('Added to your report.')
              onDone()
            },
            (e) => toast(errorMessage(e), 'error'),
          )
        }}
      >
        Done
      </Button>
    </div>
  )
}
