import { useState } from 'react'
import { Link } from 'react-router'
import { useWinnersWall } from '@/api/hooks'
import { TrophyIcon } from '@/components/icons'
import { NoProductMatch, ProductSearch } from '@/components/ProductId'
import { EmptyState, ErrorState, PageTitle, Skeleton, buttonClass } from '@/components/ui'
import { WinnerCard } from '@/components/WinnerStory'
import { matchesProductSearch } from '@/domain/productCode'

/** /winners: public. Winners who chose to be shown, with a link to check each draw. */
export function WinnersPage() {
  const q = useWinnersWall()
  const [search, setSearch] = useState('')
  const found = (q.data ?? []).filter((w) => matchesProductSearch(search, w.productCode, w.listingTitle, w.firstName))
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Winners" sub="People who won a draw and chose to be shown. Most tickets don’t win, and only spend what you can afford.">
        Recent winners
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-80" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState
          icon={TrophyIcon}
          title="No winners to show yet"
          body="Winners choose whether to appear here. You can still check every finished draw on the Results page."
          action={
            <Link to="/draws" className={buttonClass('outline')}>
              See results
            </Link>
          }
        />
      ) : (
        <>
          <ProductSearch value={search} onChange={setSearch} placeholder="Search by name, item or product ID" />
          {found.length ? (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {found.map((w) => (
                <WinnerCard key={w.id} entry={w} />
              ))}
            </div>
          ) : (
            <NoProductMatch query={search} />
          )}
        </>
      )}
    </div>
  )
}
