import { useState } from 'react'
import { Link } from 'react-router'
import { useMe, useMyWinnerStories, useShareWinnerStory, useWithdrawWinnerStory } from '@/api/hooks'
import type { MyWinnerStory, WinnerWallEntry } from '@/api/types'
import { WINNER_CONSENT_TEXT, WINNER_STORY_ERROR_TEXT, suggestedFirstName, winnerStoryError, type WinnerStoryError } from '@/domain/winnerStories'
import { shortDate, ticketNo } from '@/lib/time'
import { ArrowRightIcon, TrophyIcon } from './icons'
import { ProductId } from './ProductId'
import { useToast } from './toast'
import { Badge, Button, Card, Field, ProductImage, cx, errorMessage, inputCls } from './ui'

const STATUS: Record<MyWinnerStory['status'], { label: string; tone: 'ticket' | 'brand' | 'neutral'; body: string }> = {
  pending: { label: 'Waiting for review', tone: 'ticket', body: 'DrawMart checks each one before it goes up.' },
  approved: { label: 'On the Winners page', tone: 'brand', body: 'Anyone can see this.' },
  rejected: { label: 'Not shown', tone: 'neutral', body: 'We couldn’t show this one. You can change it and send it again.' },
}

/** On a won draw's result page. Entirely optional, and nothing about the prize depends on it. */
export function WinnerStoryCard({ listingId }: { listingId: string }) {
  const stories = useMyWinnerStories()
  const story = stories.data?.find((s) => s.listingId === listingId)
  const [editing, setEditing] = useState(false)
  if (stories.isPending) return null
  return (
    <Card className="flex flex-col gap-3 p-5">
      {story && !editing ? (
        <StoryStatus story={story} onEdit={story.status === 'rejected' ? () => setEditing(true) : undefined} />
      ) : (
        <StoryForm listingId={listingId} story={story} onDone={() => setEditing(false)} />
      )}
    </Card>
  )
}

function StoryStatus({ story, onEdit }: { story: MyWinnerStory; onEdit?: () => void }) {
  const withdraw = useWithdrawWinnerStory()
  const toast = useToast()
  const s = STATUS[story.status]
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="leading-tight">Your win on the Winners page</strong>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <p className="text-sm">
        <strong>{story.firstName}</strong>{' '}
        <span className="text-muted">won {story.listingTitle}</span>
      </p>
      <p className="text-sm text-muted">{s.body}</p>
      <div className="flex flex-wrap gap-2">
        {onEdit ? (
          <Button variant="outline" size="sm" onClick={onEdit}>
            Change it
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          loading={withdraw.isPending}
          onClick={() =>
            withdraw.mutate(story.listingId, {
              onSuccess: () => toast('Withdrawn. Your name has been removed.'),
              onError: (e) => toast(errorMessage(e), 'error'),
            })
          }
        >
          Withdraw
        </Button>
      </div>
    </>
  )
}

function StoryForm({ listingId, story, onDone }: { listingId: string; story?: MyWinnerStory; onDone: () => void }) {
  const me = useMe()
  const share = useShareWinnerStory()
  const toast = useToast()
  const [open, setOpen] = useState(!!story)
  const [firstName, setFirstName] = useState<string | null>(story?.firstName ?? null)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<WinnerStoryError | null>(null)
  // Holds the suggestion until they type, so it can arrive after the page does.
  const name = firstName ?? suggestedFirstName(me.data?.displayName)

  if (!open) {
    return (
      <>
        <strong className="leading-tight">Show your win on the Winners page?</strong>
        <p className="text-sm text-muted">It’s up to you, and your prize isn’t affected either way. Only your first name is shown, and you can withdraw at any time.</p>
        <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
          Choose what to show
        </Button>
      </>
    )
  }

  function submit() {
    const problem = winnerStoryError({ firstName: name, consent })
    setError(problem)
    if (problem) return
    share.mutate(
      { listingId, firstName: name.trim(), consent },
      {
        onSuccess: () => {
          toast('Thanks. DrawMart will check it before it goes up.')
          onDone()
        },
        onError: (e) => toast(errorMessage(e), 'error'),
      },
    )
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <strong className="leading-tight">Show your win on the Winners page</strong>
      <Field label="First name" htmlFor="story-name" hint="Just your first name. Never your full name or phone number." error={error === 'first_name' ? WINNER_STORY_ERROR_TEXT.first_name : undefined}>
        <input id="story-name" value={name} onChange={(e) => setFirstName(e.target.value)} maxLength={30} autoComplete="given-name" className={inputCls} />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 shrink-0" />
        <span>{WINNER_CONSENT_TEXT}</span>
      </label>
      {error === 'consent' ? <p className="text-sm font-semibold text-hot-ink">{WINNER_STORY_ERROR_TEXT.consent}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={share.isPending}>
          Send for review
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false)
            onDone()
          }}
        >
          Not now
        </Button>
      </div>
    </form>
  )
}

/** For Account: every win the buyer has chosen to show, with a way to withdraw it. Nothing if there are none. */
export function MyWinnerStoriesSection() {
  const stories = useMyWinnerStories()
  if (!stories.data?.length) return null
  return (
    <Card className="flex flex-col gap-4 p-5">
      {stories.data.map((story) => (
        <div key={story.listingId} className="flex flex-col gap-3 border-b border-line pb-4 last:border-0 last:pb-0">
          <StoryStatus story={story} />
          <Link to={`/draws/${story.listingId}`} className="flex min-h-11 w-fit items-center text-sm">
            See the draw
          </Link>
        </div>
      ))}
    </Card>
  )
}

/** One winner on the wall and the home page strip. First name only, always. */
export function WinnerCard({ entry: w, className }: { entry: WinnerWallEntry; className?: string }) {
  return (
    <article className={cx('flex animate-fade-up flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card', className)}>
      <div className="p-2 pb-0">
        <ProductImage category={w.category} src={w.listingImage ?? undefined} alt={w.listingTitle} className="h-36" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-1.5 text-sm font-extrabold">
          <TrophyIcon size={15} className="shrink-0 text-ticket-ink" />
          <span className="min-w-0 truncate">{w.firstName}</span>
        </div>
        <span className="line-clamp-2 text-[15px] leading-tight font-extrabold">{w.listingTitle}</span>
        <span className="text-xs text-subtle">
          {shortDate(w.drawnAt)} · ticket {ticketNo(w.winningNumber)} of {w.ticketCount.toLocaleString('en-NG')}
        </span>
        <ProductId code={w.productCode} />
        <Link to={`/draws/${w.listingId}`} className="mt-auto flex min-h-11 items-center gap-1 text-sm font-bold no-underline">
          Check this draw <ArrowRightIcon size={15} />
        </Link>
      </div>
    </article>
  )
}
