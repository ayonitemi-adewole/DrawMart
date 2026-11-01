import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { useAccess, useMarkNotificationsRead, useNotifications } from '@/api/hooks'
import type { NotificationView } from '@/api/types'
import { AlertIcon, BellIcon, CalendarIcon, ChatIcon, CheckIcon, ClockIcon, HeartIcon, LockIcon, NairaIcon, TicketIcon, TrophyIcon, TruckIcon, XIcon, type IconComponent } from '@/components/icons'
import { DrawRevealToggle, PushToggle, StorePushSettings } from '@/components/PushSettings'
import { Card, EmptyState, ErrorState, PageTitle, Skeleton, cx } from '@/components/ui'
import { handoverMethodFor } from '@/domain/listing'
import { dateTime, ticketNo } from '@/lib/time'

/** `store` says which app a seller works from: the store app, or /sell in the buyer app. */
function describe(n: NotificationView, store: boolean): { icon: IconComponent; title: string; body: string; to: string } {
  const home = store ? '/store' : '/sell'
  switch (n.kind) {
    case 'store_payout_sent':
      return { icon: NairaIcon, title: 'Payout sent', body: 'We’ve sent money to your bank account. See what it covered.', to: store ? '/store/payouts' : '/sell?tab=payouts' }
    case 'store_bank_changed':
      return { icon: LockIcon, title: 'Bank account changed', body: 'If this wasn’t you, contact DrawMart now. Payouts are on hold for now.', to: store ? '/store/payouts' : '/sell?tab=payouts' }
    case 'store_new_order':
      return { icon: TruckIcon, title: `New order: ${n.listingTitle}`, body: 'Get it ready, then mark it ready for a rider.', to: `${home}?tab=orders` }
    case 'order_cancelled':
      return { icon: XIcon, title: `Order cancelled: ${n.listingTitle}`, body: 'You’ve been refunded. See why.', to: '/tickets?view=orders' }
    case 'store_order_confirm_soon':
      return { icon: ClockIcon, title: `Confirm soon: ${n.listingTitle}`, body: 'Add a photo of the item, or this order will be cancelled.', to: `${home}?tab=orders` }
    case 'store_order_expired':
      return { icon: XIcon, title: `Order cancelled: ${n.listingTitle}`, body: 'It wasn’t confirmed or made ready in time. The buyer was refunded and the product is paused until you resume it.', to: `${home}?tab=orders` }
    case 'store_order_failed':
      return { icon: AlertIcon, title: `Order failed: ${n.listingTitle}`, body: 'It failed the rider’s check or was refused at the door. The buyer was refunded, and a charge comes off your next payout.', to: `${home}?tab=orders` }
    case 'store_suspended':
      return { icon: AlertIcon, title: 'Your shop is suspended', body: 'Too many orders have failed, so your products are paused and you can’t list new ones. Contact DrawMart.', to: home }
    case 'store_price_approved':
      return { icon: CheckIcon, title: `Price approved: ${n.listingTitle}`, body: 'The new price is live.', to: home }
    case 'store_price_rejected':
      return { icon: XIcon, title: `Price not approved: ${n.listingTitle}`, body: 'It stays on sale at its current price.', to: home }
    case 'store_listing_approved':
      return { icon: CheckIcon, title: `Approved: ${n.listingTitle}`, body: 'It’s now live for buyers.', to: home }
    case 'store_listing_rejected':
      return { icon: XIcon, title: `Not approved: ${n.listingTitle}`, body: 'See why, and fix it to send it again.', to: `${home}?fix=${n.listingId}` }
    case 'store_draw_sold_out':
      return {
        icon: ClockIcon,
        title: `All tickets sold: ${n.listingTitle}`,
        body: n.drawAt ? `The winner will be announced on ${dateTime(n.drawAt)}.` : 'The winner will be announced soon.',
        to: home,
      }
    case 'store_winner_picked':
      return { icon: TrophyIcon, title: `Winner announced: ${n.listingTitle}`, body: 'You’re paid once it’s delivered to the winner.', to: home }
    case 'store_draw_closing':
      return { icon: ClockIcon, title: `Closing soon: ${n.listingTitle}`, body: 'It closes within 24 hours and hasn’t sold out.', to: home }
    case 'store_pickup_tomorrow':
      return { icon: CalendarIcon, title: `${handoverMethodFor(n.listingCategory) === 'inspection' ? 'Inspection' : 'Pickup'} tomorrow: ${n.listingTitle}`, body: 'Have it ready for the time you booked.', to: home }
    case 'store_new_message':
      return { icon: ChatIcon, title: `New message: ${n.listingTitle}`, body: 'A buyer wrote to you.', to: store ? '/store/messages' : '/messages' }
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
        body: `${n.winningNumber ? `Your ticket ${ticketNo(n.winningNumber)} was drawn. ` : ''}Add it to your cart, or arrange it now.`,
        to: `/draws/${n.listingId}`,
      }
    case 'draw_lost':
      return {
        icon: TicketIcon,
        title: `Winner announced: ${n.listingTitle}`,
        body: `${n.winningNumber ? `Ticket ${ticketNo(n.winningNumber)} won. ` : ''}Not this time, but your store credit is in your wallet.`,
        to: `/draws/${n.listingId}`,
      }
    case 'saved_almost_sold':
      return { icon: HeartIcon, title: `A draw you saved: ${n.listingTitle}`, body: '90% of the tickets have sold.', to: `/listings/${n.listingId}` }
    case 'saved_closing_soon':
      return { icon: HeartIcon, title: `A draw you saved: ${n.listingTitle}`, body: 'It closes within 24 hours.', to: `/listings/${n.listingId}` }
    case 'saved_relisted':
      return { icon: HeartIcon, title: `An item you saved: ${n.listingTitle}`, body: 'The store has listed it again as a new draw.', to: `/listings/${n.listingId}` }
    case 'saved_back_on_sale':
      return { icon: HeartIcon, title: `An item you saved: ${n.listingTitle}`, body: 'It’s on sale.', to: `/listings/${n.listingId}` }
    case 'saved_price_drop':
      return { icon: HeartIcon, title: `An item you saved: ${n.listingTitle}`, body: 'It now costs less.', to: `/listings/${n.listingId}` }
  }
}

/** /notifications: updates on the draws a buyer is in. Opening it marks them read. */
export function NotificationsPage() {
  const store = useAccess().role === 'store'
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
      <PageTitle eyebrow="Notifications" sub={store ? 'New orders, listing reviews, draws, pickups and messages.' : 'Updates on the draws you’re in and the items you’ve saved.'}>
        What’s new
      </PageTitle>
      {store ? (
        <StorePushSettings />
      ) : (
        <>
          <PushToggle />
          <DrawRevealToggle />
        </>
      )}
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={BellIcon} title="Nothing yet" body={store ? 'We’ll let you know here when someone buys from you, and how your listings and draws are doing.' : 'We’ll let you know here when a draw you’re in sells out, and when its winner is announced.'} />
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {q.data.map((n) => {
            const d = describe(n, store)
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
