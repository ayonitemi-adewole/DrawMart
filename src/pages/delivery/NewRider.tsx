import { useRiderLevel } from '@/api/hooks'
import { LockIcon } from '@/components/icons'
import { Notice } from '@/components/ui'
import { formatNaira } from '@/domain/money'

/** For a new rider: how far they are from carrying anything (riderApplications.ts). */
export function NewRiderProgress() {
  const q = useRiderLevel()
  const l = q.data
  if (!l || l.trusted || l.completed >= l.jobsToUnlock) return null
  return (
    <Notice tone="sky" icon={LockIcon} title={`${l.completed} of ${l.jobsToUnlock} deliveries done`}>
      Until then you can take orders worth up to {formatNaira(l.maxKobo)}, and not won items. Locked jobs show in the list so you know what’s coming.
    </Notice>
  )
}

export function LockedText() {
  const q = useRiderLevel()
  return (
    <span className="flex items-center gap-1">
      <LockIcon size={12} /> Opens after {q.data?.jobsToUnlock ?? 'more'} completed deliveries.
    </span>
  )
}
