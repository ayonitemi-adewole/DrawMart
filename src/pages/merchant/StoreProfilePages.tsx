import { useMerchant } from '@/api/hooks'
import { PageTitle, Skeleton } from '@/components/ui'
import { StorePage } from '@/pages/StorePage'
import { ShopProfile } from './ShopProfile'

/** /store/profile */
export function StoreProfileSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Shop profile" sub="What buyers see on your shop’s page. Your page links from every one of your listings.">
        Your shop page
      </PageTitle>
      <ShopProfile />
    </div>
  )
}

/** /store/shop: the store's own public page, as buyers see it. Store accounts can't open the buyer app. */
export function StoreShopPreviewPage() {
  const m = useMerchant()
  if (!m.data) return <Skeleton className="h-96" />
  return <StorePage merchantId={m.data.id} />
}
