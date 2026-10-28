import { useSearchParams } from 'react-router'
import { useListings } from '@/api/hooks'
import { ShieldIcon } from '@/components/icons'
import { ListingCard } from '@/components/ListingCard'
import { ErrorState, Skeleton, cx } from '@/components/ui'
import { CATEGORIES, type Category } from '@/domain/types'

export function HomePage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('category')
  const category = CATEGORIES.includes(raw as Category) ? (raw as Category) : undefined
  const listings = useListings({ category })

  const pick = (c?: Category) => setParams(c ? { category: c } : {}, { replace: true })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5 rounded-xl bg-brand-soft px-3 py-2.5 text-xs leading-snug text-brand-ink">
        <ShieldIcon size={20} className="shrink-0" />
        <span>
          <strong>Licensed by LSLGA</strong> · Licence [NUMBER] · Lagos residents 18+ only
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-4xl leading-[1.02] font-extrabold tracking-tight md:text-5xl">Win it for the price of a ticket.</h1>
        <p className="max-w-lg text-sm leading-relaxed text-muted">
          Real items from verified Lagos stores, held in escrow. Every draw is public and anyone can check it.
        </p>
      </div>

      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-0.5" role="group" aria-label="Filter by category">
        {[undefined, ...CATEGORIES].map((c) => {
          const active = c === category
          return (
            <button
              key={c ?? 'all'}
              onClick={() => pick(c)}
              aria-pressed={active}
              className={cx(
                'min-h-10 shrink-0 rounded-full border px-4 text-sm font-bold',
                active ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink',
              )}
            >
              {c ?? 'All'}
            </button>
          )
        })}
      </div>

      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-extrabold">Live draws</h2>
        <span className="text-xs text-subtle">Closest to selling out first</span>
      </div>

      {listings.isPending ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : listings.isError ? (
        <ErrorState error={listings.error} onRetry={() => listings.refetch()} />
      ) : listings.data.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-muted">
          No live draws in {category ?? 'this category'} right now. Check back soon.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {listings.data.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  )
}
