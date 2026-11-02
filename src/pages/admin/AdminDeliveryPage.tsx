import { useState, type FormEvent } from 'react'
import { useDeliveryPricing, useRiderPayActions, useRiderPayRates, useSetDeliveryPrice, useSetDeliverySizeExtra } from '@/api/hooks'
import { InfoIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Button, Card, ErrorState, Field, Notice, PageTitle, Skeleton, errorMessage, inputCls } from '@/components/ui'
import { PACKAGE_SIZES, PACKAGE_SIZE_TEXT, areaPairPrice, deliveryPriceError, sizeExtraError } from '@/domain/deliveryFees'
import { formatNaira, parseNairaInput } from '@/domain/money'
import { areaPairPay, attemptPayError, riderPayError } from '@/domain/riderPay'
import type { Kobo, PackageSize } from '@/domain/types'

/** /admin/delivery: what buyers pay for delivery. A change applies to the next checkout. */
export function AdminDeliveryPage() {
  const q = useDeliveryPricing()
  const rates = useRiderPayRates()
  const [from, setFrom] = useState<string | null>(null)
  const area = from ?? q.data?.areas[0]?.id

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Admin" sub="What buyers pay at checkout: the price between two areas, plus an extra for bigger packages, from ₦1,000 to ₦5,000 in all. Below each, what the rider is paid for the same trip, which can’t be more.">
        Delivery prices
      </PageTitle>
      <Notice tone="ticket" icon={InfoIcon} title="These are placeholders">
        They’re worked out from distance, and rider pay starts at 70% of each. Replace them with what riders actually charge.
      </Notice>
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
          <Card className="flex flex-col gap-4 p-5">
            <Field label="From" htmlFor="delivery-from">
              <select id="delivery-from" className={inputCls} value={area} onChange={(e) => setFrom(e.target.value)}>
                {q.data.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <ul className="flex flex-col divide-y divide-line">
              {q.data.areas.map((to) => (
                // Keyed by both, so typing in one row doesn't carry over when the area changes.
                <PriceRow key={`${area}-${to.id}`} from={area!} to={to.id} name={to.name} priceKobo={areaPairPrice(q.data, area!, to.id)} />
              ))}
            </ul>
            {rates.data ? (
              <div className="flex flex-col gap-1 border-t border-line pt-4">
                <strong>Rider pay</strong>
                <p className="text-xs text-subtle">What the rider gets for each of these trips, for a small package.</p>
                <ul className="flex flex-col divide-y divide-line">
                  {q.data.areas.map((to) => (
                    <PayRow key={`pay-${area}-${to.id}`} from={area!} to={to.id} name={to.name} payKobo={areaPairPay(rates.data, area!, to.id)} chargedKobo={areaPairPrice(q.data, area!, to.id)} />
                  ))}
                </ul>
              </div>
            ) : rates.isError ? (
              <ErrorState error={rates.error} onRetry={() => rates.refetch()} />
            ) : null}
          </Card>
          <Card className="flex flex-col gap-4 p-5">
            <strong>Extra for package size</strong>
            <ul className="flex flex-col divide-y divide-line">
              {PACKAGE_SIZES.map((s) => (
                <ExtraRow key={s} size={s} extraKobo={q.data.sizeExtras[s]} />
              ))}
            </ul>
            {rates.data ? (
              <>
                <strong className="border-t border-line pt-4">Rider extra for package size</strong>
                <ul className="flex flex-col divide-y divide-line">
                  {PACKAGE_SIZES.map((s) => (
                    <RiderExtraRow key={s} size={s} extraKobo={rates.data.sizeExtras[s]} chargedKobo={q.data.sizeExtras[s]} />
                  ))}
                </ul>
                <strong className="border-t border-line pt-4">Rider pay per failed attempt</strong>
                <ul className="flex flex-col">
                  <AttemptRow payKobo={rates.data.attemptKobo} />
                </ul>
              </>
            ) : null}
          </Card>
        </div>
      )}
    </div>
  )
}

function PriceRow({ from, to, name, priceKobo }: { from: string; to: string; name: string; priceKobo: Kobo }) {
  const set = useSetDeliveryPrice()
  return (
    <AmountRow
      id={`price-${to}`}
      label={`To ${name}`}
      valueKobo={priceKobo}
      error={deliveryPriceError}
      pending={set.isPending}
      save={(priceKobo) => set.mutateAsync({ areaA: from, areaB: to, priceKobo })}
    />
  )
}

function ExtraRow({ size, extraKobo }: { size: PackageSize; extraKobo: Kobo }) {
  const set = useSetDeliverySizeExtra()
  return (
    <AmountRow
      id={`extra-${size}`}
      label={PACKAGE_SIZE_TEXT[size].label}
      valueKobo={extraKobo}
      error={sizeExtraError}
      pending={set.isPending}
      save={(extraKobo) => set.mutateAsync({ size, extraKobo })}
    />
  )
}

function PayRow({ from, to, name, payKobo, chargedKobo }: { from: string; to: string; name: string; payKobo: Kobo; chargedKobo: Kobo }) {
  const { setPay } = useRiderPayActions()
  return (
    <AmountRow
      id={`pay-${to}`}
      label={`To ${name} (buyer pays ${formatNaira(chargedKobo)})`}
      valueKobo={payKobo}
      error={(k) => riderPayError(k, chargedKobo)}
      pending={setPay.isPending}
      save={(payKobo) => setPay.mutateAsync({ areaA: from, areaB: to, payKobo })}
    />
  )
}

function RiderExtraRow({ size, extraKobo, chargedKobo }: { size: PackageSize; extraKobo: Kobo; chargedKobo: Kobo }) {
  const { setExtra } = useRiderPayActions()
  return (
    <AmountRow
      id={`rider-extra-${size}`}
      label={`${PACKAGE_SIZE_TEXT[size].label} (buyer pays ${formatNaira(chargedKobo)})`}
      valueKobo={extraKobo}
      error={(k) => riderPayError(k, chargedKobo)}
      pending={setExtra.isPending}
      save={(extraKobo) => setExtra.mutateAsync({ size, extraKobo })}
    />
  )
}

function AttemptRow({ payKobo }: { payKobo: Kobo }) {
  const { setAttempt } = useRiderPayActions()
  return <AmountRow id="rider-attempt" label="Each failed attempt" valueKobo={payKobo} error={attemptPayError} pending={setAttempt.isPending} save={(k) => setAttempt.mutateAsync(k)} />
}

function AmountRow({ id, label, valueKobo, error, pending, save }: { id: string; label: string; valueKobo: Kobo; error: (k: Kobo) => string | null; pending: boolean; save: (k: Kobo) => Promise<void> }) {
  const toast = useToast()
  const [text, setText] = useState(String(valueKobo / 100))
  const amount = parseNairaInput(text)
  const problem = error(amount)
  const changed = amount !== valueKobo

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (problem) {
      toast(problem, 'error')
      return
    }
    save(amount)
      .then(() => toast(`Saved: ${formatNaira(amount)}.`))
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <li>
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 py-2">
        <label htmlFor={id} className="min-w-32 flex-1 text-sm">
          {label}
        </label>
        <div className="w-28 shrink-0">
          <input id={id} inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} className={inputCls} aria-label={`${label}, in naira`} />
        </div>
        <Button type="submit" variant="outline" disabled={!changed} loading={pending}>
          Save
        </Button>
      </form>
    </li>
  )
}
