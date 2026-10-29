import { Card, PageTitle } from '@/components/ui'
import { PHOTO_CREDITS } from '@/lib/photoCredits'

/** /credits: who took the sample listing photos, as their licences require. */
export function CreditsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="About" sub="Sample listing photos from Wikimedia Commons, used under these licences. Some show the nearest available model or a similar item.">
        Photo credits
      </PageTitle>
      <Card className="divide-y divide-line overflow-hidden">
        {PHOTO_CREDITS.map((c) => (
          <div key={c.asset} className="flex gap-4 p-4">
            <img src={`/assets/${c.asset}`} alt="" loading="lazy" className="size-16 shrink-0 rounded-xl bg-photo object-cover" />
            <div className="flex min-w-0 flex-col gap-0.5 text-sm">
              <strong className="leading-tight">{c.usedFor}</strong>
              <span className="text-muted">
                Photo by {c.author || 'unknown'} ·{' '}
                {c.licenseUrl ? (
                  <a href={c.licenseUrl} target="_blank" rel="noreferrer">
                    {c.license}
                  </a>
                ) : (
                  c.license
                )}
              </span>
              <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="truncate text-xs">
                {c.source}
              </a>
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}
