import { useEffect, useRef, useState } from 'react'
import { CameraIcon } from './icons'
import { Button, Notice } from './ui'

const MAX_SIDE = 900

/**
 * A live camera view inside the app, so a photo can only be taken now. There's
 * deliberately no file picker, even as a fallback: those offer the gallery.
 */
export function CameraCapture({ photo, onChange }: { photo: string | null; onChange: (photo: string | null) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'starting' | 'live' | 'blocked' | 'unsupported'>('starting')
  const wanted = !photo

  useEffect(() => {
    if (!wanted) return
    let stream: MediaStream | null = null
    let stopped = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported')
      return
    }
    setState('starting')
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(async (s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (video.current) {
          video.current.srcObject = s
          await video.current.play().catch(() => {})
        }
        setState('live')
      })
      .catch(() => {
        if (!stopped) setState('blocked')
      })
    // The camera light must go off as soon as this closes.
    return () => {
      stopped = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [wanted])

  function take() {
    const v = video.current
    if (!v?.videoWidth) return
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(v.videoWidth * scale)
    canvas.height = Math.round(v.videoHeight * scale)
    canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height)
    onChange(canvas.toDataURL('image/jpeg', 0.82))
  }

  if (photo)
    return (
      <div className="flex flex-col gap-2">
        <img src={photo} alt="Your photo of the item" className="max-h-64 w-full rounded-2xl border border-line bg-photo object-contain" />
        <Button type="button" variant="outline" onClick={() => onChange(null)}>
          <CameraIcon size={16} /> Take another
        </Button>
      </div>
    )

  if (state === 'blocked')
    return (
      <Notice tone="hot" icon={CameraIcon} title="DrawMart can’t use your camera">
        Allow the camera for DrawMart in your browser or phone settings, then try again. Photos can’t be uploaded, so this is the only way to confirm.
      </Notice>
    )
  if (state === 'unsupported')
    return (
      <Notice tone="hot" icon={CameraIcon} title="This browser can’t open the camera">
        Open DrawMart in Chrome or Safari on your phone, then try again. Browsers inside other apps often can’t use the camera.
      </Notice>
    )

  return (
    <div className="flex flex-col gap-2">
      {/* playsInline and muted, or iPhones open the video full screen instead of showing it here. */}
      <video ref={video} playsInline muted className="max-h-72 min-h-40 w-full rounded-2xl border border-line bg-ink object-cover" aria-label="Your camera" />
      <Button type="button" variant="outline" disabled={state !== 'live'} onClick={take}>
        <CameraIcon size={16} /> {state === 'live' ? 'Take the photo' : 'Opening the camera…'}
      </Button>
    </div>
  )
}
