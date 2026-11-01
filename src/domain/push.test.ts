import { describe, expect, it } from 'vitest'
import { DEFAULT_PUSH_PREFERENCES, PUSH_CATEGORIES, STORE_PUSH_CATEGORIES, pushSubscriptionValid } from './push'

const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }
const at = (endpoint: string) => pushSubscriptionValid({ endpoint, ...keys })

describe('pushSubscriptionValid', () => {
  it('accepts the browsers’ own push services', () => {
    for (const e of ['https://fcm.googleapis.com/fcm/send/abc:DEF_1-2', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/QAbc', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) expect(at(e)).toBe(true)
  })

  it('refuses anywhere else our server shouldn’t be sent', () => {
    for (const e of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://evil.example/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/abc',
      'https://evil.example/https://fcm.googleapis.com/abc',
      'https://push.apple.com.evil.example/abc',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/abc',
      'https://fcm.googleapis.com/',
      'https://user@fcm.googleapis.com/abc',
      '',
    ])
      expect(at(e)).toBe(false)
  })

  it('checks the keys look right', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc'
    expect(pushSubscriptionValid({ endpoint, ...keys, p256dh: 'short' })).toBe(false)
    expect(pushSubscriptionValid({ endpoint, ...keys, auth: 'bad key with spaces!!!' })).toBe(false)
  })
})

describe('push preferences', () => {
  it('has a label and a default for every category', () => {
    expect([...new Set([...PUSH_CATEGORIES, ...STORE_PUSH_CATEGORIES].map((c) => c.value))].sort()).toEqual(Object.keys(DEFAULT_PUSH_PREFERENCES).filter((k) => k !== 'drawReveal').sort())
  })
})
