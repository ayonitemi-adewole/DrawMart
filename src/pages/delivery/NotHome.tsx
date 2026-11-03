import { useState } from 'react'
import { useDeliveryActions } from '@/api/hooks'
import type { DeliveryJob } from '@/api/types'
import { ClockIcon, MapPinIcon, UserIcon } from '@/components/icons'
import { RiderPhotos } from '@/components/RiderPhotos'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Button, Card, Notice, errorMessage } from '@/components/ui'
import { ATTEMPT_WAIT_MINUTES, CHOOSE_WITHIN_HOURS, attemptError, canFailFrom, windowEnd } from '@/domain/deliveryAttempts'
import type { GeoPoint } from '@/domain/types'
import { shortDate, timeOfDay } from '@/lib/time'

/** At the door with nobody answering (deliveryAttempts.ts). */
export function NotHome({ job: j }: { job: DeliveryJob }) {
  if (j.awaitingBuyer)
    return (
      <Notice tone="ticket" icon={ClockIcon} title="Waiting for the buyer">
        They have {CHOOSE_WITHIN_HOURS} hours to pick a new time or a pickup location, and we’ll tell you which. Keep the item safe meanwhile. If they get in touch first, you can still deliver it with their PIN.
      </Notice>
    )
  return (
    <>
      {j.redeliverAt ? (
        <Notice tone="sky" icon={ClockIcon} title="Second try">
          The buyer asked for {shortDate(j.redeliverAt)}, {timeOfDay(j.redeliverAt)}–{timeOfDay(windowEnd(j.redeliverAt))}. If they’re not there again, it goes back to the seller.
        </Notice>
      ) : null}
      <Attempt job={j} />
    </>
  )
}

function Attempt({ job: j }: { job: DeliveryJob }) {
  const { arrived, failAttempt } = useDeliveryActions()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [locating, setLocating] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const onError = (e: unknown) => toast(errorMessage(e), 'error')

  if (!j.arrivedAt)
    return (
      <Button variant="outline" className="min-h-11 self-center" loading={arrived.isPending} onClick={() => arrived.mutateAsync(j.id).catch(onError)}>
        <UserIcon size={16} /> Nobody’s answering? Say you’ve arrived
      </Button>
    )

  const record = (at: GeoPoint) => {
    const error = attemptError({ arrivedAt: j.arrivedAt, nowMs: Date.now(), photos, at, dropOff: j.dropOff?.location ?? null })
    if (error) return setProblem(error)
    failAttempt
      .mutateAsync({ id: j.id, photo: photos[0], at })
      .then(() => {
        setOpen(false)
        toast(j.failedAttempts ? 'Recorded. Take it back to the seller.' : 'Recorded. We’ve asked the buyer to choose a new time.', 'info')
      })
      .catch((e) => setProblem(errorMessage(e)))
  }

  // Asked for only now, from a tap, and only sent with the attempt.
  function locateAndRecord() {
    if (!photos.length) return setProblem('Take a photo of where you are.')
    if (!navigator.geolocation) return setProblem('This device can’t share its location.')
    setLocating(true)
    setProblem(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        record({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      (err) => {
        setLocating(false)
        setProblem(err.code === err.PERMISSION_DENIED ? 'Turn on location for this site to record a failed attempt.' : 'Couldn’t find your location. Try again outside.')
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }

  return (
    <Card className="flex flex-col gap-3 p-4 text-sm">
      <strong className="flex items-center gap-2">
        <ClockIcon size={16} className="text-brand" /> Arrived at {timeOfDay(j.arrivedAt)}
      </strong>
      <p className="text-muted">
        Call the buyer and wait. If nobody comes, you can record a failed attempt from {timeOfDay(canFailFrom(j.arrivedAt))} ({ATTEMPT_WAIT_MINUTES} minutes after you arrived).
      </p>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Buyer not available
      </Button>
      <Sheet open={open} onClose={() => !failAttempt.isPending && setOpen(false)} title="Buyer not available">
        <h2 className="pr-10 font-display text-2xl font-extrabold">Buyer not available</h2>
        <p className="text-sm text-muted">
          {j.failedAttempts
            ? 'This is the second try, so it goes back to the seller and the buyer is refunded.'
            : 'You keep the item. The buyer picks a new time or a pickup location, and we tell you.'}{' '}
          Take a photo showing where you are; we also record your location once, now.
        </p>
        <RiderPhotos photos={photos} onChange={setPhotos} max={1} label="Take a photo of the place" />
        {problem ? <Notice tone="hot">{problem}</Notice> : null}
        <Button size="lg" loading={locating || failAttempt.isPending} onClick={locateAndRecord}>
          <MapPinIcon size={16} /> Record failed attempt
        </Button>
      </Sheet>
    </Card>
  )
}
