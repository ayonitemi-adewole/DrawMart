import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, RouterProvider, createBrowserRouter, useRouteError } from 'react-router'
import { ToastProvider } from '@/components/toast'
import { ErrorState } from '@/components/ui'
import { BackOfficeLayout } from '@/layouts/BackOfficeLayout'
import { BuyerLayout } from '@/layouts/BuyerLayout'
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
    <div className="mx-auto max-w-md p-6">
      <ErrorState error={error} />
    </div>
  )
}

function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <h1 className="font-display text-3xl font-extrabold">Page not found</h1>
      <Link to="/">Back to live draws</Link>
    </div>
  )
}

const router = createBrowserRouter([
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
