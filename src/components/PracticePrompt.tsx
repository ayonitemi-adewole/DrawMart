import { useState } from 'react'
import { Link } from 'react-router'
import { useAccess, useMyListings } from '@/api/hooks'
import { dismissPracticePrompt, practicePromptDismissed } from '@/lib/practicePrompt'
import { DiceIcon, XIcon } from './icons'
import { buttonClass } from './ui'

/** Offers the practice draw to anyone who hasn't bought a ticket yet, until they try it or close this. */
export function PracticePrompt() {
  const access = useAccess()
  const mine = useMyListings()
  const [dismissed, setDismissed] = useState(practicePromptDismissed)
  const noTickets = access.ready && (!access.signedIn || mine.data?.length === 0)
  if (dismissed || !noTickets) return null

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-line bg-surface p-4 shadow-card" aria-label="Practice draw">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-sky-soft text-sky">
        <DiceIcon size={22} />
      </span>
      <div className="flex min-w-0 flex-1 basis-48 flex-col">
        <strong className="leading-tight">New here? Try a practice draw</strong>
        <span className="text-sm text-muted">See how it works with pretend tickets. No money, no prize, under a minute.</span>
      </div>
      <div className="flex items-center gap-1">
        <Link to="/practice" className={buttonClass('outline')}>
          Try it
        </Link>
        <button
          type="button"
          aria-label="Close the practice draw offer"
          onClick={() => {
            dismissPracticePrompt()
            setDismissed(true)
          }}
          className="flex size-11 cursor-pointer items-center justify-center rounded-xl text-muted hover:bg-sunken hover:text-ink"
        >
          <XIcon size={18} />
        </button>
      </div>
    </section>
  )
}
