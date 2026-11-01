import { describe, expect, it } from 'vitest'
import { cautionFeeFor } from './listing'
import { newRejection, REJECTION_NOTE_MAX, rejectionError, rejectionReasonsFor, rejectionReasonText, resentCautionFee } from './rejection'

describe('rejection reasons', () => {
  it('needs a reason, and a note only for "other"', () => {
    expect(rejectionError('raffle', { reason: null, note: 'A clear note' })).toBe('reason_required')
    expect(rejectionError('raffle', { reason: 'photos_unclear', note: '' })).toBeNull()
    expect(rejectionError('raffle', { reason: 'other', note: '  no ' })).toBe('note_required')
    expect(rejectionError('raffle', { reason: 'other', note: 'Wrong item in the photos' })).toBeNull()
    expect(rejectionError('raffle', { reason: 'price_wrong', note: 'x'.repeat(REJECTION_NOTE_MAX + 1) })).toBe('note_too_long')
  })

  it('has no escrow check for regular products', () => {
    expect(rejectionReasonsFor('raffle')).toContain('failed_escrow_check')
    expect(rejectionReasonsFor('product')).not.toContain('failed_escrow_check')
    expect(rejectionError('product', { reason: 'failed_escrow_check', note: '' })).toBe('reason_required')
  })

  it('calls it an inspection for cars', () => {
    expect(rejectionReasonText('failed_escrow_check', 'Phones')).toBe('Failed the escrow check')
    expect(rejectionReasonText('failed_escrow_check', 'Cars')).toBe('Failed the inspection')
  })

  it('stores a blank note as none', () => {
    expect(newRejection('price_wrong', '   ')).toEqual({ reason: 'price_wrong', note: null })
    expect(newRejection('other', ' Too blurry ')).toEqual({ reason: 'other', note: 'Too blurry' })
  })
})

describe('caution fee on a resent draw', () => {
  it('keeps what was paid, and only rises with a dearer category', () => {
    expect(resentCautionFee(cautionFeeFor('Phones'), 'Phones')).toBe(cautionFeeFor('Phones'))
    expect(resentCautionFee(cautionFeeFor('Phones'), 'Cars')).toBe(cautionFeeFor('Cars'))
    expect(resentCautionFee(cautionFeeFor('Cars'), 'Phones')).toBe(cautionFeeFor('Cars'))
  })
})
