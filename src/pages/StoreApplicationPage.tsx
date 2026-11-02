import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useMySellerApplication, useMyStoreApplication, useSubmitStoreApplication } from '@/api/hooks'
import type { StoreApplicationView } from '@/api/types'
import { AlertIcon, CheckIcon, ClockIcon, IdCardIcon, ShieldIcon, StoreIcon, XIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, ErrorState, Field, Notice, PageTitle, Skeleton, buttonClass, cx, errorMessage, inputCls } from '@/components/ui'
import { STORE_APPLICATION_ERROR_TEXT, validateStoreApplication, type StoreApplicationError, type StoreApplicationInput } from '@/domain/storeApplications'
import { IdPhoto } from './SellPage'

/**
 * /sell/business: a CAC-registered business applies to be a store. The account applying
 * becomes the store's account once an admin approves it, so it must be a new one.
 */
export function StoreApplicationPage() {
  const q = useMyStoreApplication()
  const seller = useMySellerApplication()
  if (q.isPending || seller.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const individual = seller.data && seller.data.status !== 'rejected'

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Sell on DrawMart" sub="For CAC-registered businesses. Stores sell products at a fixed price and can run raffle draws, with DrawMart’s riders delivering across Lagos.">
        Open a store
      </PageTitle>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
        {individual ? (
          <Notice tone="ticket" icon={AlertIcon} title="This account sells as an individual">
            A store needs its own account. Sign out, then sign up with a new email address for your business and apply from there.
          </Notice>
        ) : q.data?.status === 'approved' ? (
          <Approved application={q.data} />
        ) : q.data?.status === 'pending' ? (
          <UnderReview application={q.data} />
        ) : (
          <StoreApplicationForm previous={q.data} />
        )}
        <HowItWorks />
      </div>
    </div>
  )
}

function HowItWorks() {
  return (
    <aside className="flex flex-col gap-3 lg:sticky lg:top-24">
      <Card className="flex flex-col gap-3 p-5 text-sm">
        <strong className="font-display text-lg">What happens next</strong>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted">
          <li>DrawMart checks your CAC certificate and the director’s ID, usually within two working days.</li>
          <li>Once approved, this account opens the store app the next time you open DrawMart.</li>
          <li>Add your bank account and where riders collect from, then send your first listing.</li>
        </ol>
      </Card>
      <Notice tone="neutral" icon={ShieldIcon}>
        Your documents are only seen by DrawMart’s review team, never by buyers. Selling just your own things?{' '}
        <Link to="/sell" className="font-bold">
          Sell as an individual
        </Link>
        .
      </Notice>
    </aside>
  )
}

function UnderReview({ application: a }: { application: StoreApplicationView }) {
  return (
    <Card className="flex animate-fade-up flex-col items-center gap-4 p-6 text-center sm:p-8">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-ticket-soft text-ticket-ink">
        <ClockIcon size={32} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-extrabold">We’re checking your business</h2>
        <p className="text-sm text-muted">
          {a.businessName} · {a.cacNumber}. Don’t buy anything with this account meanwhile: it becomes your store’s account.
        </p>
      </div>
      <Badge tone="ticket">Under review</Badge>
    </Card>
  )
}

function Approved({ application: a }: { application: StoreApplicationView }) {
  return (
    <Card className="flex animate-fade-up flex-col items-center gap-4 p-6 text-center sm:p-8">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-brand-soft text-brand-ink">
        <CheckIcon size={32} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-extrabold">{a.businessName} is approved</h2>
        <p className="text-sm text-muted">This account is now your store’s account.</p>
      </div>
      {/* A full load, so the app picks up the account's new role. */}
      <a href="/store" className={buttonClass('primary', 'lg')}>
        <StoreIcon size={18} /> Open the store app
      </a>
    </Card>
  )
}

const FIELD: Record<StoreApplicationError, keyof StoreApplicationInput> = {
  business_name_required: 'businessName',
  cac_invalid: 'cacNumber',
  director_name_required: 'directorName',
  phone_invalid: 'phone',
  address_required: 'address',
  area_required: 'area',
  certificate_required: 'certificatePhoto',
  director_id_required: 'directorIdPhoto',
}

function StoreApplicationForm({ previous }: { previous: StoreApplicationView | null | undefined }) {
  const submit = useSubmitStoreApplication()
  const toast = useToast()
  // A rejected applicant fixes the details; photos are always taken again.
  const [input, setInput] = useState<StoreApplicationInput>(() => ({
    businessName: previous?.businessName ?? '',
    cacNumber: previous?.cacNumber ?? '',
    directorName: previous?.directorName ?? '',
    phone: previous?.phone ?? '',
    address: previous?.address ?? '',
    area: previous?.area ?? '',
    certificatePhoto: '',
    directorIdPhoto: '',
  }))
  const [agreed, setAgreed] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const errors = validateStoreApplication(input)
  const set = (k: keyof StoreApplicationInput) => (v: string) => setInput((i) => ({ ...i, [k]: v }))
  const err = (k: keyof StoreApplicationInput) => {
    const e = showErrors ? errors.find((x) => FIELD[x] === k) : undefined
    return e ? STORE_APPLICATION_ERROR_TEXT[e] : undefined
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setShowErrors(true)
    if (errors.length || !agreed) {
      toast(errors.length ? 'A few details need fixing first.' : 'Tick the box to confirm.', 'error')
      return
    }
    submit.mutate(input, {
      onSuccess: () => toast('Sent. We’ll check your business and let you know.'),
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
      <Notice tone="ticket" icon={AlertIcon} title="This account becomes your store’s account">
        Once approved, it opens the store app and can’t buy tickets or items. Use an account you haven’t bought with, and a separate one for shopping.
      </Notice>

      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="font-display text-lg font-extrabold">Your business</h2>
        <Field label="Business name" htmlFor="biz-name" error={err('businessName')} hint="As on your CAC certificate. Buyers see this.">
          <input id="biz-name" autoComplete="organization" value={input.businessName} onChange={(e) => set('businessName')(e.target.value)} className={inputCls} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CAC number" htmlFor="biz-cac" error={err('cacNumber')} hint="RC, BN or IT, then the number.">
            <input id="biz-cac" autoComplete="off" value={input.cacNumber} onChange={(e) => set('cacNumber')(e.target.value)} className={inputCls} placeholder="RC 1234567" />
          </Field>
          <Field label="Area in Lagos" htmlFor="biz-area" error={err('area')} hint="Shown to buyers.">
            <input id="biz-area" value={input.area} onChange={(e) => set('area')(e.target.value)} className={inputCls} placeholder="Ikeja" />
          </Field>
        </div>
        <Field label="Business address" htmlFor="biz-address" error={err('address')}>
          <textarea id="biz-address" rows={2} autoComplete="street-address" value={input.address} onChange={(e) => set('address')(e.target.value)} className={cx(inputCls, 'min-h-20 py-3')} placeholder="Street, building and area" />
        </Field>
      </Card>

      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-extrabold">Director and contact</h2>
          <p className="text-xs text-subtle">A director or the proprietor. Only DrawMart’s review team sees these.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Director’s full name" htmlFor="biz-director" error={err('directorName')} hint="As on their ID.">
            <input id="biz-director" autoComplete="name" value={input.directorName} onChange={(e) => set('directorName')(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Phone" htmlFor="biz-phone" error={err('phone')}>
            <input id="biz-phone" type="tel" inputMode="tel" autoComplete="tel" value={input.phone} onChange={(e) => set('phone')(e.target.value)} className={inputCls} placeholder="0803 123 4567" />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-extrabold">Documents</h2>
          <p className="text-xs text-subtle">A clear photo or screenshot. Make sure every word is readable.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <IdPhoto label="CAC certificate" icon={StoreIcon} value={input.certificatePhoto} onChange={set('certificatePhoto')} error={err('certificatePhoto')} />
          <IdPhoto label="Director’s ID" icon={IdCardIcon} value={input.directorIdPhoto} onChange={set('directorIdPhoto')} error={err('directorIdPhoto')} />
        </div>
      </Card>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl bg-surface p-4 text-sm shadow-card">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
        <span>These details are true, and I can act for this business. I understand DrawMart can close the store and keep payouts if they’re not, or if it sells fake or stolen goods.</span>
      </label>
      {showErrors && !agreed ? (
        <span className="-mt-3 text-xs font-semibold text-hot-ink" role="alert">
          Confirm to continue.
        </span>
      ) : null}

      <Button type="submit" size="lg" loading={submit.isPending}>
        <ShieldIcon size={18} /> {previous?.status === 'rejected' ? 'Send again for review' : 'Send for review'}
      </Button>
    </form>
  )
}
