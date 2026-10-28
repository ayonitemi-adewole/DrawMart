import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Kobo } from '@/domain/types'
import { api } from './index'
import type { ListingFilter, NewListingInput } from './types'

export const keys = {
  session: ['session'] as const,
  me: ['me'] as const,
  listings: (f?: ListingFilter) => ['listings', f ?? {}] as const,
  listing: (id: string) => ['listing', id] as const,
  myListings: ['my-listings'] as const,
  results: ['results'] as const,
  wallet: ['wallet'] as const,
  merchant: ['merchant'] as const,
  merchantListings: ['merchant-listings'] as const,
  pending: ['pending'] as const,
}

/** The signed-in account, or null. Kept fresh by SessionSync in App.tsx. */
export const useSession = () =>
  useQuery({ queryKey: keys.session, queryFn: async () => (api.auth ? api.auth.getSession() : null), staleTime: Infinity })

/** What the current visitor may do. The mock has no accounts, so there everything is allowed. */
export function useAccess() {
  const s = useSession()
  if (!api.auth) return { ready: true, signedIn: true, isAdmin: true, isStore: true, email: null }
  return { ready: !s.isPending, signedIn: !!s.data, isAdmin: !!s.data?.isAdmin, isStore: !!s.data?.merchantId, email: s.data?.email ?? null }
}

// Public data
export const useListings = (f?: ListingFilter) => useQuery({ queryKey: keys.listings(f), queryFn: () => api.listListings(f) })
export const useListing = (id: string) => useQuery({ queryKey: keys.listing(id), queryFn: () => api.getListing(id) })
export const useResults = () => useQuery({ queryKey: keys.results, queryFn: () => api.listResults() })

// Private data waits until the visitor is allowed to see it.
export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.getCurrentUser(), enabled: useAccess().signedIn })
export const useMyListings = () => useQuery({ queryKey: keys.myListings, queryFn: () => api.listMyListings(), enabled: useAccess().signedIn })
export const useWallet = () => useQuery({ queryKey: keys.wallet, queryFn: () => api.getWallet(), enabled: useAccess().signedIn })
export const useMerchant = () => useQuery({ queryKey: keys.merchant, queryFn: () => api.getMyMerchant(), enabled: useAccess().isStore })
export const useMerchantListings = () =>
  useQuery({ queryKey: keys.merchantListings, queryFn: () => api.listMerchantListings(), enabled: useAccess().isStore })
export const usePendingListings = () => useQuery({ queryKey: keys.pending, queryFn: () => api.listPendingListings(), enabled: useAccess().isAdmin })

// Auth. SessionSync (App.tsx) clears the cache when the account changes.
export const useSendSignInLink = () => useMutation({ mutationFn: ({ email, redirectTo }: { email: string; redirectTo: string }) => api.auth!.sendSignInLink(email, redirectTo) })
export const usePasswordSignIn = () => useMutation({ mutationFn: ({ email, password }: { email: string; password: string }) => api.auth!.signInWithPassword(email, password) })
export const useSignOut = () => useMutation({ mutationFn: () => api.auth!.signOut() })

/** Almost every write touches money or ticket counts, so refresh everything. */
function useInvalidateAll() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries()
}

export function useBuyTickets() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ listingId, quantity }: { listingId: string; quantity: number }) => api.buyTickets(listingId, quantity),
    onSettled: invalidate,
  })
}

export function useTopUp() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (amount: Kobo) => api.topUp(amount), onSettled: invalidate })
}

/** Top-up through the payment provider's checkout. Only when `api.payments` exists. */
export function useDeposit() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (amount: Kobo) => api.payments!.deposit(amount), onSettled: invalidate })
}

export function useCheckDeposit() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (txRef: string) => api.payments!.checkDeposit(txRef), onSettled: invalidate })
}

export function useSetWeeklyLimit() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (amount: Kobo) => api.setWeeklyLimit(amount), onSettled: invalidate })
}

export function useUpdateProfile() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (patch: Parameters<typeof api.updateProfile>[0]) => api.updateProfile(patch), onSettled: invalidate })
}

export function useCreateListing() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (input: NewListingInput) => api.createListing(input), onSettled: invalidate })
}

export function useReviewListing() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => (approve ? api.approveListing(id) : api.rejectListing(id)),
    onSettled: invalidate,
  })
}

export function useDemoActions() {
  const invalidate = useInvalidateAll()
  return {
    sellOut: useMutation({ mutationFn: (id: string) => api.demoSellOut(id), onSettled: invalidate }),
    expire: useMutation({ mutationFn: (id: string) => api.demoExpire(id), onSettled: invalidate }),
    reset: useMutation({
      mutationFn: () => api.demoReset?.() ?? Promise.resolve(),
      onSuccess: () => window.location.assign('/'),
    }),
  }
}
