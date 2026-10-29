export interface Page<T> {
  items: T[]
  /** 1-based, clamped into range. */
  page: number
  pages: number
  total: number
}

/** One page of a list. Out-of-range or junk page numbers land on the nearest real page. */
export function paginate<T>(all: readonly T[], page: number, size: number): Page<T> {
  const pages = Math.max(1, Math.ceil(all.length / size))
  const p = Math.min(pages, Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1))
  return { items: all.slice((p - 1) * size, p * size), page: p, pages, total: all.length }
}

/** Page numbers to show: first, last, and two either side of the current one, with gaps as '…'. */
export function pageNumbers(page: number, pages: number): (number | '…')[] {
  const keep = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages))
  const sorted = [...keep].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  for (const n of sorted) {
    const prev = out[out.length - 1]
    if (typeof prev === 'number' && n - prev > 1) out.push(n - prev === 2 ? prev + 1 : '…')
    out.push(n)
  }
  return out
}
