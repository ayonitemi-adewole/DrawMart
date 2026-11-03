import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useReturnActions, useReturnJobs } from '@/api/hooks'
import type { ReturnJob } from '@/api/types'
import { AlertIcon, BackIcon, CheckCircleIcon, ChevronRightIcon, MapPinIcon, PhoneIcon, StoreIcon, TruckIcon, UserIcon } from '@/components/icons'
import { ProductId } from '@/components/ProductId'
import { RiderPhotos } from '@/components/RiderPhotos'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, ProductImage, Skeleton, cx, errorMessage, inputCls } from '@/components/ui'
import { directionsUrl } from '@/domain/location'
import { CollectByLine, CollectByNotice } from './CollectBy'
import { JobFacts, type PoolView } from './PoolControls'
import { LockedText } from './NewRider'
import { ReportProblem } from './ReportProblem'

/** The Returns tab: items going from a buyer back to a seller. */
export function ReturnJobList({ view }: { view: PoolView }) {
  const q = useReturnJobs()
  const { take } = useReturnActions()
  const navigate = useNavigate()
  const toast = useToast()
  if (q.isPending) return <Skeleton className="h-40" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data.length) return <EmptyState icon={TruckIcon} title="No returns right now" body="Items going back from a buyer to a seller appear here." />
  // Yours first, then the pool, filtered and sorted.
  const shown = [...q.data.filter((j) => j.mine), ...view.apply(q.data.filter((j) => !j.mine))]
  if (!shown.length) return <EmptyState icon={TruckIcon} title="No returns in this area" body="Try all areas." />
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {shown.map((j) => (
        <Card key={j.id} className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex min-w-0 gap-3">
            <ProductImage category={j.category} src={j.listingImage ?? undefined} alt="" size="sm" className="size-16 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
              <strong className="leading-tight">{j.listingTitle}{j.quantity > 1 ? ` × ${j.quantity}` : ''}</strong>
              <ProductId code={j.productCode} />
              <span className="text-xs text-subtle">Buyer → {j.returnTo.name}, {j.returnTo.area}</span>
              <JobFacts job={j} />
              {j.locked && !j.mine ? <span className="text-xs text-subtle"><LockedText /></span> : null}
              {j.collectBy ? <CollectByLine at={j.collectBy} /> : null}
            </div>
          </div>
          {j.mine ? (
            <Link to={`/delivery/returns/${j.id}`} className="flex min-h-11 items-center justify-between rounded-xl border border-line px-3 text-sm font-bold text-ink no-underline">
              {j.status === 'returning' ? 'Take it to the seller' : 'Collect it from the buyer'} <ChevronRightIcon className="shrink-0 text-subtle" />
            </Link>
          ) : (
            <Button loading={take.isPending && take.variables === j.id} disabled={take.isPending || j.locked} onClick={() => take.mutate(j.id, { onSuccess: () => navigate(`/delivery/returns/${j.id}`), onError: (e) => toast(errorMessage(e), 'error') })}>
              <TruckIcon size={16} /> Take this return
            </Button>
          )}
        </Card>
      ))}
    </div>
  )
}

/** /delivery/returns/:id */
export function ReturnJobPage() {
  const { id = '' } = useParams()
  const q = useReturnJobs()
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const j = q.data.find((x) => x.id === id)
  if (!j?.mine) return <Navigate to="/delivery?tab=returns" replace />
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <Link to="/delivery?tab=returns" className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-xl px-2 text-sm font-bold text-muted no-underline hover:bg-sunken hover:text-ink">
        <BackIcon size={18} /> Returns
      </Link>
      <Card className="flex gap-3 p-4">
        <ProductImage category={j.category} src={j.listingImage ?? undefined} alt={j.listingTitle} size="sm" className="size-18 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-xl leading-tight font-extrabold">{j.listingTitle}{j.quantity > 1 ? ` × ${j.quantity}` : ''}</h1>
          <ProductId code={j.productCode} copy />
          <Badge tone="hot" className="w-fit">{j.kind === 'fault' ? 'Reported faulty' : 'Changed their mind'}</Badge>
        </div>
      </Card>
      <ReportProblem kind="return" id={j.id} />
      {j.status === 'returning' ? <BackToSeller job={j} /> : <CollectFromBuyer job={j} />}
    </div>
  )
}

function Place({ icon: Icon, title, address, location, phone, callLabel }: { icon: typeof StoreIcon; title: string; address?: string; location?: { lat: number; lng: number }; phone?: string; callLabel: string }) {
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <span className="flex items-start gap-2">
        <Icon size={16} className="mt-0.5 shrink-0 text-brand" />
        <span><strong>{title}</strong>{address ? <span className="block text-muted">{address}</span> : null}</span>
      </span>
      {location ? (
        <a href={directionsUrl(location)} target="_blank" rel="noreferrer" className="flex min-h-11 w-fit items-center gap-2 font-bold">
          <MapPinIcon size={16} /> Get directions
        </a>
      ) : null}
      {phone ? (
        <a href={`tel:${phone.replace(/\s/g, '')}`} className="flex min-h-11 w-fit items-center gap-2 font-bold">
          <PhoneIcon size={16} /> {callLabel} on {phone}
        </a>
      ) : null}
    </Card>
  )
}

function CollectFromBuyer({ job: j }: { job: ReturnJob }) {
  const { pass, release } = useReturnActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [photos, setPhotos] = useState<string[]>([])
  const [failing, setFailing] = useState(false)
  const from = j.pickupFrom

  function onPass() {
    if (!photos.length) {
      toast('Add 1 to 3 photos.', 'error')
      return
    }
    pass.mutate({ id: j.id, photos }, { onSuccess: () => toast('Collected. The buyer has been refunded.'), onError: (e) => toast(errorMessage(e), 'error') })
  }

  return (
    <>
      <Place icon={UserIcon} title={`Collect from ${from?.buyerName ?? 'the buyer'}`} address={from?.address} location={from?.location} phone={from?.contactPhone} callLabel="Call the buyer" />
      {j.collectBy ? <CollectByNotice at={j.collectBy} /> : null}
      <Card className="flex flex-col gap-4 p-4">
        <strong className="flex items-center gap-2">
          <CheckCircleIcon size={16} className="text-brand" /> Check it before you take it
        </strong>
        <p className="text-sm text-muted">
          {j.kind === 'change_of_mind' ? 'It must be unused, complete and in its packaging. ' : 'It should be the item they reported, with the fault they described. '}
          The buyer is refunded as soon as you confirm, so take photos first.
        </p>
        <RiderPhotos photos={photos} onChange={setPhotos} />
        <Button size="lg" loading={pass.isPending} onClick={onPass}>
          <TruckIcon size={18} /> I’ve collected it
        </Button>
        <Button variant="ghost" onClick={() => setFailing(true)}>
          <AlertIcon size={16} /> It’s not as described
        </Button>
        <Button
          variant="ghost"
          loading={release.isPending}
          onClick={() => release.mutate(j.id, { onSuccess: () => navigate('/delivery?tab=returns', { replace: true }), onError: (e) => toast(errorMessage(e), 'error') })}
        >
          I can’t do this return
        </Button>
      </Card>
      {failing ? <FailReturnSheet job={j} photos={photos} onPhotos={setPhotos} onClose={() => setFailing(false)} /> : null}
    </>
  )
}

function FailReturnSheet({ job: j, photos, onPhotos, onClose }: { job: ReturnJob; photos: string[]; onPhotos: (p: string[]) => void; onClose: () => void }) {
  const { fail } = useReturnActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [note, setNote] = useState('')
  const [showError, setShowError] = useState(false)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (note.trim().length < 5) {
      setShowError(true)
      return
    }
    fail
      .mutateAsync({ id: j.id, note, photos })
      .then(() => {
        toast('Recorded. Leave the item with the buyer.', 'info')
        navigate('/delivery?tab=returns', { replace: true })
      })
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <Sheet open onClose={() => !fail.isPending && onClose()} title="Not as described">
      <h2 className="pr-10 font-display text-2xl font-extrabold">What’s wrong?</h2>
      <p className="text-sm text-muted">The buyer won’t be refunded and will see what you write, so stick to what you can see.</p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="What did you find?" htmlFor={`fail-return-${j.id}`} error={showError ? 'Say what’s wrong.' : undefined}>
          <textarea id={`fail-return-${j.id}`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} rows={3} className={cx(inputCls, 'py-3')} />
        </Field>
        <RiderPhotos photos={photos} onChange={onPhotos} />
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={fail.isPending}>
            Go back
          </Button>
          <Button type="submit" variant="danger" className="flex-1" loading={fail.isPending}>
            Don’t take it
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function BackToSeller({ job: j }: { job: ReturnJob }) {
  const { finish } = useReturnActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [photos, setPhotos] = useState<string[]>([])

  function onDone() {
    if (!photos.length) {
      toast('Take a photo of the handover.', 'error')
      return
    }
    finish
      .mutateAsync({ id: j.id, photo: photos[0] })
      .then(() => {
        toast('Returned. Thank you!')
        navigate('/delivery?tab=returns', { replace: true })
      })
      .catch((e) => toast(errorMessage(e), 'error'))
  }

  return (
    <>
      <Place icon={StoreIcon} title={`Return to ${j.returnTo.name}, ${j.returnTo.area}`} address={j.returnTo.address} location={j.returnTo.location} phone={j.returnTo.contactPhone} callLabel="Call the seller" />
      <Notice tone="neutral">The buyer has been refunded.</Notice>
      <Card className="flex flex-col gap-4 p-4">
        <RiderPhotos photos={photos} onChange={setPhotos} max={1} label="Take a photo of the handover" />
        <Button size="lg" loading={finish.isPending} onClick={onDone}>
          <CheckCircleIcon size={18} /> It’s back with the seller
        </Button>
      </Card>
    </>
  )
}
