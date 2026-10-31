import { describe, expect, it } from 'vitest'
import { PRODUCT_CODE_ALPHABET, isProductCode, listingMatchesSearch, matchesProductCode, matchesProductSearch, newProductCode } from './productCode'

describe('product IDs', () => {
  it('makes IDs in the right format, from characters that are hard to mix up', () => {
    for (let i = 0; i < 200; i++) expect(isProductCode(newProductCode())).toBe(true)
    expect(PRODUCT_CODE_ALPHABET).not.toMatch(/[01OIL]/)
    expect(newProductCode(() => 0)).toBe('PRD-222222')
    expect(newProductCode(() => 0.9999)).toBe('PRD-ZZZZZZ')
    for (const bad of ['PRD-7K3Q9', 'PRD-7K3Q9XX', 'prd-7K3Q9X', '7K3Q9X', 'PRD-0K3Q9X', 'DM-7K3Q9X']) expect(isProductCode(bad)).toBe(false)
  })

  it('finds an ID however it is typed', () => {
    for (const q of ['PRD-7K3Q9X', 'prd-7k3q9x', ' prd 7k3q9x ', 'PRD7K3Q9X', '7k3q9x', '7K3', 'q9x']) expect(matchesProductCode('PRD-7K3Q9X', q)).toBe(true)
  })

  it('does not treat a short word or the prefix alone as an ID', () => {
    for (const q of ['', 'PRD', 'PRD-', 'prd', '7K', '-', 'K3Z', 'PRD-7K3Q9Y']) expect(matchesProductCode('PRD-7K3Q9X', q)).toBe(false)
  })

  it('searches by ID or by the text shown', () => {
    expect(matchesProductSearch('', 'PRD-7K3Q9X', 'Lamp')).toBe(true)
    expect(matchesProductSearch('  ', 'PRD-7K3Q9X', 'Lamp')).toBe(true)
    expect(matchesProductSearch('prd-7k3q9x', 'PRD-7K3Q9X', 'Lamp')).toBe(true)
    expect(matchesProductSearch('LAM', 'PRD-7K3Q9X', 'Lamp')).toBe(true)
    expect(matchesProductSearch('chair', 'PRD-7K3Q9X', 'Lamp', 'Ikeja')).toBe(false)
    expect(matchesProductSearch('ikeja', 'PRD-7K3Q9X', 'Lamp', 'Ikeja')).toBe(true)
  })

  it('searches a whole listing', () => {
    const l = { productCode: 'PRD-7K3Q9X', title: 'Phone', description: 'Boxed', category: 'Phones', merchant: { name: 'Ikeja Gadgets', area: 'Ikeja' } }
    for (const q of ['7k3q9x', 'phone', 'boxed', 'ikeja', 'gadgets']) expect(listingMatchesSearch(l, q)).toBe(true)
    expect(listingMatchesSearch(l, 'laptop')).toBe(false)
  })
})
