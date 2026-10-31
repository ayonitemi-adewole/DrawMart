import { describe, expect, it } from 'vitest'
import { canSaveListing } from './saved'

describe('canSaveListing', () => {
  it('allows anything buyers can see, including finished draws', () => {
    for (const s of ['live', 'sold_out', 'drawn', 'refunded', 'for_sale', 'sold'] as const) expect(canSaveListing(s)).toBe(true)
  })

  it('refuses listings buyers can’t see', () => {
    for (const s of ['pending_review', 'rejected'] as const) expect(canSaveListing(s)).toBe(false)
  })
})
