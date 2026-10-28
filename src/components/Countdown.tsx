import { useNow } from '@/lib/useNow'
import { clock, msLeft, timeLeft } from '@/lib/time'
import { ClockIcon } from './icons'
import { cx } from './ui'

const DAY = 24 * 60 * 60 * 1000

/** Live countdown: "2d 4h" far out, a ticking "04:12:09" in the last day. */
export function Countdown({ closesAt, className, icon = true }: { closesAt: string; className?: string; icon?: boolean }) {
  const now = useNow(1000)
  const ms = msLeft(closesAt, now)
  const urgent = ms < DAY
  return (
    <span className={cx('inline-flex items-center gap-1 tabular-nums', urgent && 'text-hot-ink', className)}>
      {icon ? <ClockIcon size={14} className="shrink-0" /> : null}
      <time dateTime={closesAt}>{ms <= 0 ? 'Closing now' : urgent ? clock(ms) : timeLeft(closesAt, now)}</time>
    </span>
  )
}
