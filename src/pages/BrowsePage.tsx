import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useListings } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { BackIcon, SearchIcon } from '@/components/icons'
import { ListingGrid } from '@/components/ListingGrid'
import { Pagination } from '@/components/Pagination'
import { EmptyState, ErrorState, PageTitle, Segmented, Skeleton, buttonClass } from '@/components/ui'
import { withSponsoredFirst } from '@/domain/boosts'
import { CATEGORIES, type Category } from '@/domain/types'
import { paginate } from '@/lib/paginate'

/** Five rows of three: the explore page's per-category cap, one page at a time. */
export const BROWSE_PAGE_SIZE = 15

type Kind = 'all' | 'draws' | 'buy'
const KINDS: Kind[] = ['all', 'draws', 'buy']

const matchesKind = (l: ListingView, k: Kind) => (k === 'draws' ? l.status === 'live' : k === 'buy' ? l.status === 'for_sale' : true)

/** Builds a /browse link. */
export function browseHref(f: { category?: Category; seller?: string; type?: Kind; q?: string }) {
  const p = new URLSearchParams()
  if (f.category) p.set('category', f.category)
  if (f.seller) p.set('seller', f.seller)
  if (f.type && f.type !== 'all') p.set('type', f.type)
  if (f.q) p.set('q', f.q)
  const qs = p.toString()
  return qs ? `/browse?${qs}` : '/browse'
}

/** /browse: every live draw and item on sale, filtered by category, seller or search, a page at a time. */
export function BrowsePage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('category')
  const category = CATEGORIES.includes(raw as Category) ? (raw as Category) : undefined
  const seller = params.get('seller') ?? undefined
  const query = (params.get('q') ?? '').trim()
  const kind: Kind = KINDS.find((k) => k === params.get('type')) ?? 'all'
  const page = Number(params.get('page') ?? '1')
  const q = useListings({ status: ['live', 'for_sale'] })

  const matching = useMemo(() => {
    const needle = query.toLowerCase()
    const list = (q.data ?? []).filter(
      (l) =>
        (!category || l.category === category) &&
        (!seller || l.merchant.id === seller) &&
        (!needle || [l.title, l.description, l.merchant.name, l.merchant.area, l.category].some((s) => s.toLowerCase().includes(needle))),
    )
    const { sponsored, rest } = withSponsoredFirst(list, Date.now())
    return [...sponsored, ...rest]
  }, [q.data, category, seller, query])
  const shown = matching.filter((l) => matchesKind(l, kind))
  const current = paginate(shown, page, BROWSE_PAGE_SIZE)

  const sellerName = seller ? q.data?.find((l) => l.merchant.id === seller)?.merchant.name : undefined
  const title = seller ? (sellerName ?? 'Seller') : category ? category : query ? `Results for “${query}”` : 'Everything on DrawMart'
  const eyebrow = seller ? (category ? `From this seller · ${category}` : 'From this seller') : category ? 'Category' : 'Browse'
  const setKind = (k: Kind) => {
    const next = new URLSearchParams(params)
    if (k === 'all') next.delete('type')
    else next.set('type', k)
    next.delete('page')
    setParams(next, { replace: true, preventScrollReset: true })
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/" className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-xl px-2 text-sm font-bold text-muted no-underline hover:bg-sunken hover:text-ink">
        <BackIcon size={18} /> Explore
      </Link>
      <PageTitle eyebrow={eyebrow} sub={q.data ? `${shown.length.toLocaleString('en-NG')} ${shown.length === 1 ? 'item' : 'items'}` : undefined}>
        {title}
      </PageTitle>
      <Segmented<Kind>
        label="Show"
        value={kind}
        onChange={setKind}
        className="w-full sm:w-auto sm:self-start"
        options={[
          { value: 'all', label: 'All', count: matching.length },
          { value: 'draws', label: 'Live draws', count: matching.filter((l) => matchesKind(l, 'draws')).length },
          { value: 'buy', label: 'Buy now', count: matching.filter((l) => matchesKind(l, 'buy')).length },
        ]}
      />
      {q.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[23rem]" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title="Nothing here right now"
          body="New draws and items go up every day. Check back soon."
          action={
            <Link to="/" className={buttonClass('outline')}>
              Back to explore
            </Link>
          }
        />
      ) : (
        <>
          <ListingGrid listings={current.items} />
          <Pagination page={current.page} pages={current.pages} />
          <p className="text-center text-xs text-subtle">
            Showing {((current.page - 1) * BROWSE_PAGE_SIZE + 1).toLocaleString('en-NG')}–
            {((current.page - 1) * BROWSE_PAGE_SIZE + current.items.length).toLocaleString('en-NG')} of {current.total.toLocaleString('en-NG')}
          </p>
        </>
      )}
    </div>
  )
}
