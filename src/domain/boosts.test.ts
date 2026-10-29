import { describe, expect, it } from 'vitest'
import { boostComparison, boostEndsAt, boostWindow, boostsUnlocked, canBoost, isBoosted, liftPct, withSponsoredFirst } from './boosts'

const now = Date.parse('2026-10-30T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const at = (ms: number) => new Date(ms).toISOString()

describe('boosts', () => {
  it('unlocks at the active-buyer threshold, or when an admin forces it', () => {
    expect(boostsUnlocked(999, 1000, false)).toBe(false)
    expect(boostsUnlocked(1000, 1000, false)).toBe(true)
    expect(boostsUnlocked(3, 1000, true)).toBe(true)
  })

  it('only boosts live draws and items on sale', () => {
    expect(canBoost({ kind: 'raffle', status: 'live' })).toBe(true)
    expect(canBoost({ kind: 'product', status: 'for_sale' })).toBe(true)
    expect(canBoost({ kind: 'raffle', status: 'for_sale' })).toBe(true)
    expect(canBoost({ kind: 'product', status: 'sold' })).toBe(false)
    expect(canBoost({ kind: 'raffle', status: 'pending_review' })).toBe(false)
  })

  it('starts now, or runs on from a boost still going', () => {
    expect(boostEndsAt(null, 3, now)).toBe(at(now + 3 * DAY))
    expect(boostEndsAt(at(now - DAY), 3, now)).toBe(at(now + 3 * DAY))
    expect(boostEndsAt(at(now + DAY), 7, now)).toBe(at(now + 8 * DAY))
  })

  it('puts a few boosted items first, soonest-ending first', () => {
    const list = [
      { id: 'a', boostedUntil: null },
      { id: 'b', boostedUntil: at(now + 5 * DAY) },
      { id: 'c', boostedUntil: at(now - 1) },
      { id: 'd', boostedUntil: at(now + DAY) },
      { id: 'e', boostedUntil: at(now + 2 * DAY) },
    ]
    expect(isBoosted(list[2], now)).toBe(false)
    const { sponsored, rest } = withSponsoredFirst(list, now, 2)
    expect(sponsored.map((l) => l.id)).toEqual(['d', 'e'])
    expect(rest.map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('compares a boost with the same number of days just before it', () => {
    // Started 30 Oct at 10:00 Lagos, a 7-day boost three days in.
    const w = boostWindow('2026-10-30T09:00:00Z', '2026-11-06T09:00:00Z', Date.parse('2026-11-01T15:00:00Z'))
    expect(w).toEqual({ from: '2026-10-30', to: '2026-11-01', days: 3, beforeFrom: '2026-10-27', beforeTo: '2026-10-29' })
    // Finished: the whole boost.
    expect(boostWindow('2026-10-30T09:00:00Z', '2026-11-02T09:00:00Z', Date.parse('2026-12-01T00:00:00Z')).days).toBe(4)
  })

  it('reports the lift, or nothing when there was nothing before', () => {
    expect(liftPct(10, 25)).toBe(150)
    expect(liftPct(10, 5)).toBe(-50)
    expect(liftPct(0, 5)).toBeNull()
    const zero = { views: 0, visitors: 0, chats: 0, units: 0, buyers: 0, salesKobo: 0 }
    expect(boostComparison({ ...zero, views: 30 }, { ...zero, views: 60, units: 2 }, 3)).toMatchObject({
      views: { before: 10, during: 20, lift: 100 },
      units: { before: 0, during: 2 / 3, lift: null },
    })
  })
})
