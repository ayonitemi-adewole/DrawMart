import { describe, expect, it } from 'vitest'
import { commitmentFor, winningTicketNumber } from './draw'
import { PRACTICE, drawPractice, practiceNumbers, startPractice } from './practice'
import { RULES, consolationCredit } from './rules'

describe('practice draw', () => {
  it('publishes the commitment of its seed, like a real draw', async () => {
    const game = await startPractice()
    expect(game.commitment).toBe(await commitmentFor(game.seed))
    expect(game.commitment).not.toContain(game.seed)
  })

  it('numbers your tickets after the ones already gone, and limits how many', () => {
    expect(practiceNumbers(3)).toEqual([9, 10, 11])
    expect(() => practiceNumbers(0)).toThrow()
    expect(() => practiceNumbers(PRACTICE.maxTickets + 1)).toThrow()
    expect(() => practiceNumbers(1.5)).toThrow()
    expect(PRACTICE.soldBefore + PRACTICE.maxTickets).toBeLessThan(PRACTICE.ticketCount)
  })

  it('uses the real draw maths, and the result checks out', async () => {
    const game = await startPractice()
    const r = await drawPractice(game, 2)
    expect(r.winningNumber).toBe(await winningTicketNumber(game.seed, r.closingRef, PRACTICE.ticketCount))
    expect(r.check.valid).toBe(true)
    expect(r.won).toBe(practiceNumbers(2).includes(r.winningNumber))
  })

  it('can come out either way, with no thumb on the scale', async () => {
    // 5 tickets in 20 wins a quarter of the time, so about 100 of these. Far outside this range would be a bug.
    const results = await Promise.all(Array.from({ length: 400 }, async () => drawPractice(await startPractice(), PRACTICE.maxTickets)))
    const wins = results.filter((r) => r.won).length
    expect(wins).toBeGreaterThan(60)
    expect(wins).toBeLessThan(140)
    // Every ticket number can come up, not just the buyer's.
    expect(new Set(results.map((r) => r.winningNumber)).size).toBe(PRACTICE.ticketCount)
  })

  it('works out what a real draw would pay a loser, and nothing for a winner', async () => {
    const results = await Promise.all(Array.from({ length: 100 }, async () => drawPractice(await startPractice(), 3)))
    const spent = 3 * PRACTICE.ticketPriceKobo
    for (const r of results) {
      expect(r.spentKobo).toBe(spent)
      expect(r.wouldBeCreditKobo).toBe(r.won ? 0 : consolationCredit(spent))
    }
    expect(consolationCredit(spent)).toBe((spent * RULES.consolationCreditBps) / 10_000)
  })

  it('never reaches the backend: neither the page nor this module imports the API', () => {
    const sources = import.meta.glob(['/src/pages/PracticePage.tsx', '/src/domain/practice.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(sources)).toHaveLength(2)
    for (const source of Object.values(sources)) expect(source).not.toMatch(/@\/api|from ['"].*\/api/)
  })
})
