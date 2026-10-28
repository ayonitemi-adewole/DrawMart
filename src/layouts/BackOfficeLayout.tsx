import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router'
import { useMerchant, usePendingListings } from '@/api/hooks'
import { ArrowRightIcon, CheckIcon, ClipboardIcon, LayoutIcon } from '@/components/icons'
import { ThemeToggle } from '@/components/ThemeToggle'
import { cx } from '@/components/ui'
import { Logo, TestModeBanner } from './BuyerLayout'

/** Shared desktop-first shell for the merchant and admin areas. */
export function BackOfficeLayout() {
  const { pathname } = useLocation()
  const merchant = useMerchant()
  const pending = usePendingListings()
  const pendingCount = pending.data?.length ?? 0

  const nav = [
    { to: '/merchant', label: 'Store dashboard', icon: LayoutIcon, count: 0 },
    { to: '/admin', label: 'Admin review', icon: ClipboardIcon, count: pendingCount },
  ]

  return (
    <div className="flex min-h-dvh flex-col">
      <TestModeBanner />
      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-xl lg:h-dvh lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 lg:flex-col lg:items-stretch lg:gap-6 lg:p-5">
            <div className="flex items-center justify-between">
              <Logo suffix="Business" />
              <div className="hidden lg:block">
                <ThemeToggle />
              </div>
            </div>
            <nav className="flex items-center gap-1 lg:flex-col lg:items-stretch" aria-label="Back office">
              {nav.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    cx(
                      'flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-bold no-underline transition',
                      isActive ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:bg-sunken hover:text-ink',
                    )
                  }
                >
                  <n.icon size={18} />
                  <span className="hidden sm:inline">{n.label}</span>
                  {n.count > 0 ? <span className="ml-auto rounded-full bg-hot px-1.5 py-0.5 text-[10px] font-extrabold text-white">{n.count}</span> : null}
                </NavLink>
              ))}
              <div className="lg:hidden">
                <ThemeToggle />
              </div>
            </nav>
            <div className="mt-auto hidden flex-col gap-3 lg:flex">
              {merchant.data ? (
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
              ) : null}
              <Link to="/" className="flex min-h-11 items-center justify-between rounded-xl px-3 text-sm font-bold text-muted no-underline hover:bg-sunken hover:text-ink">
                Open buyer app <ArrowRightIcon size={16} />
              </Link>
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
