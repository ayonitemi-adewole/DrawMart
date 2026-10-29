import { SellerInsights } from '@/components/SellerInsights'
import { PageTitle } from '@/components/ui'

/** /store/insights */
export function InsightsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Insights" sub="How many people see your listings, and how many of them buy.">
        Views and sales
      </PageTitle>
      <SellerInsights />
    </div>
  )
}
