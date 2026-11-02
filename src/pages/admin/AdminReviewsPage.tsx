import { useState } from 'react'
import { useAdminReviews, useReviewActions } from '@/api/hooks'
import type { AdminReviewView } from '@/api/types'
import { StarIcon } from '@/components/icons'
import { ReviewItem } from '@/components/Reviews'
import { useToast } from '@/components/toast'
import { Button, EmptyState, ErrorState, Field, PageTitle, Segmented, Skeleton, errorMessage, inputCls } from '@/components/ui'
import { HIDE_REASON_MAX, hideReasonError } from '@/domain/reviews'

type Filter = 'all' | 'low' | 'hidden'

/** /admin/reviews: the latest reviews, to hide abusive ones. */
export function AdminReviewsPage() {
  const q = useAdminReviews()
  const [filter, setFilter] = useState<Filter>('all')
  const list = (q.data ?? []).filter((r) => (filter === 'low' ? r.rating <= 2 : filter === 'hidden' ? r.hidden : true))
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Admin" sub="Hide a review that’s abusive, off-topic, or shares personal details. A hidden review doesn’t count towards the seller’s rating, and the buyer can’t change it.">
        Reviews
      </PageTitle>
      <Segmented<Filter>
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'Latest' },
          { value: 'low', label: '1 and 2 stars' },
          { value: 'hidden', label: 'Hidden' },
        ]}
      />
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={StarIcon} title="Nothing here" body="Reviews appear here as buyers post them." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((r) => (
            <AdminReview key={r.id} review={r} />
          ))}
        </div>
      )}
    </div>
  )
}

function AdminReview({ review: r }: { review: AdminReviewView }) {
  const { hide } = useReviewActions()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [showError, setShowError] = useState(false)
  const problem = hideReasonError(reason)

  function set(hidden: boolean) {
    if (hidden && problem) {
      setShowError(true)
      return
    }
    hide
      .mutateAsync({ id: r.id, hidden, reason })
      .then(() => toast(hidden ? 'Hidden from buyers.' : 'Showing again.'))
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold text-subtle">{r.merchantName}</span>
      <ReviewItem review={r} canReply={false} showProduct />
      {r.hidden ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {r.hiddenReason ? <span>Hidden because: {r.hiddenReason}</span> : null}
          <Button variant="ghost" loading={hide.isPending} onClick={() => set(false)}>
            Show it again
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Why hide it?" htmlFor={`hide-${r.id}`} error={showError && problem ? problem : undefined}>
              <input id={`hide-${r.id}`} value={reason} maxLength={HIDE_REASON_MAX} onChange={(e) => setReason(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Button variant="outline" loading={hide.isPending} onClick={() => set(true)}>
            Hide
          </Button>
        </div>
      )}
    </div>
  )
}
