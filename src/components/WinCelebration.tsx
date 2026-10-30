import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useMarkWinCelebrated, useUncelebratedWins } from '@/api/hooks'
import { ticketNo } from '@/lib/time'
import { Confetti } from './Confetti'
import { TrophyIcon } from './icons'
import { Sheet } from './Sheet'
import { ProductImage, buttonClass } from './ui'

/**
 * Greets a winner when they next open the app, one win at a time. Waits while
 * they're paying, or already looking at a result, which has its own celebration.
 */
export function WinCelebration() {
  const wins = useUncelebratedWins()
  const { mutate: markCelebrated } = useMarkWinCelebrated()
  const { pathname } = useLocation()
  // So it goes straight away, and stays gone this visit if saving it fails.
  const [closed, setClosed] = useState<string[]>([])
  const waiting = pathname === '/checkout' || pathname.startsWith('/draws/')
  const win = waiting ? undefined : wins.find((n) => !closed.includes(n.id))
  if (!win) return null

  function close() {
    setClosed((c) => [...c, win!.id])
    markCelebrated(win!.listingId)
  }

  return (
    <Sheet key={win.id} open onClose={close} title={`You won ${win.listingTitle}`} overlay={<Confetti />}>
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex items-center gap-2 rounded-full bg-ticket px-3 py-1.5 text-xs font-extrabold tracking-[0.15em] text-on-ticket">
          <TrophyIcon size={14} /> YOU WON
        </span>
        <ProductImage category={win.listingCategory} src={win.listingImage ?? undefined} alt={win.listingTitle} size="lg" eager className="aspect-[4/3] w-full max-w-sm rounded-3xl" />
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-extrabold text-balance sm:text-3xl">Congratulations! You won {win.listingTitle}</h2>
          {win.winningNumber ? <p className="text-sm text-muted">Your ticket {ticketNo(win.winningNumber)} was drawn.</p> : null}
        </div>
        <Link to={`/draws/${win.listingId}`} state={{ announced: true }} onClick={close} className={buttonClass('ticket', 'lg', 'w-full')}>
          <TrophyIcon size={18} /> See your prize
        </Link>
      </div>
    </Sheet>
  )
}
