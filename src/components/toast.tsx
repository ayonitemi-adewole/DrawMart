import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertIcon, CheckCircleIcon, InfoIcon, XIcon } from './icons'
import { cx } from './ui'

type ToastTone = 'success' | 'info' | 'error'

interface Toast {
  id: number
  message: string
  tone: ToastTone
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {})

const STYLE: Record<ToastTone, { icon: typeof InfoIcon; cls: string }> = {
  success: { icon: CheckCircleIcon, cls: 'text-brand' },
  info: { icon: InfoIcon, cls: 'text-sky' },
  error: { icon: AlertIcon, cls: 'text-hot' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const show = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = ++nextId.current
      setToasts((t) => [...t.slice(-2), { id, message, tone }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 4000),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => map.forEach(clearTimeout)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => {
          const s = STYLE[t.tone]
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-md animate-toast-in items-start gap-3 rounded-2xl border border-line bg-raised py-3 pr-2 pl-4 text-sm text-ink shadow-lift"
            >
              <s.icon size={20} className={cx('mt-0.5 shrink-0', s.cls)} />
              <span className="flex-1 py-0.5 leading-snug font-semibold">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="-my-2 flex size-11 shrink-0 items-center justify-center rounded-xl text-subtle hover:bg-sunken hover:text-ink"
              >
                <XIcon size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
