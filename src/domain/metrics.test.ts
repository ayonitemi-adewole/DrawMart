import { describe, expect, it } from 'vitest'
import { conversionBps, fillDays, formatRate, insightTip, lagosDay, sumMetrics } from './metrics'

const row = (patch: Partial<Parameters<typeof insightTip>[0]> = {}) => ({ views: 0, visitors: 0, chats: 0, units: 0, buyers: 0, salesKobo: 0, ...patch })

describe('seller metrics', () => {
  it('computes conversion in basis points, never above 100%', () => {
    expect(conversionBps(5, 40)).toBe(1250)
    expect(conversionBps(3, 0)).toBe(0)
    expect(conversionBps(9, 4)).toBe(10_000)
    expect(formatRate(1250)).toBe('13%')
    expect(formatRate(250)).toBe('2.5%')
    expect(formatRate(0)).toBe('0%')
  })

  it('dates by the Lagos day', () => {
    expect(lagosDay('2026-10-29T22:59:00Z')).toBe('2026-10-29')
    expect(lagosDay('2026-10-29T23:00:00Z')).toBe('2026-10-30')
  })

  it('sums listings', () => {
    expect(sumMetrics([row({ views: 3, salesKobo: 100 }), row({ views: 2, buyers: 1, salesKobo: 50 })])).toMatchObject({ views: 5, buyers: 1, salesKobo: 150 })
  })

  it('fills every day in the range, oldest first', () => {
    const days = fillDays([{ date: '2026-10-28', views: 4, salesKobo: 10 }], 3, '2026-10-29')
    expect(days).toEqual([
      { date: '2026-10-27', views: 0, salesKobo: 0 },
      { date: '2026-10-28', views: 4, salesKobo: 10 },
      { date: '2026-10-29', views: 0, salesKobo: 0 },
    ])
    expect(fillDays([], 7, '2026-03-02')[0].date).toBe('2026-02-24')
  })

  it('only gives tips with enough traffic to mean something', () => {
    expect(insightTip(row())).toBe('not_seen')
    expect(insightTip(row({ visitors: 5 }))).toBeNull()
    expect(insightTip(row({ visitors: 200, buyers: 1 }))).toBe('seen_not_bought')
    expect(insightTip(row({ visitors: 40, chats: 3 }))).toBe('chats_not_bought')
    expect(insightTip(row({ visitors: 40, buyers: 3 }))).toBe('converting')
    expect(insightTip(row({ visitors: 100, buyers: 2 }))).toBeNull()
  })
})
