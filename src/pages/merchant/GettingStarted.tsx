import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useCallPhone, useMerchant, useMerchantListings, usePayoutAccount, useShopPickup } from '@/api/hooks'
import { CheckIcon } from '@/components/icons'
import { ShopPickupSheet } from '@/components/ShopPickup'
import { Button, Card, buttonClass, cx } from '@/components/ui'
import { profileStarted, startSteps, startingDone, type StartStep } from '@/domain/gettingStarted'

// Shops that chose not to take calls, on this browser. Losing it only brings the step back.
const SKIPPED_KEY = 'drawmart:calls-skipped'
function readSkipped(): string[] {
  try {
    return (localStorage.getItem(SKIPPED_KEY) ?? '').split(',').filter(Boolean)
  } catch {
    return []
  }
}
function writeSkipped(ids: string[]) {
  try {
    localStorage.setItem(SKIPPED_KEY, ids.join(','))
  } catch {
    // Private windows can refuse; the step just stays.
  }
}

/**
 * A new shop's first steps, on the store dashboard and /sell. Worked out from what the
 * shop already has (gettingStarted.ts), and gone once everything's done.
 */
export function GettingStarted({ app, onNewListing }: { app: 'store' | 'sell'; onNewListing: () => void }) {
  const shop = useMerchant()
  const payout = usePayoutAccount()
  const pickup = useShopPickup()
  const calls = useCallPhone()
  const listings = useMerchantListings()
  const [skipped, setSkipped] = useState(readSkipped)
  const [addingPickup, setAddingPickup] = useState(false)

  if (!shop.isSuccess || !payout.isSuccess || !pickup.isSuccess || !calls.isSuccess || !listings.isSuccess) return null
  const facts = {
    verified: shop.data.verified,
    payoutAccount: !!payout.data,
    pickupSpot: !!pickup.data,
    profile: profileStarted(shop.data),
    callsDecided: !!calls.data || skipped.includes(shop.data.id),
    listed: listings.data.length > 0,
  }
  if (startingDone(facts)) return null

  const store = app === 'store'
  const steps = startSteps(facts)
  const done = steps.filter((s) => s.done).length
  const skip = () => {
    const next = [...skipped, shop.data.id]
    writeSkipped(next)
    setSkipped(next)
  }
  const link = (to: string, label: string) => (
    <Link to={to} className={buttonClass('outline', 'sm', 'min-h-11')}>
      {label}
    </Link>
  )

  const text: Record<StartStep, { title: string; sub: string; action?: ReactNode }> = {
    verified: {
      title: store ? 'DrawMart checks your store' : 'DrawMart checks your ID',
      sub: facts.verified ? 'Done.' : 'We’re checking your details. You can set up the rest meanwhile.',
    },
    payouts: {
      title: 'Add your bank account',
      sub: 'So we can pay you for what you sell.',
      action: link(store ? '/store/payouts' : '/sell?tab=payouts', 'Add it'),
    },
    pickup: {
      title: 'Say where riders collect from',
      sub: 'A rider comes here for every order.',
      action: (
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => setAddingPickup(true)}>
          Add it
        </Button>
      ),
    },
    profile: {
      title: 'Set up your shop page',
      sub: 'A logo and a few words about you help buyers trust you.',
      action: link(store ? '/store/profile' : '/sell?tab=profile', 'Set it up'),
    },
    calls: {
      title: 'Choose whether buyers can call you',
      sub: 'Add a number in Messages, or skip it: buyers can always message you.',
      action: (
        <span className="flex flex-wrap gap-2">
          {link(store ? '/store/messages' : '/messages', 'Add a number')}
          <Button variant="ghost" size="sm" className="min-h-11" onClick={skip}>
            Skip
          </Button>
        </span>
      ),
    },
    listing: {
      title: 'Send your first listing',
      sub: 'DrawMart checks it before it goes on sale.',
      action: (
        <Button size="sm" className="min-h-11" onClick={onNewListing}>
          Start one
        </Button>
      ),
    },
  }

  return (
    <Card className="flex animate-fade-up flex-col gap-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col">
          <strong className="font-display text-lg">Get your shop ready</strong>
          <span className="text-sm text-subtle">
            {done} of {steps.length} done. This goes away once they all are.
          </span>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Steps done">
        <span className="block h-full rounded-full bg-brand transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="flex flex-col divide-y divide-line">
        {steps.map(({ step, done: ok }) => (
          <li key={step} className="flex flex-wrap items-center gap-3 py-3">
            <span
              className={cx('flex size-7 shrink-0 items-center justify-center rounded-full border-2', ok ? 'border-brand bg-brand text-on-brand' : 'border-line-strong')}
              aria-hidden="true"
            >
              {ok ? <CheckIcon size={14} /> : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cx('text-sm font-bold', ok && 'text-subtle line-through')}>
                {text[step].title}
                <span className="sr-only">{ok ? ' (done)' : ' (to do)'}</span>
              </span>
              {ok ? null : <span className="text-xs text-subtle">{text[step].sub}</span>}
            </span>
            {ok || !text[step].action ? null : <span className="flex basis-full pl-10 sm:basis-auto sm:pl-0">{text[step].action}</span>}
          </li>
        ))}
      </ol>
      {addingPickup ? <ShopPickupSheet onClose={() => setAddingPickup(false)} /> : null}
    </Card>
  )
}
