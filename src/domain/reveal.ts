/**
 * The short roll of ticket numbers before a draw's result appears. It's decoration:
 * the result is already fixed, and always comes from the real draw.
 *
 * It must never suggest a buyer nearly won, since near-misses encourage problem
 * gambling. So it never shows the viewer's own tickets or the numbers next to them,
 * or the winner before its moment, and it keeps a steady pace rather than slowing
 * to a stop like a slot machine.
 */
export const REVEAL_FRAMES = 18
export const REVEAL_FRAME_MS = 70

/** The numbers to flash before landing on the winner. Empty if a draw is too small to roll without near-misses. */
export function revealFrames(ticketCount: number, winningNumber: number, myNumbers: readonly number[], random: () => number = Math.random): number[] {
  const avoid = new Set<number>([winningNumber])
  for (const n of myNumbers) for (const near of [n - 1, n, n + 1]) avoid.add(near)
  const pool: number[] = []
  for (let n = 1; n <= ticketCount && pool.length < 5000; n++) if (!avoid.has(n)) pool.push(n)
  if (pool.length < 2) return []

  const frames: number[] = []
  while (frames.length < REVEAL_FRAMES) {
    const next = pool[Math.floor(random() * pool.length)]
    // The same number twice in a row looks stuck.
    if (next !== frames[frames.length - 1]) frames.push(next)
  }
  return frames
}
