import { Suspense, lazy, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { useDeliveryActions, useDeliveryJobs, useMyCounter, useReturnJobs } from '@/api/hooks'
import type { DeliveryJob } from '@/api/types'
import { AlertIcon, BackIcon, ChatIcon, CheckCircleIcon, ChevronRightIcon, LockIcon, MapPinIcon, PhoneIcon, StoreIcon, TruckIcon, UserIcon } from '@/components/icons'
import { NoProductMatch, ProductId, ProductSearch } from '@/components/ProductId'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, PageTitle, ProductImage, Segmented, Skeleton, cx, errorMessage, inputCls } from '@/components/ui'
import { DELIVERY_PIN_LENGTH, MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES, isDeliveryPin } from '@/domain/delivery'
import { COLLECTION_CHECKS, COLLECTION_PROBLEMS, COLLECTION_PROBLEM_TEXT, REFUSAL_REASONS, REFUSAL_TEXT, collectionFailError, photosError } from '@/domain/deliveryChecks'
import type { CollectionProblem, RefusalReason } from '@/domain/types'
import { RiderPhotos } from '@/components/RiderPhotos'
import { CollectByLine, CollectByNotice } from './CollectBy'
import { CounterPage } from './CounterPage'
import { NotHome } from './NotHome'
import { RiderPhoto } from './RiderPhoto'
import { JobFacts, PoolControls, usePoolView } from './PoolControls'
import { DeliveryChatSheet } from '@/components/DeliveryChat'
import { firstName } from '@/domain/deliveryChat'
import { ReturnJobList } from './ReturnJobs'
import { directionsUrl } from '@/domain/location'
import { matchesProductSearch } from '@/domain/productCode'
import { takeJobError } from '@/domain/riderLimits'
import { dateTime, timeOfDay } from '@/lib/time'

const RouteMap = lazy(() => import('@/components/RouteMap'))

type Tab = 'mine' | 'available' | 'returns' | 'done'
const TABS: Tab[] = ['mine', 'available', 'returns', 'done']

/** Done once delivered, or once a pickup order is with the counter. */
const finished = (j: DeliveryJob) => j.status === 'delivered' || !!j.atCounterAt
const inTab = (j: DeliveryJob, t: Tab) => (t === 'done' ? finished(j) : t === 'mine' ? j.mine && !finished(j) : !j.mine)

const destination = (j: DeliveryJob) => (j.fulfilment === 'pickup' ? (j.pickupPoint?.name ?? 'Pickup location') : 'Buyer’s address')
/** Where it goes from, and to. An uncollected item goes from the counter back to the seller. */
const route = (j: DeliveryJob) => (j.returning ? `${j.pickupPoint?.name ?? 'Pickup location'} → ${j.collectFrom.name}` : `${j.collectFrom.name} → ${destination(j)}`)

/** /delivery: counter staff get their counter; riders get the job pool. */
export function DeliveryHome() {
  const counter = useMyCounter()
  if (counter.isPending) return <Skeleton className="h-96" />
  if (counter.isError) return <ErrorState error={counter.error} onRetry={() => counter.refetch()} />
  return counter.data ? <CounterPage point={counter.data} /> : <DeliveryPage />
}

/** /delivery: orders ready to go, the ones this rider has taken, and what they've finished. */
export function DeliveryPage() {
  const q = useDeliveryJobs()
  const returns = useReturnJobs()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const jobs = q.data ?? []
  const mineCount = jobs.filter((j) => inTab(j, 'mine')).length
  // The server has the final say: admins can change the limit.
  const full = takeJobError(mineCount + (returns.data ?? []).filter((r) => r.mine).length)
  const tab = TABS.find((t) => t === params.get('tab')) ?? (q.data && !mineCount ? 'available' : 'mine')
  const pool = usePoolView()
  const matching = jobs.filter((j) => inTab(j, tab) && matchesProductSearch(search, j.productCode, j.listingTitle, j.collectFrom.name, destination(j)))
  // Only the pool is filtered and sorted: your own jobs are always all there.
  const shown = tab === 'available' ? pool.view.apply(matching) : matching

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Delivery" sub="Take an order, collect it, and get the buyer’s PIN when you hand it over. A delivery only counts once the PIN is entered.">
        Deliveries
      </PageTitle>
      <RiderPhoto />
      <Segmented<Tab>
        label="Show"
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        className="w-full sm:w-auto sm:self-start"
        options={[
          { value: 'mine', label: 'Yours', count: mineCount },
          { value: 'available', label: 'To take', count: jobs.filter((j) => inTab(j, 'available')).length },
          { value: 'returns', label: 'Returns', count: returns.data?.length ?? 0 },
          { value: 'done', label: 'Done' },
        ]}
      />
      {tab === 'available' || tab === 'returns' ? <PoolControls pool={pool} /> : null}
      {tab === 'returns' ? <ReturnJobList view={pool.view} /> : null}
      {full && (tab === 'available' || tab === 'returns') ? <Notice tone="ticket">{full}</Notice> : null}
      {jobs.length && tab !== 'returns' ? <ProductSearch value={search} onChange={setSearch} /> : null}
      {tab === 'returns' ? null : q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : shown.length === 0 && search.trim() ? (
        <NoProductMatch query={search} />
      ) : shown.length === 0 && tab === 'available' && pool.view.area ? (
        <EmptyState icon={TruckIcon} title="Nothing in this area right now" body="Jobs collected in or going to this area appear here. Try all areas." />
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
        <strong className="leading-tight">{j.listingTitle}{j.quantity > 1 ? ` × ${j.quantity}` : ''}</strong>
        <ProductId code={j.productCode} />
        <span className="text-xs text-subtle">{route(j)}</span>
        {tab === 'mine' && j.collectBy ? <CollectByLine at={j.collectBy} /> : null}
        {tab === 'available' || tab === 'mine' ? <JobFacts job={j} /> : null}
        {tab === 'done' && j.atCounterAt ? <span className="text-xs text-subtle">Handed to the counter {dateTime(j.atCounterAt)}</span> : tab === 'done' && j.deliveredAt ? <span className="text-xs text-subtle">Delivered {dateTime(j.deliveredAt)}</span> : null}
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
  // Delivered, at the counter, handed back or taken by someone else: its details are gone from here.
  if (!j?.mine || finished(j)) return <Navigate to="/delivery" replace />
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      {back}
      <JobDetails job={j} />
    </div>
  )
}

function JobDetails({ job: j }: { job: DeliveryJob }) {
  if (j.returning) return <ReturnLeg job={j} />
  const pickup = j.fulfilment === 'pickup'
  const atSeller = !j.collected
  const spot = atSeller ? j.collectFrom.location : pickup ? j.pickupPoint?.location : j.dropOff?.location
  const address = pickup ? j.pickupPoint?.address : j.dropOff?.address
  return (
    <>
      <Card className="flex gap-3 p-4">
        <ProductImage category={j.category} src={j.listingImage ?? undefined} alt={j.listingTitle} size="sm" className="size-18 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-xl leading-tight font-extrabold">{j.listingTitle}{j.quantity > 1 ? ` × ${j.quantity}` : ''}</h1>
          <ProductId code={j.productCode} copy />
          <Badge tone="sky" className="w-fit">{pickup ? 'For a pickup location' : 'To the buyer'}</Badge>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4 text-sm">
        <span className="flex items-start gap-2">
          <StoreIcon size={16} className="mt-0.5 shrink-0 text-brand" />
          <span><strong>Collect from</strong> {j.collectFrom.name}, {j.collectFrom.area}{j.collectFrom.address ? <span className="block text-muted">{j.collectFrom.address}</span> : null}</span>
        </span>
        <span className="flex items-start gap-2">
          <MapPinIcon size={16} className="mt-0.5 shrink-0 text-hot" />
          {pickup || j.collected ? (
            <span><strong>{pickup ? `Bring to ${j.pickupPoint?.name ?? 'the pickup location'}` : 'Deliver to'}</strong> {address}</span>
          ) : (
            <span className="text-muted">The address and the buyer’s number appear once the item passes your check.</span>
          )}
        </span>
        {spot ? (
          <>
            {/* isolate: Leaflet's own layers mustn't sit above the app's sticky headers. */}
            <div className="relative isolate h-72 overflow-hidden rounded-2xl border border-line bg-sunken">
              <Suspense fallback={<Skeleton className="size-full" />}>
                <RouteMap point={spot} label={atSeller ? `Map of where to collect: ${j.collectFrom.address ?? ''}` : `Map of the drop-off: ${address ?? ''}`} />
              </Suspense>
            </div>
            <a href={directionsUrl(spot)} target="_blank" rel="noreferrer" className="flex min-h-11 w-fit items-center gap-2 font-bold">
              <MapPinIcon size={16} /> Get directions
            </a>
          </>
        ) : j.collected ? (
          <Notice tone="ticket">This order was placed before map pins, so go by the written address.</Notice>
        ) : null}
        {atSeller && j.collectFrom.contactPhone ? (
          <a href={`tel:${j.collectFrom.contactPhone.replace(/\s/g, '')}`} className="flex min-h-11 w-fit items-center gap-2 font-bold">
            <PhoneIcon size={16} /> Call the seller on {j.collectFrom.contactPhone}
          </a>
        ) : null}
        {j.dropOff ? (
          <div className="flex flex-col gap-1 border-t border-line pt-3">
            <span className="flex items-center gap-2">
              <UserIcon size={16} className="shrink-0 text-muted" /> {j.dropOff.buyerName}
            </span>
            <a href={`tel:${j.dropOff.contactPhone.replace(/\s/g, '')}`} className="flex min-h-11 w-fit items-center gap-2 font-bold">
              <PhoneIcon size={16} /> Call {j.dropOff.contactPhone}
            </a>
            {j.fulfilment === 'delivery' ? <MessageBuyer orderId={j.id} name={firstName(j.dropOff.buyerName)} /> : null}
          </div>
        ) : null}
      </Card>

      {j.collected && pickup ? (
        <Notice tone="sky" icon={StoreIcon} title={`Hand it in at ${j.pickupPoint?.name ?? 'the counter'}`}>
          The counter staff check the product ID on the label ({j.productCode}) and take it in. That finishes this job, and the buyer collects it from them.
        </Notice>
      ) : j.collected ? (
        <>
          <PinForm job={j} />
          <NotHome job={j} />
          <RefuseAtDoor job={j} />
        </>
      ) : (
        <>
          {j.collectBy ? <CollectByNotice at={j.collectBy} /> : null}
          <CollectionCheck job={j} />
        </>
      )}
      <HandBack job={j} />
    </>
  )
}

function MessageBuyer({ orderId, name }: { orderId: string; name: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <ChatIcon size={16} /> Message {name}
      </Button>
      <DeliveryChatSheet orderId={orderId} title={`Message ${name}`} open={open} onClose={() => setOpen(false)} />
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
      <p className="text-sm text-muted">Let the buyer open it and check it. If they’re happy, they read you the PIN from their order, which only they can see.</p>
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

/** Before leaving the seller. The buyer's details stay hidden until this passes. */
function CollectionCheck({ job: j }: { job: DeliveryJob }) {
  const { pass } = useDeliveryActions()
  const toast = useToast()
  const [ticked, setTicked] = useState<boolean[]>(COLLECTION_CHECKS.map(() => false))
  const [photos, setPhotos] = useState<string[]>([])
  const [failing, setFailing] = useState(false)
  const allTicked = ticked.every(Boolean)
  const problem = photosError(photos)

  function onPass() {
    if (!allTicked || problem) {
      toast(allTicked ? problem! : 'Tick every check first.', 'error')
      return
    }
    pass.mutate({ id: j.id, photos }, { onSuccess: () => toast('Checked. The buyer’s details are below.'), onError: (e) => toast(errorMessage(e), 'error') })
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <strong className="flex items-center gap-2">
        <CheckCircleIcon size={16} className="text-brand" /> Check it before you leave
      </strong>
      <p className="text-sm text-muted">Compare what you’re handed with these. You’re looking for the wrong item or visible damage, and aren’t expected to spot a good fake.</p>
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        {j.listingImage ? (
          <span className="flex flex-col gap-1">
            <img src={j.listingImage} alt="The listing’s photo" className="size-28 rounded-xl border border-line bg-photo object-cover" />
            The listing
          </span>
        ) : null}
        {j.confirmPhoto ? (
          <span className="flex flex-col gap-1">
            <img src={j.confirmPhoto} alt="The seller’s photo for this order" className="size-28 rounded-xl border border-line bg-photo object-cover" />
            The seller’s photo
          </span>
        ) : null}
      </div>
      <p className="text-sm font-bold">You should be collecting {j.quantity} {j.quantity === 1 ? 'item' : 'items'}.</p>
      <ul className="flex flex-col gap-1">
        {COLLECTION_CHECKS.map((c, i) => (
          <li key={c}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 shrink-0 accent-brand" checked={ticked[i]} onChange={() => setTicked((t) => t.map((v, n) => (n === i ? !v : v)))} />
              {c}
            </label>
          </li>
        ))}
      </ul>
      <RiderPhotos photos={photos} onChange={setPhotos} />
      <Button size="lg" loading={pass.isPending} onClick={onPass}>
        <TruckIcon size={18} /> It’s right: I’m taking it
      </Button>
      <Button variant="ghost" onClick={() => setFailing(true)}>
        <AlertIcon size={16} /> There’s a problem
      </Button>
      {failing ? <FailSheet job={j} photos={photos} onPhotos={setPhotos} onClose={() => setFailing(false)} /> : null}
    </Card>
  )
}

function FailSheet({ job: j, photos, onPhotos, onClose }: { job: DeliveryJob; photos: string[]; onPhotos: (p: string[]) => void; onClose: () => void }) {
  const { fail } = useDeliveryActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [problems, setProblems] = useState<CollectionProblem[]>([])
  const [note, setNote] = useState('')
  const [showError, setShowError] = useState(false)
  const error = collectionFailError(problems, photos)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (error) {
      setShowError(true)
      return
    }
    fail
      .mutateAsync({ id: j.id, problems, note, photos })
      .then(() => {
        toast('Recorded. The buyer has been refunded, so leave the item with the seller.', 'info')
        navigate('/delivery', { replace: true })
      })
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <Sheet open onClose={() => !fail.isPending && onClose()} title="Report a problem">
      <h2 className="pr-10 font-display text-2xl font-extrabold">What’s wrong?</h2>
      <p className="text-sm text-muted">This cancels the order. The buyer is refunded and the seller is charged, so only report what you can see.</p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Problems</legend>
          {COLLECTION_PROBLEMS.map((p) => (
            <label key={p} className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm transition', problems.includes(p) ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong')}>
              <input type="checkbox" className="size-4 shrink-0 accent-brand" checked={problems.includes(p)} onChange={() => setProblems((all) => (all.includes(p) ? all.filter((x) => x !== p) : [...all, p]))} />
              {COLLECTION_PROBLEM_TEXT[p]}
            </label>
          ))}
        </fieldset>
        <RiderPhotos photos={photos} onChange={onPhotos} label="Take a photo of the problem" />
        <Field label="Anything to add? (optional)" htmlFor={`fail-note-${j.id}`} error={showError && error ? error : undefined}>
          <textarea id={`fail-note-${j.id}`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} rows={2} className={cx(inputCls, 'py-3')} />
        </Field>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={fail.isPending}>
            Go back
          </Button>
          <Button type="submit" variant="danger" className="flex-1" loading={fail.isPending}>
            Cancel the order
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

/** Needs the buyer's PIN, so a refusal can't be claimed without them. */
function RefuseAtDoor({ job: j }: { job: DeliveryJob }) {
  const { refuse } = useDeliveryActions()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<RefusalReason | null>(null)
  const [pin, setPin] = useState('')
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!reason) return setProblem('Pick why it’s being refused.')
    if (!photos.length) return setProblem('Take a photo of the item.')
    if (!isDeliveryPin(pin)) return setProblem(`Enter all ${DELIVERY_PIN_LENGTH} digits of the buyer’s PIN.`)
    refuse
      .mutateAsync({ id: j.id, pin, reason, note, photo: photos[0] })
      .then((r) => {
        if (r.confirmed) {
          toast('Refused. The buyer has been refunded. Take it back to the seller.', 'info')
          return
        }
        setPin('')
        setProblem(r.lockedUntil ? `Too many wrong tries. You can try again at ${timeOfDay(r.lockedUntil)}.` : `That’s not the PIN. ${r.attemptsLeft} ${r.attemptsLeft === 1 ? 'try' : 'tries'} left.`)
      })
      .catch((err) => setProblem(errorMessage(err)))
  }

  return (
    <>
      <Button variant="ghost" className="min-h-11 self-center" onClick={() => setOpen(true)}>
        <AlertIcon size={16} /> The buyer is refusing it
      </Button>
      <Sheet open={open} onClose={() => !refuse.isPending && setOpen(false)} title="Refuse the item">
        <h2 className="pr-10 font-display text-2xl font-extrabold">Why are they refusing it?</h2>
        <p className="text-sm text-muted">Only if it’s wrong or damaged, not if they’ve changed their mind. The buyer gives you their PIN to agree, and you take it back to the seller.</p>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">Reason</legend>
            {REFUSAL_REASONS.map((r) => (
              <label key={r} className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm transition', reason === r ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong')}>
                <input type="radio" name={`refuse-${j.id}`} checked={reason === r} onChange={() => setReason(r)} className="size-4 shrink-0 accent-brand" />
                {REFUSAL_TEXT[r]}
              </label>
            ))}
          </fieldset>
          <RiderPhotos photos={photos} onChange={setPhotos} max={1} label="Take a photo of the item" />
          <Field label="Note (optional)" htmlFor={`refuse-note-${j.id}`}>
            <textarea id={`refuse-note-${j.id}`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} rows={2} className={cx(inputCls, 'py-3')} />
          </Field>
          <Field label="Buyer’s PIN" htmlFor={`refuse-pin-${j.id}`} error={problem ?? undefined}>
            <input id={`refuse-pin-${j.id}`} inputMode="numeric" autoComplete="off" maxLength={DELIVERY_PIN_LENGTH} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className={`${inputCls} text-center font-mono text-xl tracking-[0.3em]`} />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={refuse.isPending}>
              Go back
            </Button>
            <Button type="submit" variant="danger" className="flex-1" loading={refuse.isPending}>
              Refuse it
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  )
}

/** A refused item going back to the seller. */
function ReturnLeg({ job: j }: { job: DeliveryJob }) {
  const { finishReturn } = useDeliveryActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [photos, setPhotos] = useState<string[]>([])

  function onDone() {
    if (!photos.length) {
      toast('Take a photo of the handover.', 'error')
      return
    }
    finishReturn
      .mutateAsync({ id: j.id, photo: photos[0] })
      .then(() => {
        toast('Returned. Thank you!')
        navigate('/delivery', { replace: true })
      })
      .catch((e) => toast(errorMessage(e), 'error'))
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex gap-3">
        <ProductImage category={j.category} src={j.listingImage ?? undefined} alt={j.listingTitle} size="sm" className="size-18 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-xl leading-tight font-extrabold">{j.listingTitle}{j.quantity > 1 ? ` × ${j.quantity}` : ''}</h1>
          <ProductId code={j.productCode} copy />
          <Badge tone="hot" className="w-fit">{j.fulfilment === 'pickup' ? 'Not collected: take it back' : j.failedAttempts ? 'Not delivered: take it back' : 'Refused: take it back'}</Badge>
        </div>
      </div>
      <span className="flex items-start gap-2 text-sm">
        <StoreIcon size={16} className="mt-0.5 shrink-0 text-brand" />
        <span><strong>Return to</strong> {j.collectFrom.name}, {j.collectFrom.area}{j.collectFrom.address ? <span className="block text-muted">{j.collectFrom.address}</span> : null}</span>
      </span>
      {j.collectFrom.location ? (
        <a href={directionsUrl(j.collectFrom.location)} target="_blank" rel="noreferrer" className="flex min-h-11 w-fit items-center gap-2 text-sm font-bold">
          <MapPinIcon size={16} /> Get directions
        </a>
      ) : null}
      {j.collectFrom.contactPhone ? (
        <a href={`tel:${j.collectFrom.contactPhone.replace(/\s/g, '')}`} className="flex min-h-11 w-fit items-center gap-2 text-sm font-bold">
          <PhoneIcon size={16} /> Call the seller on {j.collectFrom.contactPhone}
        </a>
      ) : null}
      {j.waitingAtCounter ? (
        <>
          <span className="flex items-start gap-2 text-sm">
            <MapPinIcon size={16} className="mt-0.5 shrink-0 text-hot" />
            <span><strong>Collect from</strong> {j.pickupPoint?.name}<span className="block text-muted">{j.pickupPoint?.address}</span></span>
          </span>
          {j.pickupPoint ? (
            <a href={directionsUrl(j.pickupPoint.location)} target="_blank" rel="noreferrer" className="flex min-h-11 w-fit items-center gap-2 text-sm font-bold">
              <MapPinIcon size={16} /> Get directions to the counter
            </a>
          ) : null}
          <Notice tone="sky">The counter staff hand it to you. Once they have, you can finish here at the seller.</Notice>
          <HandBack job={j} />
        </>
      ) : (
        <>
          <RiderPhotos photos={photos} onChange={setPhotos} max={1} label="Take a photo of the handover" />
          <Button size="lg" loading={finishReturn.isPending} onClick={onDone}>
            <CheckCircleIcon size={18} /> It’s back with the seller
          </Button>
        </>
      )}
    </Card>
  )
}
