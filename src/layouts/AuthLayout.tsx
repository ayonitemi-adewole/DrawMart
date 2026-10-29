import { Outlet, ScrollRestoration } from 'react-router'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Logo, TestModeBanner } from './BuyerLayout'

/** The shared front door: buyers, stores and admins all sign in here. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <TestModeBanner />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-16 sm:px-6">
        <Outlet />
      </main>
      <ScrollRestoration />
    </div>
  )
}
