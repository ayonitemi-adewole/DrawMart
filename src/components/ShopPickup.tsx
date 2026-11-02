import { useState, type FormEvent } from 'react'
import { useSaveShopPickup, useShopPickup } from '@/api/hooks'
import { shopPickupErrorText, shopPickupErrors } from '@/domain/shopPickup'
import type { GeoPoint } from '@/domain/types'
import { AddressPicker } from './AddressPicker'
import { MapPinIcon, PhoneIcon } from './icons'
import { Sheet } from './Sheet'
import { useToast } from './toast'
import { Button, Card, Field, Notice, errorMessage, inputCls } from './ui'

/** Where riders collect from. Saves the shop's delivery area too, since that follows the pin. */
export function ShopPickupSheet({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const q = useShopPickup()
  const save = useSaveShopPickup()
  const toast = useToast()
  const [address, setAddress] = useState(q.data?.address ?? '')
  const [location, setLocation] = useState<GeoPoint | null>(q.data?.location ?? null)
  const [phone, setPhone] = useState(q.data?.contactPhone ?? '')
  const [showErrors, setShowErrors] = useState(false)
  const errors = shopPickupErrors({ address, location, contactPhone: phone })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (errors.length || !location) {
      setShowErrors(true)
      return
    }
    save
      .mutateAsync({ address, location, contactPhone: phone })
      .then(() => {
        toast('Saved. Riders will collect from there.')
        onClose()
        onSaved?.()
      })
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <Sheet open onClose={() => !save.isPending && onClose()} title="Where riders collect from">
      <h2 className="pr-10 font-display text-2xl font-extrabold">Where should riders collect from?</h2>
      <p className="text-sm text-muted">Only the rider coming to collect sees this, and only while they’re on their way. What buyers pay for delivery depends on this area.</p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <AddressPicker
          id="shop-pickup"
          label="Pickup address"
          hint="Street, building and area in Lagos."
          placeholder="e.g. 12 Allen Avenue, Ikeja"
          address={address}
          onAddress={setAddress}
          location={location}
          onLocation={setLocation}
          addressError={showErrors && errors.includes('address_required') ? shopPickupErrorText(['address_required']) : undefined}
          showPinError={showErrors}
        />
        <Field label="Number for the rider to call" htmlFor="shop-pickup-phone" error={showErrors && errors.includes('phone_invalid') ? shopPickupErrorText(['phone_invalid']) : undefined}>
          <input id="shop-pickup-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="0803 123 4567" />
        </Field>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

/** Shows where riders collect from, with a nudge if the seller hasn't said yet. */
export function ShopPickupCard() {
  const q = useShopPickup()
  const [open, setOpen] = useState(false)
  if (q.isPending || q.isError) return null
  return (
    <>
      {q.data ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <div className="flex min-w-0 flex-col gap-1">
            <strong>Riders collect from</strong>
            <span className="flex items-start gap-2 text-muted">
              <MapPinIcon size={14} className="mt-0.5 shrink-0" /> {q.data.address}
            </span>
            <span className="flex items-center gap-2 text-muted">
              <PhoneIcon size={14} className="shrink-0" /> {q.data.contactPhone}
            </span>
          </div>
          <Button variant="outline" onClick={() => setOpen(true)}>
            Change
          </Button>
        </Card>
      ) : (
        <Notice tone="ticket" icon={MapPinIcon} title="Where should riders collect from?" action={<Button size="sm" className="min-h-11" onClick={() => setOpen(true)}>Add it</Button>}>
          A rider can’t collect your orders until you add this, and it sets what buyers pay for delivery.
        </Notice>
      )}
      {open ? <ShopPickupSheet onClose={() => setOpen(false)} /> : null}
    </>
  )
}
