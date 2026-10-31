import { LockIcon } from './icons'
import { cx } from './ui'

/** The buyer's PIN for one order. Only ever shown to the buyer. */
export function DeliveryPin({ pin, pickup, title, className }: { pin: string; pickup: boolean; title?: string; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-1.5 rounded-2xl bg-ticket-soft p-3 text-sm', className)}>
      <span className="flex min-w-0 items-center gap-1.5 font-bold">
        <LockIcon size={14} className="shrink-0" />
        <span className="min-w-0 truncate">{title ? `PIN for ${title}` : pickup ? 'Your collection PIN' : 'Your delivery PIN'}</span>
      </span>
      <span className="font-mono text-3xl font-extrabold tracking-[0.25em] tabular-nums">{pin}</span>
      <span className="text-xs text-muted">
        {pickup ? 'Give this to the counter staff when you collect.' : 'Only give this to the rider once you have the item.'} It’s how we know it reached you, so don’t share it before then.
      </span>
    </div>
  )
}
