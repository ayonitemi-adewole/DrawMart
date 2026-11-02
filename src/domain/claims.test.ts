import { describe, expect, it } from 'vitest'
import { canClaim, canContest, claimError, contestError, returnFeeKobo, returnFeePercent, returnRefundSplit, sellerShareOfReturnFee } from './claims'
import { nairaToKobo as k } from './money'

const at = Date.parse('2026-11-02T10:00:00Z')
const hours = (n: number) => at + n * 3_600_000
const delivered = { status: 'delivered' as const, isPrize: false, deliveredAt: '2026-11-02T10:00:00Z', category: 'Home' as const }

describe('claims', () => {
  it('stays open for 48 hours after delivery, not for prizes or cars', () => {
    expect(canClaim(delivered, hours(47.9))).toBe(true)
    expect(canClaim(delivered, hours(48))).toBe(false)
    expect(canClaim({ ...delivered, status: 'dispatched' }, hours(1))).toBe(false)
    expect(canClaim({ ...delivered, isPrize: true }, hours(1))).toBe(false)
    expect(canClaim({ ...delivered, category: 'Cars' }, hours(1))).toBe(false)
  })

  it('charges 30%, 20% or 10% by what one costs', () => {
    expect(returnFeePercent(k(99_999))).toBe(30)
    expect(returnFeePercent(k(100_000))).toBe(20)
    expect(returnFeePercent(k(499_999))).toBe(20)
    expect(returnFeePercent(k(500_000))).toBe(10)
    expect(returnFeeKobo(k(20_000), 1)).toBe(k(6_000))
    expect(returnFeeKobo(k(300_000), 1)).toBe(k(60_000))
    expect(returnFeeKobo(k(300_000), 3)).toBe(k(60_000)) // ₦100,000 each is the 20% band
    expect(returnFeeKobo(k(150_000), 3)).toBe(k(45_000)) // ₦50,000 each is the 30% band
  })

  it('pays for the trip first, then splits what’s left', () => {
    expect(sellerShareOfReturnFee(k(60_000), k(5_000))).toBe(k(27_500))
    expect(sellerShareOfReturnFee(k(3_000), k(5_000))).toBe(0)
    expect(sellerShareOfReturnFee(101, 0)).toBe(50)
  })

  it('takes the fee from cash first', () => {
    expect(returnRefundSplit({ cashKobo: 700, creditKobo: 300 }, 200)).toEqual({ cashKobo: 500, creditKobo: 300 })
    expect(returnRefundSplit({ cashKobo: 100, creditKobo: 900 }, 300)).toEqual({ cashKobo: 0, creditKobo: 700 })
  })

  it('needs a description and a photo for a fault, not for a change of mind', () => {
    expect(claimError(null, '', [])).toContain('Pick')
    expect(claimError('change_of_mind', '', [])).toBeNull()
    expect(claimError('fault', 'short', ['/assets/a.jpg'])).toContain('few words')
    expect(claimError('fault', 'The screen is cracked', [])).toContain('photos')
    expect(claimError('fault', 'The screen is cracked', ['/assets/a.jpg'])).toBeNull()
  })

  it('lets a seller contest a failure for 7 days', () => {
    const o = { cancelReason: 'refused_wrong' as const, cancelledAt: '2026-11-02T10:00:00Z' }
    expect(canContest(o, hours(24 * 6.9))).toBe(true)
    expect(canContest(o, hours(24 * 7))).toBe(false)
    expect(canContest({ ...o, cancelReason: 'cant_send' }, hours(1))).toBe(false)
    expect(contestError('too short')).toBeTruthy()
    expect(contestError('It was the right item, I have the photos')).toBeNull()
  })
})
