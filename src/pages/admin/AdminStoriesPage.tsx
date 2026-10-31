import { usePendingWinnerStories, useReviewWinnerStory } from '@/api/hooks'
import { TrophyIcon } from '@/components/icons'
import { ProductId } from '@/components/ProductId'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, PageTitle, Skeleton, errorMessage } from '@/components/ui'
import { dateTime } from '@/lib/time'

/** Winners who've asked to appear on the public Winners page. Only what would be shown is here. */
export function AdminStoriesPage() {
  const q = usePendingWinnerStories()
  const review = useReviewWinnerStory()
  const toast = useToast()
  const decide = (id: string, approve: boolean) =>
    review.mutate({ id, approve }, { onSuccess: () => toast(approve ? 'It’s on the Winners page.' : 'It won’t be shown. The winner can change it and send it again.'), onError: (e) => toast(errorMessage(e), 'error') })
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Admin" sub="Check that it’s a first name and nothing personal has slipped in. The winner can withdraw at any time." action={q.data ? <Badge tone={q.data.length ? 'ticket' : 'brand'}>{q.data.length} waiting</Badge> : null}>
        Winner stories
      </PageTitle>
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon={TrophyIcon} title="Nothing to review" body="When a winner chooses to appear on the Winners page, it waits here for a check." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {q.data.map((s) => (
            <Card key={s.id} className="flex flex-col gap-3 p-5">
              <div className="flex flex-col gap-1">
                <strong className="text-lg leading-tight">{s.firstName}</strong>
                <span className="text-sm text-muted">won {s.listingTitle}</span>
                <ProductId code={s.productCode} />
                <span className="text-xs text-subtle">Agreed {dateTime(s.consentAt)}</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" loading={review.isPending} onClick={() => decide(s.id, true)}>
                  Approve
                </Button>
                <Button variant="outline" size="sm" disabled={review.isPending} onClick={() => decide(s.id, false)}>
                  Don’t show
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
