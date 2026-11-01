import { MinusIcon, PlusIcon } from './icons'
import { IconButton } from './ui'

/** Minus, the number, plus. For how many of a product to buy. */
export function QuantityPicker({ value, max, onChange, label, disabled }: { value: number; max: number; onChange: (n: number) => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex w-fit items-center gap-1 rounded-xl border border-line-strong" role="group" aria-label={label}>
      <IconButton aria-label="One fewer" disabled={disabled || value <= 1} onClick={() => onChange(value - 1)} className="disabled:opacity-40">
        <MinusIcon size={18} />
      </IconButton>
      <output aria-live="polite" className="min-w-8 text-center font-bold tabular-nums">
        {value}
      </output>
      <IconButton aria-label="One more" disabled={disabled || value >= max} onClick={() => onChange(value + 1)} className="disabled:opacity-40">
        <PlusIcon size={18} />
      </IconButton>
    </div>
  )
}
