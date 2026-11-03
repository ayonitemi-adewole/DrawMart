import { Link, useNavigate } from 'react-router'
import { useDeliveryActions } from '@/api/hooks'
import type { DeliveryJob } from '@/api/types'
import { ChevronRightIcon, MapPinIcon, NairaIcon, StoreIcon, TruckIcon } from '@/components/icons'
import { ProductId } from '@/components/ProductId'
import { useToast } from '@/components/toast'
import { Button, Card, errorMessage } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import { areaName } from '@/domain/riderAlerts'
import { planStops, poolTrips, tripRoomError, type StopJob, type Trip } from '@/domain/trips'

/** Where a job is picked up: the counter for an item going back from one, otherwise the seller. */
const collectName = (j: DeliveryJob) => (j.waitingAtCounter ? (j.pickupPoint?.name ?? 'Pickup location') : j.collectFrom.name)

/** Jobs in the pool that can go on one trip, in the pool's own order. */
export function TripList({ jobs, held }: { jobs: DeliveryJob[]; held: number }) {
  const trips = poolTrips(jobs)
  if (!trips.length) return null
  return (
    <section className="flex flex-col gap-3" aria-labelledby="trips-title">
      <div className="flex flex-col gap-0.5">
        <h2 id="trips-title" className="font-display text-lg font-extrabold">Take together</h2>
        <p className="text-sm text-muted">One collection, or the same way across town. Each still has its own check and PIN.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {trips.map((t) => (
          <TripCard key={t.key} trip={t} held={held} />
        ))}
      </div>
    </section>
  )
}

function TripCard({ trip: t, held }: { trip: Trip<DeliveryJob>; held: number }) {
  const { takeTrip } = useDeliveryActions()
  const navigate = useNavigate()
  const toast = useToast()
  const ids = t.jobs.map((j) => j.id)
  const noRoom = tripRoomError(held, ids.length)
  const first = t.jobs[0]
  return (
    <Card className="flex min-w-0 animate-fade-up flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <strong className="flex items-center gap-2 leading-tight">
          {t.kind === 'same_pickup' ? <StoreIcon size={16} className="shrink-0 text-brand" /> : <MapPinIcon size={16} className="shrink-0 text-brand" />}
          {t.kind === 'same_pickup' ? `${t.jobs.length} from ${collectName(first)}` : `${t.jobs.length} going ${areaName(first.fromArea)} → ${areaName(first.toArea)}`}
        </strong>
        <span className="flex items-center gap-1 text-sm font-bold">
          <NairaIcon size={14} className="text-brand" /> Pays {formatNaira(t.payKobo)} in all
        </span>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {t.jobs.map((j) => (
          <li key={j.id} className="flex flex-col">
            <span className="truncate">
              {j.listingTitle}
              {j.quantity > 1 ? ` × ${j.quantity}` : ''}
              <span className="text-subtle"> · to {areaName(j.toArea)}</span>
            </span>
            <ProductId code={j.productCode} />
          </li>
        ))}
      </ul>
      {noRoom ? <span className="text-xs text-subtle">{noRoom}</span> : null}
      <Button
        variant="outline"
        loading={takeTrip.isPending && takeTrip.variables?.join() === ids.join()}
        disabled={takeTrip.isPending || !!noRoom}
        onClick={() =>
          takeTrip.mutate(ids, {
            onSuccess: () => {
              toast(`Taken: ${ids.length} jobs. Your route is under Yours.`)
              navigate('/delivery?tab=mine')
            },
            onError: (e) => toast(errorMessage(e), 'error'),
          })
        }
      >
        <TruckIcon size={16} /> Take all {ids.length}
      </Button>
    </Card>
  )
}

function stopJob(j: DeliveryJob): StopJob {
  const pickup = j.fulfilment === 'pickup'
  return {
    id: j.id,
    collectKey: j.collectKey,
    collected: j.collected && !j.waitingAtCounter,
    collectName: collectName(j),
    collectAt: (j.waitingAtCounter ? j.pickupPoint?.location : j.collectFrom.location) ?? null,
    collectArea: j.fromArea,
    // Going back: to the seller. Otherwise the counter, or the buyer once their details are here.
    dropName: j.returning ? j.collectFrom.name : pickup ? (j.pickupPoint?.name ?? 'Pickup location') : (j.dropOff?.buyerName ?? `A buyer in ${areaName(j.toArea)}`),
    dropAt: (j.returning ? j.collectFrom.location : pickup ? j.pickupPoint?.location : j.dropOff?.location) ?? null,
    dropArea: j.toArea,
  }
}

/** The rider's own jobs as stops: collect everything, then drop off nearest first. */
export function RouteStops({ jobs }: { jobs: DeliveryJob[] }) {
  if (jobs.length < 2) return null
  const byId = new Map(jobs.map((j) => [j.id, j]))
  const stops = planStops(jobs.map(stopJob))
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <strong>Your route</strong>
        <span className="text-xs text-subtle">A suggested order from the areas and pins you have. Go another way if you know a better one.</span>
      </div>
      <ol className="flex flex-col gap-1">
        {stops.map((s, i) => {
          const items = s.jobIds.map((id) => byId.get(id)!)
          return (
            <li key={`${s.kind}-${s.jobIds.join('-')}`}>
              <Link to={`/delivery/${s.jobIds[0]}`} className="flex min-h-11 items-center gap-3 rounded-2xl p-2 text-ink no-underline hover:bg-sunken">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken font-display text-sm font-extrabold">{i + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col text-sm">
                  <span className="flex items-center gap-1.5 font-bold">
                    {s.kind === 'collect' ? <StoreIcon size={14} className="shrink-0 text-brand" /> : <MapPinIcon size={14} className="shrink-0 text-hot" />}
                    <span className="truncate">
                      {s.kind === 'collect' ? 'Collect from' : 'Drop off at'} {s.name}
                    </span>
                  </span>
                  <span className="truncate text-xs text-subtle">
                    {areaName(s.area)} · {items.map((j) => j.listingTitle).join(', ')}
                  </span>
                </span>
                <ChevronRightIcon size={16} className="shrink-0 text-subtle" />
              </Link>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
