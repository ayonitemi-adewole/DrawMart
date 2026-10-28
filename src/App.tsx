import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, RouterProvider, createBrowserRouter, useRouteError } from 'react-router'
import { ToastProvider } from '@/components/toast'
import { SearchIcon } from '@/components/icons'
import { EmptyState, ErrorState, buttonClass } from '@/components/ui'
import { BackOfficeLayout } from '@/layouts/BackOfficeLayout'
import { BuyerLayout } from '@/layouts/BuyerLayout'
import { AuthGate } from '@/pages/SignInPage'
import { AdminPage } from '@/pages/admin/AdminPage'
import { DrawsPage } from '@/pages/DrawsPage'
import { HomePage } from '@/pages/HomePage'
import { ListingPage } from '@/pages/ListingPage'
import { MerchantPage } from '@/pages/merchant/MerchantPage'
import { ResultPage } from '@/pages/ResultPage'
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

const router = createBrowserRouter([
  {
    // Shows the sign-in screen when the backend has accounts and nobody is signed in.
    element: <AuthGate />,
    errorElement: <RouteError />,
    children: [
      {
        element: <BuyerLayout />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'listings/:id', element: <ListingPage /> },
          { path: 'tickets', element: <TicketsPage /> },
          { path: 'draws', element: <DrawsPage /> },
          { path: 'draws/:id', element: <ResultPage /> },
          { path: 'wallet', element: <WalletPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
      {
        element: <BackOfficeLayout />,
        errorElement: <RouteError />,
        children: [
          { path: 'merchant', element: <MerchantPage /> },
          { path: 'admin', element: <AdminPage /> },
        ],
      },
    ],
  },
])

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
