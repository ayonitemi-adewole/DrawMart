import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useMarkWinCelebrated, useUncelebratedWins } from '@/api/hooks'
import type { Category } from '@/domain/types'
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
    <WinSheet
      key={win.id}
      listingId={win.listingId}
      title={win.listingTitle}
      category={win.listingCategory}
      image={win.listingImage ?? undefined}
      winningNumber={win.winningNumber}
      onClose={close}
    />
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
