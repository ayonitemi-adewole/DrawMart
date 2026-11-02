import { useState } from 'react'
import type { OrderView } from '@/api/types'
import { deliveryTimeline } from '@/domain/deliveryChat'
import { timeOfDay } from '@/lib/time'
import { DeliveryChatSheet } from './DeliveryChat'
import { ChatIcon, CheckIcon, UserIcon } from './icons'
import { Button, cx } from './ui'

/** For the buyer: where their order has got to, and who's bringing it. */
export function DeliveryTracker({ order: o }: { order: OrderView }) {
  const [chatting, setChatting] = useState(false)
  const steps = deliveryTimeline(o)
  if (o.status !== 'dispatched' || !steps.length) return null
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-ground p-4 text-sm">
      {o.rider ? (
        <div className="flex items-center gap-3">
          {o.rider.photo ? (
            <img src={o.rider.photo} alt={`${o.rider.firstName}, your rider`} className="size-12 shrink-0 rounded-full border border-line bg-photo object-cover" />
          ) : (
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sunken text-muted">
              <UserIcon size={20} />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <strong>{o.rider.firstName} is bringing it</strong>
            <span className="text-xs text-subtle">Your DrawMart rider</span>
          </span>
          <Button variant="outline" size="sm" onClick={() => setChatting(true)}>
            <ChatIcon size={16} /> Message
          </Button>
        </div>
      ) : null}
      <ol className="flex flex-col gap-2" aria-label="Delivery progress">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className={cx(
                'flex size-5 shrink-0 items-center justify-center rounded-full',
                s.state === 'done' ? 'bg-brand text-on-brand' : s.state === 'now' ? 'border-2 border-brand' : 'border border-line-strong',
              )}
            >
              {s.state === 'done' ? <CheckIcon size={12} /> : null}
            </span>
            <span className={cx('flex-1', s.state === 'next' && 'text-subtle', s.state === 'now' && 'font-bold')}>{s.label}</span>
            {s.at && s.state === 'done' ? <span className="text-xs text-subtle tabular-nums">{timeOfDay(s.at)}</span> : null}
          </li>
        ))}
      </ol>
      {o.rider ? <DeliveryChatSheet orderId={o.id} title={`Message ${o.rider.firstName}`} open={chatting} onClose={() => setChatting(false)} /> : null}
    </div>
  )
}
