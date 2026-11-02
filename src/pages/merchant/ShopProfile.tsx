import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useAccess, useMerchant, useUpdateShopProfile } from '@/api/hooks'
import type { Merchant } from '@/domain/types'
import { XIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Button, Card, ErrorState, Field, Skeleton, Switch, buttonClass, cx, errorMessage, inputCls } from '@/components/ui'
import { SHOP_LIMITS, shopProfileErrors } from '@/domain/shopProfile'
import { photoToDataUrl } from '@/lib/image'

/** Shop profile: what buyers see on the shop's public page. */
export function ShopProfile() {
  const q = useMerchant()
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  return <ShopProfileForm key={q.data.id} shop={q.data} />
}

function ImageField({ label, hint, value, onChange, wide }: { label: string; hint: string; value: string | null; onChange: (v: string | null) => void; wide?: boolean }) {
  const toast = useToast()
  const [reading, setReading] = useState(false)
  async function onPick(file: File | undefined) {
    if (!file) return
    setReading(true)
    try {
      onChange(await photoToDataUrl(file, wide ? 1500 : 500))
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setReading(false)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold">{label}</span>
      <span className="text-xs text-subtle">{hint}</span>
      {value ? (
        <div className="relative w-fit">
          <img src={value} alt={label} className={cx('rounded-2xl border border-line bg-photo object-cover', wide ? 'h-24 w-72 max-w-full' : 'size-24')} />
          <button type="button" aria-label={`Remove the ${label.toLowerCase()}`} onClick={() => onChange(null)} className="absolute -top-2 -right-2 flex size-11 items-center justify-center">
            <span className="flex size-7 items-center justify-center rounded-full bg-ink text-ground shadow-card">
              <XIcon size={14} />
            </span>
          </button>
        </div>
      ) : (
        <label className="flex min-h-11 w-fit cursor-pointer items-center rounded-xl border border-line-strong px-4 text-sm font-bold">
          {reading ? 'Reading…' : 'Add a picture'}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onPick(e.target.files?.[0])} />
        </label>
      )}
    </div>
  )
}

function ShopProfileForm({ shop }: { shop: Merchant }) {
  const update = useUpdateShopProfile()
  const toast = useToast()
  const role = useAccess().role
  const [about, setAbout] = useState(shop.about ?? '')
  const [openingHours, setOpeningHours] = useState(shop.openingHours ?? '')
  const [shopNote, setShopNote] = useState(shop.shopNote ?? '')
  const [publicPhone, setPublicPhone] = useState(shop.publicPhone ?? '')
  const [logoUrl, setLogoUrl] = useState(shop.logoUrl ?? null)
  const [coverUrl, setCoverUrl] = useState(shop.coverUrl ?? null)
  const [showCac, setShowCac] = useState(!!shop.showCac)
  const [showErrors, setShowErrors] = useState(false)
  const input = { about, openingHours, shopNote, publicPhone, logoUrl, coverUrl, showCac }
  const errors = shopProfileErrors(input, shop.kind)
  const store = shop.kind !== 'individual'

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (errors.length) {
      setShowErrors(true)
      return
    }
    update.mutate(input, { onSuccess: () => toast('Saved. Your page is up to date.'), onError: (err) => toast(errorMessage(err), 'error') })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-5">
      <Card className="flex flex-col gap-5 p-5">
        <ImageField label="Logo" hint="Square works best." value={logoUrl} onChange={setLogoUrl} />
        <ImageField label="Cover picture" hint="Wide, about 3 times as wide as it is tall." value={coverUrl} onChange={setCoverUrl} wide />
        <Field label="About your shop" htmlFor="shop-about" hint={`${about.length}/${SHOP_LIMITS.about}`}>
          <textarea id="shop-about" value={about} maxLength={SHOP_LIMITS.about} onChange={(e) => setAbout(e.target.value)} rows={3} className={cx(inputCls, 'py-3')} placeholder="What you sell, and why buy from you" />
        </Field>
        <Field label="Opening hours" htmlFor="shop-hours" hint="When you can hand things to a rider.">
          <input id="shop-hours" value={openingHours} maxLength={SHOP_LIMITS.openingHours} onChange={(e) => setOpeningHours(e.target.value)} className={inputCls} placeholder="Mon–Sat, 9am–6pm" />
        </Field>
        <Field label="A note for buyers (optional)" htmlFor="shop-note" hint="Warranty, what’s included, anything else. Delivery and returns follow DrawMart’s rules, which your page shows anyway.">
          <textarea id="shop-note" value={shopNote} maxLength={SHOP_LIMITS.shopNote} onChange={(e) => setShopNote(e.target.value)} rows={2} className={cx(inputCls, 'py-3')} />
        </Field>
      </Card>
      <Card className="flex flex-col gap-4 p-5">
        <strong>What else buyers can see</strong>
        <Field label="Phone number on your page (optional)" htmlFor="shop-phone" hint="Leave blank to keep it private. Buyers can always message you about a product.">
          <input id="shop-phone" type="tel" inputMode="tel" value={publicPhone} onChange={(e) => setPublicPhone(e.target.value)} className={inputCls} placeholder="0803 123 4567" />
        </Field>
        {store ? (
          <div className="flex items-center gap-3 text-sm">
            <span id="show-cac" className="min-w-0 flex-1">
              <strong className="block">Show your CAC registration number</strong>
              <span className="text-xs text-subtle">Some buyers like to look you up. It’s hidden unless you turn this on.</span>
            </span>
            <Switch checked={showCac} labelledBy="show-cac" onChange={() => setShowCac((v) => !v)} />
          </div>
        ) : null}
      </Card>
      {showErrors && errors.length ? (
        <ul className="list-disc rounded-2xl bg-hot-soft py-3 pr-3 pl-8 text-sm text-hot-ink" role="alert">
          {errors.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" loading={update.isPending}>
          Save
        </Button>
        <Link to={role === 'store' ? '/store/shop' : `/stores/${shop.id}`} className={buttonClass('outline', 'lg')}>
          See your page
        </Link>
      </div>
    </form>
  )
}
