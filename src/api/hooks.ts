import type { ClaimInput } from './types'
import type { StoreRole } from '@/domain/team'
import type { DeliveryRatingReason } from '@/domain/deliveryRatings'
import { deliveryJobsToKeep, returnJobsToKeep } from '@/domain/offlineJobs'
import { clearSavedJobs, loadSavedJobs, saveJobs } from '@/lib/offlineJobs'
import type { IncidentOutcome, IncidentType } from '@/domain/incidents'
import type { DiscountInput } from '@/domain/discounts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { ShopPickup } from '@/domain/shopPickup'
import type { ShopProfileInput } from '@/domain/shopProfile'
import type { ReviewInput } from '@/domain/reviews'
import type { CancelReason, CollectionProblem, GeoPoint, Kobo, PackageSize, RefusalReason, RejectionReason, Category } from '@/domain/types'
import { api } from './index'
import type { MetricRange } from '@/domain/metrics'
import type { SellerApplicationInput } from '@/domain/sellers'
import type { StoreApplicationInput } from '@/domain/storeApplications'
import type { RiderApplicationInput } from '@/domain/riderApplications'
import { visitorId } from '@/lib/visitor'
import { pushDeviceState, subscribeThisDevice, unsubscribeThisDevice } from '@/lib/push'
import type { NotificationPreference } from '@/domain/push'
import type { SavedAddressInput } from '@/domain/addresses'
import type { AccountRole, BoostSettings, DeliveryJob, ReturnJob, DispatchJobKind, CheckoutInput, ListingFilter, NewListingInput, NewPickupInput, NewProductInput, PickupItemInput } from './types'

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
  priceReviews: ['price-reviews'] as const,
  cancelRates: ['cancel-rates'] as const,
  deliveryPricing: ['delivery-pricing'] as const,
  shopPickup: ['shop-pickup'] as const,
  shop: (id: string) => ['shop', id] as const,
  shopReviews: (id: string, listingId?: string) => ['shop-reviews', id, listingId ?? null] as const,
  adminReviews: ['admin-reviews'] as const,
  supportThread: ['support-thread'] as const,
  quickReplies: ['quick-replies'] as const,
  discounts: ['discounts'] as const,
  storeRole: ['store-role'] as const,
  storeTeam: ['store-team'] as const,
  storeActivity: ['store-activity'] as const,
  storeInvites: ['store-invites'] as const,
  drawPriceStats: (category: string, band: number) => ['draw-price-stats', category, band] as const,
  supportInbox: ['support-inbox'] as const,
  supportMessages: (merchantId: string) => ['support-messages', merchantId] as const,
  cacNumber: (id: string) => ['cac-number', id] as const,
  openClaims: ['open-claims'] as const,
  listingCheckPlan: ['listing-check-plan'] as const,
  listingCheck: (id: string) => ['listing-check', id] as const,
  returnJobs: ['return-jobs'] as const,
  riderAreas: ['rider-areas'] as const,
  myCounter: ['my-counter'] as const,
  riderSignupsOpen: ['rider-signups-open'] as const,
  myRiderApplication: ['my-rider-application'] as const,
  riderApplications: ['rider-applications'] as const,
  riderFleets: ['rider-fleets'] as const,
  adminRiders: ['admin-riders'] as const,
  dispatchBoard: ['dispatch-board'] as const,
  myRiderStats: ['my-rider-stats'] as const,
  myOpenIncidents: ['my-open-incidents'] as const,
  openIncidents: ['open-incidents'] as const,
  riderPerformance: ['rider-performance'] as const,
  riderLevel: ['rider-level'] as const,
  riderProfile: ['rider-profile'] as const,
  deliveryChat: (orderId: string) => ['delivery-chat', orderId] as const,
  riderPayRates: ['rider-pay-rates'] as const,
  myEarnings: ['my-earnings'] as const,
  riderPayDue: ['rider-pay-due'] as const,
  counterItems: ['counter-items'] as const,
  pending: ['pending'] as const,
  myOrders: ['my-orders'] as const,
  merchantOrders: ['merchant-orders'] as const,
  savedPickup: ['saved-pickup'] as const,
  notifications: ['notifications'] as const,
  addresses: ['addresses'] as const,
  deliveryJobs: ['delivery-jobs'] as const,
  cart: ['cart'] as const,
  pushPreferences: ['push-preferences'] as const,
  payouts: ['payouts'] as const,
  payoutAccount: ['payoutAccount'] as const,
  banks: ['banks'] as const,
  duePayouts: ['duePayouts'] as const,
  pushDevice: ['push-device'] as const,
  winnersWall: ['winners-wall'] as const,
  myWinnerStories: ['my-winner-stories'] as const,
  pendingWinnerStories: ['pending-winner-stories'] as const,
  saved: ['saved'] as const,
  savedIds: ['saved-ids'] as const,
  pickupPoints: ['pickup-points'] as const,
  prizeOrders: ['prize-orders'] as const,
  sellerApplication: ['seller-application'] as const,
  sellerApplications: ['seller-applications'] as const,
  storeApplication: ['store-application'] as const,
  storeApplications: ['store-applications'] as const,
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
/** Buyers and stores get notifications. Riders and admins don't. */
const useHasInbox = () => {
  const role = useAccess().role
  return role === 'buyer' || role === 'store' || role === 'delivery'
}
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
export const useShopPickup = () => useQuery({ queryKey: keys.shopPickup, queryFn: () => api.getShopPickup(), enabled: useHasShop() })
export const useListingCheckPlan = (enabled: boolean) => useQuery({ queryKey: keys.listingCheckPlan, queryFn: () => api.getListingCheckPlan(), enabled: useHasShop() && enabled, staleTime: Infinity })
export const useListingCheck = (id: string | null) => useQuery({ queryKey: keys.listingCheck(id ?? ''), queryFn: () => api.getListingCheck(id!), enabled: !!id, staleTime: 5 * 60_000 })
export const useOpenClaims = () => useQuery({ queryKey: keys.openClaims, queryFn: () => api.listOpenClaims(), enabled: useIs('admin') })
export function useReturnJobs() {
  const userId = useSession().data?.userId ?? null
  return useQuery({
    queryKey: keys.returnJobs,
    queryFn: async () => {
      const jobs = await api.listReturnJobs()
      if (userId) saveJobs('returns', userId, returnJobsToKeep(jobs))
      return jobs
    },
    initialData: () => loadSavedJobs<ReturnJob>('returns', userId)?.jobs,
    initialDataUpdatedAt: 0,
    enabled: useIs('delivery'),
    refetchInterval: 30_000,
  })
}
/** Cached per band, so typing a price doesn't ask again on every key. */
export const useDrawPriceStats = (category: Category, band: number | null) =>
  useQuery({ queryKey: keys.drawPriceStats(category, band ?? -1), queryFn: () => api.getDrawPriceStats(category, band!), enabled: useIs('store') && band !== null, staleTime: 10 * 60_000 })
/** Null while loading or without a shop; canDo treats that as the owner, and the database checks anyway. */
export const useStoreRole = () => useQuery({ queryKey: keys.storeRole, queryFn: () => api.getMyStoreRole(), enabled: useHasShop(), staleTime: 60_000 })
export const useStoreTeam = () => useQuery({ queryKey: keys.storeTeam, queryFn: () => api.getStoreTeam(), enabled: useIs('store') })
export const useStoreActivity = () => useQuery({ queryKey: keys.storeActivity, queryFn: () => api.listStoreActivity(), enabled: useIs('store') })
export const useMyStoreInvites = () => useQuery({ queryKey: keys.storeInvites, queryFn: () => api.listMyStoreInvites(), enabled: useIs('buyer'), staleTime: 60_000 })
export const useDiscounts = () => useQuery({ queryKey: keys.discounts, queryFn: () => api.listDiscounts(), enabled: useHasShop() })
export const useQuickReplies = () => useQuery({ queryKey: keys.quickReplies, queryFn: () => api.listQuickReplies(), enabled: useHasShop() })
export const useSupportThread = () => useQuery({ queryKey: keys.supportThread, queryFn: () => api.getSupportThread(), enabled: useHasShop(), refetchInterval: 10_000 })
export const useSupportUnread = () => useSupportThread().data?.unread ?? 0
export const useSupportInbox = () => useQuery({ queryKey: keys.supportInbox, queryFn: () => api.listSupportThreads(), enabled: useIs('admin'), refetchInterval: 15_000 })
export const useSupportMessages = (merchantId: string) =>
  useQuery({ queryKey: keys.supportMessages(merchantId), queryFn: () => api.getSupportMessages(merchantId), enabled: useIs('admin') && !!merchantId, refetchInterval: 5_000 })
export const useShopReviews = (merchantId: string | null | undefined, listingId?: string) =>
  useQuery({ queryKey: keys.shopReviews(merchantId ?? '', listingId), queryFn: () => api.getShopReviews(merchantId!, listingId), enabled: !!merchantId })
export const useAdminReviews = () => useQuery({ queryKey: keys.adminReviews, queryFn: () => api.listAdminReviews(), enabled: useIs('admin') })
export const useShop = (id: string) => useQuery({ queryKey: keys.shop(id), queryFn: () => api.getShop(id), enabled: !!id })
export const useMerchantCacNumber = (id: string | null) => useQuery({ queryKey: keys.cacNumber(id ?? ''), queryFn: () => api.getMerchantCacNumber(id!), enabled: !!id, staleTime: Infinity })
export const useMerchant = () => useQuery({ queryKey: keys.merchant, queryFn: () => api.getMyMerchant(), enabled: useHasShop() })
export const useMerchantListings = () =>
  useQuery({ queryKey: keys.merchantListings, queryFn: () => api.listMerchantListings(), enabled: useHasShop() })
export const useMyOrders = () => useQuery({ queryKey: keys.myOrders, queryFn: () => api.listMyOrders(), enabled: useIs('buyer') })
export const useMerchantOrders = () => useQuery({ queryKey: keys.merchantOrders, queryFn: () => api.listMerchantOrders(), enabled: useHasShop() })
export const useMyStoreApplication = () =>
  useQuery({ queryKey: keys.storeApplication, queryFn: () => api.getMyStoreApplication(), enabled: useIs('buyer') })
export const useStoreApplications = () =>
  useQuery({ queryKey: keys.storeApplications, queryFn: () => api.listStoreApplications(), enabled: useIs('admin') })
export const useSellerApplications = () =>
  useQuery({ queryKey: keys.sellerApplications, queryFn: () => api.listSellerApplications(), enabled: useIs('admin') })
export const useDeliveryPricing = () => useQuery({ queryKey: keys.deliveryPricing, queryFn: () => api.getDeliveryPricing(), staleTime: 5 * 60_000 })
export const useCancelRates = () => useQuery({ queryKey: keys.cancelRates, queryFn: () => api.listCancelRates(), enabled: useIs('admin') })
export const usePriceReviews = () => useQuery({ queryKey: keys.priceReviews, queryFn: () => api.listPriceReviews(), enabled: useIs('admin') })
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

// Push notifications
export const usePushPreferences = () => useQuery({ queryKey: keys.pushPreferences, queryFn: () => api.getPushPreferences(), enabled: useHasInbox() })
/** This device's own state, so it's only ever asked of the browser, not the server. */
export const usePushDeviceState = () => useQuery({ queryKey: keys.pushDevice, queryFn: () => pushDeviceState(), enabled: useHasInbox() })

// Winners wall
export const useWinnersWall = () => useQuery({ queryKey: keys.winnersWall, queryFn: () => api.listWinnersWall() })
export const useMyWinnerStories = () => useQuery({ queryKey: keys.myWinnerStories, queryFn: () => api.listMyWinnerStories(), enabled: useIs('buyer') })
export const usePendingWinnerStories = () => useQuery({ queryKey: keys.pendingWinnerStories, queryFn: () => api.listPendingWinnerStories(), enabled: useIs('admin') })

// Saved items
export const useSavedListings = () => useQuery({ queryKey: keys.saved, queryFn: () => api.listSavedListings(), enabled: useIs('buyer') })
export const useSavedIds = () => useQuery({ queryKey: keys.savedIds, queryFn: () => api.listSavedIds(), enabled: useIs('buyer') })
export const usePickupPoints = () => useQuery({ queryKey: keys.pickupPoints, queryFn: () => api.listPickupPoints(), staleTime: 5 * 60_000 })
export const usePrizeOrders = () => useQuery({ queryKey: keys.prizeOrders, queryFn: () => api.listPrizeOrders(), enabled: useIs('admin') })

// Notifications. No push channel yet, so these poll like messages.
export const useNotifications = () =>
  useQuery({ queryKey: keys.notifications, queryFn: () => api.listNotifications(), enabled: useHasInbox(), refetchInterval: 30_000 })
export const useUnreadNotifications = () => useNotifications().data?.filter((n) => !n.read).length ?? 0
/** Results of draws the buyer was in that they haven't seen yet, oldest first. */
export const useUncelebratedResults = () => (useNotifications().data ?? []).filter((n) => (n.kind === 'draw_won' || n.kind === 'draw_lost') && !n.celebrated).reverse()

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
    mutationFn: async () => {
      // So the next person to use this device doesn't get this account's wins and messages.
      await unsubscribeThisDevice()
        .then((endpoint) => (endpoint ? api.deletePushSubscription(endpoint) : undefined))
        .catch(() => {})
      await api.auth.signOut()
      // Buyers' addresses and numbers on a rider's jobs don't stay on a shared phone.
      clearSavedJobs()
    },
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
  // Not awaited: the confirmation shows now, not after the item has refreshed as sold.
  return useMutation({ mutationFn: (input: CheckoutInput) => api.checkout(input), onSettled: () => void invalidate() })
}

export function useSetCartQuantity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ listingId, quantity }: { listingId: string; quantity: number }) => api.addToCart(listingId, quantity),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.cart }),
  })
}

export function useAddToCart() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (listingId: string) => api.addToCart(listingId), onSettled: () => qc.invalidateQueries({ queryKey: keys.cart }) })
}

export function useRemoveFromCart() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (listingId: string) => api.removeFromCart(listingId), onSettled: () => qc.invalidateQueries({ queryKey: keys.cart }) })
}

export function useSetPushPreference() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ category, enabled }: { category: NotificationPreference; enabled: boolean }) => api.setPushPreference(category, enabled),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.pushPreferences }),
  })
}

/** Resolves to whether it's now on: false if the buyer said no to the browser's question. */
export function useEnablePush() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!api.pushPublicKey) return false
      const subscription = await subscribeThisDevice(api.pushPublicKey)
      if (!subscription) return false
      await api.savePushSubscription(subscription)
      return true
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.pushDevice }),
  })
}

export function useDisablePush() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const endpoint = await unsubscribeThisDevice()
      if (endpoint) await api.deletePushSubscription(endpoint)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.pushDevice }),
  })
}

export function useShareWinnerStory() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (input: { listingId: string; firstName: string; consent: boolean }) => api.shareWinnerStory(input), onSettled: invalidate })
}

export function useWithdrawWinnerStory() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (listingId: string) => api.withdrawWinnerStory(listingId), onSettled: invalidate })
}

export function useReviewWinnerStory() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ id, approve }: { id: string; approve: boolean }) => api.reviewWinnerStory(id, approve), onSettled: invalidate })
}

/** The heart fills straight away, and goes back if the save fails. */
export function useSetSaved() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ listingId, saved }: { listingId: string; saved: boolean }) => (saved ? api.saveListing(listingId) : api.unsaveListing(listingId)),
    onMutate: async ({ listingId, saved }) => {
      await qc.cancelQueries({ queryKey: keys.savedIds })
      const before = qc.getQueryData<string[]>(keys.savedIds)
      qc.setQueryData<string[]>(keys.savedIds, (ids = []) => (saved ? [listingId, ...ids.filter((id) => id !== listingId)] : ids.filter((id) => id !== listingId)))
      return { before }
    },
    onError: (_e, _vars, context) => qc.setQueryData(keys.savedIds, context?.before),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.savedIds })
      qc.invalidateQueries({ queryKey: keys.saved })
    },
  })
}

// Delivery accounts. No push channel yet, so the pool polls.
/** The rider's own unfinished jobs are kept on the phone, so they open without signal (offlineJobs.ts). */
export function useDeliveryJobs() {
  const userId = useSession().data?.userId ?? null
  return useQuery({
    queryKey: keys.deliveryJobs,
    queryFn: async () => {
      const jobs = await api.listDeliveryJobs()
      if (userId) saveJobs('deliveries', userId, deliveryJobsToKeep(jobs))
      return jobs
    },
    initialData: () => loadSavedJobs<DeliveryJob>('deliveries', userId)?.jobs,
    // Shown at once, then fetched again as soon as there's signal.
    initialDataUpdatedAt: 0,
    enabled: useIs('delivery'),
    refetchInterval: 30_000,
  })
}

/** The pickup location a counter account works at; null for riders. */
export const useMyCounter = () => useQuery({ queryKey: keys.myCounter, queryFn: () => api.getMyCounter(), enabled: useIs('delivery'), staleTime: 5 * 60_000 })
export function useCounterItems() {
  const isCounter = !!useMyCounter().data
  return useQuery({ queryKey: keys.counterItems, queryFn: () => api.listCounterItems(), enabled: isCounter, refetchInterval: 30_000 })
}

export function useCounterActions() {
  const invalidate = useInvalidateAll()
  return {
    receive: useMutation({ mutationFn: ({ id, code }: { id: string; code: string }) => api.receiveAtCounter(id, code), onSettled: invalidate }),
    handOver: useMutation({ mutationFn: ({ id, pin }: { id: string; pin: string }) => api.counterHandOver(id, pin), onSettled: invalidate }),
    release: useMutation({ mutationFn: (id: string) => api.releaseToRider(id), onSettled: invalidate }),
  }
}

export const useRiderProfile = () => useQuery({ queryKey: keys.riderProfile, queryFn: () => api.getRiderProfile(), enabled: useIs('delivery') })

export function useSetRiderPhoto() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (photo: string) => api.setRiderPhoto(photo), onSettled: () => qc.invalidateQueries({ queryKey: keys.riderProfile }) })
}

/** Polls like an open chat while it's on screen. */
export const useDeliveryChat = (orderId: string) => useQuery({ queryKey: keys.deliveryChat(orderId), queryFn: () => api.getDeliveryChat(orderId), refetchInterval: 4_000 })

export function useSendDeliveryMessage(orderId: string) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (body: string) => api.sendDeliveryMessage(orderId, body), onSettled: () => qc.invalidateQueries({ queryKey: keys.deliveryChat(orderId) }) })
}

export const useRiderSignupsOpen = () => useQuery({ queryKey: keys.riderSignupsOpen, queryFn: () => api.getRiderSignupsOpen(), staleTime: 5 * 60_000 })
export const useMyRiderApplication = () => useQuery({ queryKey: keys.myRiderApplication, queryFn: () => api.getMyRiderApplication(), enabled: useIs('buyer') })
export const useRiderApplications = () => useQuery({ queryKey: keys.riderApplications, queryFn: () => api.listRiderApplications(), enabled: useIs('admin') })
export const useRiderFleets = () => useQuery({ queryKey: keys.riderFleets, queryFn: () => api.listRiderFleets(), enabled: useIs('admin') })
export const useAdminRiders = () => useQuery({ queryKey: keys.adminRiders, queryFn: () => api.listRiders(), enabled: useIs('admin') })
/** Riders move jobs on their own, so it keeps itself fresh. */
export const useMyOpenIncidents = () => useQuery({ queryKey: keys.myOpenIncidents, queryFn: () => api.getMyOpenIncidents(), enabled: useIs('delivery') })
/** Someone may be in trouble, so admins see new reports without reloading. */
export const useOpenIncidents = () => useQuery({ queryKey: keys.openIncidents, queryFn: () => api.listOpenIncidents(), enabled: useIs('admin'), refetchInterval: 30_000 })
export function useIncidentActions() {
  const invalidate = useInvalidateAll()
  return {
    report: useMutation({ mutationFn: ({ kind, id, type, at }: { kind: DispatchJobKind; id: string; type: IncidentType; at: GeoPoint | null }) => api.reportIncident(kind, id, type, at), onSettled: invalidate }),
    addDetails: useMutation({ mutationFn: ({ id, details }: { id: string; details: { note?: string; photo?: string; at?: GeoPoint | null } }) => api.addIncidentDetails(id, details), onSettled: invalidate }),
    resolve: useMutation({ mutationFn: ({ id, outcome, note }: { id: string; outcome: IncidentOutcome; note: string }) => api.resolveIncident(id, outcome, note), onSettled: invalidate }),
  }
}
export const useMyRiderStats = () => useQuery({ queryKey: keys.myRiderStats, queryFn: () => api.getMyRiderStats(), enabled: useIs('delivery') })
export const useRiderPerformance = () => useQuery({ queryKey: keys.riderPerformance, queryFn: () => api.getRiderPerformance(), enabled: useIs('admin') })
export function useRateDelivery() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ orderId, good, reasons }: { orderId: string; good: boolean; reasons: DeliveryRatingReason[] }) => api.rateDelivery(orderId, good, reasons), onSettled: invalidate })
}
export const useDispatchBoard = () => useQuery({ queryKey: keys.dispatchBoard, queryFn: () => api.getDispatchBoard(), enabled: useIs('admin'), refetchInterval: 30_000 })

export function useDispatchActions() {
  const invalidate = useInvalidateAll()
  return {
    assign: useMutation({ mutationFn: ({ kind, id, riderId }: { kind: DispatchJobKind; id: string; riderId: string }) => api.assignJob(kind, id, riderId), onSettled: invalidate }),
    takeBack: useMutation({ mutationFn: ({ kind, id }: { kind: DispatchJobKind; id: string }) => api.unassignJob(kind, id), onSettled: invalidate }),
  }
}

export const useRiderLevel = () => useQuery({ queryKey: keys.riderLevel, queryFn: () => api.getRiderLevel(), enabled: useIs('delivery') })

export function useSubmitRiderApplication() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (input: RiderApplicationInput) => api.submitRiderApplication(input), onSettled: invalidate })
}

export function useRiderAdminActions() {
  const invalidate = useInvalidateAll()
  return {
    setOpen: useMutation({ mutationFn: (open: boolean) => api.setRiderSignupsOpen(open), onSettled: invalidate }),
    review: useMutation({ mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) => (approve ? api.approveRiderApplication(id) : api.rejectRiderApplication(id, note ?? '')), onSettled: invalidate }),
    createFleet: useMutation({ mutationFn: ({ name, phone }: { name: string; phone: string }) => api.createRiderFleet(name, phone), onSettled: invalidate }),
    setFleetTrusted: useMutation({ mutationFn: ({ id, trusted }: { id: string; trusted: boolean }) => api.setFleetTrusted(id, trusted), onSettled: invalidate }),
    setFleet: useMutation({ mutationFn: ({ riderId, fleetId }: { riderId: string; fleetId: string | null }) => api.setRiderFleet(riderId, fleetId), onSettled: invalidate }),
    setTrusted: useMutation({ mutationFn: ({ riderId, trusted }: { riderId: string; trusted: boolean }) => api.setRiderTrusted(riderId, trusted), onSettled: invalidate }),
  }
}

export const useRiderAreas = () => useQuery({ queryKey: keys.riderAreas, queryFn: () => api.getRiderAreas(), enabled: useIs('delivery') })

export function useSetRiderAreas() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (areas: string[]) => api.setRiderAreas(areas), onSettled: () => qc.invalidateQueries({ queryKey: keys.riderAreas }) })
}

export function useDeliveryActions() {
  const invalidate = useInvalidateAll()
  return {
    take: useMutation({ mutationFn: (orderId: string) => api.takeDelivery(orderId), onSettled: invalidate }),
    takeTrip: useMutation({ mutationFn: (orderIds: string[]) => api.takeDeliveries(orderIds), onSettled: invalidate }),
    release: useMutation({ mutationFn: (orderId: string) => api.releaseDelivery(orderId), onSettled: invalidate }),
    confirm: useMutation({ mutationFn: ({ id, pin }: { id: string; pin: string }) => api.confirmDelivery(id, pin), onSettled: invalidate }),
    arrived: useMutation({ mutationFn: (orderId: string) => api.markArrived(orderId), onSettled: invalidate }),
    failAttempt: useMutation({ mutationFn: ({ id, photo, at }: { id: string; photo: string; at: GeoPoint }) => api.failDeliveryAttempt(id, photo, at), onSettled: invalidate }),
    pass: useMutation({ mutationFn: ({ id, photos }: { id: string; photos: string[] }) => api.passCollection(id, photos), onSettled: invalidate }),
    fail: useMutation({ mutationFn: ({ id, problems, note, photos }: { id: string; problems: CollectionProblem[]; note: string; photos: string[] }) => api.failCollection(id, problems, note, photos), onSettled: invalidate }),
    refuse: useMutation({ mutationFn: ({ id, pin, reason, note, photo }: { id: string; pin: string; reason: RefusalReason; note: string; photo: string }) => api.refuseDelivery(id, pin, reason, note, photo), onSettled: invalidate }),
    finishReturn: useMutation({ mutationFn: ({ id, photo }: { id: string; photo: string }) => api.completeReturn(id, photo), onSettled: invalidate }),
  }
}

export function useSetDeliveryPrice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ areaA, areaB, priceKobo }: { areaA: string; areaB: string; priceKobo: Kobo }) => api.setDeliveryPrice(areaA, areaB, priceKobo),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.deliveryPricing }),
  })
}

export function useSetDeliverySizeExtra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ size, extraKobo }: { size: PackageSize; extraKobo: Kobo }) => api.setDeliverySizeExtra(size, extraKobo),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.deliveryPricing }),
  })
}

export function useTeamActions() {
  const invalidate = useInvalidateAll()
  return {
    invite: useMutation({ mutationFn: ({ email, role }: { email: string; role: StoreRole }) => api.inviteStoreMember(email, role), onSettled: invalidate }),
    revoke: useMutation({ mutationFn: (id: string) => api.revokeStoreInvite(id), onSettled: invalidate }),
    setRole: useMutation({ mutationFn: ({ userId, role }: { userId: string; role: StoreRole }) => api.setStoreMemberRole(userId, role), onSettled: invalidate }),
    remove: useMutation({ mutationFn: (userId: string) => api.removeStoreMember(userId), onSettled: invalidate }),
  }
}

export const useAcceptStoreInvite = () => useMutation({ mutationFn: (id: string) => api.acceptStoreInvite(id) })

export function useCreateProductsBulk() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ items, onProgress }: { items: NewProductInput[]; onProgress?: (done: number, total: number) => void }) => api.createProductsBulk(items, onProgress),
    onSettled: invalidate,
  })
}

export function useDiscountActions() {
  const invalidate = useInvalidateAll()
  return {
    create: useMutation({ mutationFn: (input: DiscountInput) => api.createDiscount(input), onSettled: invalidate }),
    end: useMutation({ mutationFn: (id: string) => api.endDiscount(id), onSettled: invalidate }),
  }
}

export const useCheckDiscountCode = () => useMutation({ mutationFn: ({ code, listingIds }: { code: string; listingIds: string[] }) => api.checkDiscountCode(code, listingIds) })

export function useQuickReplyActions() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: keys.quickReplies })
  return {
    save: useMutation({ mutationFn: (input: { id?: string; body: string }) => api.saveQuickReply(input), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api.deleteQuickReply(id), onSuccess: refresh }),
  }
}

export function useSendSupportMessage() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (body: string) => api.sendSupportMessage(body), onSuccess: () => qc.invalidateQueries({ queryKey: keys.supportThread }) })
}

export function useReplySupport(merchantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => api.replySupport(merchantId, body),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.supportMessages(merchantId) }), qc.invalidateQueries({ queryKey: keys.supportInbox })]),
  })
}

export function useMarkSupportRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (merchantId: string | undefined) => api.markSupportRead(merchantId),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.supportThread }), qc.invalidateQueries({ queryKey: keys.supportInbox })]),
  })
}

export function useSetSupportResolved() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ merchantId, resolved }: { merchantId: string; resolved: boolean }) => api.setSupportResolved(merchantId, resolved),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.supportInbox }),
  })
}

export function useReviewActions() {
  const invalidate = useInvalidateAll()
  return {
    submit: useMutation({ mutationFn: ({ orderId, input }: { orderId: string; input: ReviewInput }) => api.submitReview(orderId, input), onSettled: invalidate }),
    reply: useMutation({ mutationFn: ({ id, reply }: { id: string; reply: string }) => api.replyToReview(id, reply), onSettled: invalidate }),
    hide: useMutation({ mutationFn: ({ id, hidden, reason }: { id: string; hidden: boolean; reason: string }) => api.setReviewHidden(id, hidden, reason), onSettled: invalidate }),
  }
}

export function useUpdateShopProfile() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (input: ShopProfileInput) => api.updateShopProfile(input), onSettled: invalidate })
}

export function useSaveShopPickup() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (input: ShopPickup) => api.saveShopPickup(input), onSettled: invalidate })
}

export function useSellerConfirmOrder() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ id, photo }: { id: string; photo: string }) => api.sellerConfirmOrder(id, photo), onSettled: invalidate })
}

export function useLiftSuspension() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (merchantId: string) => api.liftSuspension(merchantId), onSettled: invalidate })
}

export function useClaimActions() {
  const invalidate = useInvalidateAll()
  return {
    open: useMutation({ mutationFn: ({ id, input }: { id: string; input: ClaimInput }) => api.openClaim(id, input), onSettled: invalidate }),
    rebook: useMutation({ mutationFn: ({ id, choice }: { id: string; choice: { windowStart: string } | { pickupPointId: string } }) => api.chooseRedelivery(id, choice), onSettled: invalidate }),
    contest: useMutation({ mutationFn: ({ id, note }: { id: string; note: string }) => api.contestFailure(id, note), onSettled: invalidate }),
    review: useMutation({ mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note: string }) => api.reviewClaim(id, approve, note), onSettled: invalidate }),
  }
}

export function useReturnActions() {
  const invalidate = useInvalidateAll()
  return {
    take: useMutation({ mutationFn: (id: string) => api.takeReturn(id), onSettled: invalidate }),
    release: useMutation({ mutationFn: (id: string) => api.releaseReturn(id), onSettled: invalidate }),
    pass: useMutation({ mutationFn: ({ id, photos }: { id: string; photos: string[] }) => api.passReturnPickup(id, photos), onSettled: invalidate }),
    fail: useMutation({ mutationFn: ({ id, note, photos }: { id: string; note: string; photos: string[] }) => api.failReturnPickup(id, note, photos), onSettled: invalidate }),
    finish: useMutation({ mutationFn: ({ id, photo }: { id: string; photo: string }) => api.finishReturn(id, photo), onSettled: invalidate }),
  }
}

export function useCancelOrder() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ id, reason, note }: { id: string; reason: CancelReason; note: string }) => api.cancelOrder(id, reason, note), onSettled: invalidate })
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

export function useUpdateListing() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: NewListingInput | NewProductInput }) => api.updateListing(id, input), onSettled: invalidate })
}

export function useWithdrawListing() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (id: string) => api.withdrawListing(id), onSettled: invalidate })
}

export const usePayouts = () => useQuery({ queryKey: keys.payouts, queryFn: () => api.listPayouts(), enabled: useHasShop() })
export function usePayoutAccount() {
  const hasShop = useHasShop()
  const rider = useIs('delivery')
  const enabled = hasShop || rider
  return useQuery({ queryKey: keys.payoutAccount, queryFn: () => api.getPayoutAccount(), enabled })
}
export const useRiderPayRates = () => useQuery({ queryKey: keys.riderPayRates, queryFn: () => api.getRiderPayRates(), enabled: useIs('admin') })
export const useMyEarnings = () => useQuery({ queryKey: keys.myEarnings, queryFn: () => api.listMyEarnings(), enabled: useIs('delivery') })
export const useRiderPayDue = () => useQuery({ queryKey: keys.riderPayDue, queryFn: () => api.listRiderPayDue(), enabled: useIs('admin') })

export function useRiderPayActions() {
  const invalidate = useInvalidateAll()
  return {
    setPay: useMutation({ mutationFn: ({ areaA, areaB, payKobo }: { areaA: string; areaB: string; payKobo: Kobo }) => api.setRiderPay(areaA, areaB, payKobo), onSettled: invalidate }),
    setExtra: useMutation({ mutationFn: ({ size, extraKobo }: { size: PackageSize; extraKobo: Kobo }) => api.setRiderSizeExtra(size, extraKobo), onSettled: invalidate }),
    setAttempt: useMutation({ mutationFn: (payKobo: Kobo) => api.setRiderAttemptPay(payKobo), onSettled: invalidate }),
    markPaid: useMutation({ mutationFn: ({ riderId, reference }: { riderId: string; reference: string }) => api.markRiderPaid(riderId, reference), onSettled: invalidate }),
  }
}
export const useBanks = () => useQuery({ queryKey: keys.banks, queryFn: () => api.listBanks(), staleTime: 60 * 60_000 })
export const useDuePayouts = () => useQuery({ queryKey: keys.duePayouts, queryFn: () => api.listDuePayouts(), enabled: useIs('admin') })

export function useLookupBankAccount() {
  return useMutation({ mutationFn: ({ bankCode, accountNumber }: { bankCode: string; accountNumber: string }) => api.lookupBankAccount(bankCode, accountNumber) })
}

export function useSavePayoutAccount() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ bankCode, accountNumber }: { bankCode: string; accountNumber: string }) => api.savePayoutAccount(bankCode, accountNumber), onSettled: invalidate })
}

export function useMarkPayoutsPaid() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ ids, reference }: { ids: string[]; reference: string }) => api.markPayoutsPaid(ids, reference), onSettled: invalidate })
}

export function usePauseProduct() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ id, paused }: { id: string; paused: boolean }) => (paused ? api.pauseListing(id) : api.resumeListing(id)), onSettled: invalidate })
}

export function useChangeStock() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ id, change }: { id: string; change: number }) => api.changeStock(id, change), onSettled: invalidate })
}

export function useChangePrice() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ id, priceKobo }: { id: string; priceKobo: Kobo }) => api.changePrice(id, priceKobo), onSettled: invalidate })
}

export function useReviewPriceChange() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ id, newPriceKobo, approve }: { id: string; newPriceKobo: Kobo; approve: boolean }) => api.reviewPriceChange(id, newPriceKobo, approve), onSettled: invalidate })
}

export function useResubmitListing() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: NewListingInput | NewProductInput }) => api.resubmitListing(id, input), onSettled: invalidate })
}

export function useCreateProduct() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (input: NewProductInput) => api.createProduct(input), onSettled: invalidate })
}

export function useSubmitStoreApplication() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: (input: StoreApplicationInput) => api.submitStoreApplication(input), onSettled: invalidate })
}

export function useReviewStoreApplication() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) => (approve ? api.approveStoreApplication(id) : api.rejectStoreApplication(id, note ?? '')),
    onSettled: invalidate,
  })
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
    mutationFn: (d: { id: string; approve: true; revision?: number } | { id: string; approve: false; reason: RejectionReason; note: string }) =>
      d.approve ? api.approveListing(d.id, d.revision) : api.rejectListing(d.id, d.reason, d.note),
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
