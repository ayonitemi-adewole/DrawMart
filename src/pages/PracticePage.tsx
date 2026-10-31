import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CheckIcon, DiceIcon, LockIcon } from '@/components/icons'
import { TicketStub } from '@/components/TicketStub'
import { Button, Card, PageTitle, ProgressBar, buttonClass, chipClass, cx } from '@/components/ui'
import { chanceText } from '@/domain/chance'
import { formatNaira } from '@/domain/money'
import { PRACTICE, drawPractice, practiceNumbers, startPractice, type PracticeGame, type PracticeResult } from '@/domain/practice'
import { RULES } from '@/domain/rules'
import { dismissPracticePrompt } from '@/lib/practicePrompt'

/** How often another pretend ticket goes. At most about 4 seconds in all. */
const SELL_EVERY_MS = 320

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** On every step, so this can never be mistaken for a real draw or a free entry. */
function PracticeLabel() {
  return <span className="w-fit rounded-full bg-ticket px-3 py-1 text-xs font-extrabold text-on-ticket">Practice: no money</span>
}

/** /practice: one pretend draw, start to finish. Runs in the browser only, and never touches a wallet. */
export function PracticePage() {
  const [round, setRound] = useState(0)
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <PageTitle eyebrow="Practice" sub="See how a draw works, start to finish, with pretend tickets. It takes under a minute. There’s no prize and no credit, and nothing leaves your wallet.">
        Try a practice draw
      </PageTitle>
      <PracticeRound key={round} onAgain={() => setRound(round + 1)} />
    </div>
  )
}

function PracticeRound({ onAgain }: { onAgain: () => void }) {
  const [game, setGame] = useState<PracticeGame | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [selling, setSelling] = useState(false)
  const [sold, setSold] = useState<number>(PRACTICE.soldBefore)
  const [result, setResult] = useState<PracticeResult | null>(null)

  useEffect(() => {
    let live = true
    void startPractice().then((g) => {
      if (live) setGame(g)
    })
    return () => {
      live = false
    }
  }, [])

  // The remaining pretend tickets sell, then the draw runs on the last one.
  useEffect(() => {
    if (!selling || !game) return
    let live = true
    const finish = () =>
      void drawPractice(game, quantity).then((r) => {
        if (!live) return
        setResult(r)
        dismissPracticePrompt()
      })
    if (prefersReducedMotion()) {
      setSold(PRACTICE.ticketCount)
      finish()
      return () => {
        live = false
      }
    }
    let current = PRACTICE.soldBefore + quantity
    setSold(current)
    // Taking every ticket left means there's nothing to wait for.
    if (current >= PRACTICE.ticketCount) {
      finish()
      return () => {
        live = false
      }
    }
    const timer = setInterval(() => {
      current += 1
      setSold(current)
      if (current >= PRACTICE.ticketCount) {
        clearInterval(timer)
        finish()
      }
    }, SELL_EVERY_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [selling, game, quantity])

  if (result && game) return <PracticeOutcome game={game} quantity={quantity} result={result} onAgain={onAgain} />

  if (selling) {
    return (
      <Card className="flex flex-col gap-4 p-5">
        <PracticeLabel />
        <div className="flex flex-col gap-1">
          <strong className="font-display text-xl">The other tickets are selling</strong>
          <p className="text-sm text-muted">A draw only runs once every ticket has gone. If they don’t sell by the deadline, a real draw refunds everyone or carries on as the seller chose.</p>
        </div>
        <YourTickets quantity={quantity} />
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <ProgressBar value={sold} max={PRACTICE.ticketCount} label={`${sold} of ${PRACTICE.ticketCount} practice tickets sold`} />
          <span className="text-xs font-semibold text-muted tabular-nums">
            {sold} of {PRACTICE.ticketCount} sold
          </span>
        </div>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col gap-5 p-5">
      <PracticeLabel />
      <div className="flex items-center gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-sky-soft text-sky">
          <DiceIcon size={28} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <strong className="font-display text-xl leading-tight">A pretend draw</strong>
          <span className="text-sm text-muted">
            {formatNaira(PRACTICE.ticketPriceKobo)} pretend money per ticket · {PRACTICE.ticketCount} tickets
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <ProgressBar value={PRACTICE.soldBefore} max={PRACTICE.ticketCount} label={`${PRACTICE.soldBefore} of ${PRACTICE.ticketCount} practice tickets sold`} />
        <span className="text-xs font-semibold text-muted tabular-nums">
          {PRACTICE.soldBefore} of {PRACTICE.ticketCount} sold
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold">How many practice tickets?</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Practice tickets">
          {Array.from({ length: PRACTICE.maxTickets }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" onClick={() => setQuantity(n)} aria-pressed={quantity === n} className={cx(chipClass(quantity === n), 'justify-center px-0 min-w-20 flex-1')}>
              {n}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">
          Your chance with {quantity} {quantity === 1 ? 'ticket' : 'tickets'}: <strong className="text-ink">{chanceText(quantity, PRACTICE.ticketCount)}</strong>
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-2xl bg-sunken p-3 text-xs text-muted">
        <LockIcon size={16} className="mt-px shrink-0" />
        <span className="flex min-w-0 flex-col gap-1">
          <span>Before any ticket sells, every draw publishes a sealed code. It fixes the secret behind the draw, so nobody can change it later.</span>
          <span className="font-mono break-all">{game ? game.commitment : '…'}</span>
        </span>
      </div>

      <Button size="lg" disabled={!game} onClick={() => setSelling(true)}>
        Get {quantity} practice {quantity === 1 ? 'ticket' : 'tickets'}
      </Button>
      <p className="-mt-2 text-center text-xs text-subtle">Nothing is charged. This doesn’t touch your wallet.</p>
    </Card>
  )
}

function YourTickets({ quantity, winningNumber }: { quantity: number; winningNumber?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-bold">Your practice {quantity === 1 ? 'ticket' : 'tickets'}</span>
      <div className="flex flex-wrap gap-2">
        {practiceNumbers(quantity).map((n) => (
          <TicketStub key={n} number={n} size="sm" state={winningNumber === undefined ? 'default' : n === winningNumber ? 'winner' : 'lost'} />
        ))}
      </div>
    </div>
  )
}

/** States the result plainly: no spinning reveal, and nothing about how close it came. */
function PracticeOutcome({ game, quantity, result: r, onAgain }: { game: PracticeGame; quantity: number; result: PracticeResult; onAgain: () => void }) {
  const realCredit = RULES.consolationCreditBps / 100
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <PracticeLabel />
        <div className="flex flex-col gap-1">
          <strong className="font-display text-2xl leading-tight">{r.won ? 'Your practice ticket came up' : 'Your practice tickets didn’t come up'}</strong>
          <p className="text-sm text-muted">
            {r.won ? 'In a real draw, you’d now arrange to get the item. This was practice, so there’s no prize.' : 'That’s how most tickets end. Each one has the same chance, however early or late it’s bought.'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold">Winning ticket</span>
          <div>
            <TicketStub number={r.winningNumber} state="winner" />
          </div>
        </div>
        <YourTickets quantity={quantity} winningNumber={r.winningNumber} />
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <PracticeLabel />
        <strong className="leading-tight">How consolation credit works</strong>
        <p className="text-sm text-muted">
          {r.won ? (
            <>
              In a real draw, everyone who didn’t win gets {realCredit}% of what they spent back as store credit, to use on any draw or item.
            </>
          ) : (
            <>
              In a real draw, you’d get <strong className="text-ink">{formatNaira(r.wouldBeCreditKobo)}</strong> back as store credit: {realCredit}% of the {formatNaira(r.spentKobo)} you spent, to use on any draw or item.
            </>
          )}{' '}
          This was practice, so no credit has been added.
        </p>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <PracticeLabel />
        <strong className="leading-tight">Check it yourself</strong>
        <p className="text-sm text-muted">Real draws show these same details on their result page, so anyone can check that the winner wasn’t picked by hand.</p>
        <dl className="flex flex-col gap-2 text-xs">
          <Detail term="Sealed code, published first" value={game.commitment} />
          <Detail term="Secret, revealed after the draw" value={game.seed} />
          <Detail term="Reference from the last ticket sold" value={r.closingRef} />
        </dl>
        {r.check.valid ? (
          <p className="flex items-center gap-1.5 text-sm font-bold text-brand-ink">
            <CheckIcon size={16} className="shrink-0" /> The secret matches the sealed code, and gives ticket {r.check.computedWinner}.
          </p>
        ) : null}
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" size="lg" className="flex-1" onClick={onAgain}>
          Practice again
        </Button>
        <Link to="/" className={buttonClass('primary', 'lg', 'flex-1')}>
          <span className="text-on-brand">Back to explore</span>
        </Link>
      </div>
      <p className="text-center text-xs text-subtle">Real tickets cost real money, and most don’t win. Only spend what you can afford.</p>
    </div>
  )
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-bold text-muted">{term}</dt>
      <dd className="font-mono break-all text-subtle">{value}</dd>
    </div>
  )
}
