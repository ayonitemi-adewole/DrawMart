import { useState, type FormEvent } from 'react'
import { useReviewActions } from '@/api/hooks'
import type { OrderView } from '@/api/types'
import { REVIEW_TEXT_MAX, reviewError } from '@/domain/reviews'
import { Sheet } from './Sheet'
import { StarPicker } from './Stars'
import { useToast } from './toast'
import { Button, Field, cx, errorMessage, inputCls } from './ui'

/** Rate the seller, and say something about them and the product. */
export function ReviewSheet({ order: o, onClose }: { order: OrderView; onClose: () => void }) {
  const { submit } = useReviewActions()
  const toast = useToast()
  const [rating, setRating] = useState(o.review?.rating ?? 0)
  const [sellerComment, setSellerComment] = useState(o.review?.sellerComment ?? '')
  const [productComment, setProductComment] = useState(o.review?.productComment ?? '')
  const [showError, setShowError] = useState(false)
  const input = { rating, sellerComment, productComment }
  const problem = reviewError(input)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (problem) {
      setShowError(true)
      return
    }
    submit
      .mutateAsync({ orderId: o.id, input })
      .then(() => {
        toast(o.review ? 'Review updated.' : 'Thanks. Your review helps other buyers choose.')
        onClose()
      })
      .catch((err) => toast(errorMessage(err), 'error'))
  }

  return (
    <Sheet open onClose={() => !submit.isPending && onClose()} title="Review">
      <h2 className="pr-10 font-display text-2xl font-extrabold">How was it?</h2>
      <p className="text-sm text-muted">
        {o.listingTitle} from {o.merchantName}. Your review shows with your first name only. You can change it until the seller replies.
      </p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span id={`rating-${o.id}`} className="text-sm font-bold">
            Rate the seller
          </span>
          <StarPicker id={`rating-${o.id}`} value={rating} onChange={setRating} />
        </div>
        <Field label="About the seller (optional)" htmlFor={`review-seller-${o.id}`} hint="Were they quick, helpful, honest about the item?">
          <textarea id={`review-seller-${o.id}`} value={sellerComment} maxLength={REVIEW_TEXT_MAX} onChange={(e) => setSellerComment(e.target.value)} rows={3} className={cx(inputCls, 'py-3')} />
        </Field>
        <Field label="About the product (optional)" htmlFor={`review-product-${o.id}`} hint="Is it as described? How is it working?">
          <textarea id={`review-product-${o.id}`} value={productComment} maxLength={REVIEW_TEXT_MAX} onChange={(e) => setProductComment(e.target.value)} rows={3} className={cx(inputCls, 'py-3')} />
        </Field>
        {showError && problem ? (
          <p className="text-sm font-semibold text-hot-ink" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={submit.isPending}>
            Not now
          </Button>
          <Button type="submit" className="flex-1" loading={submit.isPending}>
            {o.review ? 'Update review' : 'Post review'}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
