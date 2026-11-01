import { describe, expect, it } from 'vitest'
import { nairaToKobo as k } from './money'
import { canControlProduct, repriceNeedsReview, statusAfterStock, stockChangeError } from './productControls'

describe('product controls', () => {
  it('is for products on sale, paused or sold out, never draws', () => {
    for (const status of ['for_sale', 'paused', 'sold'] as const) expect(canControlProduct({ kind: 'product', status })).toBe(true)
    for (const status of ['pending_review', 'rejected', 'withdrawn'] as const) expect(canControlProduct({ kind: 'product', status })).toBe(false)
    expect(canControlProduct({ kind: 'raffle', status: 'for_sale' })).toBe(false)
  })

  it('sends a change of more than 20% for review, up or down', () => {
    expect(repriceNeedsReview(k(12_000), k(10_000))).toBe(false)
    expect(repriceNeedsReview(k(8_000), k(10_000))).toBe(false)
    expect(repriceNeedsReview(k(12_000) + 1, k(10_000))).toBe(true)
    expect(repriceNeedsReview(k(8_000) - 1, k(10_000))).toBe(true)
  })

  it('keeps stock within its limits', () => {
    expect(stockChangeError(3, 2)).toBeNull()
    expect(stockChangeError(3, -3)).toBeNull()
    expect(stockChangeError(3, 0)).toContain('how many')
    expect(stockChangeError(3, 1.5)).toContain('how many')
    expect(stockChangeError(3, -4)).toContain('remove')
    expect(stockChangeError(10_000, 1)).toContain('above')
  })

  it('sells out and comes back with its stock, but stays paused until resumed', () => {
    expect(statusAfterStock('for_sale', 0)).toBe('sold')
    expect(statusAfterStock('sold', 2)).toBe('for_sale')
    expect(statusAfterStock('paused', 0)).toBe('paused')
    expect(statusAfterStock('paused', 5)).toBe('paused')
    expect(statusAfterStock('for_sale', 2)).toBe('for_sale')
  })
})
