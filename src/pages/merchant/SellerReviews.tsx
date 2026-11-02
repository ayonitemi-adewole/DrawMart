import { useMerchant } from '@/api/hooks'
import { ShopReviewsSection } from '@/components/Reviews'
import { ErrorState, PageTitle, Skeleton } from '@/components/ui'

/** The shop's own reviews, with a reply box on each. */
export function SellerReviews() {
  const m = useMerchant()
  if (m.isPending) return <Skeleton className="h-60" />
  if (m.isError) return <ErrorState error={m.error} onRetry={() => m.refetch()} />
  return <ShopReviewsSection merchantId={m.data.id} insider title="What buyers say" />
}

/** /store/reviews */
export function StoreReviewsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Reviews" sub="Buyers rate you after delivery. You can reply to each review once, and buyers see your reply with it.">
        Reviews
      </PageTitle>
      <SellerReviews />
    </div>
  )
}
