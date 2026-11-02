import { useState } from 'react'
import { MAX_DELIVERY_PHOTOS } from '@/domain/deliveryChecks'
import { photoToDataUrl } from '@/lib/image'
import { CameraIcon, XIcon } from './icons'
import { useToast } from './toast'
import { errorMessage } from './ui'

/** Pictures only from here: these go to the seller and admins as proof. */
export function RiderPhotos({ photos, onChange, max = MAX_DELIVERY_PHOTOS, label = 'Take photos' }: { photos: string[]; onChange: (p: string[]) => void; max?: number; label?: string }) {
  const toast = useToast()
  const [reading, setReading] = useState(false)

  async function onPick(file: File | undefined) {
    if (!file) return
    setReading(true)
    try {
      onChange([...photos, await photoToDataUrl(file)].slice(-max))
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setReading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {photos.map((src, i) => (
          <div key={i} className="relative">
            <img src={src} alt={`Photo ${i + 1}`} className="size-20 rounded-xl border border-line bg-photo object-cover" />
            <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => onChange(photos.filter((_, n) => n !== i))} className="absolute -top-2 -right-2 flex size-11 items-center justify-center">
              <span className="flex size-7 items-center justify-center rounded-full bg-ink text-ground shadow-card">
                <XIcon size={14} />
              </span>
            </button>
          </div>
        ))}
      </div>
      {photos.length < max ? (
        <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-bold">
          <CameraIcon size={16} /> {reading ? 'Reading…' : photos.length ? 'Take another' : label}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void onPick(e.target.files?.[0])} />
        </label>
      ) : null}
    </div>
  )
}
