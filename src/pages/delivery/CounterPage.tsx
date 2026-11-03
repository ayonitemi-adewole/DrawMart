import { useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useCounterActions, useCounterItems } from '@/api/hooks'
import type { CounterItem } from '@/api/types'
import { CheckCircleIcon, LockIcon, StoreIcon, TruckIcon, UserIcon } from '@/components/icons'
import { NoProductMatch, ProductId, ProductSearch } from '@/components/ProductId'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, PageTitle, ProductImage, Segmented, Skeleton, errorMessage, inputCls } from '@/components/ui'
import { COUNTER_RETURN_DAYS, counterCodeError, counterReminderDue, daysOnShelf } from '@/domain/counter'
import { DELIVERY_PIN_LENGTH, MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES, isDeliveryPin } from '@/domain/delivery'
import { matchesProductSearch } from '@/domain/productCode'
import type { PickupPoint } from '@/domain/types'
import { timeOfDay } from '@/lib/time'

type Tab = CounterItem['stage']
const TABS: Tab[] = ['shelf', 'incoming', 'send_back']

/** /delivery for counter staff: take in what riders bring, and hand it to buyers. */
export function CounterPage({ point }: { point: PickupPoint }) {
  const q = useCounterItems()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const items = q.data ?? []
  const tab = TABS.find((t) => t === params.get('tab')) ?? 'shelf'
  const shown = items.filter((i) => i.stage === tab && matchesProductSearch(search, i.productCode, i.listingTitle, i.buyerName ?? ''))
  const count = (t: Tab) => items.filter((i) => i.stage === t).length

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Pickup counter" sub="Take in what riders bring by checking its product ID, and hand it to the buyer once they give you their PIN.">
        {point.name}
      </PageTitle>
      <Segmented<Tab>
        label="Show"
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        className="w-full sm:w-auto sm:self-start"
        options={[
          { value: 'shelf', label: 'On the shelf', count: count('shelf') },
          { value: 'incoming', label: 'Coming in', count: count('incoming') },
          { value: 'send_back', label: 'Going back', count: count('send_back') },
        ]}
      />
      {items.length ? <ProductSearch value={search} onChange={setSearch} /> : null}
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : shown.length === 0 && search.trim() ? (
        <NoProductMatch query={search} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={StoreIcon}
          title={tab === 'shelf' ? 'The shelf is empty' : tab === 'incoming' ? 'Nothing on its way' : 'Nothing to send back'}
          body={
            tab === 'shelf'
              ? 'Items you take in wait here for their buyers.'
              : tab === 'incoming'
                ? 'Orders appear here once a rider has collected them for this counter.'
                : `Items not collected within ${COUNTER_RETURN_DAYS} days go back to the seller with a rider.`
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((i) => (i.stage === 'incoming' ? <IncomingCard key={i.id} item={i} /> : i.stage === 'shelf' ? <ShelfCard key={i.id} item={i} /> : <SendBackCard key={i.id} item={i} />))}
        </div>
      )}
    </div>
  )
}

function Summary({ item: i, children }: { item: CounterItem; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3">
      <ProductImage category={i.category} src={i.listingImage ?? undefined} alt="" size="sm" className="size-16 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <strong className="leading-tight">{i.listingTitle}{i.quantity > 1 ? ` × ${i.quantity}` : ''}</strong>
        <ProductId code={i.productCode} />
        {children}
      </div>
    </div>
  )
}

/** A rider has it: staff check the label against the order before taking it. */
function IncomingCard({ item: i }: { item: CounterItem }) {
  const { receive } = useCounterActions()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const error = counterCodeError(code, i.productCode)
    if (error) {
      setProblem(error)
      return
    }
    receive
      .mutateAsync({ id: i.id, code })
      .then(() => toast('On the shelf. The buyer has been told.'))
      .catch((err) => setProblem(errorMessage(err)))
  }

  return (
    <Card className="flex min-w-0 animate-fade-up flex-col gap-3 p-4">
      <Summary item={i}>
        <span className="flex items-center gap-1 text-xs text-subtle">
          <TruckIcon size={14} /> With a rider
        </span>
      </Summary>
      <form onSubmit={submit} noValidate className="flex flex-col gap-2">
        <Field label="Product ID on the item" htmlFor={`code-${i.id}`} error={problem ?? undefined} hint="Type it from the label, not from this screen.">
          <input
            id={`code-${i.id}`}
            autoComplete="off"
            autoCapitalize="characters"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              setProblem(null)
            }}
            placeholder="PRD-"
            className={`${inputCls} font-mono uppercase`}
          />
        </Field>
        <Button type="submit" loading={receive.isPending && receive.variables?.id === i.id}>
          <CheckCircleIcon size={16} /> Take it in
        </Button>
      </form>
    </Card>
  )
}

function ShelfCard({ item: i }: { item: CounterItem }) {
  const [open, setOpen] = useState(false)
  const days = i.atCounterAt ? daysOnShelf(i.atCounterAt, Date.now()) : 0
  const late = !i.isPrize && !!i.atCounterAt && counterReminderDue(i.atCounterAt, Date.now())
  return (
    <Card className="flex min-w-0 animate-fade-up flex-col gap-3 p-4">
      <Summary item={i}>
        <span className="flex items-center gap-1 text-xs">
          <UserIcon size={14} className="text-muted" /> For {i.buyerName}
        </span>
        <span className={late ? 'text-xs font-bold text-hot' : 'text-xs text-subtle'}>
          {days === 0 ? 'Arrived today' : `${days} ${days === 1 ? 'day' : 'days'} on the shelf`}
          {i.isPrize ? '' : ` · goes back after ${COUNTER_RETURN_DAYS}`}
        </span>
      </Summary>
      {i.isPrize ? <Badge tone="ticket" className="w-fit">Won in a draw</Badge> : null}
      <Button onClick={() => setOpen(true)}>
        <LockIcon size={16} /> Hand to the buyer
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Hand to the buyer">
        <HandOverForm item={i} onDone={() => setOpen(false)} />
      </Sheet>
    </Card>
  )
}

function HandOverForm({ item: i, onDone }: { item: CounterItem; onDone: () => void }) {
  const { handOver } = useCounterActions()
  const toast = useToast()
  const [pin, setPin] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = useState(i.pinLockedUntil)
  const locked = !!lockedUntil && Date.parse(lockedUntil) > Date.now()

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!isDeliveryPin(pin)) {
      setProblem(`Enter all ${DELIVERY_PIN_LENGTH} digits.`)
      return
    }
    handOver
      .mutateAsync({ id: i.id, pin })
      .then((r) => {
        if (r.confirmed) {
          toast('Collected. Thank you!')
          onDone()
          return
        }
        setPin('')
        setLockedUntil(r.lockedUntil)
        setProblem(r.lockedUntil ? null : `That’s not the PIN. ${r.attemptsLeft} ${r.attemptsLeft === 1 ? 'try' : 'tries'} left.`)
      })
      .catch((err) => setProblem(errorMessage(err)))
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="pr-10 font-display text-2xl font-extrabold">{i.listingTitle}</h2>
      <p className="text-sm text-muted">
        Check it’s {i.buyerName}, and let them open it. If they’re happy, they read you the PIN from their order, which only they can see.
      </p>
      {locked ? (
        <Notice tone="hot">Too many wrong tries. You can try again at {timeOfDay(lockedUntil)}.</Notice>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <Field label="Buyer’s PIN" htmlFor={`counter-pin-${i.id}`} error={problem ?? undefined} hint={`${MAX_PIN_ATTEMPTS} wrong tries pauses it for ${PIN_LOCK_MINUTES} minutes.`}>
            <input
              id={`counter-pin-${i.id}`}
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
          <Button type="submit" size="lg" className="w-full" loading={handOver.isPending}>
            <CheckCircleIcon size={18} /> Confirm collection
          </Button>
        </form>
      )}
    </div>
  )
}

/** Not collected in time: it leaves with the rider taking it back to the seller. */
function SendBackCard({ item: i }: { item: CounterItem }) {
  const { release } = useCounterActions()
  const toast = useToast()
  return (
    <Card className="flex min-w-0 animate-fade-up flex-col gap-3 p-4">
      <Summary item={i}>
        <span className="text-xs text-subtle">{i.riderAssigned ? 'A rider is coming for it.' : 'Waiting for a rider to take it back to the seller.'}</span>
      </Summary>
      <Button
        disabled={!i.riderAssigned}
        loading={release.isPending && release.variables === i.id}
        onClick={() => release.mutateAsync(i.id).then(() => toast('Handed to the rider.')).catch((e) => toast(errorMessage(e), 'error'))}
      >
        <TruckIcon size={16} /> Hand to the rider
      </Button>
    </Card>
  )
}
