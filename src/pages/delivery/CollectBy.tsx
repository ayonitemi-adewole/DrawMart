import { ClockIcon } from '@/components/icons'
import { Notice, cx } from '@/components/ui'
import { collectSoon } from '@/domain/riderLimits'
import { timeOfDay } from '@/lib/time'

/** On a taken job's card: when it goes back to the pool if it isn't collected. */
export function CollectByLine({ at }: { at: string }) {
  return (
    <span className={cx('flex items-center gap-1 text-xs', collectSoon(at, Date.now()) ? 'font-bold text-hot' : 'text-subtle')}>
      <ClockIcon size={14} /> Collect by {timeOfDay(at)}
    </span>
  )
}

export function CollectByNotice({ at }: { at: string }) {
  return (
    <Notice tone={collectSoon(at, Date.now()) ? 'hot' : 'ticket'} icon={ClockIcon} title={`Collect it by ${timeOfDay(at)}`}>
      If it isn’t collected by then, it goes back on the list for another rider.
    </Notice>
  )
}
