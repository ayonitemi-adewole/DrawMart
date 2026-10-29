import { useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { useMe, useMerchant, useMySellerApplication, useSubmitSellerApplication } from '@/api/hooks'
import type { SellerApplicationView } from '@/api/types'
import { CameraIcon, CheckIcon, ClockIcon, IdCardIcon, LayoutIcon, PlusIcon, ShieldIcon, StoreIcon, TruckIcon, XIcon, type IconComponent } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, ErrorState, Field, Notice, PageTitle, Segmented, Skeleton, cx, errorMessage, inputCls } from '@/components/ui'
import { SELLER_APPLICATION_ERROR_TEXT, validateSellerApplication, type SellerApplicationError, type SellerApplicationInput } from '@/domain/sellers'
import { photoToDataUrl } from '@/lib/image'
import { MerchantListings } from './merchant/MerchantPage'
import { MerchantOrders, NewProduct } from './merchant/NewProduct'

/**
 * /sell, in the buyer app. Any buyer can apply to sell regular products;
 * once an admin has checked their ID they get a small shop here. Raffles are
 * only for CAC-registered stores.
 */
export function SellPage() {
  const q = useMySellerApplication()
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (q.data?.status === 'approved') return <SellerDashboard />

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Sell on DrawMart" sub="Sell your own items to buyers across Lagos. We check every seller’s ID first, so buyers can trust who they’re paying.">
        Sell your items
      </PageTitle>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
        {q.data?.status === 'pending' ? <UnderReview application={q.data} /> : <ApplicationForm previous={q.data} />}
        <HowSellingWorks />
      </div>
    </div>
  )
}

const STEPS: { icon: IconComponent; title: string; body: string }[] = [
  { icon: IdCardIcon, title: 'Verify your ID', body: 'Your NIN, a photo of your ID and a selfie holding it. A DrawMart admin checks them, usually within a day.' },
  { icon: StoreIcon, title: 'List your items', body: 'Regular products at a fixed price. Each listing is reviewed before it goes on sale.' },
  { icon: TruckIcon, title: 'Send it, get paid', body: 'When it sells, you get the buyer’s address. You’re paid once they confirm it arrived.' },
]

function HowSellingWorks() {
  return (
    <aside className="flex flex-col gap-3 lg:sticky lg:top-24">
      <Card className="flex flex-col gap-4 p-5">
        <strong className="font-display text-lg">How selling works</strong>
        <ol className="flex flex-col gap-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                <s.icon size={20} />
              </span>
              <span className="flex flex-col text-sm">
                <strong>
                  {i + 1}. {s.title}
                </strong>
                <span className="text-muted">{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <Notice tone="neutral" icon={ShieldIcon}>
        Raffle draws are only for CAC-registered stores. As an individual you sell at a fixed price, with a platform fee taken from each sale.
      </Notice>
    </aside>
  )
}

function UnderReview({ application: a }: { application: SellerApplicationView }) {
  return (
    <Card className="flex animate-fade-up flex-col items-center gap-4 p-6 text-center sm:p-8">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-ticket-soft text-ticket-ink">
        <ClockIcon size={32} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-extrabold">We’re checking your ID</h2>
        <p className="text-sm text-muted">
          {a.shopName} · sent by {a.legalName}. Usually done within a day; we’ll open your shop here once it’s approved.
        </p>
      </div>
      <Badge tone="ticket">Under review</Badge>
    </Card>
  )
}

const FIELD: Record<SellerApplicationError, keyof SellerApplicationInput> = {
  shop_name_required: 'shopName',
  legal_name_required: 'legalName',
  nin_invalid: 'nin',
  phone_invalid: 'phone',
  address_required: 'address',
  area_required: 'area',
  id_photo_required: 'idPhoto',
  selfie_required: 'selfie',
}

function ApplicationForm({ previous }: { previous: SellerApplicationView | null | undefined }) {
  const submit = useSubmitSellerApplication()
  const me = useMe()
  const toast = useToast()
  // A rejected applicant fixes the details; photos are always taken again.
  const [input, setInput] = useState<SellerApplicationInput>(() => ({
    shopName: previous?.shopName ?? '',
    legalName: previous?.legalName ?? '',
    nin: previous?.nin ?? '',
    phone: previous?.phone ?? '',
    address: previous?.address ?? '',
    area: previous?.area ?? '',
    idPhoto: '',
    selfie: '',
  }))
  const [agreed, setAgreed] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const errors = validateSellerApplication(input)
  const set = (k: keyof SellerApplicationInput) => (v: string) => setInput((i) => ({ ...i, [k]: v }))
  const err = (k: keyof SellerApplicationInput) => {
    const e = showErrors ? errors.find((x) => FIELD[x] === k) : undefined
    return e ? SELLER_APPLICATION_ERROR_TEXT[e] : undefined
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setShowErrors(true)
    if (errors.length || !agreed) {
      toast(errors.length ? 'A few details need fixing first.' : 'Tick the box to confirm your details.', 'error')
      return
    }
    submit.mutate(input, {
      onSuccess: () => toast('Sent. We’ll check your ID and open your shop.'),
      onError: (err) => toast(errorMessage(err), 'error'),
    })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-w-0 animate-fade-up flex-col gap-5">
      {previous?.status === 'rejected' ? (
        <Notice tone="hot" icon={XIcon} title="Your last application wasn’t approved">
          {previous.reviewNote} Fix the details below and send it again.
        </Notice>
      ) : null}

      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="font-display text-lg font-extrabold">Your shop</h2>
        <Field label="Shop name" htmlFor="shop" error={err('shopName')} hint="Buyers see this on your items.">
          <input id="shop" value={input.shopName} onChange={(e) => set('shopName')(e.target.value)} className={inputCls} placeholder={me.data ? `${me.data.displayName}’s shop` : 'e.g. Tolu’s Gadgets'} />
        </Field>
        <Field label="Area in Lagos" htmlFor="area" error={err('area')} hint="Shown to buyers, e.g. Yaba.">
          <input id="area" value={input.area} onChange={(e) => set('area')(e.target.value)} className={inputCls} placeholder="Yaba" />
        </Field>
      </Card>

      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-extrabold">About you</h2>
          <p className="text-xs text-subtle">Only DrawMart’s review team sees these. They’re never shown to buyers.</p>
        </div>
        <Field label="Full legal name" htmlFor="legal" error={err('legalName')} hint="Exactly as on your ID.">
          <input id="legal" autoComplete="name" value={input.legalName} onChange={(e) => set('legalName')(e.target.value)} className={inputCls} placeholder="First Middle Last" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="NIN" htmlFor="nin" error={err('nin')} hint="11 digits, on your NIN slip or card.">
            <input id="nin" inputMode="numeric" autoComplete="off" value={input.nin} onChange={(e) => set('nin')(e.target.value)} className={inputCls} placeholder="123 4567 8901" />
          </Field>
          <Field label="Phone" htmlFor="seller-phone" error={err('phone')}>
            <input id="seller-phone" type="tel" inputMode="tel" autoComplete="tel" value={input.phone} onChange={(e) => set('phone')(e.target.value)} className={inputCls} placeholder="0803 123 4567" />
          </Field>
        </div>
        <Field label="Home address" htmlFor="seller-address" error={err('address')}>
          <textarea
            id="seller-address"
            rows={2}
            autoComplete="street-address"
            value={input.address}
            onChange={(e) => set('address')(e.target.value)}
            className={cx(inputCls, 'min-h-20 py-3')}
            placeholder="Street, building and area"
          />
        </Field>
      </Card>

      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-extrabold">ID check</h2>
          <p className="text-xs text-subtle">NIN slip, driver’s licence, international passport or voter’s card. Make sure the photo is sharp and the name is readable.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <IdPhoto label="Photo of your ID" icon={IdCardIcon} value={input.idPhoto} onChange={set('idPhoto')} error={err('idPhoto')} />
          <IdPhoto label="Selfie holding the same ID" icon={CameraIcon} value={input.selfie} onChange={set('selfie')} error={err('selfie')} capture="user" />
        </div>
      </Card>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl bg-surface p-4 text-sm shadow-card">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
        <span>
          These details are true and the ID is mine. I understand DrawMart can close my shop and keep payouts if they’re not, or if I sell fake or stolen goods.
        </span>
      </label>
      {showErrors && !agreed ? (
        <span className="-mt-3 text-xs font-semibold text-hot-ink" role="alert">
          Confirm your details to continue.
        </span>
      ) : null}

      <Button type="submit" size="lg" loading={submit.isPending}>
        <ShieldIcon size={18} /> {previous?.status === 'rejected' ? 'Send again for review' : 'Send for ID check'}
      </Button>
    </form>
  )
}

function IdPhoto({
  label,
  icon: Icon,
  value,
  onChange,
  error,
  capture,
}: {
  label: string
  icon: IconComponent
  value: string
  onChange: (v: string) => void
  error?: string
  capture?: 'user'
}) {
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function pick(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setBusy(true)
    try {
      // Bigger than listing photos so an admin can read the ID.
      onChange(await photoToDataUrl(file, 1600, 0.85))
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-bold">{label}</span>
      <label
        className={cx(
          'relative flex h-44 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed text-sm font-bold transition',
          value ? 'border-brand' : error ? 'border-hot text-hot-ink' : 'border-line-strong text-muted hover:border-brand hover:text-brand',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        {value ? (
          <>
            <img src={value} alt={label} className="absolute inset-0 size-full bg-photo object-cover" />
            <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-ink/75 px-2 py-0.5 text-[11px] text-ground">
              <CheckIcon size={12} /> Tap to retake
            </span>
          </>
        ) : (
          <>
            <Icon size={28} />
            {busy ? 'Adding…' : 'Take or upload a photo'}
          </>
        )}
        <input ref={input} type="file" accept="image/*" capture={capture} className="sr-only" onChange={(e) => pick(e.target.files)} />
      </label>
      {error ? <span className="text-xs font-semibold text-hot-ink">{error}</span> : null}
    </div>
  )
}

type SellTab = 'items' | 'orders' | 'new'

/** Once approved: the seller's own items, orders to send, and a regular-product form. */
function SellerDashboard() {
  const shop = useMerchant()
  const [params, setParams] = useSearchParams()
  const tab: SellTab = params.get('tab') === 'orders' ? 'orders' : params.get('tab') === 'new' ? 'new' : 'items'
  const setTab = (t: SellTab) => setParams(t === 'items' ? {} : { tab: t }, { replace: true })

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        eyebrow="Your shop"
        sub="Regular products at a fixed price. Each listing is checked before it goes on sale."
        action={
          tab !== 'new' ? (
            <Button onClick={() => setTab('new')}>
              <PlusIcon size={18} /> New item
            </Button>
          ) : null
        }
      >
        <span className="flex flex-wrap items-center gap-2">
          {shop.data?.name ?? 'Your shop'}
          <Badge>
            <ShieldIcon size={12} /> ID verified
          </Badge>
        </span>
      </PageTitle>
      <Segmented<SellTab>
        label="Section"
        value={tab}
        onChange={setTab}
        className="w-full sm:w-auto sm:self-start"
        options={[
          { value: 'items', label: <><LayoutIcon size={16} /> Your items</> },
          { value: 'orders', label: <><TruckIcon size={16} /> Orders</> },
          { value: 'new', label: <><PlusIcon size={16} /> New item</> },
        ]}
      />
      <div key={tab} className="animate-fade-in">
        {tab === 'orders' ? (
          <MerchantOrders />
        ) : tab === 'new' ? (
          <NewProduct onBack={() => setTab('items')} onDone={() => setTab('items')} />
        ) : (
          <MerchantListings onNew={() => setTab('new')} emptyBody="List your first item. We check it, then it goes on sale at your price." />
        )}
      </div>
    </div>
  )
}
