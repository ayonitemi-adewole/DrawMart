import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { Kobo } from '@/domain/types'
import { api } from './index'
import type { MetricRange } from '@/domain/metrics'
import type { SellerApplicationInput } from '@/domain/sellers'
import { visitorId } from '@/lib/visitor'
import type { SavedAddressInput } from '@/domain/addresses'
import type { AccountRole, BoostSettings, CheckoutInput, ListingFilter, NewListingInput, NewPickupInput, NewProductInput, PickupItemInput } from './types'

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
  myOrders: ['my-orders'] as const,
  merchantOrders: ['merchant-orders'] as const,
  savedPickup: ['saved-pickup'] as const,
  notifications: ['notifications'] as const,
  addresses: ['addresses'] as const,
  cart: ['cart'] as const,
  pickupPoints: ['pickup-points'] as const,
  prizeOrders: ['prize-orders'] as const,
  sellerApplication: ['seller-application'] as const,
  sellerApplications: ['seller-applications'] as const,
  conversations: ['conversations'] as const,
  messages: (id: string) => ['messages', id] as const,
  callPhone: ['call-phone'] as const,
  metrics: (days: MetricRange) => ['metrics', days] as const,
  boostStatus: ['boost-status'] as const,
  boosts: ['boosts'] as const,
}

/** The signed-in account, or null. Kept fresh by SessionSync in App.tsx. */
export const useSession = () => useQuery({ queryKey: keys.session, queryFn: () => api.auth.getSession(), staleTime: Infinity })

/** Who is signed in, and which app their account belongs to. */
export function useAccess() {
  const s = useSession()
  return { ready: !s.isPending, signedIn: !!s.data, role: s.data?.role ?? null, email: s.data?.email ?? null }
}

// Public data
export const useListings = (f?: ListingFilter) => useQuery({ queryKey: keys.listings(f), queryFn: () => api.listListings(f) })
export const useListing = (id: string) => useQuery({ queryKey: keys.listing(id), queryFn: () => api.getListing(id) })
export const useResults = () => useQuery({ queryKey: keys.results, queryFn: () => api.listResults() })

// Private data waits until the right kind of account is signed in.
const useIs = (role: AccountRole) => useAccess().role === role
export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.getCurrentUser(), enabled: useIs('buyer') })
export const useMyListings = () => useQuery({ queryKey: keys.myListings, queryFn: () => api.listMyListings(), enabled: useIs('buyer') })
export const useWallet = () => useQuery({ queryKey: keys.wallet, queryFn: () => api.getWallet(), enabled: useIs('buyer') })
export const useMySellerApplication = () =>
  useQuery({ queryKey: keys.sellerApplication, queryFn: () => api.getMySellerApplication(), enabled: useIs('buyer') })
/** Store accounts, and buyers who passed the seller check, manage a shop. */
export function useHasShop() {
  const role = useAccess().role
  const application = useMySellerApplication()
  return role === 'store' || (role === 'buyer' && application.data?.status === 'approved')
}
export const useMerchant = () => useQuery({ queryKey: keys.merchant, queryFn: () => api.getMyMerchant(), enabled: useHasShop() })
export const useMerchantListings = () =>
  useQuery({ queryKey: keys.merchantListings, queryFn: () => api.listMerchantListings(), enabled: useHasShop() })
export const useMyOrders = () => useQuery({ queryKey: keys.myOrders, queryFn: () => api.listMyOrders(), enabled: useIs('buyer') })
export const useMerchantOrders = () => useQuery({ queryKey: keys.merchantOrders, queryFn: () => api.listMerchantOrders(), enabled: useHasShop() })
export const useSellerApplications = () =>
  useQuery({ queryKey: keys.sellerApplications, queryFn: () => api.listSellerApplications(), enabled: useIs('admin') })
export const usePendingListings = () => useQuery({ queryKey: keys.pending, queryFn: () => api.listPendingListings(), enabled: useIs('admin') })

// Messages. No push channel yet, so open chats poll every few seconds and the inbox less often.
const useCanChat = () => {
  const role = useAccess().role
  return role === 'buyer' || role === 'store'
}
export const useConversations = () =>
  useQuery({ queryKey: keys.conversations, queryFn: () => api.listConversations(), enabled: useCanChat(), refetchInterval: 20_000 })
export const useUnreadMessages = () => useConversations().data?.reduce((n, c) => n + c.unread, 0) ?? 0
export const useMessages = (conversationId: string) =>
  useQuery({ queryKey: keys.messages(conversationId), queryFn: () => api.listMessages(conversationId), enabled: useCanChat(), refetchInterval: 4_000 })
export const useCallPhone = () => useQuery({ queryKey: keys.callPhone, queryFn: () => api.getCallPhone(), enabled: useHasShop() })

/** The buyer's first message about a product, which is what creates the chat. */
export function useSendFirstMessage(listingId: string) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (body: string) => api.sendFirstMessage(listingId, body), onSettled: () => qc.invalidateQueries({ queryKey: keys.conversations }) })
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => api.sendMessage(conversationId, body),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: keys.messages(conversationId) }), qc.invalidateQueries({ queryKey: keys.conversations })]),
  })
}

export function useMarkConversationRead() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (conversationId: string) => api.markConversationRead(conversationId), onSettled: () => qc.invalidateQueries({ queryKey: keys.conversations }) })
}

export function useSetCallPhone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (phone: string | null) => api.setCallPhone(phone),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: keys.callPhone }), qc.invalidateQueries({ queryKey: keys.conversations })]),
  })
}

// Saved delivery addresses
export const useAddresses = () => useQuery({ queryKey: keys.addresses, queryFn: () => api.listAddresses(), enabled: useIs('buyer') })

/** Each change returns the new list, which goes straight in the cache. */
export function useAddressActions() {
  const qc = useQueryClient()
  const onSuccess = (list: Awaited<ReturnType<typeof api.listAddresses>>) => qc.setQueryData(keys.addresses, list)
  return {
    save: useMutation({ mutationFn: (input: SavedAddressInput) => api.saveAddress(input), onSuccess }),
    setDefault: useMutation({ mutationFn: (id: string) => api.setDefaultAddress(id), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => api.deleteAddress(id), onSuccess }),
  }
}

// Cart and checkout
export const useCart = () => useQuery({ queryKey: keys.cart, queryFn: () => api.listCart(), enabled: useIs('buyer') })
export const usePickupPoints = () => useQuery({ queryKey: keys.pickupPoints, queryFn: () => api.listPickupPoints(), staleTime: 5 * 60_000 })
export const usePrizeOrders = () => useQuery({ queryKey: keys.prizeOrders, queryFn: () => api.listPrizeOrders(), enabled: useIs('admin') })

// Notifications. No push channel yet, so these poll like messages.
export const useNotifications = () =>
  useQuery({ queryKey: keys.notifications, queryFn: () => api.listNotifications(), enabled: useIs('buyer'), refetchInterval: 30_000 })
export const useUnreadNotifications = () => useNotifications().data?.filter((n) => !n.read).length ?? 0
/** Wins the buyer hasn't been greeted with yet, oldest first. */
export const useUncelebratedWins = () => (useNotifications().data ?? []).filter((n) => n.kind === 'draw_won' && !n.celebrated).reverse()

export function useMarkWinCelebrated() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (listingId: string) => api.markWinCelebrated(listingId), onSettled: () => qc.invalidateQueries({ queryKey: keys.notifications }) })
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: () => api.markNotificationsRead(), onSettled: () => qc.invalidateQueries({ queryKey: keys.notifications }) })
}

// Boosts (paid promotion)
const useCanSeeBoosts = () => {
  const hasShop = useHasShop()
  const role = useAccess().role // always call both hooks, in the same order
  return hasShop || role === 'admin'
}
export const useBoostStatus = () => useQuery({ queryKey: keys.boostStatus, queryFn: () => api.getBoostStatus(), enabled: useCanSeeBoosts() })
/** While a payment waits on Flutterwave, keep checking so the card flips to "active" on its own. */
export const useBoosts = () =>
  useQuery({
    queryKey: keys.boosts,
    queryFn: () => api.listBoosts(),
    enabled: useCanSeeBoosts(),
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === 'pending' && isRecentPending(b.createdAt)) ? 15_000 : false),
  })
export const useBoostInsights = (boostId: string | null) =>
  useQuery({ queryKey: ['boost-insights', boostId], queryFn: () => api.getBoostInsights(boostId!), enabled: !!boostId })

/** Pending boosts older than a day were abandoned; stop showing them. */
export const isRecentPending = (createdAt: string) => Date.now() - Date.parse(createdAt) < 24 * 60 * 60 * 1000

export function useBuyBoost() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ listingId, packageId }: { listingId: string; packageId: string }) => api.buyBoost(listingId, packageId), onSettled: invalidate })
}

export function useSetBoostSettings() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (s: BoostSettings) => api.setBoostSettings(s), onSettled: invalidate })
}

// Seller insights
export const useMerchantMetrics = (days: MetricRange) =>
  useQuery({ queryKey: keys.metrics(days), queryFn: () => api.getMerchantMetrics(days), enabled: useHasShop() })

/** Counts one view of a listing page for its seller's insights. Failures are ignored: it's only a counter. */
export function useRecordListingView(listingId: string | undefined) {
  useEffect(() => {
    if (listingId) api.recordListingView(listingId, visitorId()).catch(() => undefined)
  }, [listingId])
}

// Auth. SessionSync (App.tsx) clears the cache when the account changes.
export const useSendSignInLink = () => useMutation({ mutationFn: ({ email, redirectTo }: { email: string; redirectTo: string }) => api.auth.sendSignInLink(email, redirectTo) })
export const usePasswordSignIn = () => useMutation({ mutationFn: ({ email, password }: { email: string; password: string }) => api.auth.signInWithPassword(email, password) })
export function useSignOut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.auth.signOut(),
    // Don't wait for SessionSync: whatever opens next must already see "signed out".
    onSuccess: () => {
      qc.clear()
      qc.setQueryData(keys.session, null)
    },
  })
}

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

export function useCheckout() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (input: CheckoutInput) => api.checkout(input), onSettled: invalidate })
}

export function useAddToCart() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (listingId: string) => api.addToCart(listingId), onSettled: () => qc.invalidateQueries({ queryKey: keys.cart }) })
}

export function useRemoveFromCart() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (listingId: string) => api.removeFromCart(listingId), onSettled: () => qc.invalidateQueries({ queryKey: keys.cart }) })
}

export function useConfirmOrder() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (orderId: string) => api.confirmOrder(orderId), onSettled: invalidate })
}

export function useDispatchOrder() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (orderId: string) => api.dispatchOrder(orderId), onSettled: invalidate })
}

export function useCreateListingBatch() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (input: NewPickupInput) => api.createListingBatch(input), onSettled: invalidate })
}

export const useSavedPickup = () => useQuery({ queryKey: keys.savedPickup, queryFn: () => api.getSavedPickup(), enabled: useIs('store') })

export function useSavePickupItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: PickupItemInput[]) => api.savePickupItems(items),
    onSuccess: (saved) => qc.setQueryData(keys.savedPickup, saved),
  })
}

export function useCreateProduct() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (input: NewProductInput) => api.createProduct(input), onSettled: invalidate })
}

export function useSubmitSellerApplication() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (input: SellerApplicationInput) => api.submitSellerApplication(input), onSettled: invalidate })
}

export function useReviewSeller() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) => (approve ? api.approveSeller(id) : api.rejectSeller(id, note ?? '')),
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
    runDraw: useMutation({ mutationFn: (id: string) => api.demoRunDraw(id), onSettled: invalidate }),
    expire: useMutation({ mutationFn: (id: string) => api.demoExpire(id), onSettled: invalidate }),
    reset: useMutation({
      mutationFn: () => api.demoReset?.() ?? Promise.resolve(),
      onSuccess: () => window.location.assign('/'),
    }),
    resetAll: useMutation({ mutationFn: () => api.resetTestData(), onSettled: invalidate }),
  }
}
