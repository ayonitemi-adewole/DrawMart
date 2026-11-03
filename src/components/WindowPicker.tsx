import { useState } from 'react'
import { ClockIcon } from '@/components/icons'
import { Segmented, cx } from '@/components/ui'
import { WINDOW_PARTS, offeredWindows, windowDayText, windowHoursText, windowTimes, type DeliveryWindow } from '@/domain/deliveryWindows'

/** At checkout: as soon as it's ready, or a morning, afternoon or evening on one of the days offered (deliveryWindows.ts). */
export function WindowPicker({ value, onChange }: { value: DeliveryWindow | null; onChange: (w: DeliveryWindow | null) => void }) {
  // Worked out once, so the choices don't shift while the buyer is choosing. The server checks again.
  const [now] = useState(() => Date.now())
  const [offered] = useState(() => offeredWindows(now))
  const days = [...new Set(offered.map((w) => w.day))]
  const [day, setDay] = useState(value?.day ?? days[0])
  const option = (checked: boolean) => cx('flex min-h-11 cursor-pointer gap-3 rounded-2xl border p-3.5 text-sm transition', checked ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong')
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 flex items-center gap-1.5 text-sm font-bold">
        <ClockIcon size={14} /> When
      </legend>
      <label className={option(!value)}>
        <input type="radio" name="delivery-window" checked={!value} onChange={() => onChange(null)} className="mt-1 size-4 shrink-0 accent-brand" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <strong>As soon as it’s ready</strong>
          <span className="text-xs text-subtle">A rider brings it once the seller has it ready, and calls you first.</span>
        </span>
      </label>
      <label className={option(!!value)}>
        <input type="radio" name="delivery-window" checked={!!value} onChange={() => onChange(offered.find((w) => w.day === day) ?? offered[0])} className="mt-1 size-4 shrink-0 accent-brand" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <strong>Choose a day and time</strong>
          <span className="text-xs text-subtle">The first times are when the seller is sure to have it ready.</span>
        </span>
      </label>
      {value ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-ground p-3.5">
          <Segmented<string>
            label="Day"
            value={day}
            onChange={(d) => {
              setDay(d)
              const same = offered.find((w) => w.day === d && w.part === value.part)
              onChange(same ?? offered.find((w) => w.day === d)!)
            }}
            className="w-full"
            size="sm"
            options={days.map((d) => ({ value: d, label: windowDayText(d, now) }))}
          />
          <div role="radiogroup" aria-label="Time" className="grid gap-2 sm:grid-cols-3">
            {WINDOW_PARTS.map((p) => {
              const w = { day, part: p.part }
              const open = offered.some((o) => o.day === day && o.part === p.part)
              const checked = value.day === day && value.part === p.part
              return (
                <label key={p.part} className={cx(option(checked), 'flex-col gap-0.5', !open && 'cursor-not-allowed opacity-50')}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="delivery-window-part" disabled={!open} checked={checked} onChange={() => onChange(w)} className="size-4 shrink-0 accent-brand" />
                    <strong>{p.label}</strong>
                  </span>
                  <span className="text-xs text-subtle">{open ? windowHoursText(windowTimes(w)) : 'Too soon for the seller'}</span>
                </label>
              )
            })}
          </div>
        </div>
      ) : null}
    </fieldset>
  )
}
