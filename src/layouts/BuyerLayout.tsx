import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router'
import { useMyListings, useWallet } from '@/api/hooks'
import { api } from '@/api'
import { IntroSheet } from '@/components/HowItWorks'
import { HomeIcon, ShieldIcon, StoreIcon, TicketIcon, TrophyIcon, WalletIcon } from '@/components/icons'
import { ThemeToggle } from '@/components/ThemeToggle'
import { cx } from '@/components/ui'
import { formatNaira } from '@/domain/money'

const NAV = [
  { to: '/', label: 'Explore', icon: HomeIcon, end: true },
  { to: '/tickets', label: 'Tickets', icon: TicketIcon },
  { to: '/draws', label: 'Results', icon: TrophyIcon },
  { to: '/wallet', label: 'Wallet', icon: WalletIcon },
]

export function Logo({ suffix }: { suffix?: string }) {
  return (
    <Link to="/" className="group flex items-center gap-2 text-ink no-underline" aria-label={`DrawMart${suffix ? ' ' + suffix : ''} home`}>
      <span className="flex size-9 -rotate-6 items-center justify-center rounded-xl bg-linear-to-br from-brand to-hero text-ticket shadow-glow transition group-hover:rotate-0">
        <TicketIcon size={20} strokeWidth={2.4} />
      </span>
      <span className="font-display text-[21px] font-extrabold tracking-tight">
        Draw<span className="text-brand">Mart</span>
        {suffix ? <span className="ml-1 text-sm font-semibold text-subtle">{suffix}</span> : null}
      </span>
    </Link>
  )
}

export function TestModeBanner() {
  if (!api.testMode) return null
  return (
    <div className="flex items-center justify-center gap-2 bg-ticket px-4 py-1.5 text-center text-xs font-bold text-on-ticket">
      <span className="rounded-full bg-on-ticket px-1.5 py-px text-[10px] tracking-wider text-ticket">TEST</span>
      No real money. Data is stored in this browser only.
    </div>
  )
}

function useActiveTicketCount() {
  const q = useMyListings()
  return q.data?.filter((l) => l.status === 'live').length ?? 0
}

export function BuyerLayout() {
  const wallet = useWallet()
  const { pathname } = useLocation()
  const active = useActiveTicketCount()
  const cash = wallet.data?.balance.cashKobo ?? null
  const credit = wallet.data?.balance.creditKobo ?? 0

  return (
    <div className="flex min-h-dvh flex-col">
      <TestModeBanner />
      <header className="sticky top-0 z-30 border-b border-line/70 bg-ground/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 rounded-2xl bg-sunken/70 p-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx(
                    'relative flex min-h-10 items-center gap-1.5 rounded-xl px-3.5 text-sm font-bold no-underline transition',
                    isActive ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
                  )
                }
              >
                <n.icon size={17} />
                {n.label}
                {n.to === '/tickets' && active > 0 ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-brand text-[10px] text-on-brand">{active}</span>
                ) : null}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <Link to="/merchant" className="hidden min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-muted no-underline hover:bg-sunken hover:text-ink lg:flex">
              <StoreIcon size={18} /> For stores
            </Link>
            <ThemeToggle />
            <Link
              to="/wallet"
              aria-label={`Wallet: ${cash === null ? 'loading' : formatNaira(cash)} cash${credit ? `, ${formatNaira(credit)} credit` : ''}`}
              className="flex min-h-11 items-center gap-2 rounded-2xl bg-ink py-1 pr-3.5 pl-1.5 text-sm font-extrabold text-ground no-underline shadow-card transition hover:opacity-90"
            >
              <span className="flex size-8 items-center justify-center rounded-xl bg-ticket text-on-ticket">
                <WalletIcon size={16} />
              </span>
              <span className="flex flex-col leading-none">
                <span className="tabular-nums">{cash === null ? '…' : formatNaira(cash)}</span>
                {credit > 0 ? <span className="mt-0.5 text-[10px] font-bold text-ticket">+{formatNaira(credit)} credit</span> : null}
              </span>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-32 sm:px-6 md:pb-16">
        <div key={pathname} className="animate-fade-in">
          <Outlet />
        </div>
      </main>

      <footer className="hidden border-t border-line bg-surface/50 md:block">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-xs text-subtle">
          <div className="flex items-center gap-2">
            <ShieldIcon size={16} className="text-brand" />
            <span>Licensed by LSLGA · Licence [NUMBER] · Lagos residents 18+ only · Play responsibly</span>
          </div>
          <div className="flex gap-4">
            <Link to="/merchant">For stores</Link>
            <Link to="/admin">Admin review</Link>
          </div>
        </div>
      </footer>

      <nav
        className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-30 grid grid-cols-4 gap-1 rounded-3xl border border-line bg-raised/90 p-1.5 shadow-lift backdrop-blur-xl md:hidden"
        aria-label="Main"
      >
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cx(
                'relative flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] no-underline transition',
                isActive ? 'bg-brand-soft font-extrabold text-brand-ink' : 'font-semibold text-subtle',
              )
            }
          >
            <n.icon size={22} />
            {n.label}
            {n.to === '/tickets' && active > 0 ? (
              <span className="absolute top-1 right-[calc(50%-20px)] flex size-4.5 items-center justify-center rounded-full bg-hot text-[9px] font-extrabold text-white">
                {active}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>
      <IntroSheet />
      <ScrollRestoration />
    </div>
  )
}
