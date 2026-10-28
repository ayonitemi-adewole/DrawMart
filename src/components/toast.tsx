import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

interface Toast {
  id: number
  message: string
  tone: 'info' | 'error'
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    clearTimeout(timer.current)
    setToast({ id: Date.now(), message, tone })
    timer.current = setTimeout(() => setToast(null), 3500)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
        {toast ? (
          <div
            key={toast.id}
            role="status"
            className={
              'pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm shadow-lg ' +
              (toast.tone === 'error' ? 'bg-hot-ink text-white' : 'bg-ink text-ground')
            }
          >
            {toast.message}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
