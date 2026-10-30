import { useEffect, useRef, type ReactNode } from 'react'
import { XIcon } from './icons'
import { IconButton, cx } from './ui'

/**
 * Modal built on native <dialog>: focus trapping, Escape and the top layer
 * come for free. Renders as a bottom sheet on phones and a centred card on
 * larger screens.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  hideClose,
  overlay,
  pop,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
  hideClose?: boolean
  /** Full-screen decoration above the sheet, such as confetti. */
  overlay?: ReactNode
  /** A moment to celebrate: bursts out of the screen, centred on every size. */
  pop?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes it.
        if (e.target === e.currentTarget) onClose()
      }}
      className={cx(
        'bg-transparent text-ink backdrop:bg-transparent',
        pop ? 'm-auto w-full max-w-lg overflow-visible p-4' : 'm-0 mt-auto w-full max-w-none p-0 sm:m-auto sm:max-w-lg',
      )}
    >
      {overlay}
      <div
        className={cx(
          'relative flex flex-col gap-4 overflow-y-auto border border-line bg-raised p-5 shadow-lift sm:p-6',
          pop ? 'max-h-[85dvh] animate-pop-out rounded-[28px]' : 'max-h-[90dvh] animate-sheet-up rounded-t-[28px] pb-[max(env(safe-area-inset-bottom),20px)] sm:rounded-[28px]',
          className,
        )}
      >
        {pop ? null : <span className="mx-auto -mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />}
        {hideClose ? null : (
          <IconButton aria-label="Close" onClick={onClose} className="absolute top-3 right-3">
            <XIcon />
          </IconButton>
        )}
        {children}
      </div>
    </dialog>
  )
}
