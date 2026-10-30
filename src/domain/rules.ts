import { applyBps, formatNaira } from './money'
import type { Kobo, LedgerEntry, Listing, User, WalletBalance } from './types'

/** Platform-wide settings. These will move to the backend/admin later. */
export const RULES = {
  /** States where we hold a licence and may sell tickets. */
  licensedStates: ['Lagos'] as readonly string[],
  maxTicketsPerUserPerListing: 20,
  /** Share of a losing buyer's spend returned as store credit, in bps. */
  consolationCreditBps: 2000,
  defaultWeeklyLimitKobo: 50_000_00,
  /** Raising a weekly limit only takes effect after this delay. */
  limitIncreaseDelayHours: 24,
  /** Draws run for a store-chosen number of days, counted from approval. */
  minDurationDays: 3,
  maxDurationDays: 60,
  durationPresetsDays: [7, 14, 30] as const,
  extensionDays: 7,
  /** How far ahead a pickup or inspection can be booked. */
  handoverMinLeadDays: 1,
  handoverMaxLeadDays: 14,
  /** Items a store can send in one pickup. */
  maxPickupItems: 10,
  /** Longest wait between the last ticket selling and the winner being announced. */
  maxDrawWaitDays: 7,
  /** How long a store can keep items saved for a pickup, from the first save. */
  savedPickupDays: 7,
  /** Size of one wallet top-up. */
  minTopUpKobo: 100_00,
  maxTopUpKobo: 500_000_00,
}

export function balanceFromLedger(entries: LedgerEntry[]): WalletBalance {
  return entries.reduce<WalletBalance>(
    (acc, e) => ({ cashKobo: acc.cashKobo + e.cashKobo, creditKobo: acc.creditKobo + e.creditKobo }),
    { cashKobo: 0, creditKobo: 0 },
  )
}

/** Why a top-up amount isn't allowed, or null if it is. */
export function topUpError(amountKobo: Kobo): string | null {
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) return 'Enter an amount to add.'
  if (amountKobo < RULES.minTopUpKobo) return `The smallest top-up is ${formatNaira(RULES.minTopUpKobo)}.`
  if (amountKobo > RULES.maxTopUpKobo) return `The largest single top-up is ${formatNaira(RULES.maxTopUpKobo)}.`
  return null
}

/** Ticket spend in the 7 days up to `now`, net of refunds. */
export function spentInLastWeek(entries: LedgerEntry[], now: Date): Kobo {
  const since = now.getTime() - 7 * 24 * 60 * 60 * 1000
  return entries
    .filter((e) => (e.kind === 'ticket_purchase' || e.kind === 'refund') && new Date(e.createdAt).getTime() >= since)
    .reduce((sum, e) => sum - (e.cashKobo + e.creditKobo), 0)
}

/** Store credit is spent before cash. */
export function splitPayment(cost: Kobo, balance: WalletBalance): { fromCredit: Kobo; fromCash: Kobo } {
  const fromCredit = Math.min(balance.creditKobo, cost)
  return { fromCredit, fromCash: cost - fromCredit }
}

export type PurchaseError =
  | 'not_live'
  | 'invalid_quantity'
  | 'sold_out'
  | 'not_enough_tickets_left'
  | 'per_user_limit'
  | 'weekly_limit'
  | 'insufficient_funds'
  | 'state_not_licensed'
  | 'age_not_verified'

/** The listing fields purchase rules depend on. */
export type PurchasableListing = Pick<Listing, 'status' | 'ticketCount' | 'ticketsSold' | 'buyerTicketPriceKobo'>

export interface PurchaseCheckInput {
  user: User
  listing: PurchasableListing
  quantity: number
  ticketsAlreadyHeld: number
  balance: WalletBalance
  spentThisWeekKobo: Kobo
}

/** Returns the first rule a purchase breaks, or null if it's allowed. */
export function checkPurchase(i: PurchaseCheckInput): PurchaseError | null {
  if (!RULES.licensedStates.includes(i.user.state)) return 'state_not_licensed'
  if (!i.user.ageVerified) return 'age_not_verified'
  if (i.listing.status !== 'live') return 'not_live'
  if (!Number.isInteger(i.quantity) || i.quantity < 1) return 'invalid_quantity'
  const left = i.listing.ticketCount - i.listing.ticketsSold
  if (left <= 0) return 'sold_out'
  if (i.quantity > left) return 'not_enough_tickets_left'
  if (i.ticketsAlreadyHeld + i.quantity > RULES.maxTicketsPerUserPerListing) return 'per_user_limit'
  const cost = i.quantity * i.listing.buyerTicketPriceKobo
  if (i.spentThisWeekKobo + cost > i.user.weeklyLimitKobo) return 'weekly_limit'
  if (i.balance.cashKobo + i.balance.creditKobo < cost) return 'insufficient_funds'
  return null
}

export const PURCHASE_ERROR_TEXT: Record<PurchaseError, string> = {
  not_live: 'This draw isn’t taking tickets right now.',
  invalid_quantity: 'Choose at least one ticket.',
  sold_out: 'Sold out. The draw is about to run.',
  not_enough_tickets_left: 'There aren’t that many tickets left.',
  per_user_limit: `You can hold at most ${RULES.maxTicketsPerUserPerListing} tickets in one draw.`,
  weekly_limit: 'This would go over your weekly spending limit.',
  insufficient_funds: 'Not enough in your wallet. Top up to continue.',
  state_not_licensed: 'DrawMart is only available to Lagos residents for now.',
  age_not_verified: 'Verify your age (18+) before buying tickets.',
}

/** Largest quantity a user could buy right now, ignoring wallet balance. */
export function maxPurchasable(listing: PurchasableListing, ticketsAlreadyHeld: number): number {
  return Math.max(0, Math.min(RULES.maxTicketsPerUserPerListing - ticketsAlreadyHeld, listing.ticketCount - listing.ticketsSold))
}

export function consolationCredit(spentKobo: Kobo): Kobo {
  return applyBps(spentKobo, RULES.consolationCreditBps)
}
