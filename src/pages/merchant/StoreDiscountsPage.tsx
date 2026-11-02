import { PageTitle } from '@/components/ui'
import { Discounts } from './Discounts'

/** /store/discounts */
export function StoreDiscountsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Discounts" sub="Put products on sale for a while, or make a code to share with your customers.">
        Discounts
      </PageTitle>
      <Discounts />
    </div>
  )
}
