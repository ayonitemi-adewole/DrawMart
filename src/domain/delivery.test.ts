import { describe, expect, it } from 'vitest'
import { MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES, checkPin, isDeliveryPin, newDeliveryPin, type PinState } from './delivery'

const T = Date.parse('2026-11-01T10:00:00Z')

describe('delivery PINs', () => {
  it('makes 6-digit PINs, keeping leading zeros', () => {
    for (let i = 0; i < 200; i++) expect(isDeliveryPin(newDeliveryPin())).toBe(true)
    expect(newDeliveryPin(() => 0)).toBe('000000')
    expect(newDeliveryPin(() => 0.000042)).toBe('000042')
    expect(newDeliveryPin(() => 0.9999999)).toBe('999999')
    for (const bad of ['', '12345', '1234567', '12a456', ' 123456']) expect(isDeliveryPin(bad)).toBe(false)
  })

  it('confirms the right PIN', () => {
    expect(checkPin('123456', '123456', { attempts: 3, lockedUntil: null }, T).result).toEqual({ confirmed: true, attemptsLeft: 0, lockedUntil: null })
  })

  it('counts wrong tries, then pauses', () => {
    let state: PinState = { attempts: 0, lockedUntil: null }
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      const r = checkPin('123456', '000000', state, T)
      expect(r.result).toEqual({ confirmed: false, attemptsLeft: MAX_PIN_ATTEMPTS - i, lockedUntil: null })
      state = r.state
    }
    const last = checkPin('123456', '000000', state, T)
    const until = new Date(T + PIN_LOCK_MINUTES * 60_000).toISOString()
    expect(last.result).toEqual({ confirmed: false, attemptsLeft: 0, lockedUntil: until })
    state = last.state

    // Even the right PIN waits, and doesn't extend the pause.
    expect(checkPin('123456', '123456', state, T + 60_000)).toEqual({ result: { confirmed: false, attemptsLeft: 0, lockedUntil: until }, state })

    // Afterwards it works, and wrong tries count from the start.
    expect(checkPin('123456', '123456', state, T + PIN_LOCK_MINUTES * 60_000 + 1).result.confirmed).toBe(true)
    expect(checkPin('123456', '000000', state, T + PIN_LOCK_MINUTES * 60_000 + 1).result).toEqual({ confirmed: false, attemptsLeft: MAX_PIN_ATTEMPTS - 1, lockedUntil: null })
  })
})
