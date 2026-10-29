import { useRef, useState, type ReactNode } from 'react'
import { CATEGORY_STYLE } from '@/components/category'
import { PlusIcon, XIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Card, cx, errorMessage } from '@/components/ui'
import { CATEGORIES, type Category } from '@/domain/types'
import { photoToDataUrl } from '@/lib/image'

/** Form pieces shared by the raffle and regular-product listing forms. */

export function CategoryPicker({ value, onChange }: { value: Category; onChange: (c: Category) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-bold">Category</legend>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {CATEGORIES.map((c) => {
          const Icon = CATEGORY_STYLE[c].icon
          const active = c === value
          return (
            <button
              type="button"
              key={c}
              aria-pressed={active}
              onClick={() => onChange(c)}
              className={cx(
                'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-bold transition active:scale-95',
                active ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface text-muted hover:border-line-strong',
              )}
            >
              <Icon size={20} />
              {c}
            </button>
          )
        })}
      </div>
      <span className="text-xs text-subtle">Perishable goods like food can’t be listed.</span>
    </fieldset>
  )
}

const MAX_PHOTOS = 4

export function PhotoPicker({ photos, onChange }: { photos: string[]; onChange: (p: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function add(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    try {
      const picked = [...files].filter((f) => f.type.startsWith('image/')).slice(0, MAX_PHOTOS - photos.length)
      onChange([...photos, ...(await Promise.all(picked.map((f) => photoToDataUrl(f))))])
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold">Photos</span>
      <div className="flex flex-wrap gap-2">
        {photos.map((src, i) => (
          <div key={i} className="relative">
            <img src={src} alt={`Photo ${i + 1}`} className="size-24 rounded-2xl border border-line bg-photo object-cover" />
            {i === 0 ? <span className="absolute bottom-1.5 left-1.5 rounded-full bg-ink/75 px-2 py-0.5 text-[10px] font-bold text-ground">Cover</span> : null}
            <button
              type="button"
              onClick={() => onChange(photos.filter((_, j) => j !== i))}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute -top-2 -right-2 flex size-11 items-center justify-center"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-ink text-ground shadow-card">
                <XIcon size={14} />
              </span>
            </button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS ? (
          <label
            className={cx(
              'flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line-strong text-xs font-bold text-muted transition hover:border-brand hover:text-brand',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            <PlusIcon size={20} />
            {busy ? 'Adding…' : 'Add photo'}
            <input ref={input} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => add(e.target.files)} />
          </label>
        ) : null}
      </div>
      <span className="text-xs text-subtle">Up to {MAX_PHOTOS}. The first is the cover. DrawMart adds its own photos at escrow or inspection.</span>
    </div>
  )
}

export function Section({ n, title, sub, children }: { n: number; title: string; sub: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink font-display font-extrabold text-ground">{n}</span>
        <div className="flex flex-col">
          <h2 className="font-display text-lg font-extrabold">{title}</h2>
          <p className="text-xs text-subtle">{sub}</p>
        </div>
      </div>
      {children}
    </Card>
  )
}
