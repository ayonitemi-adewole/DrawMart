import { QueryClient, QueryClientProvider, useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Link, Navigate, RouterProvider, createBrowserRouter, useRouteError } from 'react-router'
import { api } from '@/api'
import { keys, useSession } from '@/api/hooks'
import { RequireSignIn } from '@/components/RequireSignIn'
import { ToastProvider } from '@/components/toast'
import { SearchIcon } from '@/components/icons'
import { EmptyState, ErrorState, buttonClass } from '@/components/ui'
import { hideSplash, holdSplash, showSplash } from '@/lib/splash'
import { AuthLayout } from '@/layouts/AuthLayout'
import { BackOfficeLayout } from '@/layouts/BackOfficeLayout'
import { BuyerLayout } from '@/layouts/BuyerLayout'
import { AdminBoostsPage } from '@/pages/admin/AdminBoostsPage'
import { AdminDrawsPage } from '@/pages/admin/AdminDrawsPage'
import { AdminPage } from '@/pages/admin/AdminPage'
import { AdminSellersPage } from '@/pages/admin/AdminSellersPage'
import { BrowsePage } from '@/pages/BrowsePage'
import { CreditsPage } from '@/pages/CreditsPage'
import { DrawsPage } from '@/pages/DrawsPage'
import { HomePage } from '@/pages/HomePage'
import { ListingPage } from '@/pages/ListingPage'
import { MerchantPage } from '@/pages/merchant/MerchantPage'
import { ResultPage } from '@/pages/ResultPage'
import { ConversationPage, MessagesPage, NewConversationPage } from '@/pages/MessagesPage'
import { InsightsPage } from '@/pages/merchant/InsightsPage'
import { SellPage } from '@/pages/SellPage'
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

/**
 * Drives the loading screen: it comes down once the session and the page's
 * first data have loaded, and goes back up when someone signs in, while their
 * app opens.
 */
function SplashController() {
  const session = useSession()
  const fetching = useIsFetching()
  const busy = session.isPending || fetching > 0
  const userId = session.isPending ? undefined : (session.data?.userId ?? null)
  const lastUser = useRef<string | null | undefined>(undefined)

  // Before paint, so the app being opened never shows from behind it.
  useLayoutEffect(() => {
    if (userId === undefined) return
    if (lastUser.current === null && userId) showSplash()
    lastUser.current = userId
  }, [userId])

  useEffect(() => {
    if (busy) holdSplash()
    else hideSplash()
  }, [busy, userId])

  return null
}

// Three separate apps behind one sign-in page. Each account belongs to one of them:
//   buyer  /        browsing is public; tickets and wallet need a buyer account
//   store  /store   store accounts only
//   admin  /admin   admin accounts only
const router = createBrowserRouter([
  {
    path: 'login',
    element: <AuthLayout />,
    errorElement: <RouteError />,
    children: [{ index: true, element: <SignInPage /> }],
  },
  {
    element: <BuyerLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'listings/:id', element: <ListingPage /> },
      { path: 'tickets', element: <RequireSignIn role="buyer"><TicketsPage /></RequireSignIn> },
      { path: 'browse', element: <BrowsePage /> },
      { path: 'credits', element: <CreditsPage /> },
      { path: 'draws', element: <DrawsPage /> },
      { path: 'draws/:id', element: <ResultPage /> },
      { path: 'wallet', element: <RequireSignIn role="buyer"><WalletPage /></RequireSignIn> },
      { path: 'sell', element: <RequireSignIn role="buyer"><SellPage /></RequireSignIn> },
      { path: 'messages', element: <RequireSignIn role="buyer"><MessagesPage basePath="/messages" /></RequireSignIn> },
      { path: 'messages/new/:listingId', element: <RequireSignIn role="buyer"><NewConversationPage basePath="/messages" /></RequireSignIn> },
      { path: 'messages/:id', element: <RequireSignIn role="buyer"><ConversationPage basePath="/messages" /></RequireSignIn> },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    path: 'store',
    element: <RequireSignIn role="store"><BackOfficeLayout app="store" /></RequireSignIn>,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <MerchantPage /> },
      { path: 'insights', element: <InsightsPage /> },
      { path: 'messages', element: <MessagesPage basePath="/store/messages" /> },
      { path: 'messages/:id', element: <ConversationPage basePath="/store/messages" /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    path: 'admin',
    element: <RequireSignIn role="admin"><BackOfficeLayout app="admin" /></RequireSignIn>,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <AdminPage /> },
      { path: 'draws', element: <AdminDrawsPage /> },
      { path: 'boosts', element: <AdminBoostsPage /> },
      { path: 'sellers', element: <AdminSellersPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  // Old address of the store app.
  { path: 'merchant', element: <Navigate to="/store" replace /> },
])

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionSync />
      <SplashController />
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
