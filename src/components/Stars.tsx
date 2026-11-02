import { StarIcon } from './icons'
import { cx } from './ui'

/** A rating, read out as a number. */
export function Stars({ rating, size = 16, className }: { rating: number; size?: number; className?: string }) {
  const full = Math.round(rating)
  return (
    <span className={cx('flex items-center gap-0.5', className)} role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} size={size} className={i <= full ? 'text-ticket' : 'text-line-strong'} fill={i <= full ? 'currentColor' : 'none'} />
      ))}
    </span>
  )
}

const LABELS = ['', 'Poor', 'Not great', 'OK', 'Good', 'Excellent']

/** Five buttons, one per star. */
export function StarPicker({ value, onChange, id }: { value: number; onChange: (v: number) => void; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div role="radiogroup" aria-labelledby={id} className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={`${i} star${i > 1 ? 's' : ''}: ${LABELS[i]}`}
            onClick={() => onChange(i)}
            className="flex size-11 items-center justify-center rounded-xl transition hover:bg-sunken"
          >
            <StarIcon size={28} className={i <= value ? 'text-ticket' : 'text-line-strong'} fill={i <= value ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
      <span className="min-h-5 text-sm font-bold">{LABELS[value]}</span>
    </div>
  )
}
