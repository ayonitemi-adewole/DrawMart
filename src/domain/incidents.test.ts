import { describe, expect, it } from 'vitest'
import { INCIDENT_NOTE_MAX, incidentLabel, incidentNoteError, resolveIncidentError, sellerStillPaid } from './incidents'

describe('incidents', () => {
  it('keeps notes short and names each kind plainly', () => {
    expect(incidentNoteError('')).toBeNull()
    expect(incidentNoteError('x'.repeat(INCIDENT_NOTE_MAX))).toBeNull()
    expect(incidentNoteError('x'.repeat(INCIDENT_NOTE_MAX + 1))).toMatch(/Keep it/)
    expect(incidentLabel('damaged')).toBe('Package damaged')
  })

  it('refunds only orders still on their way, never won items or returns', () => {
    const order = { kind: 'delivery' as const, isPrize: false, status: 'dispatched' }
    expect(resolveIncidentError('refund', order)).toBeNull()
    expect(resolveIncidentError('carry_on', { ...order, kind: 'return' })).toBeNull()
    expect(resolveIncidentError('refund', { ...order, kind: 'return' })).toMatch(/return/)
    expect(resolveIncidentError('refund', { ...order, isPrize: true })).toMatch(/Won items/)
    expect(resolveIncidentError('refund', { ...order, status: 'cancelled' })).toMatch(/on their way/)
  })

  it('still pays the seller once the rider had it', () => {
    expect(sellerStillPaid(true)).toBe(true)
    expect(sellerStillPaid(false)).toBe(false)
  })
})
