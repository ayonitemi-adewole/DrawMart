import { Link, NavLink, Outlet } from 'react-router'
import { cx } from '@/components/ui'
import { Logo, TestModeBanner } from './BuyerLayout'

/** Shared desktop-first shell for the merchant and admin areas. */
export function BackOfficeLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <TestModeBanner />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <Logo suffix="for Stores" />
          <nav className="flex items-center gap-1" aria-label="Back office">
            {[
              { to: '/merchant', label: 'My draws' },
              { to: '/admin', label: 'Admin review' },
            ].map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) => cx('rounded-lg px-3 py-2 text-sm font-bold no-underline', isActive ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:text-ink')}
              >
                {n.label}
              </NavLink>
            ))}
            <Link to="/" className="rounded-lg px-3 py-2 text-sm font-bold text-muted no-underline hover:text-ink">
              Buyer app
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
