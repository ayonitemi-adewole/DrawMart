import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useAccess, useSavedIds, useSetSaved } from '@/api/hooks'
import { HeartIcon } from './icons'
import { useToast } from './toast'
import { cx, errorMessage } from './ui'

/** Set on the page someone returns to after signing in, to finish the save they tapped. */
const SAVE_PARAM = 'save'

/** The heart on cards and listing pages. Signed out, it goes to sign-in and saves afterwards. */
export function SaveButton({ listingId, title, onImage, className }: { listingId: string; title: string; /** Over a photo, so it needs its own background. */ onImage?: boolean; className?: string }) {
  const access = useAccess()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const ids = useSavedIds()
  const setSaved = useSetSaved()
  const saved = ids.data?.includes(listingId) ?? false

  // Stores, admins and riders don't save things.
  if (access.role && access.role !== 'buyer') return null

  function onClick() {
    if (!access.ready) return
    if (!access.signedIn) {
      const back = new URLSearchParams(search)
      back.set(SAVE_PARAM, listingId)
      navigate(`/login?next=${encodeURIComponent(`${pathname}?${back}`)}`)
      return
    }
    setSaved.mutate({ listingId, saved: !saved }, { onError: (e) => toast(errorMessage(e), 'error') })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${title} from saved items` : `Save ${title}`}
      title={saved ? 'Remove from saved items' : 'Save'}
      className={cx('flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl', onImage ? '' : 'hover:bg-sunken', saved ? 'text-hot' : 'text-muted hover:text-ink', className)}
    >
      <span className={cx('flex size-8 items-center justify-center rounded-full', onImage && 'bg-surface/90 shadow-card')}>
        <HeartIcon size={onImage ? 17 : 20} fill={saved ? 'currentColor' : 'none'} />
      </span>
    </button>
  )
}

/** Finishes a save that started signed out, once the buyer is back from signing in. */
export function SaveAfterSignIn() {
  const [params, setParams] = useSearchParams()
  const access = useAccess()
  const toast = useToast()
  const setSaved = useSetSaved()
  const listingId = params.get(SAVE_PARAM)
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (!listingId || !access.signedIn || handled.current === listingId) return
    handled.current = listingId
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete(SAVE_PARAM)
        return next
      },
      { replace: true, preventScrollReset: true },
    )
    if (access.role !== 'buyer') return
    setSaved.mutate({ listingId, saved: true }, { onSuccess: () => toast('Saved. Find it under Saved items in your account.'), onError: (e) => toast(errorMessage(e), 'error') })
  }, [listingId, access.signedIn, access.role, setParams, setSaved, toast])

  return null
}
