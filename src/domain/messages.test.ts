import { describe, expect, it } from 'vitest'
import { asksForOffPlatformPayment, messageError } from './messages'

describe('messages', () => {
  it('needs some text, within the limit', () => {
    expect(messageError('  ')).toBe('Write a message first.')
    expect(messageError('Is it still available?')).toBeNull()
    expect(messageError('x'.repeat(1001))).toMatch(/under 1,000/)
  })

  it('flags requests to pay outside DrawMart', () => {
    expect(asksForOffPlatformPayment('Send to 0123456789 GTB')).toBe(true)
    expect(asksForOffPlatformPayment('acct: 0123 456 789')).toBe(true)
    expect(asksForOffPlatformPayment('Just transfer to my Opay and I’ll ship')).toBe(true)
    expect(asksForOffPlatformPayment('Pay me directly, it’s cheaper')).toBe(true)
    expect(asksForOffPlatformPayment('Yes, it comes with the charger and box.')).toBe(false)
    expect(asksForOffPlatformPayment('Call me on 0803 123 4567')).toBe(false) // 11-digit phone, not an account
  })
})
