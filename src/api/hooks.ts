import type { ClaimInput } from './types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { ShopPickup } from '@/domain/shopPickup'
import type { ShopProfileInput } from '@/domain/shopProfile'
import type { CancelReason, CollectionProblem, Kobo, PackageSize, RefusalReason, RejectionReason } from '@/domain/types'
import { api } from './index'
import type { MetricRange } from '@/domain/metrics'
import type { SellerApplicationInput } from '@/domain/sellers'
import { visitorId } from '@/lib/visitor'
import { pushDeviceState, subscribeThisDevice, unsubscribeThisDevice } from '@/lib/push'
import type { NotificationPreference } from '@/domain/push'
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
  priceReviews: ['price-reviews'] as const,
  cancelRates: ['cancel-rates'] as const,
  deliveryPricing: ['delivery-pricing'] as const,
  shopPickup: ['shop-pickup'] as const,
  shop: (id: string) => ['shop', id] as const,
  cacNumber: (id: string) => ['cac-number', id] as const,
  openClaims: ['open-claims'] as const,
  listingCheckPlan: ['listing-check-plan'] as const,
  listingCheck: (id: string) => ['listing-check', id] as const,
  returnJobs: ['return-jobs'] as const,
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
  return role === 'buyer' || role === 'store'
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
export const useReturnJobs = () => useQuery({ queryKey: keys.returnJobs, queryFn: () => api.listReturnJobs(), enabled: useIs('delivery'), refetchInterval: 30_000 })
export const useShop = (id: string) => useQuery({ queryKey: keys.shop(id), queryFn: () => api.getShop(id), enabled: !!id })
export const useMerchantCacNumber = (id: string | null) => useQuery({ queryKey: keys.cacNumber(id ?? ''), queryFn: () => api.getMerchantCacNumber(id!), enabled: !!id, staleTime: Infinity })
export const useMerchant = () => useQuery({ queryKey: keys.merchant, queryFn: () => api.getMyMerchant(), enabled: useHasShop() })
export const useMerchantListings = () =>
  useQuery({ queryKey: keys.merchantListings, queryFn: () => api.listMerchantListings(), enabled: useHasShop() })
export const useMyOrders = () => useQuery({ queryKey: keys.myOrders, queryFn: () => api.listMyOrders(), enabled: useIs('buyer') })
export const useMerchantOrders = () => useQuery({ queryKey: keys.merchantOrders, queryFn: () => api.listMerchantOrders(), enabled: useHasShop() })
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
export const useDeliveryJobs = () => useQuery({ queryKey: keys.deliveryJobs, queryFn: () => api.listDeliveryJobs(), enabled: useIs('delivery'), refetchInterval: 30_000 })

export function useDeliveryActions() {
  const invalidate = useInvalidateAll()
  return {
    take: useMutation({ mutationFn: (orderId: string) => api.takeDelivery(orderId), onSettled: invalidate }),
    release: useMutation({ mutationFn: (orderId: string) => api.releaseDelivery(orderId), onSettled: invalidate }),
    confirm: useMutation({ mutationFn: ({ id, pin }: { id: string; pin: string }) => api.confirmDelivery(id, pin), onSettled: invalidate }),
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
export const usePayoutAccount = () => useQuery({ queryKey: keys.payoutAccount, queryFn: () => api.getPayoutAccount(), enabled: useHasShop() })
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
