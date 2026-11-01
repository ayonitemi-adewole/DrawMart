import { describe, expect, it } from 'vitest'
import { canChangeInReview, hasLivePage, withdrawalFees } from './listingActions'
import { cautionFeeFor } from './listing'
import type { Handover } from './types'

const handover = (date: string) => ({ date }) as Handover
const held = (amountKobo: number) => ({ amountKobo, status: 'held' as const })

describe('listing actions', () => {
  it('only has a live page once buyers can see it', () => {
    for (const s of ['live', 'for_sale', 'sold', 'drawn'] as const) expect(hasLivePage(s)).toBe(true)
    for (const s of ['pending_review', 'rejected', 'withdrawn'] as const) expect(hasLivePage(s)).toBe(false)
  })

  it('locks a draw on its pickup day, and anything once it leaves review', () => {
    const draw = { kind: 'raffle' as const, status: 'pending_review' as const }
    expect(canChangeInReview({ ...draw, handover: handover('2026-11-03') }, '2026-11-02')).toBe(true)
    expect(canChangeInReview({ ...draw, handover: handover('2026-11-02') }, '2026-11-02')).toBe(false)
    expect(canChangeInReview({ ...draw, status: 'live', handover: handover('2026-11-03') }, '2026-11-02')).toBe(false)
    expect(canChangeInReview({ kind: 'product', status: 'pending_review', handover: null }, '2026-11-02')).toBe(true)
    expect(canChangeInReview({ kind: 'product', status: 'for_sale', handover: null }, '2026-11-02')).toBe(false)
  })
})

describe('caution fee on a withdrawal', () => {
  const phones = cautionFeeFor('Phones')
  const home = cautionFeeFor('Home')

  it('refunds a draw on its own, unless it was rejected first', () => {
    expect(withdrawalFees(held(phones), false, null).withdrawn).toEqual({ amountKobo: phones, status: 'refunded' })
    expect(withdrawalFees(held(phones), true, null).withdrawn).toEqual({ amountKobo: phones, status: 'kept' })
  })

  it('leaves a product with no fee', () => {
    expect(withdrawalFees({ amountKobo: 0, status: 'none' }, false, null).withdrawn.status).toBe('none')
  })

  it('gives back only what a shared pickup’s fee drops by', () => {
    expect(withdrawalFees(held(home), false, ['Phones'])).toEqual({ withdrawn: { amountKobo: home - phones, status: 'refunded' }, remainingKobo: phones })
    expect(withdrawalFees(held(phones), false, ['Home'])).toEqual({ withdrawn: { amountKobo: 0, status: 'none' }, remainingKobo: phones })
    expect(withdrawalFees(held(home), false, ['Home'])).toEqual({ withdrawn: { amountKobo: 0, status: 'none' }, remainingKobo: home })
  })

  it('refunds the whole fee when the last item of a pickup leaves', () => {
    expect(withdrawalFees(held(home), false, [])).toEqual({ withdrawn: { amountKobo: home, status: 'refunded' }, remainingKobo: null })
  })

  it('gives nothing back from a pickup whose fee is kept, or after a rejection', () => {
    expect(withdrawalFees({ amountKobo: home, status: 'kept' }, false, ['Phones'])).toEqual({ withdrawn: { amountKobo: 0, status: 'none' }, remainingKobo: home })
    expect(withdrawalFees(held(home), true, ['Phones'])).toEqual({ withdrawn: { amountKobo: 0, status: 'none' }, remainingKobo: home })
    expect(withdrawalFees({ amountKobo: home, status: 'kept' }, false, []).withdrawn.status).toBe('kept')
  })
})
