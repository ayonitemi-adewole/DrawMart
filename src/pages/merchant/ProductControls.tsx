import { useState, type FormEvent } from 'react'
import { useChangePrice, useChangeStock, usePauseProduct } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { ClockIcon, EyeIcon, NairaIcon, PlusIcon, XIcon } from '@/components/icons'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Button, Field, Notice, Segmented, errorMessage, inputCls } from '@/components/ui'
import { platformFeeBps } from '@/domain/fees'
import { formatNaira, parseNairaInput } from '@/domain/money'
import { MIN_PRODUCT_PRICE_KOBO, PRODUCT_ERROR_TEXT, saleEconomics } from '@/domain/orders'
import { REPRICE_REVIEW_PERCENT, canControlProduct, repriceNeedsReview, stockChangeError } from '@/domain/productControls'

/** Pause, stock and price, for a product once it's on sale. These cards can leave the list on refresh, so wait on promises. */
export function ProductControls({ listing: l }: { listing: ListingView }) {
  const pause = usePauseProduct()
  const toast = useToast()
  const [open, setOpen] = useState<'stock' | 'price' | null>(null)
  if (!canControlProduct(l)) return null
  const paused = l.status === 'paused'

  function onPause() {
    pause
      .mutateAsync({ id: l.id, paused: !paused })
      .then(() => toast(paused ? `${l.title} is back.` : `${l.title} is paused. Buyers can’t find or buy it until you resume.`, 'info'))
      .catch((e) => toast(errorMessage(e), 'error'))
  }

  return (
    <div className="flex flex-col gap-2 border-t border-dashed border-line pt-3">
      {paused ? (
        <Notice tone="neutral" icon={ClockIcon} title="Paused">
          Buyers can’t find or buy this. Your insights and chats are kept, and orders already placed still need sending.
        </Notice>
      ) : null}
      {l.pendingPriceKobo ? (
        <Notice tone="ticket" icon={ClockIcon} title={`New price in review: ${formatNaira(l.pendingPriceKobo)}`}>
          Buyers still pay {formatNaira(l.priceKobo)} until it’s approved.
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {l.status !== 'sold' || paused ? (
          <Button variant="ghost" loading={pause.isPending} onClick={onPause}>
            {paused ? <EyeIcon size={16} /> : <XIcon size={16} />} {paused ? 'Resume' : 'Pause'}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => setOpen('stock')}>
          <PlusIcon size={16} /> {l.status === 'sold' ? 'Restock' : 'Change stock'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen('price')}>
          <NairaIcon size={16} /> Change price
        </Button>
      </div>
      {open === 'stock' ? <StockSheet listing={l} onClose={() => setOpen(null)} /> : null}
      {open === 'price' ? <PriceSheet listing={l} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

function StockSheet({ listing: l, onClose }: { listing: ListingView; onClose: () => void }) {
  const change = useChangeStock()
  const toast = useToast()
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [amount, setAmount] = useState('')
  const [showError, setShowError] = useState(false)
  const count = Number(amount.replace(/,/g, '').trim() || NaN)
  const delta = mode === 'add' ? count : -count
  const problem = count > 0 ? stockChangeError(l.stock, delta) : 'Enter how many to add or remove.'

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (problem) {
      setShowError(true)
      return
    }
    change
      .mutateAsync({ id: l.id, change: delta })
      .then(() => {
        toast(`${l.title} now has ${(l.stock + delta).toLocaleString('en-NG')} in stock.`)
        onClose()
      })
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <Sheet open onClose={() => !change.isPending && onClose()} title="Change stock">
      <h2 className="pr-10 font-display text-2xl font-extrabold">{l.title}</h2>
      <p className="text-sm text-muted">{l.stock.toLocaleString('en-NG')} in stock now. This applies straight away.</p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Segmented<'add' | 'remove'>
          label="Add or remove"
          value={mode}
          onChange={setMode}
          className="w-full"
          options={[
            { value: 'add', label: 'Add' },
            { value: 'remove', label: 'Remove' },
          ]}
        />
        <Field label="How many?" htmlFor={`stock-${l.id}`} error={showError ? (problem ?? undefined) : undefined} hint={mode === 'remove' ? 'Use this if you’ve sold some elsewhere, so buyers can’t order what you don’t have.' : undefined}>
          <input id={`stock-${l.id}`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </Field>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={change.isPending}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={change.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function PriceSheet({ listing: l, onClose }: { listing: ListingView; onClose: () => void }) {
  const change = useChangePrice()
  const toast = useToast()
  const [price, setPrice] = useState(String(l.priceKobo / 100))
  const [showError, setShowError] = useState(false)
  const newPrice = parseNairaInput(price)
  const valid = newPrice >= MIN_PRODUCT_PRICE_KOBO
  const needsReview = valid && repriceNeedsReview(newPrice, l.reviewedPriceKobo ?? l.priceKobo)
  const { feeKobo, payoutKobo } = saleEconomics(newPrice, platformFeeBps(newPrice))

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!valid) {
      setShowError(true)
      return
    }
    change
      .mutateAsync({ id: l.id, priceKobo: newPrice })
      .then((inReview) => {
        toast(inReview ? 'Sent for review. Buyers pay the current price until then.' : `${l.title} now costs ${formatNaira(newPrice)}.`)
        onClose()
      })
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <Sheet open onClose={() => !change.isPending && onClose()} title="Change price">
      <h2 className="pr-10 font-display text-2xl font-extrabold">{l.title}</h2>
      <p className="text-sm text-muted">Buyers pay {formatNaira(l.priceKobo)} now.</p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="New price (₦)" htmlFor={`price-${l.id}`} error={showError && !valid ? PRODUCT_ERROR_TEXT.price_too_low : undefined}>
          <input id={`price-${l.id}`} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} />
        </Field>
        {valid ? (
          <p className="text-sm text-muted">
            DrawMart’s fee is {formatNaira(feeKobo)}, so you receive {formatNaira(payoutKobo)} per item.
          </p>
        ) : null}
        {needsReview ? (
          <Notice tone="ticket" icon={ClockIcon} title="This needs a review">
            It’s more than {REPRICE_REVIEW_PERCENT}% away from the last reviewed price of {formatNaira(l.reviewedPriceKobo ?? l.priceKobo)}. Your product stays on sale at its current price until then.
          </Notice>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={change.isPending}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={change.isPending}>
            {needsReview ? 'Send for review' : 'Save'}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
