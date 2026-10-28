import { describe, expect, it } from 'vitest'
import {
  addDays,
  cautionFeeFor,
  daysBetween,
  handoverMethodFor,
  isNigerianMobile,
  settleCautionFee,
  validateHandover,
  validateListingTerms,
} from './listing'
import { nairaToKobo as k } from './money'

describe('handover and caution fee', () => {
  it('inspects cars where they are and picks everything else up', () => {
    expect(handoverMethodFor('Cars')).toBe('inspection')
    expect(handoverMethodFor('Phones')).toBe('pickup')
    expect(cautionFeeFor('Cars')).toBeGreaterThan(cautionFeeFor('Phones'))
  })

  it('refunds the caution fee on a sell-out and keeps it otherwise', () => {
    const held = { amountKobo: k(2_500), status: 'held' as const }
    expect(settleCautionFee(held, 'drawn').status).toBe('refunded')
    expect(settleCautionFee(held, 'refunded').status).toBe('kept')
    expect(settleCautionFee(held, 'for_sale').status).toBe('kept')
    expect(settleCautionFee(held, 'rejected').status).toBe('kept')
    expect(settleCautionFee(held, 'live').status).toBe('held')
    // Settled once, never flips.
    expect(settleCautionFee({ ...held, status: 'kept' }, 'drawn').status).toBe('kept')
  })
})

describe('validateListingTerms', () => {
  it('accepts a custom deadline within range', () => {
    expect(validateListingTerms({ durationDays: 21, unsoldPolicy: 'refund' })).toEqual([])
  })
  it('rejects deadlines that are too short, too long or fractional', () => {
    for (const d of [2, 61, 7.5]) expect(validateListingTerms({ durationDays: d, unsoldPolicy: 'refund' })).toContain('duration_out_of_range')
  })
  it('needs a fallback price when the item stays on sale', () => {
    expect(validateListingTerms({ durationDays: 7, unsoldPolicy: 'convert_to_sale' })).toContain('fallback_price_required')
    expect(validateListingTerms({ durationDays: 7, unsoldPolicy: 'convert_to_sale', fallbackPriceKobo: 0 })).toContain('fallback_price_required')
    expect(validateListingTerms({ durationDays: 7, unsoldPolicy: 'convert_to_sale', fallbackPriceKobo: k(900_000) })).toEqual([])
  })
})

describe('validateHandover', () => {
  const today = '2026-10-28'
  const ok = { address: '12 Allen Avenue, Ikeja', contactPhone: '0803 123 4567', date: '2026-10-30', slot: 'morning' as const }

  it('accepts a complete booking', () => {
    expect(validateHandover(ok, today)).toEqual([])
  })
  it('flags a missing address, bad phone and out-of-range dates', () => {
    expect(validateHandover({ ...ok, address: 'Ikeja' }, today)).toContain('address_required')
    expect(validateHandover({ ...ok, contactPhone: '12345' }, today)).toContain('phone_invalid')
    expect(validateHandover({ ...ok, date: today }, today)).toContain('date_out_of_range')
    expect(validateHandover({ ...ok, date: '2026-11-20' }, today)).toContain('date_out_of_range')
  })
  it('understands common phone formats', () => {
    expect(isNigerianMobile('+234 803 123 4567')).toBe(true)
    expect(isNigerianMobile('07011234567')).toBe(true)
    expect(isNigerianMobile('0603 123 4567')).toBe(false)
  })
  it('does date maths across month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(daysBetween('2026-10-28', '2026-11-27')).toBe(30)
  })
})
