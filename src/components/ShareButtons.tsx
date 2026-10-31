import type { ListingView } from '@/api/types'
import { listingShareText, whatsAppShareUrl } from '@/domain/share'
import { ShareIcon, WhatsAppIcon } from './icons'
import { useToast } from './toast'
import { IconButton } from './ui'

/** Share to WhatsApp, and the phone's own share sheet (or copying the link where there isn't one). */
export function ShareButtons({ listing: l }: { listing: ListingView }) {
  const toast = useToast()
  // The listing's own address, without anything else that's in the bar.
  const url = `${window.location.origin}/listings/${l.id}`
  const text = listingShareText(l)

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: l.title, text, url })
      else {
        await navigator.clipboard.writeText(url)
        toast('Link copied. Share it with a friend.', 'info')
      }
    } catch {
      /* share sheet dismissed */
    }
  }

  return (
    <>
      <a
        href={whatsAppShareUrl(text, url)}
        target="_blank"
        rel="noreferrer"
        aria-label="Share to WhatsApp"
        title="Share to WhatsApp"
        className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted no-underline hover:bg-sunken hover:text-ink"
      >
        <WhatsAppIcon size={20} />
      </a>
      <IconButton aria-label="Share this listing" onClick={share}>
        <ShareIcon />
      </IconButton>
    </>
  )
}
