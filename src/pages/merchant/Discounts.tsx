import { useState, type FormEvent } from 'react'
import { useDiscountActions, useDiscounts, useMerchantListings } from '@/api/hooks'
import { GiftIcon, PlusIcon, XIcon } from '@/components/icons'
import { ProductId } from '@/components/ProductId'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, Segmented, Skeleton, cx, errorMessage, inputCls } from '@/components/ui'
import {
  MAX_CODE_DAYS,
  MAX_PERCENT_OFF,
  describeDiscount,
  discountErrors,
  discountState,
  discountedUnitKobo,
  normalizeCode,
  type Discount,
  type DiscountInput,
  type DiscountKind,
} from '@/domain/discounts'
import { addDays, localDate } from '@/domain/listing'
import { formatNaira, parseNairaInput } from '@/domain/money'
import { dateTime } from '@/lib/time'

const SALE_LENGTHS = [3, 7, 14, 30]
const CODE_LENGTHS = [7, 30, 60, MAX_CODE_DAYS]
const STATE_TEXT = { running: 'Running', scheduled: 'Starts later', ended: 'Ended' } as const

/** A sale or a code on the shop's own products (domain/discounts.ts). The store pays for it. */
export function Discounts() {
  const q = useDiscounts()
  const [creating, setCreating] = useState(false)
  const now = Date.now()
  const sorted = [...(q.data ?? [])].sort((a, b) => Number(discountState(b, now) !== 'ended') - Number(discountState(a, now) !== 'ended') || b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="flex flex-col gap-5">
      <Notice tone="neutral" icon={GiftIcon}>
        You pay for the discount: buyers pay the lower price, and your payout and DrawMart’s fee are worked out on that. Discounts are for products only, never draws.
      </Notice>
      {creating ? (
        <NewDiscount onDone={() => setCreating(false)} />
      ) : (
        <Button className="w-fit" onClick={() => setCreating(true)}>
          <PlusIcon size={18} /> New discount
        </Button>
      )}
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : sorted.length === 0 ? (
        creating ? null : <EmptyState icon={GiftIcon} title="No discounts yet" body="Put products on sale for a while, or make a code to share with your customers." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {sorted.map((d) => (
            <DiscountCard key={d.id} discount={d} />
          ))}
        </div>
      )}
    </div>
  )
}

function DiscountCard({ discount: d }: { discount: Discount }) {
  const listings = useMerchantListings()
  const { end } = useDiscountActions()
  const toast = useToast()
  const state = discountState(d, Date.now())
  const products = (listings.data ?? []).filter((l) => d.listingIds.includes(l.id))

  return (
    <Card className={cx('flex flex-col gap-3 p-4 text-sm', state === 'ended' && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-base">{describeDiscount(d)}</strong>
        {d.kind === 'code' ? <span className="rounded-lg bg-sunken px-2 py-0.5 font-mono font-bold">{d.code}</span> : <Badge tone="sky">Sale</Badge>}
        <Badge tone={state === 'running' ? 'brand' : state === 'scheduled' ? 'ticket' : 'neutral'}>{STATE_TEXT[state]}</Badge>
      </div>
      <span className="text-muted">
        {dateTime(d.startsAt)} to {dateTime(d.endedAt ?? d.endsAt)}
        {d.kind === 'code' ? ` · used ${d.uses}${d.maxUses ? ` of ${d.maxUses}` : ''} time${d.uses === 1 && !d.maxUses ? '' : 's'}` : ''}
      </span>
      <ul className="flex flex-col gap-1">
        {products.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-2 text-xs">
            <span className="font-semibold">{l.title}</span>
            <ProductId code={l.productCode} />
            <span className="text-subtle">
              {formatNaira(l.priceKobo)} → {formatNaira(discountedUnitKobo(l.priceKobo, d))}
            </span>
          </li>
        ))}
      </ul>
      {state !== 'ended' ? (
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 w-fit"
          loading={end.isPending}
          onClick={() => end.mutate(d.id, { onSuccess: () => toast('Discount ended.'), onError: (e) => toast(errorMessage(e), 'error') })}
        >
          <XIcon size={16} /> End it now
        </Button>
      ) : null}
    </Card>
  )
}

function NewDiscount({ onDone }: { onDone: () => void }) {
  const listings = useMerchantListings()
  const { create } = useDiscountActions()
  const toast = useToast()
  const [today] = useState(() => localDate(new Date()))
  const [kind, setKind] = useState<DiscountKind>('sale')
  const [by, setBy] = useState<'percent' | 'amount'>('percent')
  const [value, setValue] = useState('10')
  const [chosen, setChosen] = useState<string[]>([])
  const [start, setStart] = useState(today)
  const [days, setDays] = useState(7)
  const [code, setCode] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  const products = (listings.data ?? []).filter((l) => l.kind === 'product' && (l.status === 'for_sale' || l.status === 'paused' || l.status === 'pending_review'))
  const lengths = kind === 'sale' ? SALE_LENGTHS : CODE_LENGTHS
  const length = lengths.includes(days) ? days : lengths[1]
  // Today starts now; another day starts at midnight in Lagos. Either way it ends at midnight.
  const startsAt = start === today ? new Date().toISOString() : new Date(`${start}T00:00:00+01:00`).toISOString()
  const endsAt = new Date(`${addDays(start, length)}T00:00:00+01:00`).toISOString()
  const input: DiscountInput = {
    kind,
    percentOff: by === 'percent' ? Number(value) || 0 : null,
    amountOffKobo: by === 'amount' ? parseNairaInput(value) : null,
    code: normalizeCode(code),
    maxUses: kind === 'code' && maxUses.trim() ? Number(maxUses) : null,
    startsAt,
    endsAt,
    listingIds: chosen,
  }
  const prices = Object.fromEntries(products.map((l) => [l.id, l.priceKobo]))
  const errors = discountErrors(input, prices)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (errors.length) {
      setShowErrors(true)
      return
    }
    create.mutate(input, {
      onSuccess: () => {
        toast(kind === 'code' ? `Code ${input.code} is ready to share.` : 'Sale set up.')
        onDone()
      },
      onError: (err) => toast(errorMessage(err), 'error'),
    })
  }

  return (
    <Card className="flex flex-col gap-5 p-5">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold">What kind?</span>
          <Segmented<DiscountKind>
            label="Kind of discount"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'sale', label: 'Sale for everyone' },
              { value: 'code', label: 'Code to share' },
            ]}
          />
          <span className="text-xs text-subtle">
            {kind === 'sale' ? 'Buyers see the lower price, with the old one crossed out.' : 'Buyers enter the code at checkout. Each buyer can use it once.'}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-end">
          <Segmented<'percent' | 'amount'>
            label="Percentage or amount"
            value={by}
            onChange={setBy}
            options={[
              { value: 'percent', label: '% off' },
              { value: 'amount', label: '₦ off' },
            ]}
          />
          <Field label={by === 'percent' ? `Percentage off (1 to ${MAX_PERCENT_OFF})` : 'Amount off (₦)'} htmlFor="discount-value">
            <input id="discount-value" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold">Products</legend>
          {listings.isPending ? (
            <Skeleton className="h-20" />
          ) : products.length === 0 ? (
            <p className="text-sm text-muted">You don’t have any products to discount yet.</p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {products.map((l) => {
                const on = chosen.includes(l.id)
                const off = { percentOff: input.percentOff, amountOffKobo: input.amountOffKobo }
                return (
                  <li key={l.id}>
                    <label className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition', on ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong')}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setChosen((ids) => (on ? ids.filter((x) => x !== l.id) : [...ids, l.id]))}
                        className="size-5 shrink-0 accent-brand"
                      />
                      <span className="min-w-0 flex-1 truncate font-semibold">{l.title}</span>
                      <span className="shrink-0 text-xs text-subtle tabular-nums">
                        {formatNaira(l.priceKobo)}
                        {on && (off.percentOff || off.amountOffKobo) ? ` → ${formatNaira(discountedUnitKobo(l.priceKobo, off))}` : ''}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" htmlFor="discount-start" hint={start === today ? 'Today: it starts as soon as you save.' : 'At midnight, Lagos time.'}>
            <input id="discount-start" type="date" min={today} value={start} onChange={(e) => setStart(e.target.value || today)} className={inputCls} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-bold">Runs for</span>
            <Segmented<string> label="Runs for" value={String(length)} onChange={(v) => setDays(Number(v))} options={lengths.map((d) => ({ value: String(d), label: `${d} days` }))} />
          </div>
        </div>

        {kind === 'code' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" htmlFor="discount-code" hint="4 to 16 letters and numbers.">
              <input id="discount-code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={cx(inputCls, 'font-mono uppercase')} placeholder="SAVE10" />
            </Field>
            <Field label="Most uses (optional)" htmlFor="discount-uses" hint="Leave blank for no limit.">
              <input id="discount-uses" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} className={inputCls} />
            </Field>
          </div>
        ) : null}

        {showErrors && errors.length ? (
          <ul className="list-disc rounded-2xl bg-hot-soft py-3 pr-3 pl-8 text-sm text-hot-ink" role="alert">
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onDone} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            {kind === 'code' ? 'Create the code' : 'Start the sale'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
