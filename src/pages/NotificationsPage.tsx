import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { useMarkNotificationsRead, useNotifications } from '@/api/hooks'
import type { NotificationView } from '@/api/types'
import { BellIcon, ClockIcon, TicketIcon, TrophyIcon, type IconComponent } from '@/components/icons'
import { Card, EmptyState, ErrorState, PageTitle, Skeleton, cx } from '@/components/ui'
import { dateTime, ticketNo } from '@/lib/time'

function describe(n: NotificationView): { icon: IconComponent; title: string; body: string; to: string } {
  switch (n.kind) {
    case 'draw_sold_out':
      return {
        icon: ClockIcon,
        title: `All tickets sold: ${n.listingTitle}`,
        body: n.drawAt ? `The last ticket has been bought. The winner will be announced on ${dateTime(n.drawAt)}.` : 'The last ticket has been bought. The winner will be announced soon.',
        to: `/listings/${n.listingId}`,
      }
    case 'draw_won':
      return {
        icon: TrophyIcon,
        title: `You won ${n.listingTitle}!`,
        body: `${n.winningNumber ? `Your ticket ${ticketNo(n.winningNumber)} was drawn. ` : ''}We’ll arrange delivery with you.`,
        to: `/draws/${n.listingId}`,
      }
    case 'draw_lost':
      return {
        icon: TicketIcon,
        title: `Winner announced: ${n.listingTitle}`,
        body: `${n.winningNumber ? `Ticket ${ticketNo(n.winningNumber)} won. ` : ''}Not this time, but your store credit is in your wallet.`,
        to: `/draws/${n.listingId}`,
      }
  }
}

/** /notifications: updates on the draws a buyer is in. Opening it marks them read. */
export function NotificationsPage() {
  const q = useNotifications()
  const markRead = useMarkNotificationsRead()
  const unread = q.data?.some((n) => !n.read) ?? false
  const marked = useRef(false)

  useEffect(() => {
    if (!unread || marked.current) return
    marked.current = true
    markRead.mutate()
  }, [unread, markRead])

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Notifications" sub="Updates on the draws you’re in.">
        What’s new
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={BellIcon} title="Nothing yet" body="We’ll let you know here when a draw you’re in sells out, and when its winner is announced." />
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {q.data.map((n) => {
            const d = describe(n)
            return (
              <Link key={n.id} to={d.to} className={cx('flex items-start gap-3 p-4 text-ink no-underline transition hover:bg-sunken/60', !n.read && 'bg-brand-soft/50')}>
                <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl', n.kind === 'draw_won' ? 'bg-ticket text-on-ticket' : 'bg-sunken text-muted')}>
                  <d.icon size={18} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                  <strong className="leading-tight">{d.title}</strong>
                  <span className="text-muted">{d.body}</span>
                  <span className="text-[11px] text-subtle">{dateTime(n.createdAt)}</span>
                </span>
              </Link>
            )
          })}
        </Card>
      )}
    </div>
  )
}
