import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useListing } from '@/api/hooks'
import { CheckIcon, TrophyIcon, XIcon } from '@/components/icons'
import { Button, Card, ErrorState, Skeleton, cx } from '@/components/ui'
import { drawHash, verifyDraw, type VerifyOutcome } from '@/domain/draw'
import { formatNaira } from '@/domain/money'
import { dateTime, ticketNo } from '@/lib/time'

export function ResultPage() {
  const { id = '' } = useParams()
  const q = useListing(id)
  const [check, setCheck] = useState<(VerifyOutcome & { hash: string }) | null>(null)
  const [checking, setChecking] = useState(false)

  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const l = q.data
  const r = l.result
  if (!r) {
    return (
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <strong>This draw hasn’t run yet</strong>
        <Link to={`/listings/${l.id}`}>Back to the listing</Link>
      </Card>
    )
  }

  async function runCheck() {
    if (!r) return
    setChecking(true)
    const [outcome, hash] = await Promise.all([
      verifyDraw({ commitment: r.commitment, seed: r.seed, closingRef: r.closingRef, ticketCount: r.ticketCount, claimedWinner: r.winningNumber }),
      drawHash(r.seed, r.closingRef),
    ])
    setCheck({ ...outcome, hash })
    setChecking(false)
  }

  const played = r.myNumbers.length > 0

  return (
    <div className="flex flex-col gap-5">
      <div className={cx('flex flex-col gap-2 rounded-3xl p-6', r.iWon ? 'bg-ticket text-ink' : 'bg-brand-deep text-ground')}>
        <span className="flex items-center gap-2 text-xs font-extrabold tracking-[0.15em]">
          {r.iWon ? <TrophyIcon size={16} /> : null}
          {r.iWon ? 'YOU WON' : 'DRAW COMPLETE'}
        </span>
        <h1 className="font-display text-3xl leading-tight font-extrabold">
          {r.iWon ? `You won: ${l.title}` : `Ticket ${ticketNo(r.winningNumber)} won ${l.title}`}
        </h1>
        <p className="text-sm leading-relaxed">
          {r.iWon
            ? `Ticket ${ticketNo(r.winningNumber)} won. The item is already in escrow; we’ll call you to arrange delivery in Lagos within 48 hours.`
            : played
              ? `Not this time. ${formatNaira(r.myCreditKobo)} store credit has been added to your wallet.`
              : 'You didn’t have tickets in this draw.'}
        </p>
        {played ? <p className="font-mono text-xs opacity-80">Your tickets: {r.myNumbers.map(ticketNo).join('  ')}</p> : null}
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <strong>Check this draw yourself</strong>
          <p className="text-xs text-muted">Drawn {dateTime(r.drawnAt)}. Everything you need is below; the check runs in your browser, not on our servers.</p>
        </div>
        <Field label="Lock published before sales: SHA-256(secret)" value={r.commitment} />
        <Field label="Secret, revealed after the draw" value={r.seed} />
        <Field label="Reference of the purchase that sold the last ticket" value={r.closingRef} />
        <Field label="Rule" value={`winner = SHA-256(secret + ":" + reference) mod ${r.ticketCount} + 1`} />
        <Button variant="outline" onClick={runCheck} loading={checking}>
          Verify now
        </Button>
        {check ? (
          <div className="flex flex-col gap-2 rounded-xl bg-ground p-3 text-sm">
            <Row ok={check.commitmentMatches} text={check.commitmentMatches ? 'The secret matches the lock published before sales.' : 'The secret does NOT match the lock.'} />
            <Row
              ok={check.winnerMatches}
              text={`Calculated winner: ${ticketNo(check.computedWinner)} ${check.winnerMatches ? '(matches)' : `(we announced ${ticketNo(r.winningNumber)})`}`}
            />
            <code className="text-[11px] break-all text-subtle">hash {check.hash}</code>
          </div>
        ) : null}
      </Card>

      <Link to="/" className="inline-flex min-h-13 items-center justify-center rounded-xl bg-brand font-extrabold text-white no-underline">
        Back to live draws
      </Link>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-subtle">{label}</span>
      <code className="text-xs break-all">{value}</code>
    </div>
  )
}

function Row({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={cx('flex items-start gap-2', ok ? 'text-brand-ink' : 'text-hot-ink')}>
      {ok ? <CheckIcon size={18} className="shrink-0" /> : <XIcon size={18} className="shrink-0" />}
      {text}
    </span>
  )
}
