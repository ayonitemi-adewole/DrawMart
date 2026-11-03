/**
 * Who's bringing an order, and a chat about it. Once a rider has collected a
 * delivery, the buyer sees their first name and photo and can message them, until
 * it's delivered or goes back. The chat is only between the buyer and the rider
 * carrying it: a rider who takes over starts a new one, and the shop never sees it.
 * No phone numbers either way: the rider already has the buyer's, and the buyer
 * never gets the rider's. Mirrored in public.send_delivery_message.
 */
import { messageError } from './messages'
import type { Order } from './types'

/** A Nigerian phone number, however it's spaced: 0803 123 4567, +234 803..., 234-803... */
export function containsPhoneNumber(body: string): boolean {
  const digits = body.replace(/(?<=\d)[\s.-]+(?=\d)/g, '')
  return /(\+?234|\b0)[789][01]\d{8}\b/.test(digits)
}

export function deliveryMessageError(body: string): string | null {
  return messageError(body) ?? (containsPhoneNumber(body) ? 'Keep phone numbers out of this chat. The rider can already call you if they need to.' : null)
}

/** All the buyer is told about who their rider is. */
export const firstName = (displayName: string) => displayName.trim().split(/\s+/)[0] || 'Your rider'

export interface TimelineStep {
  label: string
  at: string | null
  state: 'done' | 'now' | 'next'
}

/** What's happened to an order on its way, for the buyer. */
export function deliveryTimeline(o: Pick<Order, 'status' | 'fulfilment' | 'dispatchedAt' | 'collectedAt' | 'arrivedAt' | 'atCounterAt' | 'deliveredAt' | 'pickupPoint'>): TimelineStep[] {
  if (o.status !== 'dispatched' && o.status !== 'delivered') return []
  const delivered = o.status === 'delivered'
  const steps: { label: string; at: string | null; done: boolean }[] = [
    { label: 'Ready for a rider', at: o.dispatchedAt, done: true },
    { label: 'Collected by your rider', at: o.collectedAt, done: !!o.collectedAt || delivered },
  ]
  if (o.fulfilment === 'pickup') {
    steps.push({ label: `Ready at ${o.pickupPoint?.name ?? 'the pickup location'}`, at: o.atCounterAt, done: !!o.atCounterAt || delivered })
    steps.push({ label: 'Collected by you', at: o.deliveredAt, done: delivered })
  } else {
    steps.push({ label: o.arrivedAt && !delivered ? 'At your door' : 'On the way to you', at: o.arrivedAt ?? o.collectedAt, done: (!!o.collectedAt && !!o.arrivedAt) || delivered })
    steps.push({ label: 'Delivered', at: o.deliveredAt, done: delivered })
  }
  const next = steps.findIndex((s) => !s.done)
  return steps.map((s, i) => ({ label: s.label, at: s.done || i === next ? s.at : null, state: s.done ? 'done' : i === next ? 'now' : 'next' }))
}
