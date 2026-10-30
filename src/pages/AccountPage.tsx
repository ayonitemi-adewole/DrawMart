import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '@/api'
import { useAccess, useAddressActions, useAddresses, useDemoActions, useMe, useSignOut, useUpdateProfile } from '@/api/hooks'
import { AddressPicker } from '@/components/AddressPicker'
import { resetIntro } from '@/components/HowItWorks'
import { GaugeIcon, LogOutIcon, MapPinIcon, PhoneIcon, PlusIcon, SettingsIcon, StoreIcon, UserIcon, WalletIcon, type IconComponent } from '@/components/icons'
import { Sheet } from '@/components/Sheet'
import { ThemePicker } from '@/components/ThemeToggle'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, PageTitle, Skeleton, errorMessage, inputCls } from '@/components/ui'
import { MAX_ADDRESS_LABEL, MAX_SAVED_ADDRESSES, SAVED_ADDRESS_ERROR_TEXT, validateSavedAddress, type SavedAddress, type SavedAddressInput } from '@/domain/addresses'
import { isNigerianMobile } from '@/domain/listing'
import { RULES } from '@/domain/rules'
import type { User } from '@/domain/types'

const STATES = ['Lagos', 'Ogun', 'Oyo', 'FCT', 'Rivers', 'Kano']

/** /account: profile details, saved delivery addresses and settings. */
export function AccountPage() {
  const me = useMe()
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Account" sub="Your details, delivery addresses and settings, saved so you don’t have to fill them in every time.">
        {me.data?.displayName ?? 'Your account'}
      </PageTitle>
      <div className="grid gap-5 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          {me.isPending ? <Skeleton className="h-72" /> : me.isError ? <ErrorState error={me.error} onRetry={() => me.refetch()} /> : <Profile key={me.data.id} user={me.data} />}
          <Addresses />
        </div>
        <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-24">
          <Settings />
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ icon: Icon, title, sub }: { icon: IconComponent; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sunken text-muted">
        <Icon size={20} />
      </span>
      <div className="flex min-w-0 flex-col">
        <h2 className="font-bold">{title}</h2>
        {sub ? <span className="truncate text-xs text-subtle">{sub}</span> : null}
      </div>
    </div>
  )
}

function Profile({ user }: { user: User }) {
  const { email } = useAccess()
  const update = useUpdateProfile()
  const toast = useToast()
  const [name, setName] = useState(user.displayName)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [state, setState] = useState(user.state)
  const phoneBad = !!phone.trim() && !isNigerianMobile(phone)
  const nameBad = !name.trim()
  const changed = name.trim() !== user.displayName || phone.trim() !== (user.phone ?? '') || state !== user.state
  const licensed = RULES.licensedStates.includes(state)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (phoneBad || nameBad) return
    // Outside test mode, the state comes from identity verification.
    update.mutate(
      { displayName: name, phone: phone.trim() || null, ...(api.testMode ? { state } : {}) },
      { onSuccess: () => toast('Saved.'), onError: (err) => toast(errorMessage(err), 'error') },
    )
  }

  return (
    <Card className="flex flex-col gap-4 p-5 sm:p-6">
      <SectionTitle icon={UserIcon} title="Profile" sub={email ? `Signed in as ${email}` : undefined} />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Your name" htmlFor="profile-name" error={nameBad ? 'Enter your name.' : undefined} hint="Sellers see this when you message them.">
          <input id="profile-name" value={name} maxLength={60} autoComplete="name" onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field
          label={<span className="flex items-center gap-1.5"><PhoneIcon size={14} /> Phone number</span>}
          htmlFor="profile-phone"
          error={phoneBad ? 'Enter a Nigerian mobile number, e.g. 0803 123 4567.' : undefined}
          hint="Filled in for you at checkout."
        >
          <input id="profile-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" className={inputCls} />
        </Field>
        <Field
          label={<span className="flex items-center gap-1.5"><MapPinIcon size={14} /> State of residence</span>}
          htmlFor="profile-state"
          hint={`Tickets can only be bought in licensed states (${RULES.licensedStates.join(', ')}).${api.testMode ? ' In production this is checked with KYC, not chosen here.' : ' This comes from your identity check.'}`}
        >
          <select id="profile-state" value={state} disabled={!api.testMode} onChange={(e) => setState(e.target.value)} className={inputCls}>
            {!state ? <option value="">Not verified yet</option> : null}
            {STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        {state && !licensed ? <Notice tone="hot">DrawMart isn’t available in {state} yet, so ticket purchases are paused.</Notice> : null}
        <Button type="submit" className="min-h-11 sm:self-start" loading={update.isPending} disabled={!changed || phoneBad || nameBad}>
          Save changes
        </Button>
      </form>
    </Card>
  )
}

function Addresses() {
  const q = useAddresses()
  const { setDefault, remove } = useAddressActions()
  const toast = useToast()
  // null: just the list. 'new' or an address: its form.
  const [editing, setEditing] = useState<SavedAddress | 'new' | null>(null)
  const [deleting, setDeleting] = useState<SavedAddress | null>(null)
  const list = q.data ?? []
  const onError = (err: unknown) => toast(errorMessage(err), 'error')

  return (
    <Card className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle icon={MapPinIcon} title="Delivery addresses" sub="Pick one at checkout." />
        {!editing && list.length > 0 && list.length < MAX_SAVED_ADDRESSES ? (
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => setEditing('new')}>
            <PlusIcon size={16} /> Add address
          </Button>
        ) : null}
      </div>

      {editing ? (
        <AddressForm key={editing === 'new' ? 'new' : editing.id} address={editing === 'new' ? null : editing} isFirst={list.length === 0} onClose={() => setEditing(null)} />
      ) : q.isPending ? (
        <Skeleton className="h-32" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={MapPinIcon}
          title="No saved addresses"
          body="Save your home or work and checkout takes seconds."
          action={
            <Button onClick={() => setEditing('new')}>
              <PlusIcon size={18} /> Add address
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {list.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <strong>{a.label}</strong>
                  {a.isDefault ? <Badge>Default</Badge> : null}
                </span>
                <span className="text-muted">{a.address}</span>
                <span className="text-xs text-subtle">Rider calls {a.contactPhone}</span>
              </div>
              <div className="-ml-2 flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setEditing(a)}>
                  Edit
                </Button>
                {a.isDefault ? null : (
                  <Button variant="ghost" size="sm" className="min-h-11" disabled={setDefault.isPending} onClick={() => setDefault.mutate(a.id, { onError })}>
                    Make default
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setDeleting(a)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!editing && list.length >= MAX_SAVED_ADDRESSES ? <p className="text-xs text-subtle">You’ve saved the most you can ({MAX_SAVED_ADDRESSES}). Remove one to add another.</p> : null}

      <Sheet open={!!deleting} onClose={() => !remove.isPending && setDeleting(null)} title="Remove address">
        <h2 className="pr-10 font-display text-2xl font-extrabold">Remove {deleting?.label}?</h2>
        <p className="text-sm text-muted">Orders already placed still go to the address they were placed with.</p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={remove.isPending} onClick={() => setDeleting(null)}>
            Keep it
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={remove.isPending}
            onClick={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError })}
          >
            Remove
          </Button>
        </div>
      </Sheet>
    </Card>
  )
}

function AddressForm({ address, isFirst, onClose }: { address: SavedAddress | null; isFirst: boolean; onClose: () => void }) {
  const me = useMe()
  const { save } = useAddressActions()
  const toast = useToast()
  const [form, setForm] = useState<SavedAddressInput>({
    id: address?.id,
    label: address?.label ?? (isFirst ? 'Home' : ''),
    address: address?.address ?? '',
    location: address?.location ?? null,
    contactPhone: address?.contactPhone ?? me.data?.phone ?? '',
    makeDefault: false,
  })
  const [showErrors, setShowErrors] = useState(false)
  const problems = validateSavedAddress(form)
  const err = (k: 'label_required' | 'address_required' | 'phone_invalid') => (showErrors && problems.includes(k) ? SAVED_ADDRESS_ERROR_TEXT[k] : undefined)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setShowErrors(true)
    if (problems.length) return
    save.mutate(form, { onSuccess: onClose, onError: (error) => toast(errorMessage(error), 'error') })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 border-t border-line pt-4">
      <h3 className="font-bold">{address ? `Edit ${address.label}` : 'New address'}</h3>
      <Field label="Name for this address" htmlFor="address-label" error={err('label_required')} hint="e.g. Home, Work, Mum’s house.">
        <input id="address-label" value={form.label} maxLength={MAX_ADDRESS_LABEL} onChange={(e) => setForm({ ...form, label: e.target.value })} className={inputCls} />
      </Field>
      <AddressPicker
        id="saved-address"
        label="Address"
        hint="Add your flat, gate colour or a landmark to help the rider. Lagos only for now."
        placeholder="e.g. 15 Awolowo Road, Ikoyi"
        address={form.address}
        onAddress={(value) => setForm((f) => ({ ...f, address: value }))}
        location={form.location}
        onLocation={(location) => setForm((f) => ({ ...f, location }))}
        addressError={err('address_required')}
        showPinError={showErrors}
      />
      <Field label={<span className="flex items-center gap-1.5"><PhoneIcon size={14} /> Phone for the rider</span>} htmlFor="address-phone" error={err('phone_invalid')}>
        <input id="address-phone" type="tel" inputMode="tel" autoComplete="tel" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="0803 123 4567" className={inputCls} />
      </Field>
      {isFirst || address?.isDefault ? null : (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" checked={!!form.makeDefault} onChange={(e) => setForm({ ...form, makeDefault: e.target.checked })} className="size-5 shrink-0 accent-brand" />
          Use this first at checkout
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" loading={save.isPending}>
          Save address
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" disabled={save.isPending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

const LINKS: { to: string; icon: IconComponent; label: string; sub: string }[] = [
  { to: '/wallet', icon: WalletIcon, label: 'Wallet', sub: 'Balance, top-ups and activity' },
  { to: '/wallet', icon: GaugeIcon, label: 'Weekly spending limit', sub: 'Set in your wallet' },
  { to: '/sell', icon: StoreIcon, label: 'Sell on DrawMart', sub: 'Your shop, or apply to sell' },
]

function Settings() {
  const signOut = useSignOut()
  const demo = useDemoActions()
  const navigate = useNavigate()
  const [confirmReset, setConfirmReset] = useState(false)
  const canReset = api.testMode && !!api.demoReset

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle icon={SettingsIcon} title="Settings" />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">Appearance</span>
        <ThemePicker />
      </div>
      <ul className="flex flex-col border-t border-line pt-2">
        {LINKS.map((l) => (
          <li key={l.label}>
            <Link to={l.to} className="flex min-h-14 items-center gap-3 rounded-xl px-1 text-ink no-underline hover:bg-sunken">
              <l.icon size={18} className="shrink-0 text-muted" />
              <span className="flex min-w-0 flex-col text-sm">
                <span className="font-bold">{l.label}</span>
                <span className="text-xs font-normal text-subtle">{l.sub}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={() => {
            resetIntro()
            window.location.assign('/')
          }}
        >
          Replay the intro
        </Button>
        <Button variant="outline" size="sm" className="min-h-11" loading={signOut.isPending} onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate('/') })}>
          <LogOutIcon size={16} /> Sign out
        </Button>
        {canReset ? (
          <Button variant="danger" size="sm" className="min-h-11" onClick={() => setConfirmReset(true)}>
            Reset demo data
          </Button>
        ) : null}
      </div>

      {canReset ? (
        <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset demo data">
          <h2 className="pr-10 font-display text-2xl font-extrabold">Start over?</h2>
          <p className="text-sm text-muted">This clears your test wallet, tickets and any listings you created, and reloads the sample draws.</p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" loading={demo.reset.isPending} onClick={() => demo.reset.mutate()}>
              Reset everything
            </Button>
          </div>
        </Sheet>
      ) : null}
    </Card>
  )
}
