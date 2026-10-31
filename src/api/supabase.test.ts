import { describe, expect, it } from 'vitest'
import { PURCHASE_ERROR_TEXT } from '@/domain/rules'
import { toApiError, toResultView } from './supabase'

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

describe('toResultView', () => {
  const r = { listing_id: 'l1', commitment: 'c', seed: 's', closing_ref: 'P-1', winning_number: 4, drawn_at: '2026-10-02T00:00:00Z' }
  const listing = { product_code: 'PRD-222222', title: 'Phone', images: [], ticket_count: 200 }
  const mine = (numbers: number[]) => ({ numbers: new Map([['l1', numbers]]), credits: new Map([['l1', 100]]) })

  it('works out "you won" from your own tickets', () => {
    expect(toResultView(r, listing, 'u1', mine([3, 4]))).toMatchObject({ iWon: true, winnerUserId: 'u1', myNumbers: [3, 4] })
  })

  it('never names anyone else as the winner', () => {
    expect(toResultView(r, listing, 'u1', mine([5]))).toMatchObject({ iWon: false, winnerUserId: '', myCreditKobo: 100 })
    expect(toResultView(r, listing, null, { numbers: new Map(), credits: new Map() })).toMatchObject({ iWon: false, winnerUserId: '' })
  })
})
