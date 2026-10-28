import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router'
import { useWallet } from '@/api/hooks'
import { api } from '@/api'
import { HomeIcon, TicketIcon, TrophyIcon, WalletIcon } from '@/components/icons'
import { cx } from '@/components/ui'
import { formatNaira } from '@/domain/money'

const NAV = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/tickets', label: 'Tickets', icon: TicketIcon },
  { to: '/draws', label: 'Draws', icon: TrophyIcon },
  { to: '/wallet', label: 'Wallet', icon: WalletIcon },
]

export function Logo({ suffix }: { suffix?: string }) {
  return (
    <Link to="/" className="flex items-center gap-2 text-ink no-underline">
      <TicketIcon size={26} className="text-brand" />
      <span className="font-display text-[22px] font-extrabold tracking-tight">
        DrawMart{suffix ? <span className="font-semibold text-subtle"> {suffix}</span> : null}
      </span>
    </Link>
  )
}

export function TestModeBanner() {
  if (!api.testMode) return null
  return (
    <div className="bg-ticket-soft px-4 py-1.5 text-center text-xs font-semibold text-ticket-ink">
      Test mode: no real money. Data is stored in this browser only.
    </div>
  )
}

export function BuyerLayout() {
  const wallet = useWallet()
  const total = wallet.data ? wallet.data.balance.cashKobo + wallet.data.balance.creditKobo : null

  return (
    <div className="flex min-h-dvh flex-col">
      <TestModeBanner />
      <header className="sticky top-0 z-20 border-b border-line bg-ground/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx('rounded-lg px-3 py-2 text-sm font-bold no-underline', isActive ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:text-ink')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <Link
            to="/wallet"
            aria-label="Wallet balance"
            className="flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-bold text-ink no-underline"
          >
            <WalletIcon size={18} />
            {total === null ? '…' : formatNaira(total)}
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pt-4 pb-28 md:pb-12">
        <Outlet />
      </main>

      <footer className="mx-auto hidden w-full max-w-3xl gap-4 px-5 pb-8 text-xs text-subtle md:flex">
        <Link to="/merchant">For stores</Link>
        <Link to="/admin">Admin review</Link>
        <span>18+ only · Play responsibly</span>
      </footer>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-surface px-2 pt-1.5 pb-[max(env(safe-area-inset-bottom),12px)] md:hidden" aria-label="Main">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cx('flex min-h-13 flex-col items-center justify-center gap-0.5 text-[11px] no-underline', isActive ? 'font-extrabold text-brand' : 'font-semibold text-subtle')
            }
          >
            <n.icon size={22} />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <ScrollRestoration />
    </div>
  )
}
