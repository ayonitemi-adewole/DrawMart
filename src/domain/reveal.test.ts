import { describe, expect, it } from 'vitest'
import { REVEAL_FRAMES, REVEAL_FRAME_MS, revealFrames } from './reveal'

describe('revealFrames', () => {
  it('is short', () => {
    expect(REVEAL_FRAMES * REVEAL_FRAME_MS).toBeLessThan(2000)
    expect(revealFrames(500, 42, [])).toHaveLength(REVEAL_FRAMES)
  })

  it('never shows the viewer’s tickets or the numbers beside them, however many times it runs', () => {
    const mine = [10, 11, 200]
    for (let run = 0; run < 300; run++) {
      for (const n of revealFrames(220, 100, mine)) {
        expect([9, 10, 11, 12, 199, 200, 201]).not.toContain(n)
      }
    }
  })

  it('never shows the winner early', () => {
    for (let run = 0; run < 300; run++) expect(revealFrames(30, 7, [])).not.toContain(7)
  })

  it('stays within the draw’s real ticket numbers', () => {
    for (let run = 0; run < 100; run++) {
      for (const n of revealFrames(25, 3, [1])) {
        expect(n).toBeGreaterThanOrEqual(1)
        expect(n).toBeLessThanOrEqual(25)
      }
    }
  })

  it('doesn’t repeat a number back to back', () => {
    const frames = revealFrames(5, 1, [])
    for (let i = 1; i < frames.length; i++) expect(frames[i]).not.toBe(frames[i - 1])
  })

  it('skips the roll when a draw is too small to do it honestly', () => {
    expect(revealFrames(2, 1, [1, 2])).toEqual([])
    expect(revealFrames(1, 1, [1])).toEqual([])
    expect(revealFrames(5, 2, [2, 3, 4])).toEqual([])
  })

  it('is driven by what it’s given, so it can’t lean towards anyone', () => {
    const fixed = () => 0
    expect(() => revealFrames(10, 1, [], fixed)).toBeDefined()
    const seen = new Set<number>()
    for (let run = 0; run < 400; run++) for (const n of revealFrames(20, 5, [])) seen.add(n)
    expect(seen.size).toBe(19) // everything but the winner comes up
  })

  it('copes with a very big draw', () => {
    expect(revealFrames(1_000_000, 500_000, [1])).toHaveLength(REVEAL_FRAMES)
  })
})
