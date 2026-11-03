import { useState } from 'react'
import { useRiderProfile, useSetRiderPhoto } from '@/api/hooks'
import { CameraIcon, UserIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Card, errorMessage } from '@/components/ui'
import { photoToDataUrl } from '@/lib/image'

/** Buyers see this photo and the rider's first name once they've collected an order. */
export function RiderPhoto() {
  const q = useRiderProfile()
  const set = useSetRiderPhoto()
  const toast = useToast()
  const [reading, setReading] = useState(false)
  if (!q.data) return null
  const photo = q.data.photo

  async function onPick(file: File | undefined) {
    if (!file) return
    setReading(true)
    try {
      await set.mutateAsync(await photoToDataUrl(file))
      toast('Photo saved. Buyers will see it when you’re bringing their order.')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setReading(false)
    }
  }

  return (
    <Card className="flex items-center gap-3 p-4">
      {photo ? (
        <img src={photo} alt="Your photo" className="size-12 shrink-0 rounded-full border border-line bg-photo object-cover" />
      ) : (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sunken text-muted">
          <UserIcon size={20} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col text-sm">
        <strong>{photo ? `Buyers see you as ${q.data.firstName}` : 'Add a photo of yourself'}</strong>
        <span className="text-xs text-subtle">{photo ? 'With this photo, once you’ve collected their order.' : 'Buyers see it with your first name, so they know who’s at the door.'}</span>
      </span>
      <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-line-strong px-3 text-sm font-bold">
        <CameraIcon size={16} /> {reading || set.isPending ? 'Saving…' : photo ? 'Change' : 'Take photo'}
        <input type="file" accept="image/*" capture="user" className="sr-only" disabled={reading || set.isPending} onChange={(e) => void onPick(e.target.files?.[0])} />
      </label>
    </Card>
  )
}
