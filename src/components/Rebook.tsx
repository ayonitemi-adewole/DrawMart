import { useState } from 'react'
import { useClaimActions, usePickupPoints } from '@/api/hooks'
import type { OrderView } from '@/api/types'
import { chooseBy, metresBetween, redeliveryWindows, windowEnd } from '@/domain/deliveryAttempts'
import { dateTime, shortDate, timeOfDay } from '@/lib/time'
import { AlertIcon, ClockIcon } from './icons'
import { useToast } from './toast'
import { Button, Field, Notice, Segmented, errorMessage, inputCls } from './ui'

type Choice = 'redeliver' | 'pickup'

const windowLabel = (start: string) => `${shortDate(start)}, ${timeOfDay(start)}–${timeOfDay(windowEnd(start))}`

/** After a failed attempt: a new window or a pickup location, and then what was chosen. */
export function Rebook({ order: o }: { order: OrderView }) {
  if (o.status !== 'dispatched' || o.failedAttempts < 1) return null
  if (o.redeliveryChoice === 'redeliver' && o.redeliverAt)
    return (
      <Notice tone="sky" icon={ClockIcon} title="Delivering again">
        {windowLabel(o.redeliverAt)}. Have your PIN ready. If we miss you again, it goes back to the seller and you’re refunded the price, not delivery.
      </Notice>
    )
  if (o.redeliveryChoice || !o.lastFailedAt) return null
  return <RebookForm order={o} failedAt={o.lastFailedAt} />
}

function RebookForm({ order: o, failedAt }: { order: OrderView; failedAt: string }) {
  const { rebook } = useClaimActions()
  const points = usePickupPoints()
  const toast = useToast()
  const windows = redeliveryWindows(failedAt, Date.now())
  const from = o.delivery.location
  const nearest = [...(points.data ?? [])].sort((a, b) => (from ? metresBetween(from, a.location) - metresBetween(from, b.location) : 0))
  const [choice, setChoice] = useState<Choice>('redeliver')
  const [start, setStart] = useState(windows[0] ?? '')
  const [pointId, setPointId] = useState('')
  const point = pointId || nearest[0]?.id || ''

  function submit() {
    rebook
      .mutateAsync({ id: o.id, choice: choice === 'redeliver' ? { windowStart: start } : { pickupPointId: point } })
      .then(() => toast(choice === 'redeliver' ? 'Booked. Your rider will come then.' : 'Your rider will take it to the pickup location.'))
      .catch((e) => toast(errorMessage(e), 'error'))
  }

  return (
    <Notice tone="hot" icon={AlertIcon} title="We couldn’t deliver it">
      <span className="flex flex-col gap-3">
        <span>
          Our rider came {dateTime(failedAt)} but couldn’t reach you. Choose a new time or a pickup location by {dateTime(chooseBy(failedAt))}, or it goes back to the
          seller and you’re refunded the price, not delivery. The next trip is on us.
        </span>
        <Segmented<Choice>
          label="How to get it"
          value={choice}
          onChange={setChoice}
          size="sm"
          options={[
            { value: 'redeliver', label: 'Deliver again' },
            { value: 'pickup', label: 'Collect it instead' },
          ]}
        />
        {choice === 'redeliver' ? (
          <Field label="New time" htmlFor={`rebook-${o.id}`}>
            <select id={`rebook-${o.id}`} value={start} onChange={(e) => setStart(e.target.value)} className={inputCls}>
              {windows.map((w) => (
                <option key={w} value={w}>
                  {windowLabel(w)}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Pickup location" htmlFor={`rebook-point-${o.id}`} hint="Nearest first. Bring your PIN.">
            <select id={`rebook-point-${o.id}`} value={point} onChange={(e) => setPointId(e.target.value)} className={inputCls}>
              {nearest.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}, {p.address}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Button loading={rebook.isPending} disabled={choice === 'redeliver' ? !start : !point} onClick={submit}>
          Confirm
        </Button>
      </span>
    </Notice>
  )
}
