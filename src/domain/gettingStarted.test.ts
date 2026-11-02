import { describe, expect, it } from 'vitest'
import { profileStarted, startSteps, startingDone } from './gettingStarted'

const none = { verified: false, payoutAccount: false, pickupSpot: false, profile: false, callsDecided: false, listed: false }

describe('getting started', () => {
  it('lists the steps in order, ticking what’s done', () => {
    expect(startSteps({ ...none, verified: true, listed: true })).toEqual([
      { step: 'verified', done: true },
      { step: 'payouts', done: false },
      { step: 'pickup', done: false },
      { step: 'profile', done: false },
      { step: 'calls', done: false },
      { step: 'listing', done: true },
    ])
  })

  it('is finished only when every step is', () => {
    const all = { verified: true, payoutAccount: true, pickupSpot: true, profile: true, callsDecided: true, listed: true }
    expect(startingDone(all)).toBe(true)
    expect(startingDone({ ...all, callsDecided: false })).toBe(false)
  })

  it('counts a logo or a description as a started profile', () => {
    expect(profileStarted({ about: null, logoUrl: null })).toBe(false)
    expect(profileStarted({ about: '   ', logoUrl: null })).toBe(false)
    expect(profileStarted({ about: 'Phones and laptops.', logoUrl: null })).toBe(true)
    expect(profileStarted({ about: null, logoUrl: '/assets/logo.png' })).toBe(true)
  })
})
