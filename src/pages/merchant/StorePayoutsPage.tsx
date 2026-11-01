import { PageTitle } from '@/components/ui'
import { Payouts } from './Payouts'

/** /store/payouts */
export function StorePayoutsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Payouts" sub="What each item has earned, where it is, and what we’ve sent you.">
        Your money
      </PageTitle>
      <Payouts />
    </div>
  )
}
