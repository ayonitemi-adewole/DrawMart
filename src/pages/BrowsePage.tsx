import { useMemo } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { useListings } from '@/api/hooks'
import type { ListingView } from '@/api/types'
import { BackIcon, SearchIcon } from '@/components/icons'
import { ListingGrid } from '@/components/ListingGrid'
import { Pagination } from '@/components/Pagination'
import { NoProductMatch, ProductSearch } from '@/components/ProductId'
import { EmptyState, ErrorState, PageTitle, Segmented, Skeleton, buttonClass, chipClass, cx, inputCls } from '@/components/ui'
import { withSponsoredFirst } from '@/domain/boosts'
import {
  BROWSE_SORTS,
  NO_BROWSE_OPTIONS,
  TICKET_LIMITS,
  hasBrowseFilters,
  hasDrawOnlyOptions,
  matchesBrowseOptions,
  parseBrowseOptions,
  sortForBrowse,
  writeBrowseOptions,
  type BrowseOptions,
  type BrowseSort,
} from '@/domain/browse'
import { formatNaira, nairaToKobo } from '@/domain/money'
import { listingMatchesSearch } from '@/domain/productCode'
import { CATEGORIES, type Category } from '@/domain/types'
import { paginate } from '@/lib/paginate'
import { useSearchParam } from '@/lib/useSearchParam'

/** Fills whole rows at both four and five cards across. */
export const BROWSE_PAGE_SIZE = 20

type Kind = 'all' | 'draws' | 'buy'
const KINDS: Kind[] = ['all', 'draws', 'buy']

const matchesKind = (l: ListingView, k: Kind) => (k === 'draws' ? l.status === 'live' : k === 'buy' ? l.status === 'for_sale' : true)

/** Builds a /browse link. */
export function browseHref(f: { category?: Category; seller?: string; type?: Kind; q?: string; options?: Partial<BrowseOptions> }) {
  let p = new URLSearchParams()
  if (f.category) p.set('category', f.category)
  if (f.seller) p.set('seller', f.seller)
  if (f.type && f.type !== 'all') p.set('type', f.type)
  if (f.q) p.set('q', f.q)
  if (f.options) p = writeBrowseOptions(p, f.options)
  const qs = p.toString()
  return qs ? `/browse?${qs}` : '/browse'
}

/** /browse: every live draw and item on sale, filtered by category, seller or search, a page at a time. */
export function BrowsePage() {
  const [params] = useSearchParams()
  const seller = params.get('seller')
  if (seller) return <Navigate to={`/stores/${seller}`} replace />
  return <Browse />
}

function Browse() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('category')
  const category = CATEGORIES.includes(raw as Category) ? (raw as Category) : undefined
  const seller = params.get('seller') ?? undefined
  const query = (params.get('q') ?? '').trim()
  const search = useSearchParam()
  const kind: Kind = KINDS.find((k) => k === params.get('type')) ?? 'all'
  const page = Number(params.get('page') ?? '1')
  const options = useMemo(() => parseBrowseOptions(params), [params])
  const q = useListings({ status: ['live', 'for_sale'] })

  const matching = useMemo(() => {
    const list = (q.data ?? []).filter(
      (l) =>
        (!category || l.category === category) &&
        (!seller || l.merchant.id === seller) &&
        listingMatchesSearch(l, query) &&
        matchesBrowseOptions(l, options, Date.now()),
    )
    // Paid boosts sit on top whatever the sort, as they do on the explore page.
    const { sponsored, rest } = withSponsoredFirst(sortForBrowse(list, options.sort), Date.now())
    return [...sponsored, ...rest]
  }, [q.data, category, seller, query, options])
  const shown = matching.filter((l) => matchesKind(l, kind))
  const current = paginate(shown, page, BROWSE_PAGE_SIZE)

  const sellerName = seller ? q.data?.find((l) => l.merchant.id === seller)?.merchant.name : undefined
  const title = seller ? (sellerName ?? 'Seller') : category ? category : query ? `Results for “${query}”` : 'Everything on DrawMart'
  const eyebrow = seller ? (category ? `From this seller · ${category}` : 'From this seller') : category ? 'Category' : 'Browse'
  const setKind = (k: Kind) => {
    // Buy-now items have no tickets, so the draw-only options would leave nothing to show.
    const next = k === 'buy' ? writeBrowseOptions(params, { maxTicket: null, closingToday: false, almostSoldOut: false, sort: null }) : new URLSearchParams(params)
    if (k === 'all') next.delete('type')
    else next.set('type', k)
    next.delete('page')
    setParams(next, { replace: true, preventScrollReset: true })
  }
  const setOptions = (o: Partial<BrowseOptions>) => {
    const next = writeBrowseOptions(params, o)
    next.delete('page')
    setParams(next, { replace: true, preventScrollReset: true })
  }
  const filtered = hasBrowseFilters(options)

  return (
    <div className="flex flex-col gap-6">
      <Link to="/" className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-xl px-2 text-sm font-bold text-muted no-underline hover:bg-sunken hover:text-ink">
        <BackIcon size={18} /> Explore
      </Link>
      <PageTitle eyebrow={eyebrow} sub={q.data ? `${shown.length.toLocaleString('en-NG')} ${shown.length === 1 ? 'item' : 'items'}` : undefined}>
        {title}
      </PageTitle>
      <ProductSearch value={search.text} onChange={search.change} />
      <Segmented<Kind>
        label="Show"
        value={kind}
        onChange={setKind}
        className="w-full sm:w-auto sm:self-start"
        options={[
          { value: 'all', label: 'All', count: matching.length },
          { value: 'draws', label: 'Draws', count: matching.filter((l) => matchesKind(l, 'draws')).length },
          { value: 'buy', label: 'Buy now', count: matching.filter((l) => matchesKind(l, 'buy')).length },
        ]}
      />
      <BrowseFilters options={options} onChange={setOptions} drawsToo={kind !== 'buy' || hasDrawOnlyOptions(options)} />
      {q.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : shown.length === 0 && filtered ? (
        <EmptyState
          icon={SearchIcon}
          title="Nothing matches these filters"
          body="Try fewer filters, or a higher ticket price."
          action={
            <button type="button" onClick={() => setOptions(NO_BROWSE_OPTIONS)} className={buttonClass('outline')}>
              Clear filters
            </button>
          }
        />
      ) : shown.length === 0 && query ? (
        <NoProductMatch query={query} />
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

/** Filter chips and the sort. On Buy now, only what applies to items on sale. */
function BrowseFilters({ options: o, onChange, drawsToo }: { options: BrowseOptions; onChange: (o: Partial<BrowseOptions>) => void; drawsToo: boolean }) {
  const chips: { label: string; active: boolean; toggle: Partial<BrowseOptions> }[] = [
    ...(drawsToo
      ? [
          ...TICKET_LIMITS.map((t) => ({ label: `Up to ${formatNaira(nairaToKobo(t))}`, active: o.maxTicket === t, toggle: { maxTicket: o.maxTicket === t ? null : t } })),
          { label: 'Closing today', active: o.closingToday, toggle: { closingToday: !o.closingToday } },
          { label: 'Almost sold out', active: o.almostSoldOut, toggle: { almostSoldOut: !o.almostSoldOut } },
        ]
      : []),
    { label: 'New this week', active: o.newThisWeek, toggle: { newThisWeek: !o.newThisWeek } },
  ]
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6" role="group" aria-label="Filter">
        {chips.map((c) => (
          <button key={c.label} type="button" onClick={() => onChange(c.toggle)} aria-pressed={c.active} className={chipClass(c.active)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {drawsToo ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-subtle">Sort</span>
            <select
              value={o.sort ?? ''}
              onChange={(e) => onChange({ sort: (e.target.value || null) as BrowseSort | null })}
              className={cx(inputCls, 'min-h-11 w-auto bg-surface pr-8 font-bold')}
            >
              <option value="">Suggested</option>
              {BROWSE_SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
        {hasBrowseFilters(o) || o.sort ? (
          <button type="button" onClick={() => onChange(NO_BROWSE_OPTIONS)} className="flex min-h-11 items-center rounded-xl px-2 text-sm font-bold text-brand hover:bg-brand-soft">
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  )
}
