import { Link, useLocation, useSearchParams } from 'react-router'
import { pageNumbers } from '@/lib/paginate'
import { BackIcon, ChevronRightIcon } from './icons'
import { cx } from './ui'

/** Page links that keep the rest of the URL (filters, sort) and set ?page=. */
export function Pagination({ page, pages }: { page: number; pages: number }) {
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  if (pages <= 1) return null
  const href = (p: number) => {
    const next = new URLSearchParams(params)
    if (p === 1) next.delete('page')
    else next.set('page', String(p))
    const qs = next.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }
  const cell = 'flex min-h-11 min-w-11 items-center justify-center rounded-xl px-2 text-sm font-bold no-underline transition'
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-center gap-1">
      {page > 1 ? (
        <Link to={href(page - 1)} className={cx(cell, 'text-ink hover:bg-sunken')} aria-label="Previous page">
          <BackIcon size={18} />
        </Link>
      ) : null}
      {pageNumbers(page, pages).map((n, i) =>
        n === '…' ? (
          <span key={`gap-${i}`} className={cx(cell, 'text-subtle')} aria-hidden="true">
            …
          </span>
        ) : (
          <Link
            key={n}
            to={href(n)}
            aria-current={n === page ? 'page' : undefined}
            aria-label={`Page ${n}`}
            className={cx(cell, n === page ? 'bg-ink text-ground' : 'text-ink hover:bg-sunken')}
          >
            {n}
          </Link>
        ),
      )}
      {page < pages ? (
        <Link to={href(page + 1)} className={cx(cell, 'text-ink hover:bg-sunken')} aria-label="Next page">
          <ChevronRightIcon size={18} />
        </Link>
      ) : null}
    </nav>
  )
}
