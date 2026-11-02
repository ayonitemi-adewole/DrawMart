import { useState } from 'react'
import type { ListingCheckPlan } from '@/api/types'
import { ShieldIcon, XIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Field, Notice, errorMessage, inputCls } from '@/components/ui'
import { VideoCapture } from '@/components/VideoCapture'
import { NEW_SELLER, PROOF_ABOVE_KOBO, needsProofOfPurchase, needsSerial } from '@/domain/listingChecks'
import { formatNaira } from '@/domain/money'
import type { Category, Kobo } from '@/domain/types'
import { photoToDataUrl } from '@/lib/image'
import { Section } from './parts'

/** Proof the seller has the item: a live video with a code, a serial number, a receipt. */
export function ProofSection(p: {
  plan: ListingCheckPlan
  category: Category
  priceKobo: Kobo
  onPhone: boolean
  video: Blob | null
  onVideo: (v: Blob | null) => void
  serial: string
  onSerial: (s: string) => void
  proof: string | null
  onProof: (p: string | null) => void
  problems: string[]
}) {
  const toast = useToast()
  const [reading, setReading] = useState(false)
  const serialWanted = p.category === 'Phones' || p.category === 'Electronics'
  const proofWanted = needsProofOfPurchase(p.plan.individual, p.priceKobo)
  if (!p.plan.videoRequired && !serialWanted && !proofWanted && !p.plan.newSeller) return null

  async function onReceipt(file: File | undefined) {
    if (!file) return
    setReading(true)
    try {
      p.onProof(await photoToDataUrl(file))
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setReading(false)
    }
  }

  return (
    <Section n={3} title="Show us you have it" sub="Only DrawMart sees this. It helps us approve your listing faster.">
      {p.plan.newSeller ? (
        <Notice icon={ShieldIcon} title="You’re a new seller">
          Until you’ve had {NEW_SELLER.deliveriesNeeded} successful deliveries ({p.plan.newSeller.deliveries} so far), you can list items up to {formatNaira(NEW_SELLER.maxPriceKobo)} and have {NEW_SELLER.maxLive} on sale or in review ({p.plan.newSeller.live} now).
        </Notice>
      ) : null}
      {p.plan.videoRequired ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold">A short video of the item</span>
            <span className="text-sm text-muted">Write this code on a piece of paper and film it next to the item, turning the item so we can see it all.</span>
          </div>
          <p className="w-fit rounded-xl bg-ticket-soft px-4 py-2 font-mono text-3xl font-extrabold tracking-[0.3em]" aria-label={`Your code is ${p.plan.code.split('').join(' ')}`}>
            {p.plan.code}
          </p>
          {p.onPhone ? (
            <VideoCapture video={p.video} onChange={p.onVideo} />
          ) : (
            <Notice tone="ticket" title="Switch to your phone to record it">
              The video is recorded in the app, so it can’t be uploaded from a computer. Open this page on your phone, signed in with the same account, to finish this listing.
            </Notice>
          )}
        </div>
      ) : null}
      {serialWanted ? (
        <Field
          label={needsSerial(p.category, p.priceKobo) ? 'Serial or IMEI number' : 'Serial or IMEI number (if it has one)'}
          htmlFor="p-serial"
          hint="On the box, the back of the item or in its settings. For a phone, dial *#06#."
        >
          <input id="p-serial" value={p.serial} onChange={(e) => p.onSerial(e.target.value)} autoComplete="off" className={inputCls} />
        </Field>
      ) : null}
      {proofWanted ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold">Proof you bought it</span>
          <span className="text-xs text-subtle">A receipt, invoice or bank alert. Needed from individual sellers for items over {formatNaira(PROOF_ABOVE_KOBO)}.</span>
          {p.proof ? (
            <div className="relative w-fit">
              <img src={p.proof} alt="Your proof of purchase" className="size-24 rounded-2xl border border-line bg-photo object-cover" />
              <button type="button" aria-label="Remove proof of purchase" onClick={() => p.onProof(null)} className="absolute -top-2 -right-2 flex size-11 items-center justify-center">
                <span className="flex size-7 items-center justify-center rounded-full bg-ink text-ground shadow-card">
                  <XIcon size={14} />
                </span>
              </button>
            </div>
          ) : (
            <label className="flex min-h-11 w-fit cursor-pointer items-center rounded-xl border border-line-strong px-4 text-sm font-bold">
              {reading ? 'Reading…' : 'Add a photo'}
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onReceipt(e.target.files?.[0])} />
            </label>
          )}
        </div>
      ) : null}
      {p.problems.length ? (
        <ul className="list-disc rounded-2xl bg-hot-soft py-3 pr-3 pl-8 text-sm text-hot-ink" role="alert">
          {p.problems.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
    </Section>
  )
}
