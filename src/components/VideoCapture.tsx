import { useEffect, useRef, useState } from 'react'
import { MAX_VIDEO_SECONDS } from '@/domain/listingChecks'
import { CameraIcon } from './icons'
import { Button, Notice } from './ui'

const TYPES = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm']

/**
 * A short video recorded live in the app. Like CameraCapture, there's no file picker:
 * it has to be filmed now.
 */
export function VideoCapture({ video, onChange }: { video: Blob | null; onChange: (video: Blob | null) => void }) {
  const live = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const [state, setState] = useState<'starting' | 'ready' | 'recording' | 'blocked' | 'unsupported'>('starting')
  const [seconds, setSeconds] = useState(0)
  const [preview, setPreview] = useState<string | null>(null)
  const wanted = !video

  useEffect(() => {
    if (!wanted) return
    let stopped = false
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('unsupported')
      return
    }
    setState('starting')
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 } }, audio: false })
      .then(async (s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream.current = s
        if (live.current) {
          live.current.srcObject = s
          await live.current.play().catch(() => {})
        }
        setState('ready')
      })
      .catch(() => {
        if (!stopped) setState('blocked')
      })
    return () => {
      stopped = true
      if (recorder.current?.state === 'recording') recorder.current.stop()
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = null
    }
  }, [wanted])

  useEffect(() => {
    if (!video) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(video)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [video])

  useEffect(() => {
    if (state !== 'recording') return
    const timer = setInterval(() => {
      setSeconds((n) => {
        if (n + 1 >= MAX_VIDEO_SECONDS) recorder.current?.stop()
        return n + 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [state])

  function start() {
    if (!stream.current) return
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t))
    const r = new MediaRecorder(stream.current, { mimeType, videoBitsPerSecond: 600_000 })
    const chunks: Blob[] = []
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    r.onstop = () => onChange(new Blob(chunks, { type: r.mimeType || 'video/webm' }))
    recorder.current = r
    setSeconds(0)
    r.start(500)
    setState('recording')
  }

  if (video)
    return (
      <div className="flex flex-col gap-2">
        {preview ? <video src={preview} controls playsInline className="max-h-72 w-full rounded-2xl border border-line bg-ink" aria-label="Your video" /> : null}
        <Button type="button" variant="outline" onClick={() => onChange(null)}>
          <CameraIcon size={16} /> Record again
        </Button>
      </div>
    )
  if (state === 'blocked')
    return (
      <Notice tone="hot" icon={CameraIcon} title="DrawMart can’t use your camera">
        Allow the camera for DrawMart in your browser or phone settings, then try again.
      </Notice>
    )
  if (state === 'unsupported')
    return (
      <Notice tone="hot" icon={CameraIcon} title="This browser can’t record video">
        Open DrawMart in Chrome or Safari on your phone, then try again.
      </Notice>
    )
  return (
    <div className="flex flex-col gap-2">
      <video ref={live} playsInline muted className="max-h-72 min-h-40 w-full rounded-2xl border border-line bg-ink object-cover" aria-label="Your camera" />
      {state === 'recording' ? (
        <Button type="button" variant="danger" onClick={() => recorder.current?.stop()}>
          Stop ({MAX_VIDEO_SECONDS - seconds}s left)
        </Button>
      ) : (
        <Button type="button" variant="outline" disabled={state !== 'ready'} onClick={start}>
          <CameraIcon size={16} /> {state === 'ready' ? `Record (up to ${MAX_VIDEO_SECONDS} seconds)` : 'Opening the camera…'}
        </Button>
      )}
    </div>
  )
}
