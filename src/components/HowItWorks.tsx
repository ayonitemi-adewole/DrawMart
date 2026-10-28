import { useState } from 'react'
import { RULES } from '@/domain/rules'
import { CoinIcon, DiceIcon, LockIcon, TicketIcon, type IconComponent } from './icons'
import { Sheet } from './Sheet'
import { Button, cx } from './ui'

export const HOW_STEPS: { icon: IconComponent; title: string; body: string; tone: string }[] = [
  { icon: LockIcon, title: 'Real items, checked first', body: 'DrawMart collects each item into escrow, or inspects cars on site, before a single ticket is sold.', tone: 'bg-brand-soft text-brand-ink' },
  { icon: TicketIcon, title: 'Grab a few tickets', body: `Pay from your wallet. Up to ${RULES.maxTicketsPerUserPerListing} tickets per person, per draw.`, tone: 'bg-ticket-soft text-ticket-ink' },
  { icon: DiceIcon, title: 'Sold out? It draws instantly', body: 'A provably fair draw picks the winner. Anyone can re-check the maths.', tone: 'bg-sky-soft text-sky' },
  { icon: CoinIcon, title: 'Didn’t win? Get credit', body: `${RULES.consolationCreditBps / 100}% of what you spent comes back as store credit.`, tone: 'bg-hot-soft text-hot-ink' },
]

export function HowItWorksGrid({ className }: { className?: string }) {
  return (
    <ol className={cx('grid gap-3 sm:grid-cols-2 lg:grid-cols-4', className)}>
      {HOW_STEPS.map((s, i) => (
        <li key={s.title} className="flex animate-fade-up flex-col gap-3 rounded-3xl border border-line bg-surface p-5 shadow-card" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="flex items-center justify-between">
            <span className={cx('flex size-11 items-center justify-center rounded-2xl', s.tone)}>
              <s.icon size={22} />
            </span>
            <span className="font-display text-3xl font-extrabold text-line-strong">{i + 1}</span>
          </div>
          <strong className="leading-tight">{s.title}</strong>
          <p className="text-sm leading-snug text-muted">{s.body}</p>
        </li>
      ))}
    </ol>
  )
}

const SEEN_KEY = 'drawmart:intro-seen'

function seenIntro() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true
  }
}

export function resetIntro() {
  try {
    localStorage.removeItem(SEEN_KEY)
  } catch {
    /* ignore */
  }
}

/** A short swipe-through intro shown once to first-time visitors. */
export function IntroSheet() {
  const [open, setOpen] = useState(() => !seenIntro())
  const [step, setStep] = useState(0)
  const s = HOW_STEPS[step]
  const last = step === HOW_STEPS.length - 1

  function close() {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  return (
    <Sheet open={open} onClose={close} title="How DrawMart works">
      <div key={step} className="flex animate-fade-up flex-col items-center gap-4 px-2 pt-4 text-center">
        <span className={cx('flex size-20 items-center justify-center rounded-[28px]', s.tone)}>
          <s.icon size={40} />
        </span>
        <span className="text-xs font-extrabold tracking-[0.14em] text-brand uppercase">
          Step {step + 1} of {HOW_STEPS.length}
        </span>
        <h2 className="font-display text-2xl leading-tight font-extrabold">{s.title}</h2>
        <p className="max-w-xs text-muted">{s.body}</p>
      </div>
      <div className="flex justify-center gap-1.5 py-2" aria-hidden="true">
        {HOW_STEPS.map((_, i) => (
          <span key={i} className={cx('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-brand' : 'w-1.5 bg-line-strong')} />
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={close}>
          Skip
        </Button>
        <Button className="flex-2" onClick={() => (last ? close() : setStep(step + 1))}>
          {last ? 'Start exploring' : 'Next'}
        </Button>
      </div>
    </Sheet>
  )
}
