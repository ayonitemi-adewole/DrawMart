/**
 * Product IDs: short and permanent, for reading out, typing and searching, e.g.
 * PRD-7K3Q9X. The database assigns them (private.new_product_code, mirrored
 * here for the mock). Listing.id stays the internal key.
 */
export const PRODUCT_CODE_PREFIX = 'PRD-'
/** No 0, O, 1, I or L, which get mixed up when read aloud or typed from a label. */
export const PRODUCT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const PRODUCT_CODE_LENGTH = 6
/** Fewer characters of an ID than this could just be part of a word. */
const MIN_PARTIAL_LENGTH = 3

export function newProductCode(random: () => number = Math.random): string {
  let code = PRODUCT_CODE_PREFIX
  for (let i = 0; i < PRODUCT_CODE_LENGTH; i++) code += PRODUCT_CODE_ALPHABET[Math.floor(random() * PRODUCT_CODE_ALPHABET.length)]
  return code
}

export const isProductCode = (s: string) => new RegExp(`^${PRODUCT_CODE_PREFIX}[${PRODUCT_CODE_ALPHABET}]{${PRODUCT_CODE_LENGTH}}$`).test(s)

/** Upper case, without spaces, dashes or the PRD prefix: how people type it varies. */
function codeCharacters(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^PRD/, '')
}

/** The whole ID or part of it, however it's typed: "prd-7k3q9x", "7K3Q9X", "q9x". */
export function matchesProductCode(code: string, query: string): boolean {
  const q = codeCharacters(query)
  return q.length >= MIN_PARTIAL_LENGTH && codeCharacters(code).includes(q)
}

/** Search for a list of products: by ID, or by any of the words shown for it. An empty search matches everything. */
export function matchesProductSearch(query: string, code: string, ...text: string[]): boolean {
  const q = query.trim().toLowerCase()
  return !q || matchesProductCode(code, q) || text.some((s) => s.toLowerCase().includes(q))
}

/** The search for a full listing, used wherever buyers browse. */
export function listingMatchesSearch(l: { productCode: string; title: string; description: string; category: string; merchant: { name: string; area: string } }, query: string): boolean {
  return matchesProductSearch(query, l.productCode, l.title, l.description, l.merchant.name, l.merchant.area, l.category)
}
