import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ApiError } from '@/api/types'

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'ticket' | 'outline' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-deep disabled:bg-brand/50',
  ticket: 'bg-ticket text-ink hover:brightness-95 disabled:opacity-60',
  outline: 'border border-line-strong bg-surface text-ink hover:bg-ground disabled:opacity-60',
  ghost: 'border border-dashed border-brand text-brand hover:bg-brand-soft disabled:opacity-60',
  danger: 'border border-hot-ink/30 bg-surface text-hot-ink hover:bg-hot-soft disabled:opacity-60',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  loading,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'lg' | 'sm'; loading?: boolean }) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-bold transition disabled:cursor-not-allowed',
        size === 'lg' && 'min-h-13 px-6 text-base',
        size === 'md' && 'min-h-11 px-4 text-sm',
        size === 'sm' && 'min-h-9 px-3 text-xs',
        VARIANTS[variant],
        className,
      )}
      disabled={loading || rest.disabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)} aria-hidden="true" />
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-2xl border border-line bg-surface', className)}>{children}</div>
}

type Tone = 'brand' | 'hot' | 'ticket' | 'neutral'
const TONES: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand-ink',
  hot: 'bg-hot-soft text-hot-ink',
  ticket: 'bg-ticket text-ink',
  neutral: 'bg-sunken text-muted',
}

export function Badge({ tone = 'brand', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold tracking-wide', TONES[tone], className)}>
      {children}
    </span>
  )
}

export function ProgressBar({ value, max, hot, label }: { value: number; max: number; hot?: boolean; label: string }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-2 overflow-hidden rounded-full bg-sunken"
    >
      <div className={cx('h-full rounded-full transition-[width] duration-500', hot ? 'bg-hot' : 'bg-brand')} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-2xl bg-sunken', className)} aria-hidden="true" />
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-6 text-center">
      <p className="font-bold">Something went wrong</p>
      <p className="text-sm text-muted">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </Card>
  )
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Please try again.'
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">{children}</h1>
      {sub ? <p className="text-sm text-muted">{sub}</p> : null}
    </div>
  )
}

/** Stand-in for product photos until merchants upload real ones. */
export function ProductImage({ category, className }: { category: string; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-1 rounded-xl bg-sunken text-subtle', className)} role="img" aria-label={`${category} photo placeholder`}>
      <span className="max-w-full truncate px-1 text-[10px] font-extrabold tracking-wider uppercase">{category}</span>
      <span className="text-[10px]">photo</span>
    </div>
  )
}
