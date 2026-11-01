import { Link } from 'react-router'
import { useSavedListings } from '@/api/hooks'
import { BackIcon, HeartIcon } from '@/components/icons'
import { ListingGrid } from '@/components/ListingGrid'
import { NoProductMatch, ProductSearch } from '@/components/ProductId'
import { SavedAlertsToggle } from '@/components/PushSettings'
import { EmptyState, ErrorState, PageTitle, Skeleton, buttonClass } from '@/components/ui'
import { listingMatchesSearch } from '@/domain/productCode'
import { useSearchParam } from '@/lib/useSearchParam'

/** /saved: the draws and products this buyer has kept, newest first. */
export function SavedPage() {
  const q = useSavedListings()
  const search = useSearchParam()
  const shown = (q.data ?? []).filter((l) => listingMatchesSearch(l, search.text))

  return (
    <div className="flex flex-col gap-6">
      <Link to="/account" className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-xl px-2 text-sm font-bold text-muted no-underline hover:bg-sunken hover:text-ink">
        <BackIcon size={18} /> Account
      </Link>
      <PageTitle eyebrow="Account" sub={q.data?.length ? `${q.data.length.toLocaleString('en-NG')} ${q.data.length === 1 ? 'item' : 'items'}` : undefined}>
        Saved items
      </PageTitle>
      <SavedAlertsToggle />
      {q.isPending ? (
        <Skeleton className="h-80" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState
          icon={HeartIcon}
          title="Nothing saved yet"
          body="Tap the heart on any draw or product to keep it here. Only you can see this list."
          action={
            <Link to="/" className={buttonClass('outline')}>
              Explore
            </Link>
          }
        />
      ) : (
        <>
          <ProductSearch value={search.text} onChange={search.change} />
          {shown.length ? <ListingGrid listings={shown} /> : <NoProductMatch query={search.text} />}
        </>
      )}
    </div>
  )
}
