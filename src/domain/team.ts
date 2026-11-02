/**
 * A store's team: the owner invites staff by email with a role. Individual sellers have no
 * team; they count as owners of their own shop. Mirrored in supabase/migrations/…_store_teams.sql
 * (private.require_shop_permission).
 */

export type StoreRole = 'owner' | 'manager' | 'orders'

export const STORE_ROLES: readonly StoreRole[] = ['owner', 'manager', 'orders']

export const ROLE_TEXT: Record<StoreRole, { label: string; sub: string }> = {
  owner: { label: 'Owner', sub: 'Everything, including the bank account and the team.' },
  manager: { label: 'Manager', sub: 'Listings, orders, discounts, boosts, the shop page and payouts, but not the bank account or the team.' },
  orders: { label: 'Orders only', sub: 'Confirms and sends orders, and answers messages.' },
}

/**
 * What a role can do:
 * - orders: confirm and send orders, messages, quick replies, help, notifications. Everyone.
 * - shop: listings, discounts, boosts, the shop page, reviews, insights, payouts (to view), cancelling and contesting orders.
 * - bank: the payout bank account.
 * - team: inviting, changing and removing people, and the activity log.
 */
export type ShopPermission = 'orders' | 'shop' | 'bank' | 'team'

/** Null means not on a store's team (an individual seller, or a store account from before teams): the owner. */
export function canDo(role: StoreRole | null, perm: ShopPermission): boolean {
  const r = role ?? 'owner'
  if (perm === 'orders') return true
  if (perm === 'shop') return r === 'owner' || r === 'manager'
  return r === 'owner'
}

export const MAX_TEAM = 20
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function inviteError(email: string, role: StoreRole | null): string | null {
  if (!EMAIL.test(email.trim())) return 'Enter their email address.'
  if (!role || !STORE_ROLES.includes(role)) return 'Choose a role.'
  return null
}

/** A store always keeps an owner. */
export function lastOwnerError(members: readonly { userId: string; role: StoreRole }[], userId: string, newRole: StoreRole | null): string | null {
  const owners = members.filter((m) => m.role === 'owner')
  const leaving = owners.some((m) => m.userId === userId) && newRole !== 'owner'
  return leaving && owners.length === 1 ? 'Your store needs at least one owner. Make someone else an owner first.' : null
}

export const ACTIVITY_TEXT: Record<string, string> = {
  listed: 'listed',
  edited: 'edited',
  repriced: 'changed the price of',
  restocked: 'changed the stock of',
  paused: 'paused',
  resumed: 'put back on sale',
  withdrew: 'withdrew',
  confirmed: 'confirmed an order for',
  dispatched: 'marked ready for a rider',
  cancelled: 'cancelled an order for',
}
