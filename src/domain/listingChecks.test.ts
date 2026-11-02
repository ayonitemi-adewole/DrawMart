import { describe, expect, it } from 'vitest'
import { CODE_ALPHABET, imeiValid, newCheckCode, newSellerLimitError, proofErrors, serialError } from './listingChecks'
import { nairaToKobo as k } from './money'

describe('listing checks', () => {
  it('makes 4-character codes from letters that can’t be misread', () => {
    const code = newCheckCode()
    expect(code).toMatch(/^[A-Z0-9]{4}$/)
    for (const c of code) expect(CODE_ALPHABET).toContain(c)
    for (const c of 'O0I1L5S2B8') expect(CODE_ALPHABET).not.toContain(c)
  })

  it('checks an IMEI’s last digit', () => {
    expect(imeiValid('490154203237518')).toBe(true)
    expect(imeiValid('490154203237519')).toBe(false)
    expect(imeiValid('49015420323751')).toBe(false)
  })

  it('needs a serial on dearer phones and electronics, not on cases', () => {
    expect(serialError('Phones', k(5_000), '')).toBeNull()
    expect(serialError('Phones', k(50_000), '')).toContain('Add')
    expect(serialError('Home', k(900_000), '')).toBeNull()
    expect(serialError('Electronics', k(50_000), 'SN-12AB34')).toBeNull()
    expect(serialError('Phones', k(50_000), '490154203237519')).toContain('look right')
    expect(serialError('Phones', k(50_000), '490154203237518')).toBeNull()
    expect(serialError('Electronics', k(50_000), 'a b')).toContain('look right')
  })

  it('asks for the video and, from individuals over ₦100,000, proof of purchase', () => {
    const base = { videoRequired: true, individual: true, hasVideo: false, hasProof: false, category: 'Home' as const, priceKobo: k(100_000), serial: '' }
    expect(proofErrors(base)).toEqual(['Record a short video of the item with your code.'])
    expect(proofErrors({ ...base, hasVideo: true })).toEqual([])
    expect(proofErrors({ ...base, hasVideo: true, priceKobo: k(100_001) })).toEqual(['Add a photo of your receipt or other proof you bought it.'])
    expect(proofErrors({ ...base, individual: false, videoRequired: false, priceKobo: k(500_000) })).toEqual([])
  })

  it('limits new individual sellers until 3 deliveries', () => {
    const s = { individual: true, deliveries: 0, live: 4, priceKobo: k(200_000), adding: 1 }
    expect(newSellerLimitError(s)).toBeNull()
    expect(newSellerLimitError({ ...s, priceKobo: k(200_001) })).toContain('₦200,000')
    expect(newSellerLimitError({ ...s, live: 5 })).toContain('5 items')
    expect(newSellerLimitError({ ...s, live: 5, adding: 0 })).toBeNull()
    expect(newSellerLimitError({ ...s, live: 9, deliveries: 3 })).toBeNull()
    expect(newSellerLimitError({ ...s, live: 9, individual: false })).toBeNull()
  })
})
