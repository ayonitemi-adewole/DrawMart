import { describe, expect, it } from 'vitest'
import { areaFromText, areaPairPrice, checkoutDeliveryFees, defaultSizeFor, deliveryFeeKobo, deliveryPriceError, nearestArea, packageSizeOf, placeholderPricing, sizeExtraError, type DeliveryPricing } from './deliveryFees'

const pricing: DeliveryPricing = {
  areas: [{ id: 'a', name: 'A', lat: 6.5, lng: 3.3 }, { id: 'b', name: 'B', lat: 6.5, lng: 3.6 }],
  prices: [{ areaA: 'a', areaB: 'a', priceKobo: 100_000 }, { areaA: 'a', areaB: 'b', priceKobo: 300_000 }, { areaA: 'b', areaB: 'b', priceKobo: 100_000 }],
  sizeExtras: { small: 0, medium: 50_000, large: 400_000 },
}
const inA = { lat: 6.5, lng: 3.31 }
const inB = { lat: 6.5, lng: 3.59 }
const item = (merchantId: string, area: string, over: object = {}) => ({ status: 'for_sale' as const, category: 'Phones' as const, merchantId, merchant: { name: merchantId, area: '', deliveryArea: area }, ...over })

describe('delivery fees', () => {
  it('finds the area from a pin, or from what a seller typed', () => {
    expect(nearestArea(inA, pricing.areas)).toBe('a')
    expect(nearestArea(inB, pricing.areas)).toBe('b')
    expect(areaFromText('Surulere')).toBe('yaba')
    expect(areaFromText('Victoria Island')).toBe('vi')
    expect(areaFromText('Lagos Island')).toBe('island')
    expect(areaFromText('Somewhere new')).toBe('ikeja')
  })

  it('prices a pair either way round, adds the size, and stays within ₦1,000 to ₦5,000', () => {
    expect(areaPairPrice(pricing, 'b', 'a')).toBe(300_000)
    expect(deliveryFeeKobo(pricing, 'a', inA, 'small')).toBe(100_000)
    expect(deliveryFeeKobo(pricing, 'b', inA, 'medium')).toBe(350_000)
    expect(deliveryFeeKobo(pricing, 'a', inB, 'large')).toBe(500_000)
  })

  it('uses the usual size for a category when a seller hasn’t chosen', () => {
    expect(defaultSizeFor('Phones')).toBe('small')
    expect(defaultSizeFor('Electronics')).toBe('medium')
    expect(defaultSizeFor('Home')).toBe('large')
    expect(packageSizeOf({ category: 'Home', packageSize: 'small' })).toBe('small')
    expect(packageSizeOf({ category: 'Home' })).toBe('large')
  })

  it('charges one fee per seller, for their largest package', () => {
    const fees = checkoutDeliveryFees([item('m1', 'a'), item('m1', 'a', { packageSize: 'medium' }), item('m2', 'b')], inA, pricing)
    expect(fees).toEqual([{ merchantId: 'm1', merchantName: 'm1', feeKobo: 150_000 }, { merchantId: 'm2', merchantName: 'm2', feeKobo: 300_000 }])
  })

  it('charges nothing for cars or won items', () => {
    expect(checkoutDeliveryFees([item('m1', 'a', { category: 'Cars' }), item('m2', 'a', { status: 'drawn' })], inA, pricing)).toEqual([])
  })

  it('starts every placeholder within the range, leaving room for the largest extra', () => {
    const p = placeholderPricing()
    expect(p.prices).toHaveLength((p.areas.length * (p.areas.length + 1)) / 2)
    for (const row of p.prices) {
      expect(row.priceKobo).toBeGreaterThanOrEqual(100_000)
      expect(row.priceKobo).toBeLessThanOrEqual(350_000)
      expect(row.priceKobo % 10_000).toBe(0)
    }
  })

  it('keeps admins’ prices within the range', () => {
    expect(deliveryPriceError(100_000)).toBeNull()
    expect(deliveryPriceError(500_000)).toBeNull()
    expect(deliveryPriceError(99_999)).toBeTruthy()
    expect(deliveryPriceError(500_001)).toBeTruthy()
    expect(sizeExtraError(0)).toBeNull()
    expect(sizeExtraError(-1)).toBeTruthy()
  })
})
