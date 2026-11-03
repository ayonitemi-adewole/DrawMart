import { useEffect, useRef } from 'react'
import { useDeliveryJobs, useLocationSharing, useSetLocationSharing, useShareLocation } from '@/api/hooks'
import { MapPinIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Button, Card, Notice, errorMessage } from '@/components/ui'
import { SHARE_EVERY_SECONDS, carryingToBuyer } from '@/domain/riderLocation'

/**
 * In the delivery app's layout: while the rider has opted in and is taking something
 * to a buyer's door, sends the phone's position every 30 seconds and says so, with a
 * way to stop (riderLocation.ts). Nothing is sent otherwise.
 */
export function LocationSharingBar() {
  const sharing = useLocationSharing()
  const jobs = useDeliveryJobs()
  const set = useSetLocationSharing()
  const share = useShareLocation()
  const toast = useToast()
  const carrying = (jobs.data ?? []).filter(carryingToBuyer).length
  const active = !!sharing.data && carrying > 0
  // The mutation object changes each render; the timer only needs the latest.
  const send = useRef(share.mutate)
  send.current = share.mutate
  const stop = useRef(set.mutate)
  stop.current = set.mutate

  useEffect(() => {
    if (!active || !navigator.geolocation) return
    const tick = () =>
      navigator.geolocation.getCurrentPosition(
        (p) => send.current({ lat: p.coords.latitude, lng: p.coords.longitude }),
        (err) => {
          if (err.code !== err.PERMISSION_DENIED) return
          toast('Turn on location for this site to share where you are. Sharing is off for now.', 'error')
          stop.current(false)
        },
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 15_000 },
      )
    tick()
    const timer = setInterval(tick, SHARE_EVERY_SECONDS * 1000)
    return () => clearInterval(timer)
  }, [active, toast])

  if (!active) return null
  return (
    <Notice
      tone="sky"
      icon={MapPinIcon}
      title={`Sharing your location with ${carrying === 1 ? 'the buyer' : `${carrying} buyers`}`}
      action={
        <Button variant="outline" size="sm" className="min-h-11" loading={set.isPending} onClick={() => set.mutate(false, { onError: (e) => toast(errorMessage(e), 'error') })}>
          Stop
        </Button>
      }
    >
      Until you hand it over, with DrawMart open. It uses a little more battery and data.
    </Notice>
  )
}

/** On the job page, on the way to the buyer, for a rider who hasn't chosen to share. */
export function ShareLocationPrompt() {
  const sharing = useLocationSharing()
  const set = useSetLocationSharing()
  const toast = useToast()
  if (sharing.data !== false) return null
  return (
    <Card className="flex flex-col gap-3 p-4 text-sm">
      <span className="flex items-start gap-2">
        <MapPinIcon size={16} className="mt-0.5 shrink-0 text-brand" />
        <span className="flex flex-col gap-0.5">
          <strong>Let the buyer see where you are?</strong>
          <span className="text-muted">They see your spot on a map until you hand it over, and roughly when you’ll arrive. Never after, and never your route. You can stop any time.</span>
        </span>
      </span>
      <Button variant="outline" className="w-fit" loading={set.isPending} onClick={() => set.mutate(true, { onError: (e) => toast(errorMessage(e), 'error') })}>
        Share my location
      </Button>
    </Card>
  )
}
