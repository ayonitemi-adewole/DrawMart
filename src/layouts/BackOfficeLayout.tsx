import { useEffect } from 'react'
import { keepAppForOffline } from '@/lib/appShell'
import { NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router'
import { canDo } from '@/domain/team'
import { api } from '@/api'
import { cancelRateFlagged } from '@/domain/orderCancel'
import { useStoreRole, useSupportInbox, useSupportUnread, useStoreApplications, useOpenClaims, useAccess, useCancelRates, useDispatchBoard, useOpenIncidents, useDuePayouts, useMerchant, useMyCounter, useRiderApplications, useRiderPayDue, usePendingListings, usePendingWinnerStories, usePriceReviews, usePrizeOrders, useSellerApplications, useSignOut, useUnreadMessages, useUnreadNotifications } from '@/api/hooks'
import { UsersIcon, GiftIcon, InfoIcon, StarIcon, StoreIcon, AlertIcon, XIcon, BellIcon, NairaIcon, HeartIcon, ChartIcon, ChatIcon, TrendingUpIcon, TrophyIcon, TruckIcon, CheckIcon, ClipboardIcon, DiceIcon, GaugeIcon, HashIcon, IdCardIcon, LayoutIcon, LogOutIcon, type IconComponent } from '@/components/icons'
import { NavMenu } from '@/components/NavMenu'
import { ThemeToggle } from '@/components/ThemeToggle'
import { cx } from '@/components/ui'
import { APP_HOME } from '@/lib/apps'
import { Logo, TestModeBanner } from './BuyerLayout'
import { OfflineBanner } from '@/components/Offline'
import { LocationSharingBar } from '@/pages/delivery/ShareLocation'

type BackOfficeApp = 'store' | 'admin' | 'delivery'

const APP_NAME: Record<BackOfficeApp, { suffix: string; label: string }> = {
  store: { suffix: 'Stores', label: 'Store' },
  admin: { suffix: 'Admin', label: 'Admin' },
  delivery: { suffix: 'Delivery', label: 'Delivery' },
}

interface NavItem {
  to: string
  label: string
  icon: IconComponent
  count?: number
}

/** Desktop-first shell shared by the store, admin and delivery apps. Each only links to its own pages. */
export function BackOfficeLayout({ app }: { app: BackOfficeApp }) {
  // Riders' saved jobs open without signal only if the app itself is on the phone.
  useEffect(() => {
    if (app === 'delivery') keepAppForOffline()
  }, [app])
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const merchant = useMerchant()
  const pending = usePendingListings()
  const sellers = useSellerApplications()
  const storeApplications = useStoreApplications()
  const unread = useUnreadMessages()
  const supportUnread = useSupportUnread()
  const storeRole = useStoreRole().data ?? null
  const support = useSupportInbox()
  const prizes = usePrizeOrders()
  const stories = usePendingWinnerStories()
  const priceReviews = usePriceReviews()
  const cancelRates = useCancelRates()
  const claims = useOpenClaims()
  const access = useAccess()
  const unreadNotifications = useUnreadNotifications()
  const duePayouts = useDuePayouts()
  const riderPayDue = useRiderPayDue()
  const riderApplications = useRiderApplications()
  const dispatch = useDispatchBoard()
  const incidents = useOpenIncidents()
  const counter = useMyCounter()
  const signOut = useSignOut()

  const nav: NavItem[] =
    app === 'delivery'
      ? [
          { to: '/delivery', label: counter.data ? 'Counter' : 'Deliveries', icon: TruckIcon },
          // Counter staff aren't paid per job.
          ...(counter.data ? [] : [{ to: '/delivery/earnings', label: 'Earnings', icon: NairaIcon }]),
          { to: '/delivery/notifications', label: 'Notifications', icon: BellIcon, count: unreadNotifications },
        ]
      : app === 'store'
      ? [
          { to: '/store', label: 'Dashboard', icon: LayoutIcon },
          ...(canDo(storeRole, 'shop')
            ? [
                { to: '/store/payouts', label: 'Payouts', icon: NairaIcon },
                { to: '/store/profile', label: 'Shop profile', icon: StoreIcon },
                { to: '/store/reviews', label: 'Reviews', icon: StarIcon },
                { to: '/store/discounts', label: 'Discounts', icon: GiftIcon },
                { to: '/store/insights', label: 'Insights', icon: ChartIcon },
              ]
            : []),
          ...(canDo(storeRole, 'team') ? [{ to: '/store/team', label: 'Team', icon: UsersIcon }] : []),
          { to: '/store/messages', label: 'Messages', icon: ChatIcon, count: unread },
          { to: '/store/notifications', label: 'Notifications', icon: BellIcon, count: unreadNotifications },
          { to: '/store/help', label: 'Help', icon: InfoIcon, count: supportUnread },
        ]
      : [
          { to: '/admin', label: 'Review queue', icon: ClipboardIcon, count: (pending.data?.length ?? 0) + (priceReviews.data?.length ?? 0) },
          { to: '/admin/products', label: 'All products', icon: HashIcon },
          { to: '/admin/sellers', label: 'Seller ID checks', icon: IdCardIcon, count: sellers.data?.length ?? 0 },
          { to: '/admin/support', label: 'Support', icon: ChatIcon, count: support.data?.filter((t) => t.unread > 0).length ?? 0 },
          { to: '/admin/store-applications', label: 'Store applications', icon: StoreIcon, count: storeApplications.data?.length ?? 0 },
          { to: '/admin/prizes', label: 'Won items', icon: TrophyIcon, count: prizes.data?.filter((o) => o.status === 'paid').length ?? 0 },
          { to: '/admin/stories', label: 'Winner stories', icon: HeartIcon, count: stories.data?.length ?? 0 },
          { to: '/admin/payouts', label: 'Payouts', icon: NairaIcon, count: duePayouts.data?.length ?? 0 },
          { to: '/admin/claims', label: 'Claims', icon: AlertIcon, count: claims.data?.length ?? 0 },
          { to: '/admin/reviews', label: 'Reviews', icon: StarIcon },
          { to: '/admin/cancellations', label: 'Cancellations', icon: XIcon, count: cancelRates.data?.filter((r) => cancelRateFlagged(r.orders, r.cancelled)).length ?? 0 },
          { to: '/admin/dispatch', label: 'Dispatch', icon: GaugeIcon, count: (dispatch.data?.jobs.filter((j) => j.stuck).length ?? 0) + (incidents.data?.length ?? 0) },
          { to: '/admin/riders', label: 'Riders', icon: TruckIcon, count: riderApplications.data?.length ?? 0 },
          { to: '/admin/rider-pay', label: 'Rider pay', icon: NairaIcon, count: riderPayDue.data?.length ?? 0 },
          { to: '/admin/delivery', label: 'Delivery prices', icon: TruckIcon },
          { to: '/admin/boosts', label: 'Boosts', icon: TrendingUpIcon },
          { to: '/admin/draws', label: api.testMode ? 'Live draws & demo' : 'Live draws', icon: DiceIcon },
        ]

  const shopCard =
    app === 'store' && merchant.data ? (
      <div className="flex items-center gap-3 rounded-2xl bg-sunken p-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand font-display text-lg font-extrabold text-on-brand">
          {merchant.data.name.charAt(0)}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-bold">{merchant.data.name}</span>
          <span className="flex items-center gap-1 text-[11px] text-subtle">
            {merchant.data.verified ? <CheckIcon size={12} className="text-brand" /> : null}
            {merchant.data.verified ? 'CAC verified' : 'Verification pending'}
          </span>
        </div>
      </div>
    ) : null

  return (
    <div className="flex min-h-dvh flex-col">
      <TestModeBanner />
      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-xl lg:h-dvh lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 lg:h-full lg:flex-col lg:items-stretch lg:gap-6 lg:p-5">
            <div className="flex items-center justify-between">
              <Logo suffix={APP_NAME[app].suffix} to={APP_HOME[app]} />
              <div className="hidden lg:block">
                <ThemeToggle />
              </div>
            </div>
            {/* Below lg all of this lives in the menu. */}
            <NavMenu
              title={`${APP_NAME[app].label} menu`}
              className="lg:hidden"
              links={nav}
              top={shopCard}
              account={access.email}
              signingOut={signOut.isPending}
              onSignOut={(done) =>
                signOut.mutate(undefined, {
                  onSuccess: () => {
                    done()
                    navigate('/login')
                  },
                })
              }
            />
            <nav className="hidden flex-col items-stretch gap-1 lg:flex" aria-label={APP_NAME[app].label}>
              {nav.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end
                  className={({ isActive }) =>
                    cx(
                      'flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-bold no-underline transition',
                      isActive ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:bg-sunken hover:text-ink',
                    )
                  }
                >
                  <n.icon size={18} />
                  {n.label}
                  {n.count ? <span className="ml-auto rounded-full bg-hot px-1.5 py-0.5 text-[10px] font-extrabold text-white">{n.count}</span> : null}
                </NavLink>
              ))}
            </nav>
            <div className="mt-auto hidden flex-col gap-3 lg:flex">
              {shopCard}
              <button
                onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate('/login') })}
                className="flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 text-left text-sm font-bold text-muted hover:bg-sunken hover:text-ink"
              >
                <span className="min-w-0 truncate">Sign out{access.email ? <span className="font-normal"> · {access.email}</span> : null}</span>
                <LogOutIcon size={16} className="shrink-0" />
              </button>
            </div>
          </div>
        </aside>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {app === 'delivery' ? (
            <div className="mb-5 flex flex-col gap-3 empty:hidden">
              <OfflineBanner />
              <LocationSharingBar />
            </div>
          ) : null}
          <div key={pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
      <ScrollRestoration />
    </div>
  )
}
