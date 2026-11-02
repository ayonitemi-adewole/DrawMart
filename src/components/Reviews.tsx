import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useReviewActions, useShopReviews } from '@/api/hooks'
import type { ReviewView, ShopReviews } from '@/api/types'
import { REVIEWS_SHOWN_FROM, REVIEW_TEXT_MAX, replyError } from '@/domain/reviews'
import { dateTime } from '@/lib/time'
import { StarIcon } from './icons'
import { Stars } from './Stars'
import { useToast } from './toast'
import { Badge, Button, Card, ErrorState, Field, Skeleton, cx, errorMessage, inputCls } from './ui'

/** "★ 4.6 · 12 reviews" next to a shop's name. Nothing until the public can see it. */
export function ShopRating({ merchantId, className }: { merchantId: string; className?: string }) {
  const q = useShopReviews(merchantId)
  if (!q.data?.shown || q.data.average === null) return null
  return (
    <span className={cx('flex items-center gap-1 text-xs text-subtle', className)}>
      <StarIcon size={12} className="text-ticket" fill="currentColor" />
      <span>
        <strong className="text-ink">{q.data.average.toFixed(1)}</strong> · {q.data.count} review{q.data.count === 1 ? '' : 's'}
      </span>
    </span>
  )
}

function Summary({ data, insider }: { data: ShopReviews; insider: boolean }) {
  if (data.average === null || !data.breakdown)
    return (
      <p className="text-sm text-muted">
        {data.count === 0 ? 'No reviews yet.' : `${data.count} review${data.count === 1 ? '' : 's'} so far.`} A seller’s rating shows once they have {REVIEWS_SHOWN_FROM}.
      </p>
    )
  const most = Math.max(...data.breakdown, 1)
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <div className="flex flex-col items-start gap-1">
        <span className="font-display text-4xl font-extrabold tabular-nums">{data.average.toFixed(1)}</span>
        <Stars rating={data.average} />
        <span className="text-xs text-subtle">
          From {data.count} review{data.count === 1 ? '' : 's'}
        </span>
      </div>
      <dl className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
        {data.breakdown.map((n, i) => (
          <div key={i} className="flex items-center gap-2">
            <dt className="w-8 shrink-0 tabular-nums">{5 - i} ★</dt>
            <dd className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
              <span className="block h-full rounded-full bg-ticket" style={{ width: `${(n / most) * 100}%` }} />
            </dd>
            <dd className="w-6 shrink-0 text-right tabular-nums text-subtle">{n}</dd>
          </div>
        ))}
      </dl>
      {insider && !data.shown ? <p className="basis-full text-xs text-subtle">Only you can see this until you have {REVIEWS_SHOWN_FROM} reviews.</p> : null}
    </div>
  )
}

function ReplyForm({ review }: { review: ReviewView }) {
  const { reply } = useReviewActions()
  const toast = useToast()
  const [text, setText] = useState('')
  const [showError, setShowError] = useState(false)
  const problem = replyError(text)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (problem) {
      setShowError(true)
      return
    }
    reply
      .mutateAsync({ id: review.id, reply: text })
      .then(() => toast('Reply posted. Buyers can see it with the review.'))
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      <Field label="Your reply" htmlFor={`reply-${review.id}`} hint={`You can reply once, and it can’t be changed. ${text.length}/${REVIEW_TEXT_MAX}`} error={showError && problem ? problem : undefined}>
        <textarea id={`reply-${review.id}`} value={text} maxLength={REVIEW_TEXT_MAX} onChange={(e) => setText(e.target.value)} rows={2} className={cx(inputCls, 'py-3')} />
      </Field>
      <Button type="submit" variant="outline" className="w-fit" loading={reply.isPending}>
        Post reply
      </Button>
    </form>
  )
}

export function ReviewItem({ review: r, canReply, showProduct }: { review: ReviewView; canReply: boolean; showProduct: boolean }) {
  return (
    <Card className={cx('flex flex-col gap-2 p-4 text-sm', r.hidden && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars rating={r.rating} size={14} />
        <strong>{r.name}</strong>
        <span className="text-xs text-subtle">{dateTime(r.createdAt)}</span>
        {r.hidden ? <Badge tone="hot">Hidden by DrawMart</Badge> : null}
      </div>
      {showProduct ? (
        <Link to={`/listings/${r.listingId}`} className="w-fit text-xs text-subtle">
          Bought {r.listingTitle}
        </Link>
      ) : null}
      {r.sellerComment ? (
        <p className="whitespace-pre-line">
          <span className="text-subtle">About the seller: </span>
          {r.sellerComment}
        </p>
      ) : null}
      {r.productComment ? (
        <p className="whitespace-pre-line">
          <span className="text-subtle">About the product: </span>
          {r.productComment}
        </p>
      ) : null}
      {r.reply ? (
        <p className="rounded-xl bg-ground p-3 whitespace-pre-line text-muted">
          <strong className="text-ink">The seller replied: </strong>
          {r.reply}
        </p>
      ) : canReply && !r.hidden ? (
        <ReplyForm review={r} />
      ) : null}
    </Card>
  )
}

/**
 * A shop's rating and its latest reviews, or one product's. The shop's own (`insider`) sees
 * everything, can reply, and sees its rating before it's public.
 */
export function ShopReviewsSection({ merchantId, listingId, insider = false, title = 'Reviews' }: { merchantId: string; listingId?: string; insider?: boolean; title?: string }) {
  const q = useShopReviews(merchantId, listingId)
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-extrabold">{title}</h2>
      {q.isPending ? (
        <Skeleton className="h-32" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <Card className="p-5">
            <Summary data={q.data} insider={insider} />
            {listingId && q.data.average !== null ? <p className="mt-3 text-xs text-subtle">The rating is for the seller. Below are reviews from buyers of this product.</p> : null}
          </Card>
          {q.data.reviews.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {q.data.reviews.map((r) => (
                <ReviewItem key={r.id} review={r} canReply={insider} showProduct={!listingId} />
              ))}
            </div>
          ) : q.data.average !== null && listingId ? (
            <p className="text-sm text-muted">No reviews of this product yet.</p>
          ) : null}
        </>
      )}
    </section>
  )
}
