import { describe, expect, it } from 'vitest'
import { PURCHASE_ERROR_TEXT } from '@/domain/rules'
import { toApiError } from './supabase'

describe('toApiError', () => {
  it('maps purchase rule codes to their messages', () => {
    const e = toApiError({ message: 'weekly_limit', details: '', code: 'P0001' })
    expect(e.code).toBe('weekly_limit')
    expect(e.message).toBe(PURCHASE_ERROR_TEXT.weekly_limit)
  })

  it('prefers the database detail text when there is one', () => {
    const e = toApiError({ message: 'invalid_input', details: 'Pick a deadline between 3 and 60 days.', code: 'P0001' })
    expect(e).toMatchObject({ code: 'invalid_input', message: 'Pick a deadline between 3 and 60 days.' })
  })

  it('treats permission errors as forbidden', () => {
    expect(toApiError({ message: 'permission denied for table ledger_entries', details: '', code: '42501' }).code).toBe('forbidden')
  })

  it('passes anything else through as invalid input', () => {
    expect(toApiError({ message: 'something odd', details: '', code: 'XX000' })).toMatchObject({ code: 'invalid_input', message: 'something odd' })
  })
})
