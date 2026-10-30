import { useState } from 'react'
import { api } from '@/api'
import { useDemoActions, useListings } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { Countdown } from '@/components/Countdown'
import { DiceIcon, FastForwardIcon, RefreshIcon, TicketIcon, TrophyIcon } from '@/components/icons'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageTitle, ProductImage, ProgressBar, Skeleton, errorMessage } from '@/components/ui'
import { formatNaira } from '@/domain/money'
import { dateTime } from '@/lib/time'

/** Admin view of every live draw. In test mode, also the demo controls (the database only lets admins use them). */
export function AdminDrawsPage() {
  const q = useListings({ status: ['live', 'sold_out'] })

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        eyebrow="Admin"
        sub={api.testMode ? 'Watch sales, and use the demo controls to run a draw or hit a deadline without waiting.' : 'Every draw that’s taking tickets right now.'}
        action={q.data ? <Badge tone="brand">{q.data.filter((l) => l.status === 'live').length} live</Badge> : null}
      >
        Live draws
      </PageTitle>
      {api.testMode ? (
        <Notice tone="ticket" icon={DiceIcon} title="Demo controls">
          Test mode only. “Sell out” sells the remaining tickets to filler buyers, and everyone in the draw is told; “Announce winner now” skips the wait; “Skip to deadline” closes a draw unsold.
        </Notice>
      ) : null}
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={TicketIcon} title="No live draws" body="Approved listings show up here while they take tickets." />
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {q.data.map((l) => (
            <DrawRow key={l.id} listing={l} />
          ))}
        </Card>
      )}
      {api.testMode ? <ResetTestData /> : null}
    </div>
  )
}

/** Test mode only: put everything back to the sample data. The database refuses outside test mode. */
function ResetTestData() {
  const { resetAll } = useDemoActions()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  return (
    <Card className="flex flex-wrap items-center gap-4 p-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <strong>Reset all test data</strong>
        <span className="text-sm text-muted">Back to the sample listings, and every buyer back to the starting ₦25,000. Accounts and their roles stay.</span>
      </div>
      <Button variant="danger" className="min-h-11" onClick={() => setConfirm(true)}>
        <RefreshIcon size={16} /> Reset test data
      </Button>
      <Sheet open={confirm} onClose={() => !resetAll.isPending && setConfirm(false)} title="Reset all test data">
        <h2 className="pr-10 font-display text-2xl font-extrabold">Reset everything?</h2>
        <p className="text-sm text-muted">
          This deletes every listing, ticket, draw result, order, wallet entry, top-up, chat, boost, seller application and page view, for every account. Then it puts the
          sample stores and listings back and gives every buyer the starting balance. ID-verified sellers go back to being buyers (the test seller keeps their shop). It
          can’t be undone.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirm(false)} disabled={resetAll.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={resetAll.isPending}
            onClick={() =>
              resetAll.mutate(undefined, {
                onSuccess: () => {
                  setConfirm(false)
                  toast('Test data reset.')
                },
                onError: (e) => toast(errorMessage(e), 'error'),
              })
            }
          >
            Reset everything
          </Button>
        </div>
      </Sheet>
    </Card>
  )
}

function DrawRow({ listing: l }: { listing: ListingView }) {
  const demo = useDemoActions()
  const toast = useToast()
  const busy =
    (demo.sellOut.isPending && demo.sellOut.variables === l.id) || (demo.expire.isPending && demo.expire.variables === l.id) || (demo.runDraw.isPending && demo.runDraw.variables === l.id)
  const soldOut = l.status === 'sold_out'

  return (
    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <ProductImage category={l.category} src={l.images[0]} alt={l.title} size="sm" className="size-16 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <strong className="truncate">{l.title}</strong>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-subtle">
            {l.merchant.name} · {formatNaira(l.buyerTicketPriceKobo)} a ticket · {soldOut && l.drawAt ? <>Sold out, winner on {dateTime(l.drawAt)}</> : <Countdown closesAt={l.closesAt} />}
          </span>
          <ProgressBar value={l.ticketsSold} max={l.ticketCount} label={`${l.ticketsSold} of ${l.ticketCount} sold`} />
          <span className="text-[11px] text-subtle tabular-nums">
            {l.ticketsSold.toLocaleString('en-NG')} of {l.ticketCount.toLocaleString('en-NG')} tickets sold
          </span>
        </div>
      </div>
      {api.testMode && soldOut ? (
        <div className="flex shrink-0 gap-2 sm:flex-col">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 flex-1"
            loading={demo.runDraw.isPending && demo.runDraw.variables === l.id}
            onClick={() =>
              demo.runDraw.mutate(l.id, {
                onSuccess: () => toast(`${l.title}: winner announced.`),
                onError: (e) => toast(errorMessage(e), 'error'),
              })
            }
          >
            <TrophyIcon size={14} /> Announce winner now
          </Button>
        </div>
      ) : api.testMode ? (
        <div className="flex shrink-0 gap-2 sm:flex-col">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 flex-1"
            disabled={busy}
            loading={demo.sellOut.isPending && demo.sellOut.variables === l.id}
            onClick={() =>
              demo.sellOut.mutate(l.id, {
                onSuccess: () => toast(`${l.title}: sold out. Everyone in the draw has been told.`),
                onError: (e) => toast(errorMessage(e), 'error'),
              })
            }
          >
            <TicketIcon size={14} /> Sell out
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 flex-1"
            disabled={busy}
            loading={demo.expire.isPending && demo.expire.variables === l.id}
            onClick={() =>
              demo.expire.mutate(l.id, {
                onSuccess: () => toast(`${l.title}: deadline reached.`, 'info'),
                onError: (e) => toast(errorMessage(e), 'error'),
              })
            }
          >
            <FastForwardIcon size={14} /> Skip to deadline
          </Button>
        </div>
      ) : null}
    </div>
  )
}
