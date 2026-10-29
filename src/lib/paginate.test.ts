import { describe, expect, it } from 'vitest'
import { pageNumbers, paginate } from './paginate'

const list = Array.from({ length: 32 }, (_, i) => i + 1)

describe('paginate', () => {
  it('slices one page and clamps the page number', () => {
    expect(paginate(list, 1, 15)).toMatchObject({ items: list.slice(0, 15), page: 1, pages: 3, total: 32 })
    expect(paginate(list, 3, 15).items).toEqual([31, 32])
    expect(paginate(list, 9, 15).page).toBe(3)
    expect(paginate(list, 0, 15).page).toBe(1)
    expect(paginate(list, Number.NaN, 15).page).toBe(1)
    expect(paginate([], 1, 15)).toMatchObject({ items: [], page: 1, pages: 1 })
  })

  it('shows first, last and nearby pages, with gaps', () => {
    expect(pageNumbers(1, 1)).toEqual([1])
    expect(pageNumbers(1, 4)).toEqual([1, 2, 3, 4])
    expect(pageNumbers(1, 10)).toEqual([1, 2, 3, '…', 10])
    expect(pageNumbers(6, 12)).toEqual([1, '…', 4, 5, 6, 7, 8, '…', 12])
    expect(pageNumbers(5, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, '…', 10]) // a one-page gap shows the page itself
  })
})
