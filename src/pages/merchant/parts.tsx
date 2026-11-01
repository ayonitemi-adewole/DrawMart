import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAccess, useDeliveryPricing, useMerchant, useSetShopDeliveryArea, useWithdrawListing } from '@/api/hooks'
import { sellerAreaOf } from '@/domain/deliveryFees'
import { Sheet } from '@/components/Sheet'
import { canChangeInReview, hasLivePage } from '@/domain/listingActions'
import { localDate } from '@/domain/listing'
import { formatNaira } from '@/domain/money'
import { CATEGORY_STYLE } from '@/components/category'
import { ClipboardIcon, CopyIcon, EyeIcon, PlusIcon, XIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Button, Card, Field, Notice, buttonClass, cx, errorMessage, inputCls } from '@/components/ui'
import type { ListingView } from '@/api/types'
import { rejectionReasonText } from '@/domain/rejection'
import { CATEGORIES, type Category } from '@/domain/types'
import { photoToDataUrl } from '@/lib/image'

/** Form pieces shared by the raffle and regular-product listing forms. */

/** What the listing form was opened to do with an existing listing. */
export type ListingFormMode = 'fix' | 'edit' | 'copy'
export type ListingForm = { mode: ListingFormMode; listing: ListingView }

/** Reads ?fix=, ?edit= or ?copy=. Once a listing can't be fixed or edited any more, the form closes itself. */
export function listingFormFrom(params: URLSearchParams, listings: readonly ListingView[], today: string): ListingForm | null {
  for (const mode of ['fix', 'edit', 'copy'] as const) {
    const listing = listings.find((l) => l.id === params.get(mode))
    if (!listing) continue
    if (mode === 'fix' && listing.status !== 'rejected') continue
    if (mode === 'edit' && !canChangeInReview(listing, today)) continue
    return { mode, listing }
  }
  return null
}

/** View, edit, withdraw and copy, for whichever of them this listing allows right now. */
export function ListingActions({ listing: l, onOpen }: { listing: ListingView; onOpen: (mode: ListingFormMode, l: ListingView) => void }) {
  const role = useAccess().role
  const withdraw = useWithdrawListing()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const changeable = canChangeInReview(l, localDate(new Date()))

  function onWithdraw() {
    // Under the "In review" filter this card goes as soon as the list refreshes, so wait on the promise.
    withdraw
      .mutateAsync(l.id)
      .then(() => toast(`${l.title} was withdrawn.`, 'info'))
      .catch((e) => toast(errorMessage(e), 'error'))
      .finally(() => setConfirming(false))
  }

  return (
    <div className="flex flex-col gap-2 border-t border-dashed border-line pt-3">
      {l.status === 'pending_review' && !changeable ? <p className="text-xs text-subtle">Your {l.handover?.method ?? 'pickup'} day has arrived, so this can’t be edited or withdrawn now.</p> : null}
      <div className="flex flex-wrap gap-1">
        {hasLivePage(l.status) ? (
          <Link to={`${role === 'store' ? '/store' : ''}/listings/${l.id}`} className={buttonClass('ghost')}>
            <EyeIcon size={16} /> View live page
          </Link>
        ) : null}
        {changeable ? (
          <Button variant="ghost" onClick={() => onOpen('edit', l)}>
            <ClipboardIcon size={16} /> Edit
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => onOpen('copy', l)}>
          <CopyIcon size={16} /> Copy
        </Button>
        {changeable ? (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            <XIcon size={16} /> Withdraw
          </Button>
        ) : null}
      </div>
      <Sheet open={confirming} onClose={() => !withdraw.isPending && setConfirming(false)} title="Withdraw listing">
        <h2 className="pr-10 font-display text-2xl font-extrabold">Withdraw “{l.title}”?</h2>
        <p className="text-sm text-muted">
          It leaves the review queue and won’t go on sale.{' '}
          {l.kind === 'product'
            ? null
            : l.pickupBatchId
              ? 'This item shares a pickup, so the fee is worked out again from the items left, and you get back any difference.'
              : l.wasRejected
                ? `This listing was rejected before, so its ${formatNaira(l.cautionFee.amountKobo)} caution fee is kept.`
                : `Your ${formatNaira(l.cautionFee.amountKobo)} caution fee is refunded${l.handover?.method === 'inspection' ? ' and the inspection cancelled.' : ' and the pickup cancelled.'}`}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)} disabled={withdraw.isPending}>
            Keep it
          </Button>
          <Button variant="danger" className="flex-1" loading={withdraw.isPending} onClick={onWithdraw}>
            Withdraw
          </Button>
        </div>
      </Sheet>
    </div>
  )
}

/** Says what the form is doing, above a form that starts from an existing listing. */
export function FormStartNotice({ form }: { form: ListingForm }) {
  if (form.mode === 'fix') return <RejectionNotice listing={form.listing} />
  return (
    <Notice icon={form.mode === 'copy' ? CopyIcon : ClipboardIcon} title={form.mode === 'copy' ? `Copied from ${form.listing.title}` : 'Editing while it’s in review'}>
      {form.mode === 'copy' ? 'This makes a new listing with its own product ID. Nothing is sent until you finish.' : 'The reviewer sees your changes straight away.'}
    </Notice>
  )
}

/** Why an admin turned this listing down, in their words. Rows from before reasons existed have none. */
export function RejectionNotice({ listing: l, onFix }: { listing: ListingView; onFix?: () => void }) {
  return (
    <Notice
      tone="hot"
      icon={XIcon}
      title={l.rejection ? rejectionReasonText(l.rejection.reason, l.category) : 'Not approved'}
      action={
        onFix ? (
          <Button variant="outline" onClick={onFix}>
            <ClipboardIcon size={16} /> Fix and resend
          </Button>
        ) : undefined
      }
    >
      {l.rejection?.note ? <span className="block whitespace-pre-line">{l.rejection.note}</span> : null}
      <span className="block">
        {l.kind === 'raffle' ? 'Change what’s needed and send it again. Your caution fee goes back on hold, so you don’t pay it twice.' : 'Change what’s needed and send it again.'}
      </span>
    </Notice>
  )
}

/** Where this seller's items leave from, which sets what buyers pay for delivery. Saves as soon as it's picked. */
export function ShopAreaPicker() {
  const shop = useMerchant()
  const pricing = useDeliveryPricing()
  const set = useSetShopDeliveryArea()
  const toast = useToast()
  if (!shop.data || !pricing.data) return null
  return (
    <Field label="Where do your items leave from?" htmlFor="shop-area" hint="This applies to all your items. A rider collects from you, and buyers pay more for delivery the further it has to go.">
      <select
        id="shop-area"
        className={inputCls}
        value={sellerAreaOf(shop.data)}
        disabled={set.isPending}
        onChange={(e) => set.mutate(e.target.value, { onSuccess: () => toast('Saved.'), onError: (err) => toast(errorMessage(err), 'error') })}
      >
        {pricing.data.areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function CategoryPicker({ value, onChange }: { value: Category; onChange: (c: Category) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-bold">Category</legend>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {CATEGORIES.map((c) => {
          const Icon = CATEGORY_STYLE[c].icon
          const active = c === value
          return (
            <button
              type="button"
              key={c}
              aria-pressed={active}
              onClick={() => onChange(c)}
              className={cx(
                'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-bold transition active:scale-95',
                active ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface text-muted hover:border-line-strong',
              )}
            >
              <Icon size={20} />
              {c}
            </button>
          )
        })}
      </div>
      <span className="text-xs text-subtle">Perishable goods like food can’t be listed.</span>
    </fieldset>
  )
}

const MAX_PHOTOS = 4

export function PhotoPicker({ photos, onChange }: { photos: string[]; onChange: (p: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function add(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    try {
      const picked = [...files].filter((f) => f.type.startsWith('image/')).slice(0, MAX_PHOTOS - photos.length)
      onChange([...photos, ...(await Promise.all(picked.map((f) => photoToDataUrl(f))))])
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold">Photos</span>
      <div className="flex flex-wrap gap-2">
        {photos.map((src, i) => (
          <div key={i} className="relative">
            <img src={src} alt={`Photo ${i + 1}`} className="size-24 rounded-2xl border border-line bg-photo object-cover" />
            {i === 0 ? <span className="absolute bottom-1.5 left-1.5 rounded-full bg-ink/75 px-2 py-0.5 text-[10px] font-bold text-ground">Cover</span> : null}
            <button
              type="button"
              onClick={() => onChange(photos.filter((_, j) => j !== i))}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute -top-2 -right-2 flex size-11 items-center justify-center"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-ink text-ground shadow-card">
                <XIcon size={14} />
              </span>
            </button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS ? (
          <label
            className={cx(
              'flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line-strong text-xs font-bold text-muted transition hover:border-brand hover:text-brand',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            <PlusIcon size={20} />
            {busy ? 'Adding…' : 'Add photo'}
            <input ref={input} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => add(e.target.files)} />
          </label>
        ) : null}
      </div>
      <span className="text-xs text-subtle">Up to {MAX_PHOTOS}. The first is the cover. DrawMart adds its own photos at escrow or inspection.</span>
    </div>
  )
}

export function Section({ n, title, sub, children }: { n: number; title: string; sub: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink font-display font-extrabold text-ground">{n}</span>
        <div className="flex flex-col">
          <h2 className="font-display text-lg font-extrabold">{title}</h2>
          <p className="text-xs text-subtle">{sub}</p>
        </div>
      </div>
      {children}
    </Card>
  )
}
