import { describe, expect, it } from 'vitest'
import { closingReminderSent, isSellerNotification, pickupReminderDue } from './storeNotifications'

describe('store reminders', () => {
  // 07:30 and 08:00 on 2 Nov in Lagos, which is UTC+1.
  const early = Date.parse('2026-11-02T06:30:00Z')
  const morning = Date.parse('2026-11-02T07:00:00Z')

  it('reminds the morning before a pickup, and not overnight', () => {
    expect(pickupReminderDue('2026-11-03', morning)).toBe(true)
    expect(pickupReminderDue('2026-11-03', early)).toBe(false)
    expect(pickupReminderDue('2026-11-04', morning)).toBe(false)
    expect(pickupReminderDue('2026-11-02', morning)).toBe(false)
  })

  it('uses the Lagos date near midnight', () => {
    // 23:30 UTC on the 2nd is already 00:30 on the 3rd in Lagos, and too early anyway.
    expect(pickupReminderDue('2026-11-04', Date.parse('2026-11-02T23:30:00Z'))).toBe(false)
    expect(pickupReminderDue('2026-11-04', Date.parse('2026-11-03T08:00:00Z'))).toBe(true)
  })

  it('reminds once per closing date, so an extended draw gets another', () => {
    const closes = '2026-11-10T12:00:00Z'
    expect(closingReminderSent(closes, [])).toBe(false)
    expect(closingReminderSent(closes, ['2026-11-09T13:00:00Z'])).toBe(true)
    expect(closingReminderSent(closes, ['2026-11-03T13:00:00Z'])).toBe(false)
  })

  it('tells seller news from buyer news', () => {
    expect(isSellerNotification('store_new_order')).toBe(true)
    expect(isSellerNotification('draw_won')).toBe(false)
  })
})
