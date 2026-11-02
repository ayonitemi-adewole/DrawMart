/**
 * The seller help centre's answers, in one place. Numbers come from the rules
 * themselves, so the answers stay right when a rule changes. Never state the
 * platform fee as a percentage: sellers only ever see it in naira.
 */
import { CLAIM_WINDOW_HOURS, CONTEST_WINDOW_DAYS } from './claims'
import { COLLECTION_CHECKS, FAILURE_CHARGE_KOBO, SUSPEND_AFTER_FAILURES } from './deliveryChecks'
import { MAX_VIDEO_SECONDS, NEW_SELLER } from './listingChecks'
import { formatNaira } from './money'
import { CONFIRM_DAY_ENDS, CONFIRM_DAY_STARTS, CONFIRM_HOURS } from './orderConfirm'
import { PAYOUT_ACCOUNT_HOLD_HOURS } from './payouts'
import { REVIEWS_SHOWN_FROM } from './reviews'
import { RULES } from './rules'
import type { MerchantKind } from './types'

export interface HelpTopic {
  id: string
  title: string
  /** Draws are for stores only. */
  storesOnly?: boolean
  /** New-seller limits are for individual sellers only. */
  individualsOnly?: boolean
  answers: { q: string; a: string }[]
}

const hour = (h: number) => (h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`)

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: 'fees',
    title: 'Fees',
    answers: [
      {
        q: 'How is the platform fee worked out?',
        a: 'DrawMart sets it from the item’s price, and it comes out of your payout. You see it in naira, with what you’ll get, before you send a listing. It’s never added to what the buyer pays.',
      },
      { q: 'Who pays for delivery?', a: 'The buyer, at checkout. It’s never taken from your payout.' },
    ],
  },
  {
    id: 'listings',
    title: 'Listings and reviews by DrawMart',
    answers: [
      {
        q: 'Why was my listing rejected?',
        a: 'The reason and any note from the reviewer are on the listing. The usual ones are unclear photos, a price that looks wrong, or an item DrawMart doesn’t allow. Tap “Fix and resend” and it goes back for review.',
      },
      {
        q: 'Why do I have to record a video?',
        a: `To show you have the item. It’s up to ${MAX_VIDEO_SECONDS} seconds, recorded live with the code on screen, and only DrawMart’s review team sees it.`,
      },
    ],
  },
  {
    id: 'new-sellers',
    title: 'New sellers',
    individualsOnly: true,
    answers: [
      {
        q: 'Is there a limit on what I can list?',
        a: `Until you’ve had ${NEW_SELLER.deliveriesNeeded} deliveries, each item can be up to ${formatNaira(NEW_SELLER.maxPriceKobo)} and you can have ${NEW_SELLER.maxLive} on sale at once. The limits go once you’ve delivered ${NEW_SELLER.deliveriesNeeded}.`,
      },
    ],
  },
  {
    id: 'orders',
    title: 'Orders',
    answers: [
      {
        q: 'How long do I have to confirm an order?',
        a: `${CONFIRM_HOURS} hours, counted only between ${hour(CONFIRM_DAY_STARTS)} and ${hour(CONFIRM_DAY_ENDS)} Lagos time. Confirm with a fresh photo taken on your phone. If you don’t, the order is cancelled, the buyer is refunded and the product is paused.`,
      },
      {
        q: 'What does the rider check when they collect?',
        a: `${COLLECTION_CHECKS.join(', ')}. If it fails, the buyer is refunded and ${formatNaira(FAILURE_CHARGE_KOBO)} comes off your next payout. ${SUSPEND_AFTER_FAILURES} failures in 30 days suspend your shop.`,
      },
      {
        q: 'I think a failed check was wrong. What can I do?',
        a: `Tap “I don’t think this is right” on the order, within ${CONTEST_WINDOW_DAYS} days. If DrawMart agrees, the charge is taken back and it doesn’t count against your shop.`,
      },
    ],
  },
  {
    id: 'returns',
    title: 'Returns and claims',
    answers: [
      {
        q: 'Can a buyer return an item?',
        a: `Within ${CLAIM_WINDOW_HOURS} hours of delivery. If it’s faulty, DrawMart checks first. If they changed their mind, they pay a return fee and you get a share of what’s left after the return trip. Either way, a rider brings the item back to you.`,
      },
    ],
  },
  {
    id: 'payouts',
    title: 'Payouts',
    answers: [
      {
        q: 'When am I paid?',
        a: `Each sale has its own payout line: waiting, then due, then paid. A sale is due ${CLAIM_WINDOW_HOURS} hours after delivery, as long as the buyer hasn’t reported a problem, and DrawMart pays what’s due to your bank account.`,
      },
      {
        q: 'Why are my payouts on hold?',
        a: `Changing your bank account holds payouts for ${PAYOUT_ACCOUNT_HOLD_HOURS} hours, so nobody else can redirect your money without you finding out first.`,
      },
    ],
  },
  {
    id: 'draws',
    title: 'Draws',
    storesOnly: true,
    answers: [
      {
        q: 'What is the caution fee?',
        a: 'You pay it when you send a draw for review. It comes back with your payout if the draw sells out, and is kept to cover the pickup and return if it doesn’t, or if the draw is rejected.',
      },
      {
        q: 'When is the item collected?',
        a: 'On the day and time you booked when you sent the draw. You can change the listing while it’s in review, up to the day before.',
      },
      {
        q: 'When is the winner announced?',
        a: `Not at sell-out: on the draw’s closing date, or ${RULES.maxDrawWaitDays} days after the last ticket, whichever is sooner. You’re paid once the winner has the item.`,
      },
    ],
  },
  {
    id: 'reviews',
    title: 'Ratings',
    answers: [
      {
        q: 'How do ratings work?',
        a: `Buyers rate you after delivery. Your rating shows to buyers once you have ${REVIEWS_SHOWN_FROM} reviews, and you can reply to each review once.`,
      },
    ],
  },
]

export function helpTopics(kind: MerchantKind): HelpTopic[] {
  const individual = kind === 'individual'
  return HELP_TOPICS.filter((t) => !(t.storesOnly && individual) && !(t.individualsOnly && !individual))
}
