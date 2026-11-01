import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useListing, useMarkWinCelebrated, usePushPreferences, useSetPushPreference, useUncelebratedResults } from '@/api/hooks'
import type { NotificationView } from '@/api/types'
import { RULES } from '@/domain/rules'
import type { Category } from '@/domain/types'
import { ticketNo } from '@/lib/time'
import { useTicketReveal } from '@/lib/useTicketReveal'
import { Confetti } from './Confetti'
import { TrophyIcon } from './icons'
import { Sheet } from './Sheet'
import { Button, ProductImage, buttonClass } from './ui'

/**
 * Shows everyone who held a ticket how a draw turned out, when they next have the
 * app open: a short roll ending on the real winning ticket, once per draw across
 * devices. Waits while they're paying, or already looking at a result, which has its
 * own. Wins go one at a time, oldest first. After time away, only the latest loss is
 * shown rather than a string of them.
 */
export function WinCelebration() {
  const results = useUncelebratedResults()
  const prefs = usePushPreferences()
  const { mutate: markCelebrated } = useMarkWinCelebrated()
  const { pathname } = useLocation()
  // So it goes straight away, and stays gone this visit if saving it fails.
  const [closed, setClosed] = useState<string[]>([])
  const waiting = pathname === '/checkout' || pathname.startsWith('/draws/') || !prefs.data || prefs.data.drawReveal === false
  const open = results.filter((n) => !closed.includes(n.id))
  const losses = open.filter((n) => n.kind === 'draw_lost')
  const next = waiting ? undefined : (open.find((n) => n.kind === 'draw_won') ?? losses[losses.length - 1])
  if (!next) return null

  function close() {
    const done = next!.kind === 'draw_won' ? [next!] : losses
    setClosed((c) => [...c, ...done.map((n) => n.id)])
    for (const n of done) markCelebrated(n.listingId)
  }

  return <ResultReveal key={next.id} result={next} onClose={close} />
}

/** Waits for the buyer's own tickets, so the roll can keep clear of them. */
function ResultReveal({ result, onClose }: { result: NotificationView; onClose: () => void }) {
  const listing = useListing(result.listingId)
  if (result.winningNumber === null || !listing.data) return null
  return <Reveal result={result} winningNumber={result.winningNumber} ticketCount={listing.data.ticketCount} myNumbers={listing.data.myNumbers} onClose={onClose} />
}

function Reveal({ result, winningNumber, ticketCount, myNumbers, onClose }: { result: NotificationView; winningNumber: number; ticketCount: number; myNumbers: number[]; onClose: () => void }) {
  const { rolling, shown, skip } = useTicketReveal({ ticketCount, winningNumber, myNumbers, autoplay: true })
  const setPreference = useSetPushPreference()

  if (rolling) {
    return (
      <Sheet open onClose={onClose} title={`Draw result: ${result.listingTitle}`}>
        <div className="flex flex-col items-center gap-4 pt-2 text-center">
          <strong className="font-display text-xl text-balance">{result.listingTitle}</strong>
          <WinningTicket number={shown} busy />
          <Button variant="ghost" size="sm" onClick={skip}>
            Skip
          </Button>
        </div>
      </Sheet>
    )
  }

  if (result.kind === 'draw_won') {
    return <WinSheet listingId={result.listingId} title={result.listingTitle} category={result.listingCategory} image={result.listingImage ?? undefined} winningNumber={winningNumber} onClose={onClose} />
  }

  return (
    <Sheet open onClose={onClose} title={`Draw result: ${result.listingTitle}`}>
      <div className="flex flex-col items-center gap-4 pt-2 text-center">
        <strong className="font-display text-xl text-balance">{result.listingTitle}</strong>
        <WinningTicket number={winningNumber} />
        <p className="max-w-xs text-sm text-muted">Your tickets didn’t come up this time. {RULES.consolationCreditBps / 100}% of what you spent is back in your wallet as store credit.</p>
        <div className="flex w-full gap-2">
          <Link to={`/draws/${result.listingId}`} state={{ announced: true }} onClick={onClose} className={buttonClass('outline', 'md', 'flex-1')}>
            Check the draw
          </Link>
          <Button className="flex-1" onClick={onClose}>
            Done
          </Button>
        </div>
        <button
          type="button"
          className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-subtle hover:text-ink"
          onClick={() => {
            setPreference.mutate({ category: 'drawReveal', enabled: false })
            onClose()
          }}
        >
          Don’t show these when I open the app
        </button>
      </div>
    </Sheet>
  )
}

function WinningTicket({ number, busy }: { number: number; busy?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-sm font-semibold text-muted">Winning ticket</span>
      <span aria-live="polite" aria-busy={busy} className="rounded-3xl bg-sunken px-6 py-3 font-mono text-5xl font-extrabold tracking-tight tabular-nums">
        {ticketNo(number)}
      </span>
    </div>
  )
}

/** The pop-up itself. Render it to play it: the confetti runs once per mount. */
export function WinSheet({
  listingId,
  title,
  category,
  image,
  winningNumber,
  onClose,
}: {
  listingId: string
  title: string
  category: Category
  image?: string
  winningNumber: number | null
  onClose: () => void
}) {
  return (
    <Sheet open onClose={onClose} title={`You won ${title}`} overlay={<Confetti />} pop>
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex items-center gap-2 rounded-full bg-ticket px-3 py-1.5 text-xs font-extrabold tracking-[0.15em] text-on-ticket">
          <TrophyIcon size={14} /> YOU WON
        </span>
        <ProductImage category={category} src={image} alt={title} size="lg" eager className="aspect-4/3 w-full max-w-sm animate-pop rounded-3xl [animation-delay:350ms]" />
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-extrabold text-balance sm:text-3xl">Congratulations! You won {title}</h2>
          {winningNumber ? <p className="text-sm text-muted">Your ticket {ticketNo(winningNumber)} was drawn.</p> : null}
        </div>
        <Link to={`/draws/${listingId}`} state={{ announced: true }} onClick={onClose} className={buttonClass('ticket', 'lg', 'w-full')}>
          <TrophyIcon size={18} /> See your prize
        </Link>
      </div>
    </Sheet>
  )
}
