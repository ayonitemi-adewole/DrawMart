import { NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router'
import { api } from '@/api'
import { useAccess, useMerchant, usePendingListings, usePrizeOrders, useSellerApplications, useSignOut, useUnreadMessages } from '@/api/hooks'
import { ChartIcon, ChatIcon, TrendingUpIcon, TrophyIcon, CheckIcon, ClipboardIcon, DiceIcon, IdCardIcon, LayoutIcon, LogOutIcon, type IconComponent } from '@/components/icons'
import { NavMenu } from '@/components/NavMenu'
import { ThemeToggle } from '@/components/ThemeToggle'
import { cx } from '@/components/ui'
import { APP_HOME } from '@/lib/apps'
import { Logo, TestModeBanner } from './BuyerLayout'

type BackOfficeApp = 'store' | 'admin'

interface NavItem {
  to: string
  label: string
  icon: IconComponent
  count?: number
}

/** Desktop-first shell shared by the store app and the admin app. Each only links to its own pages. */
export function BackOfficeLayout({ app }: { app: BackOfficeApp }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const merchant = useMerchant()
  const pending = usePendingListings()
  const sellers = useSellerApplications()
  const unread = useUnreadMessages()
  const prizes = usePrizeOrders()
  const access = useAccess()
  const signOut = useSignOut()

  const nav: NavItem[] =
    app === 'store'
      ? [
          { to: '/store', label: 'Dashboard', icon: LayoutIcon },
          { to: '/store/insights', label: 'Insights', icon: ChartIcon },
          { to: '/store/messages', label: 'Messages', icon: ChatIcon, count: unread },
        ]
      : [
          { to: '/admin', label: 'Review queue', icon: ClipboardIcon, count: pending.data?.length ?? 0 },
          { to: '/admin/sellers', label: 'Seller ID checks', icon: IdCardIcon, count: sellers.data?.length ?? 0 },
          { to: '/admin/prizes', label: 'Won items', icon: TrophyIcon, count: prizes.data?.filter((o) => o.status === 'paid').length ?? 0 },
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
              <Logo suffix={app === 'store' ? 'Stores' : 'Admin'} to={APP_HOME[app]} />
              <div className="hidden lg:block">
                <ThemeToggle />
              </div>
            </div>
            {/* Below lg all of this lives in the menu. */}
            <NavMenu
              title={app === 'store' ? 'Store menu' : 'Admin menu'}
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
            <nav className="hidden flex-col items-stretch gap-1 lg:flex" aria-label={app === 'store' ? 'Store' : 'Admin'}>
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
          <div key={pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
      <ScrollRestoration />
    </div>
  )
}
