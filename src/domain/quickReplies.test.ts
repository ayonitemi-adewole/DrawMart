import { describe, expect, it } from 'vitest'
import { asksForOffPlatformPayment } from './messages'
import { MAX_QUICK_REPLIES, SUGGESTED_QUICK_REPLIES, quickReplyError } from './quickReplies'

describe('quick replies', () => {
  it('needs some text, not too much, and a free slot', () => {
    expect(quickReplyError('Yes, it’s available.', 0)).toBeNull()
    expect(quickReplyError('   ', 0)).not.toBeNull()
    expect(quickReplyError('x'.repeat(501), 0)).not.toBeNull()
    expect(quickReplyError('One more', MAX_QUICK_REPLIES)).toMatch(/Delete one/)
  })

  it('never suggests paying outside DrawMart', () => {
    for (const s of SUGGESTED_QUICK_REPLIES) expect(asksForOffPlatformPayment(s)).toBe(false)
  })
})
