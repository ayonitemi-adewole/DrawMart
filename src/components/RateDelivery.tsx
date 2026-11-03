import { useState } from 'react'
import { useRateDelivery } from '@/api/hooks'
import type { OrderView } from '@/api/types'
import { RATING_REASONS, canRateDelivery, type DeliveryRatingReason } from '@/domain/deliveryRatings'
import { ThumbDownIcon, ThumbUpIcon } from './icons'
import { useToast } from './toast'
import { Button, cx, errorMessage } from './ui'

const reasonText = (reasons: DeliveryRatingReason[]) => reasons.map((r) => RATING_REASONS.find((x) => x.reason === r)?.label).join(', ')

/** On a buyer's delivered order: thumbs up or down for the delivery itself, not the seller (deliveryRatings.ts). */
export function RateDelivery({ order: o }: { order: OrderView }) {
  const rate = useRateDelivery()
  const toast = useToast()
  const [changing, setChanging] = useState(false)
  // Choosing reasons for a thumbs down, before sending.
  const [down, setDown] = useState<DeliveryRatingReason[] | null>(null)
  const open = canRateDelivery(o, Date.now())
  const rated = o.deliveryRating
  if (!open && !rated) return null

  const send = (good: boolean, reasons: DeliveryRatingReason[]) =>
    rate.mutateAsync({ orderId: o.id, good, reasons }).then(
      () => {
        setDown(null)
        setChanging(false)
        toast('Thanks. That helps us look after deliveries.')
      },
      (e) => toast(errorMessage(e), 'error'),
    )

  if (rated && !changing)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-ground p-3 text-sm">
        {rated.good ? <ThumbUpIcon size={16} className="shrink-0 text-brand" /> : <ThumbDownIcon size={16} className="shrink-0 text-hot" />}
        <span className="min-w-0 flex-1">
          <strong>You rated the delivery {rated.good ? 'good' : 'not good'}</strong>
          {rated.reasons.length ? <span className="text-muted">: {reasonText(rated.reasons)}</span> : null}
        </span>
        {open ? (
          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setChanging(true)}>
            Change
          </Button>
        ) : null}
      </div>
    )

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-ground p-3 text-sm">
      <span className="flex flex-col">
        <strong>How was the delivery?</strong>
        <span className="text-xs text-subtle">Just the delivery, not the seller or the item. Riders only see totals, never who rated them.</span>
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="min-h-11 flex-1" loading={rate.isPending && down === null} disabled={rate.isPending} onClick={() => send(true, [])}>
          <ThumbUpIcon size={16} /> Good
        </Button>
        <Button variant={down ? 'primary' : 'outline'} size="sm" className="min-h-11 flex-1" disabled={rate.isPending} aria-pressed={!!down} onClick={() => setDown(down ? null : [])}>
          <ThumbDownIcon size={16} /> Not good
        </Button>
      </div>
      {down ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-bold">What went wrong? Optional.</legend>
          <div className="flex flex-wrap gap-2">
            {RATING_REASONS.map(({ reason, label }) => {
              const on = down.includes(reason)
              return (
                <button
                  key={reason}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDown(on ? down.filter((r) => r !== reason) : [...down, reason])}
                  className={cx('min-h-11 rounded-full border px-3.5 text-xs font-bold transition', on ? 'border-brand bg-brand-soft text-ink' : 'border-line text-muted hover:border-line-strong')}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <Button size="sm" className="min-h-11 w-fit" loading={rate.isPending} onClick={() => send(false, down)}>
            Send
          </Button>
        </fieldset>
      ) : null}
      {rated ? (
        <Button variant="ghost" size="sm" className="min-h-11 w-fit" onClick={() => setChanging(false)}>
          Keep my rating
        </Button>
      ) : null}
    </div>
  )
}
