/**
 * Safety and incident reports. During a job a rider can report an accident, a theft,
 * a threat, or the package getting damaged on the way, with one tap; a note, a photo
 * and where they are can follow. Admins are told at once (a push, and the top of the
 * dispatch board). The job is paused, so no deadline moves it while it's looked into,
 * and the order is marked, so the seller isn't charged if the buyer then refuses it.
 * An admin closes it: carry on, or refund the buyer in full (cancel reason
 * `incident`), with the seller still paid if the rider had already collected it.
 * Mirrored in public.report_incident, add_incident_details, resolve_incident and
 * private.penalise_seller.
 */
export type IncidentType = 'accident' | 'theft' | 'threat' | 'damaged'

export const INCIDENT_TYPES: { type: IncidentType; label: string; told: string }[] = [
  { type: 'accident', label: 'I’ve had an accident', told: 'Accident' },
  { type: 'theft', label: 'It’s been stolen', told: 'Theft' },
  { type: 'threat', label: 'I’m being threatened', told: 'Threat' },
  { type: 'damaged', label: 'The package got damaged', told: 'Package damaged' },
]

export const incidentLabel = (t: IncidentType) => INCIDENT_TYPES.find((x) => x.type === t)?.told ?? t

export type IncidentOutcome = 'carry_on' | 'refund'

export const INCIDENT_OUTCOMES: { outcome: IncidentOutcome; label: string; hint: string }[] = [
  { outcome: 'carry_on', label: 'Carry on', hint: 'The job goes ahead as normal.' },
  { outcome: 'refund', label: 'Refund the buyer', hint: 'Cancels the order and refunds the buyer in full, delivery too. The seller is still paid if the rider had collected it.' },
]

export const INCIDENT_NOTE_MAX = 500
/** Nigeria's emergency number. */
export const EMERGENCY_NUMBER = '112'

export function incidentNoteError(note: string): string | null {
  return note.trim().length > INCIDENT_NOTE_MAX ? `Keep it to ${INCIDENT_NOTE_MAX} characters.` : null
}

/** Refunds are for orders still on their way to the buyer, not won items or buyers' returns. */
export function resolveIncidentError(outcome: IncidentOutcome, job: { kind: 'delivery' | 'return'; isPrize: boolean; status: string }): string | null {
  if (outcome === 'carry_on') return null
  if (job.kind === 'return') return 'A buyer’s return has been refunded already. Choose carry on, and sort anything else out by phone.'
  if (job.isPrize) return 'Won items can’t be refunded here. Choose carry on, and contact the winner.'
  if (job.status !== 'dispatched') return 'Only orders on their way to the buyer can be refunded here.'
  return null
}

/** The item left the seller as it should, so what happened next isn't theirs to pay for. */
export const sellerStillPaid = (collected: boolean) => collected
