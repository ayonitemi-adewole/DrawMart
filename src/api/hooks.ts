import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Kobo } from '@/domain/types'
import { api } from './index'
import type { ListingFilter, NewListingInput } from './types'

export const keys = {
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

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.getCurrentUser() })
export const useListings = (f?: ListingFilter) => useQuery({ queryKey: keys.listings(f), queryFn: () => api.listListings(f) })
export const useListing = (id: string) => useQuery({ queryKey: keys.listing(id), queryFn: () => api.getListing(id) })
export const useMyListings = () => useQuery({ queryKey: keys.myListings, queryFn: () => api.listMyListings() })
export const useResults = () => useQuery({ queryKey: keys.results, queryFn: () => api.listResults() })
export const useWallet = () => useQuery({ queryKey: keys.wallet, queryFn: () => api.getWallet() })
export const useMerchant = () => useQuery({ queryKey: keys.merchant, queryFn: () => api.getMyMerchant() })
export const useMerchantListings = () => useQuery({ queryKey: keys.merchantListings, queryFn: () => api.listMerchantListings() })
export const usePendingListings = () => useQuery({ queryKey: keys.pending, queryFn: () => api.listPendingListings() })

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
