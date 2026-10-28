import { ticketNo } from '@/lib/time'
import { cx } from './ui'

/** A single ticket number styled as a perforated stub. */
export function TicketStub({
  number,
  state = 'default',
  size = 'md',
  className,
  style,
  notch = 'bg-surface',
}: {
  number: number
  state?: 'default' | 'winner' | 'lost' | 'new'
  size?: 'sm' | 'md'
  className?: string
  style?: React.CSSProperties
  /** Background behind the stub, so the notches look cut out. */
  notch?: string
}) {
  return (
    <span
      style={style}
      className={cx(
        'relative inline-flex items-center justify-center font-mono font-bold tabular-nums',
        size === 'sm' ? 'h-8 rounded-lg px-3 text-xs' : 'h-11 rounded-xl px-4 text-sm',
        state === 'winner' && 'bg-ticket text-on-ticket shadow-card ring-2 ring-ticket/40',
        state === 'lost' && 'bg-sunken text-subtle line-through decoration-1',
        state === 'new' && 'animate-pop bg-brand text-on-brand',
        state === 'default' && 'border border-dashed border-brand/50 bg-brand-soft text-brand-ink',
        className,
      )}
    >
      {/* Notches on each side, cut out in the page colour. */}
      <span className={`absolute top-1/2 -left-1.5 size-3 -translate-y-1/2 rounded-full ${notch}`} aria-hidden="true" />
      <span className={`absolute top-1/2 -right-1.5 size-3 -translate-y-1/2 rounded-full ${notch}`} aria-hidden="true" />
      {ticketNo(number)}
    </span>
  )
}
