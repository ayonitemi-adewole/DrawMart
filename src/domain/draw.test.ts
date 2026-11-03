import { describe, expect, it } from 'vitest'
import { announcementDate } from './draw'
import { commitmentFor, createSeed, pickTicketNumbers, secureRandomInt, sha256Hex, verifyDraw, winningTicketNumber } from './draw'

describe('provably fair draw', () => {
  it('uses real SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('is deterministic for the same seed and reference', async () => {
    const seed = createSeed()
    const a = await winningTicketNumber(seed, 'TX-1', 200)
    const b = await winningTicketNumber(seed, 'TX-1', 200)
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(1)
    expect(a).toBeLessThanOrEqual(200)
  })

  it('changes with the closing reference', async () => {
    const seed = 'f'.repeat(64)
    const winners = new Set<number>()
    for (let i = 0; i < 20; i++) winners.add(await winningTicketNumber(seed, `TX-${i}`, 1000))
    expect(winners.size).toBeGreaterThan(15)
  })

  it('verifies an honest draw and rejects a tampered one', async () => {
    const seed = createSeed()
    const commitment = await commitmentFor(seed)
    const winner = await winningTicketNumber(seed, 'TX-ABC', 300)
    expect((await verifyDraw({ commitment, seed, closingRef: 'TX-ABC', ticketCount: 300, claimedWinner: winner })).valid).toBe(true)

    const wrongWinner = (winner % 300) + 1
    expect((await verifyDraw({ commitment, seed, closingRef: 'TX-ABC', ticketCount: 300, claimedWinner: wrongWinner })).valid).toBe(false)

    const otherSeed = createSeed()
    const swapped = await verifyDraw({ commitment, seed: otherSeed, closingRef: 'TX-ABC', ticketCount: 300, claimedWinner: winner })
    expect(swapped.commitmentMatches).toBe(false)
  })

  it('spreads winners roughly evenly', async () => {
    const seed = createSeed()
    const counts = [0, 0, 0, 0]
    for (let i = 0; i < 2000; i++) counts[(await winningTicketNumber(seed, `r${i}`, 4)) - 1]++
    for (const c of counts) expect(c).toBeGreaterThan(400)
  })

  it('rejects a zero ticket count', async () => {
    await expect(winningTicketNumber('a', 'b', 0)).rejects.toThrow()
  })
})

describe('announcementDate', () => {
  const soldOut = Date.parse('2026-11-01T12:00:00Z')
  it('is 7 days after the last ticket by default', () => {
    expect(announcementDate(soldOut, '2026-12-01T00:00:00Z')).toBe('2026-11-08T12:00:00.000Z')
  })
  it('is the deadline when that comes sooner', () => {
    expect(announcementDate(soldOut, '2026-11-03T09:00:00Z')).toBe('2026-11-03T09:00:00.000Z')
  })
})


describe('pickTicketNumbers', () => {
  it('picks distinct free numbers in range, sorted', () => {
    const taken = [2, 5, 7]
    for (let i = 0; i < 50; i++) {
      const picked = pickTicketNumbers(10, taken, 4)
      expect(picked).toHaveLength(4)
      expect(new Set(picked).size).toBe(4)
      expect([...picked].sort((a, b) => a - b)).toEqual(picked)
      for (const n of picked) {
        expect(n).toBeGreaterThanOrEqual(1)
        expect(n).toBeLessThanOrEqual(10)
        expect(taken).not.toContain(n)
      }
    }
  })

  it('isn’t sequential: the first buyer doesn’t get ticket 1', () => {
    const firsts = new Set(Array.from({ length: 40 }, () => pickTicketNumbers(1000, [], 1)[0]))
    expect(firsts.size).toBeGreaterThan(30)
    expect(pickTicketNumbers(1000, [], 5)).not.toEqual([1, 2, 3, 4, 5])
  })

  it('fills every number exactly once when selling out', () => {
    const first = pickTicketNumbers(20, [], 7)
    const rest = pickTicketNumbers(20, first, 13)
    expect([...first, ...rest].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  it('follows the random source it’s given', () => {
    expect(pickTicketNumbers(5, [], 2, () => 0)).toEqual([1, 2])
    expect(pickTicketNumbers(5, [1], 1, (n) => n - 1)).toEqual([5])
  })

  it('refuses more than are left', () => {
    expect(() => pickTicketNumbers(3, [1, 2], 2)).toThrow()
  })

  it('secureRandomInt stays in range', () => {
    for (let i = 0; i < 200; i++) {
      const n = secureRandomInt(7)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(7)
    }
  })
})
