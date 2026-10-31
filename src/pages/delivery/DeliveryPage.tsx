import { Suspense, lazy, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { useDeliveryActions, useDeliveryJobs } from '@/api/hooks'
import type { DeliveryJob } from '@/api/types'
import { BackIcon, CheckCircleIcon, ChevronRightIcon, LockIcon, MapPinIcon, PhoneIcon, StoreIcon, TruckIcon, UserIcon } from '@/components/icons'
import { NoProductMatch, ProductId, ProductSearch } from '@/components/ProductId'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, PageTitle, ProductImage, Segmented, Skeleton, errorMessage, inputCls } from '@/components/ui'
import { DELIVERY_PIN_LENGTH, MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES, isDeliveryPin } from '@/domain/delivery'
import { directionsUrl } from '@/domain/location'
import { matchesProductSearch } from '@/domain/productCode'
import { dateTime, timeOfDay } from '@/lib/time'

const RouteMap = lazy(() => import('@/components/RouteMap'))

type Tab = 'mine' | 'available' | 'done'
const TABS: Tab[] = ['mine', 'available', 'done']

const inTab = (j: DeliveryJob, t: Tab) => (t === 'done' ? j.status === 'delivered' : t === 'mine' ? j.mine && j.status !== 'delivered' : !j.mine)

const destination = (j: DeliveryJob) => (j.fulfilment === 'pickup' ? (j.pickupPoint?.name ?? 'Pickup location') : 'Buyer’s address')

/** /delivery: orders ready to go, the ones this rider has taken, and what they've finished. */
export function DeliveryPage() {
  const q = useDeliveryJobs()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const jobs = q.data ?? []
  const mineCount = jobs.filter((j) => inTab(j, 'mine')).length
  const tab = TABS.find((t) => t === params.get('tab')) ?? (q.data && !mineCount ? 'available' : 'mine')
  const shown = jobs.filter((j) => inTab(j, tab) && matchesProductSearch(search, j.productCode, j.listingTitle, j.collectFrom.name, destination(j)))

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Delivery" sub="Take an order, collect it, and get the buyer’s PIN when you hand it over. A delivery only counts once the PIN is entered.">
        Deliveries
      </PageTitle>
      <Segmented<Tab>
        label="Show"
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        className="w-full sm:w-auto sm:self-start"
        options={[
          { value: 'mine', label: 'Yours', count: mineCount },
          { value: 'available', label: 'To take', count: jobs.filter((j) => inTab(j, 'available')).length },
          { value: 'done', label: 'Done' },
        ]}
      />
      {jobs.length ? <ProductSearch value={search} onChange={setSearch} /> : null}
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : shown.length === 0 && search.trim() ? (
        <NoProductMatch query={search} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={TruckIcon}
          title={tab === 'mine' ? 'Nothing on your list' : tab === 'available' ? 'Nothing to take right now' : 'No deliveries yet'}
          body={tab === 'mine' ? 'Orders you take show up here, with the address and map.' : tab === 'available' ? 'Orders appear here once the seller has them ready.' : 'Deliveries you complete are listed here.'}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((j) => (
            <JobCard key={j.id} job={j} tab={tab} />
          ))}
        </div>
      )}
    </div>
  )
}

function JobCard({ job: j, tab }: { job: DeliveryJob; tab: Tab }) {
  const { take } = useDeliveryActions()
  const navigate = useNavigate()
  const toast = useToast()
  const summary = (
    <div className="flex min-w-0 flex-1 gap-3">
      <ProductImage category={j.category} src={j.listingImage ?? undefined} alt="" size="sm" className="size-16 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <strong className="leading-tight">{j.listingTitle}</strong>
        <ProductId code={j.productCode} />
        <span className="text-xs text-subtle">
          {j.collectFrom.name} → {destination(j)}
        </span>
        {tab === 'done' && j.deliveredAt ? <span className="text-xs text-subtle">Delivered {dateTime(j.deliveredAt)}</span> : null}
      </div>
    </div>
  )

  if (tab === 'mine')
    return (
      <Link to={`/delivery/${j.id}`} className="flex min-w-0 animate-fade-up items-center gap-3 rounded-3xl border border-line bg-surface p-4 text-ink no-underline shadow-card transition hover:shadow-lift">
        {summary}
        <ChevronRightIcon className="shrink-0 text-subtle" />
      </Link>
    )
  return (
    <Card className="flex min-w-0 animate-fade-up flex-col gap-3 p-4">
      {summary}
      {tab === 'available' ? (
        <>
          <span className="text-xs text-subtle">The address and map appear once you take it.</span>
          <Button
            loading={take.isPending && take.variables === j.id}
            disabled={take.isPending}
            onClick={() => take.mutate(j.id, { onSuccess: () => navigate(`/delivery/${j.id}`), onError: (e) => toast(errorMessage(e), 'error') })}
          >
            <TruckIcon size={16} /> Take this delivery
          </Button>
        </>
      ) : null}
    </Card>
  )
}

/** /delivery/:id: everything needed to deliver one order you've taken. */
export function DeliveryJobPage() {
  const { id = '' } = useParams()
  const q = useDeliveryJobs()
  const back = (
    <Link to="/delivery" className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-xl px-2 text-sm font-bold text-muted no-underline hover:bg-sunken hover:text-ink">
      <BackIcon size={18} /> Deliveries
    </Link>
  )
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const j = q.data.find((x) => x.id === id)
  // Delivered, handed back or taken by someone else: its details are gone from here.
  if (!j?.mine || j.status === 'delivered') return <Navigate to="/delivery" replace />
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      {back}
      <JobDetails job={j} />
    </div>
  )
}

function JobDetails({ job: j }: { job: DeliveryJob }) {
  const pickup = j.fulfilment === 'pickup'
  const spot = pickup ? j.pickupPoint?.location : j.dropOff?.location
  const address = pickup ? j.pickupPoint?.address : j.dropOff?.address
  return (
    <>
      <Card className="flex gap-3 p-4">
        <ProductImage category={j.category} src={j.listingImage ?? undefined} alt={j.listingTitle} size="sm" className="size-18 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-xl leading-tight font-extrabold">{j.listingTitle}</h1>
          <ProductId code={j.productCode} copy />
          <Badge tone="sky" className="w-fit">{pickup ? 'For a pickup location' : 'To the buyer'}</Badge>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4 text-sm">
        <span className="flex items-start gap-2">
          <StoreIcon size={16} className="mt-0.5 shrink-0 text-brand" />
          <span><strong>Collect from</strong> {j.collectFrom.name}, {j.collectFrom.area}</span>
        </span>
        <span className="flex items-start gap-2">
          <MapPinIcon size={16} className="mt-0.5 shrink-0 text-hot" />
          <span><strong>{pickup ? `Bring to ${j.pickupPoint?.name ?? 'the pickup location'}` : 'Deliver to'}</strong> {address}</span>
        </span>
        {spot ? (
          <>
            {/* isolate: Leaflet's own layers mustn't sit above the app's sticky headers. */}
            <div className="relative isolate h-72 overflow-hidden rounded-2xl border border-line bg-sunken">
              <Suspense fallback={<Skeleton className="size-full" />}>
                <RouteMap point={spot} label={`Map of the drop-off: ${address ?? ''}`} />
              </Suspense>
            </div>
            <a href={directionsUrl(spot)} target="_blank" rel="noreferrer" className="flex min-h-11 w-fit items-center gap-2 font-bold">
              <MapPinIcon size={16} /> Get directions
            </a>
          </>
        ) : (
          <Notice tone="ticket">This order was placed before map pins, so go by the written address.</Notice>
        )}
        {j.dropOff ? (
          <div className="flex flex-col gap-1 border-t border-line pt-3">
            <span className="flex items-center gap-2">
              <UserIcon size={16} className="shrink-0 text-muted" /> {j.dropOff.buyerName}
            </span>
            <a href={`tel:${j.dropOff.contactPhone.replace(/\s/g, '')}`} className="flex min-h-11 w-fit items-center gap-2 font-bold">
              <PhoneIcon size={16} /> Call {j.dropOff.contactPhone}
            </a>
          </div>
        ) : null}
      </Card>

      <PinForm job={j} />
      <HandBack job={j} />
    </>
  )
}

function PinForm({ job: j }: { job: DeliveryJob }) {
  const { confirm } = useDeliveryActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = useState(j.pinLockedUntil)
  const locked = !!lockedUntil && Date.parse(lockedUntil) > Date.now()

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!isDeliveryPin(pin)) {
      setProblem(`Enter all ${DELIVERY_PIN_LENGTH} digits.`)
      return
    }
    confirm.mutate(
      { id: j.id, pin },
      {
        onSuccess: (r) => {
          if (r.confirmed) {
            toast('Delivered. Thank you!')
            navigate('/delivery', { replace: true })
            return
          }
          setPin('')
          setLockedUntil(r.lockedUntil)
          setProblem(r.lockedUntil ? null : `That’s not the PIN. ${r.attemptsLeft} ${r.attemptsLeft === 1 ? 'try' : 'tries'} left.`)
        },
        onError: (err) => setProblem(errorMessage(err)),
      },
    )
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <strong className="flex items-center gap-2">
        <LockIcon size={16} className="text-brand" /> Confirm the handover
      </strong>
      <p className="text-sm text-muted">Hand the item over first. The buyer then reads you the PIN from their order, which only they can see.</p>
      {locked ? (
        <Notice tone="hot">
          Too many wrong tries. You can try again at {timeOfDay(lockedUntil)}. Check the PIN with the buyer on the phone in the meantime.
        </Notice>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <Field label="Buyer’s PIN" htmlFor="delivery-pin" error={problem ?? undefined} hint={`${MAX_PIN_ATTEMPTS} wrong tries pauses it for ${PIN_LOCK_MINUTES} minutes.`}>
            <input
              id="delivery-pin"
              inputMode="numeric"
              autoComplete="off"
              maxLength={DELIVERY_PIN_LENGTH}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ''))
                setProblem(null)
              }}
              placeholder="000000"
              className={`${inputCls} text-center font-mono text-2xl tracking-[0.4em]`}
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={confirm.isPending}>
            <CheckCircleIcon size={18} /> Confirm {j.fulfilment === 'pickup' ? 'collection' : 'delivery'}
          </Button>
        </form>
      )}
    </Card>
  )
}

function HandBack({ job: j }: { job: DeliveryJob }) {
  const { release } = useDeliveryActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" className="min-h-11 self-center" onClick={() => setOpen(true)}>
        I can’t do this delivery
      </Button>
      <Sheet open={open} onClose={() => !release.isPending && setOpen(false)} title="Hand back this delivery">
        <h2 className="pr-10 font-display text-2xl font-extrabold">Hand this back?</h2>
        <p className="text-sm text-muted">It goes back on the list for another rider to take, and you won’t see the buyer’s details any more.</p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={release.isPending} onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={release.isPending}
            onClick={() =>
              release.mutate(j.id, {
                onSuccess: () => {
                  toast('Handed back.', 'info')
                  navigate('/delivery', { replace: true })
                },
                onError: (e) => toast(errorMessage(e), 'error'),
              })
            }
          >
            Hand it back
          </Button>
        </div>
      </Sheet>
    </>
  )
}
