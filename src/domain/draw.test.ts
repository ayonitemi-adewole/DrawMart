import { describe, expect, it } from 'vitest'
import { commitmentFor, createSeed, sha256Hex, verifyDraw, winningTicketNumber } from './draw'

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
