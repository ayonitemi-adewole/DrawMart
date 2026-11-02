import { describe, expect, it } from 'vitest'
import { averageRating, canEditReview, canReview, hideReasonError, replyError, reviewError, reviewerName } from './reviews'

const NOW = Date.parse('2026-11-02T12:00:00Z')
const delivered = { status: 'delivered' as const, isPrize: false, deliveredAt: '2026-10-20T12:00:00Z' }

describe('reviews', () => {
  it('opens on delivery for 30 days, never for won items', () => {
    expect(canReview(delivered, NOW)).toBe(true)
    expect(canReview({ ...delivered, isPrize: true }, NOW)).toBe(false)
    expect(canReview({ ...delivered, status: 'dispatched', deliveredAt: null }, NOW)).toBe(false)
    expect(canReview({ ...delivered, deliveredAt: '2026-10-03T12:00:00Z' }, NOW)).toBe(false)
  })

  it('can be changed until the seller replies or it’s hidden', () => {
    expect(canEditReview(delivered, { reply: null, hidden: false }, NOW)).toBe(true)
    expect(canEditReview(delivered, { reply: 'Thanks', hidden: false }, NOW)).toBe(false)
    expect(canEditReview(delivered, { reply: null, hidden: true }, NOW)).toBe(false)
  })

  it('checks the rating and lengths', () => {
    expect(reviewError({ rating: 4, sellerComment: '', productComment: '' })).toBeNull()
    for (const rating of [0, 6, 3.5]) expect(reviewError({ rating, sellerComment: '', productComment: '' })).not.toBeNull()
    expect(reviewError({ rating: 5, sellerComment: 'x'.repeat(501), productComment: '' })).not.toBeNull()
    expect(replyError('  ')).not.toBeNull()
    expect(replyError('Thank you!')).toBeNull()
    expect(hideReasonError('no')).not.toBeNull()
    expect(hideReasonError('Abusive')).toBeNull()
  })

  it('shows a first name only', () => {
    expect(reviewerName('Adaeze Okafor')).toBe('Adaeze')
    expect(reviewerName('ada.okafor')).toBe('Ada')
    expect(reviewerName('tunde_99')).toBe('Tunde')
    expect(reviewerName('buyer2')).toBe('A buyer')
    expect(reviewerName('')).toBe('A buyer')
    expect(reviewerName('.x')).toBe('A buyer')
  })

  it('averages to one decimal place', () => {
    expect(averageRating([])).toBeNull()
    expect(averageRating([5, 4, 4, 4])).toBe(4.3)
    expect(averageRating([5, 5, 4])).toBe(4.7)
  })
})
