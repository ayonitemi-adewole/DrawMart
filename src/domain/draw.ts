/**
 * Provably fair draws (commit–reveal).
 *
 * 1. When a listing goes live we generate a secret `seed` and publish only
 *    `commitment = SHA-256(seed)`. Nobody can work out the seed from it.
 * 2. The purchase that sells the last ticket produces a `closingRef` that
 *    nobody (including us) could know in advance.
 * 3. winning ticket = (SHA-256(seed + ":" + closingRef) as an integer) mod N + 1
 * 4. We then reveal the seed. Anyone can check that SHA-256(seed) matches the
 *    commitment and recompute the winner.
 *
 * Changing the seed after the fact would break the commitment; the closing
 * reference stops us choosing a seed that favours a known ticket holder.
 *
 * In production the seed must be generated and stored server-side only.
 */

const encoder = new TextEncoder()

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(input))
  return toHex(new Uint8Array(digest))
}

export function randomHex(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(buf)
  return toHex(buf)
}

export function createSeed(): string {
  return randomHex(32)
}

export function commitmentFor(seed: string): Promise<string> {
  return sha256Hex(seed)
}

export async function drawHash(seed: string, closingRef: string): Promise<string> {
  return sha256Hex(`${seed}:${closingRef}`)
}

/** Ticket numbers run from 1 to ticketCount. */
export async function winningTicketNumber(seed: string, closingRef: string, ticketCount: number): Promise<number> {
  if (!Number.isInteger(ticketCount) || ticketCount < 1) throw new Error('ticketCount must be a positive integer')
  const h = await drawHash(seed, closingRef)
  return Number(BigInt('0x' + h) % BigInt(ticketCount)) + 1
}

export interface VerifyInput {
  commitment: string
  seed: string
  closingRef: string
  ticketCount: number
  claimedWinner: number
}

export interface VerifyOutcome {
  commitmentMatches: boolean
  computedWinner: number
  winnerMatches: boolean
  valid: boolean
}

/** What any member of the public can run to check a draw. */
export async function verifyDraw(input: VerifyInput): Promise<VerifyOutcome> {
  const commitmentMatches = (await commitmentFor(input.seed)) === input.commitment.toLowerCase()
  const computedWinner = await winningTicketNumber(input.seed, input.closingRef, input.ticketCount)
  const winnerMatches = computedWinner === input.claimedWinner
  return { commitmentMatches, computedWinner, winnerMatches, valid: commitmentMatches && winnerMatches }
}
