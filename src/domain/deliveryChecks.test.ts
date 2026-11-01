import { describe, expect, it } from 'vitest'
import { collectionFailError, photosError } from './deliveryChecks'
import { stockAfterCancel } from './orderCancel'

describe('delivery checks', () => {
  it('needs 1 to 3 real photos', () => {
    expect(photosError([])).toBeTruthy()
    expect(photosError(['/assets/a.jpg'])).toBeNull()
    expect(photosError(['data:image/jpeg;base64,x', 'https://x.test/a.jpg', '/assets/b.jpg'])).toBeNull()
    expect(photosError(['/assets/a.jpg', '/assets/a.jpg', '/assets/a.jpg', '/assets/a.jpg'])).toBeTruthy()
    expect(photosError(['javascript:alert(1)'])).toBeTruthy()
  })

  it('needs a problem, and proof unless there was no item to photograph', () => {
    expect(collectionFailError([], ['/assets/a.jpg'])).toContain('Pick')
    expect(collectionFailError(['damaged'], [])).toContain('photos')
    expect(collectionFailError(['damaged'], ['/assets/a.jpg'])).toBeNull()
    expect(collectionFailError(['no_item'], [])).toBeNull()
    expect(collectionFailError(['no_item', 'damaged'], [])).toContain('photos')
  })

  it('doesn’t put a failed or refused item back on sale', () => {
    for (const reason of ['failed_check', 'refused_wrong', 'refused_damaged'] as const) {
      expect(stockAfterCancel(reason, { stock: 2, status: 'for_sale', kind: 'product' }, 1)).toEqual({ stock: 2, status: 'for_sale' })
      expect(stockAfterCancel(reason, { stock: 0, status: 'sold', kind: 'product' }, 1)).toEqual({ stock: 0, status: 'sold' })
    }
  })

  it('pauses a product when a confirmed order is never made ready', () => {
    expect(stockAfterCancel('not_sent', { stock: 0, status: 'sold', kind: 'product' }, 1)).toEqual({ stock: 1, status: 'paused' })
  })
})
