import { commitmentFor, createSeed, randomHex, verifyDraw, winningTicketNumber, type VerifyOutcome } from './draw'
import { nairaToKobo } from './money'
import { consolationCredit } from './rules'
import type { Kobo } from './types'

/**
 * A pretend draw that runs the real draw maths in the browser. Nothing here is
 * saved or sent anywhere: no wallet, no ledger, no prize and no credit. The credit
 * it works out is only ever shown as what a real draw would have paid.
 */
export const PRACTICE = {
  ticketCount: 20,
  ticketPriceKobo: nairaToKobo(1000),
  maxTickets: 12,
  /** Pretend tickets already gone when you arrive, so yours are numbered after them. */
  soldBefore: 8,
} as const

export interface PracticeGame {
  seed: string
  /** Shown before any ticket is sold, as in a real draw. */
  commitment: string
}

export interface PracticeResult {
  closingRef: string
  winningNumber: number
  won: boolean
  spentKobo: Kobo
  /** What a real draw would have paid as store credit. Never actually given. */
  wouldBeCreditKobo: Kobo
  check: VerifyOutcome
}

export async function startPractice(): Promise<PracticeGame> {
  const seed = createSeed()
  return { seed, commitment: await commitmentFor(seed) }
}

/** Ticket numbers run in order of sale, so yours follow the ones already gone. */
export function practiceNumbers(quantity: number): number[] {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > PRACTICE.maxTickets) throw new Error('Pick 1 to 12 practice tickets')
  return Array.from({ length: quantity }, (_, i) => PRACTICE.soldBefore + i + 1)
}

/** Runs once the last pretend ticket has gone, with a closing reference nobody could know in advance. */
export async function drawPractice(game: PracticeGame, quantity: number): Promise<PracticeResult> {
  const mine = practiceNumbers(quantity)
  const closingRef = `PRACTICE-${randomHex(3).toUpperCase()}`
  const winningNumber = await winningTicketNumber(game.seed, closingRef, PRACTICE.ticketCount)
  const won = mine.includes(winningNumber)
  const spentKobo = quantity * PRACTICE.ticketPriceKobo
  return {
    closingRef,
    winningNumber,
    won,
    spentKobo,
    wouldBeCreditKobo: won ? 0 : consolationCredit(spentKobo),
    check: await verifyDraw({ commitment: game.commitment, seed: game.seed, closingRef, ticketCount: PRACTICE.ticketCount, claimedWinner: winningNumber }),
  }
}
