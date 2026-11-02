import { describe, expect, it } from 'vitest'
import { shopProfileErrors, verifiedSince } from './shopProfile'

const ok = { about: 'Phones and laptops, all with warranty.', openingHours: 'Mon–Sat, 9am–6pm', shopNote: '', publicPhone: '', logoUrl: null, coverUrl: null, showCac: false }

describe('shop profiles', () => {
  it('keeps things short, and a public phone real', () => {
    expect(shopProfileErrors(ok, 'store')).toEqual([])
    expect(shopProfileErrors({ ...ok, about: 'x'.repeat(301) }, 'store')).toHaveLength(1)
    expect(shopProfileErrors({ ...ok, publicPhone: '12345' }, 'store')).toHaveLength(1)
    expect(shopProfileErrors({ ...ok, publicPhone: '0803 123 4567' }, 'store')).toEqual([])
  })

  it('only lets a registered store show a CAC number', () => {
    expect(shopProfileErrors({ ...ok, showCac: true }, 'store')).toEqual([])
    expect(shopProfileErrors({ ...ok, showCac: true }, 'individual')).toHaveLength(1)
  })

  it('says when it was verified, in Lagos time', () => {
    expect(verifiedSince('2026-10-31T23:30:00Z')).toBe('November 2026')
    expect(verifiedSince(null)).toBeNull()
  })
})
