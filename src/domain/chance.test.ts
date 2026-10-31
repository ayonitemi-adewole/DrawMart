import { describe, expect, it } from 'vitest'
import { chancePercentText, chanceText, percentSold } from './chance'

describe('chanceText', () => {
  it('says the chance plainly, without reducing the fraction', () => {
    expect(chanceText(1, 520)).toBe('1 in 520')
    expect(chanceText(5, 520)).toBe('5 in 520')
    expect(chanceText(10, 500)).toBe('10 in 500')
  })

  it('groups thousands', () => {
    expect(chanceText(1, 2400)).toBe('1 in 2,400')
    expect(chanceText(1200, 2400)).toBe('1,200 in 2,400')
  })

  it('never claims more tickets than exist', () => {
    expect(chanceText(3, 2)).toBe('2 in 2')
  })
})

describe('chancePercentText', () => {
  it('uses two decimals under 1% and one above', () => {
    expect(chancePercentText(1, 520)).toBe('0.19%')
    expect(chancePercentText(5, 100)).toBe('5.0%')
  })

  it('doesn’t round a tiny chance down to nothing', () => {
    expect(chancePercentText(1, 100_000)).toBe('<0.01%')
  })

  it('copes with a listing that has no tickets', () => {
    expect(chancePercentText(1, 0)).toBe('0.00%')
  })
})

describe('percentSold', () => {
  it('rounds down, so a draw with tickets left is never 100%', () => {
    expect(percentSold(999, 1000)).toBe(99)
    expect(percentSold(1000, 1000)).toBe(100)
    expect(percentSold(1, 520)).toBe(0)
    expect(percentSold(241, 260)).toBe(92)
  })

  it('is 0 for a product, which has no tickets', () => {
    expect(percentSold(0, 0)).toBe(0)
  })
})
