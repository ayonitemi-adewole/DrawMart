import { describe, expect, it } from 'vitest'
import { placeholderPricing } from './deliveryFees'
import { type RiderEarning, earningWeeks, earningsCsv, pairPayError, payableNow, placeholderRiderPay, riderPayError, tripPay, weekStart } from './riderPay'

const line = (earnedAt: string, amountKobo: number, paidAt: string | null = null): RiderEarning => ({
  id: earnedAt, kind: 'delivery', amountKobo, productCode: 'PRD-7K3Q9X', listingTitle: 'Lamp, large', fromArea: 'ikeja', toArea: 'yaba', earnedAt, paidAt, reference: paidAt ? 'TRF-1' : null, paidTo: null,
})

describe('rider pay', () => {
  const pricing = placeholderPricing()
  const rates = placeholderRiderPay(pricing)

  it('starts at 70% of the delivery price, never more than the buyer pays', () => {
    for (const p of pricing.prices) {
      const pay = rates.pays.find((x) => x.areaA === p.areaA && x.areaB === p.areaB)!.payKobo
      expect(pay * 10).toBeLessThanOrEqual(p.priceKobo * 7)
      expect(pay % 5_000).toBe(0)
    }
    expect(rates.sizeExtras).toEqual({ small: 0, medium: 35_000, large: 105_000 })
    expect(tripPay(rates, 'yaba', 'ikeja', 'large')).toBe(tripPay(rates, 'ikeja', 'yaba', 'small') + 105_000)
    expect(riderPayError(100_000, 100_000)).toBeNull()
    expect(riderPayError(100_001, 100_000)).toMatch(/can’t be more/)
    expect(pairPayError(pricing, 'ikeja', 'yaba', 10_000_000)).toMatch(/can’t be more/)
  })

  it('runs weeks Monday to Sunday in Lagos, and pays only finished weeks', () => {
    // Sunday 23:30 Lagos is still that week; Monday 00:00 Lagos starts the next.
    expect(weekStart('2026-11-08T22:30:00.000Z')).toBe('2026-11-01T23:00:00.000Z')
    expect(weekStart('2026-11-08T23:00:00.000Z')).toBe('2026-11-08T23:00:00.000Z')
    const lines = [line('2026-11-03T10:00:00.000Z', 100_000), line('2026-11-04T10:00:00.000Z', 50_000, '2026-11-05T10:00:00.000Z'), line('2026-11-10T10:00:00.000Z', 70_000)]
    expect(payableNow(lines, Date.parse('2026-11-10T12:00:00.000Z')).map((l) => l.amountKobo)).toEqual([100_000])
    const [latest, earlier] = earningWeeks(lines)
    expect(latest).toMatchObject({ start: '2026-11-08T23:00:00.000Z', totalKobo: 70_000, paidKobo: 0 })
    expect(earlier).toMatchObject({ totalKobo: 150_000, paidKobo: 50_000 })
    expect(earningsCsv(earlier)).toBe(
      'Date,Job,Product ID,Item,Amount (NGN),Paid,Reference\n2026-11-03,Delivery,PRD-7K3Q9X,"Lamp, large",1000.00,,\n2026-11-04,Delivery,PRD-7K3Q9X,"Lamp, large",500.00,2026-11-05,TRF-1\n,Total,,,1500.00,,\n',
    )
  })
})
