import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link, RouterProvider, createBrowserRouter, useRouteError } from 'react-router'
import { api } from '@/api'
import { keys } from '@/api/hooks'
import { RequireSignIn } from '@/components/RequireSignIn'
import { ToastProvider } from '@/components/toast'
import { SearchIcon } from '@/components/icons'
import { EmptyState, ErrorState, buttonClass } from '@/components/ui'
import { BackOfficeLayout } from '@/layouts/BackOfficeLayout'
import { BuyerLayout } from '@/layouts/BuyerLayout'
import { AdminPage } from '@/pages/admin/AdminPage'
import { DrawsPage } from '@/pages/DrawsPage'
import { HomePage } from '@/pages/HomePage'
import { ListingPage } from '@/pages/ListingPage'
import { MerchantPage } from '@/pages/merchant/MerchantPage'
import { ResultPage } from '@/pages/ResultPage'
import { SignInPage } from '@/pages/SignInPage'
import { TicketsPage } from '@/pages/TicketsPage'
import { WalletPage } from '@/pages/WalletPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true } },
})

function RouteError() {
  const error = useRouteError()
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <ErrorState error={error} />
      <Link to="/" className={buttonClass('outline')}>
        Back to live draws
      </Link>
    </div>
  )
}

function NotFound() {
  return (
    <EmptyState
      icon={SearchIcon}
      title="Page not found"
      body="That page doesn’t exist, or the draw has moved."
      className="my-10"
      action={
        <Link to="/" className={buttonClass('primary')}>
          Back to live draws
        </Link>
      }
    />
  )
}

/** Keeps the cached session current, and never shows one account's data to another. */
function SessionSync() {
  const qc = useQueryClient()
  useEffect(() => {
    if (!api.auth) return
    let lastUser: string | null | undefined
    void api.auth.getSession().then((s) => {
      lastUser ??= s?.userId ?? null
    })
    return api.auth.onChange((s) => {
      const user = s?.userId ?? null
      if (lastUser !== undefined && lastUser !== user) qc.clear()
      lastUser = user
      qc.setQueryData(keys.session, s)
    })
  }, [qc])
  return null
}

// Browsing is public. Buying, wallets and the back office need the right account (on Supabase).
const router = createBrowserRouter([
  {
    element: <BuyerLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'login', element: <SignInPage /> },
      { path: 'listings/:id', element: <ListingPage /> },
      { path: 'tickets', element: <RequireSignIn><TicketsPage /></RequireSignIn> },
      { path: 'draws', element: <DrawsPage /> },
      { path: 'draws/:id', element: <ResultPage /> },
      { path: 'wallet', element: <RequireSignIn><WalletPage /></RequireSignIn> },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    element: <BackOfficeLayout />,
    errorElement: <RouteError />,
    children: [
      { path: 'merchant', element: <RequireSignIn need="store"><MerchantPage /></RequireSignIn> },
      { path: 'admin', element: <RequireSignIn need="admin"><AdminPage /></RequireSignIn> },
    ],
  },
])

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionSync />
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
