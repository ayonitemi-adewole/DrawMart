import { describe, expect, it } from 'vitest'
import { canCancelOrder, cancelError, cancelRateFlagged, stockAfterCancel } from './orderCancel'

describe('cancelling an order', () => {
  it('needs a reason, and a note only for "something else"', () => {
    expect(cancelError({ reason: null, note: 'A clear note' })).toContain('reason')
    expect(cancelError({ reason: 'out_of_stock', note: '' })).toBeNull()
    expect(cancelError({ reason: 'other', note: ' no ' })).toContain('Say why')
    expect(cancelError({ reason: 'other', note: 'Shop flooded this week' })).toBeNull()
    expect(cancelError({ reason: 'damaged', note: 'x'.repeat(301) })).toContain('300')
  })

  it('is only for a seller’s own paid orders, never won items', () => {
    const o = { status: 'paid' as const, isPrize: false, handledBy: 'store' as const }
    expect(canCancelOrder(o)).toBe(true)
    expect(canCancelOrder({ ...o, status: 'dispatched' })).toBe(false)
    expect(canCancelOrder({ ...o, isPrize: true })).toBe(false)
    expect(canCancelOrder({ ...o, handledBy: 'drawmart' })).toBe(false)
  })

  it('leaves the stock as the reason says', () => {
    expect(stockAfterCancel('out_of_stock', { stock: 4, status: 'for_sale' }, 2)).toEqual({ stock: 0, status: 'sold' })
    expect(stockAfterCancel('damaged', { stock: 4, status: 'for_sale' }, 2)).toEqual({ stock: 4, status: 'for_sale' })
    expect(stockAfterCancel('damaged', { stock: 0, status: 'sold' }, 2)).toEqual({ stock: 0, status: 'sold' })
    expect(stockAfterCancel('cant_send', { stock: 0, status: 'sold' }, 2)).toEqual({ stock: 2, status: 'for_sale' })
    expect(stockAfterCancel('other', { stock: 1, status: 'paused' }, 1)).toEqual({ stock: 2, status: 'paused' })
    expect(stockAfterCancel('out_of_stock', { stock: 1, status: 'paused' }, 1)).toEqual({ stock: 0, status: 'paused' })
  })

  it('pauses a product when a seller didn’t respond, but only products', () => {
    expect(stockAfterCancel('not_confirmed', { stock: 0, status: 'sold', kind: 'product' }, 1)).toEqual({ stock: 1, status: 'paused' })
    expect(stockAfterCancel('not_confirmed', { stock: 2, status: 'for_sale', kind: 'product' }, 1)).toEqual({ stock: 3, status: 'paused' })
    expect(stockAfterCancel('not_confirmed', { stock: 0, status: 'sold', kind: 'raffle' }, 1)).toEqual({ stock: 1, status: 'for_sale' })
  })

  it('doesn’t let a seller pick the deadline as their reason', () => {
    expect(cancelError({ reason: 'not_confirmed', note: '' })).toContain('reason')
  })

  it('flags a seller from 3 cancellations and 1 in 10 orders', () => {
    expect(cancelRateFlagged(10, 2)).toBe(false)
    expect(cancelRateFlagged(100, 3)).toBe(false)
    expect(cancelRateFlagged(30, 3)).toBe(true)
    expect(cancelRateFlagged(3, 3)).toBe(true)
  })
})
