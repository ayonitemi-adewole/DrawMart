import { useRef, useState, type FormEvent } from 'react'
import { useQuickReplies, useQuickReplyActions } from '@/api/hooks'
import type { QuickReply } from '@/api/types'
import { MAX_QUICK_REPLIES, QUICK_REPLY_MAX, SUGGESTED_QUICK_REPLIES, quickReplyError } from '@/domain/quickReplies'
import { PlusIcon, SparklesIcon, XIcon } from './icons'
import { useToast } from './toast'
import { Button, Card, ErrorState, Field, IconButton, Skeleton, cx, errorMessage, inputCls } from './ui'

/** Tap one to put it in the message box, ready to change before sending. */
export function QuickReplyChips({ onPick }: { onPick: (body: string) => void }) {
  const q = useQuickReplies()
  if (!q.data?.length) return null
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Quick replies">
      {q.data.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onPick(r.body)}
          className="flex min-h-11 max-w-56 shrink-0 items-center rounded-full border border-line bg-surface px-3 text-xs font-bold text-ink transition hover:border-brand"
        >
          <span className="truncate">{r.body}</span>
        </button>
      ))}
    </div>
  )
}

/** On the Messages page, for sellers: the saved answers. */
export function QuickRepliesEditor() {
  const q = useQuickReplies()
  const { save, remove } = useQuickReplyActions()
  const toast = useToast()
  const [editing, setEditing] = useState<QuickReply | null>(null)
  const [draft, setDraft] = useState('')
  const [showError, setShowError] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const list = q.data ?? []
  const problem = quickReplyError(draft, editing ? list.length - 1 : list.length)

  function reset() {
    setEditing(null)
    setDraft('')
    setShowError(false)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (problem) {
      setShowError(true)
      return
    }
    save.mutate(
      { id: editing?.id, body: draft },
      { onSuccess: () => (toast(editing ? 'Reply updated.' : 'Saved. Tap it above the message box in any chat.'), reset()), onError: (err) => toast(errorMessage(err), 'error') },
    )
  }

  function add(body: string) {
    save.mutate({ body }, { onSuccess: () => toast('Added. Open a chat to use it.'), onError: (err) => toast(errorMessage(err), 'error') })
  }

  function startEditing(r: QuickReply) {
    setEditing(r)
    setDraft(r.body)
    setShowError(false)
    box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    box.current?.focus({ preventScroll: true })
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
          <SparklesIcon size={20} />
        </span>
        <div className="flex flex-col">
          <strong>Quick replies</strong>
          <span className="text-xs text-subtle">In a chat with a buyer, tap one above the message box to use it. Tap one here to change it.</span>
        </div>
      </div>
      {q.isPending ? (
        <Skeleton className="h-24" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : list.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-1 py-1">
              <button
                type="button"
                onClick={() => startEditing(r)}
                className={cx('min-h-11 min-w-0 flex-1 rounded-xl px-2 text-left text-sm transition hover:bg-sunken', editing?.id === r.id && 'bg-brand-soft')}
                aria-label={`Edit: ${r.body}`}
              >
                <span className="line-clamp-2">{r.body}</span>
              </button>
              <IconButton
                aria-label={`Delete: ${r.body}`}
                onClick={() => remove.mutate(r.id, { onSuccess: () => (editing?.id === r.id ? reset() : undefined), onError: (err) => toast(errorMessage(err), 'error') })}
              >
                <XIcon size={16} />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-subtle">Start with one of these:</span>
          {SUGGESTED_QUICK_REPLIES.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} disabled={save.isPending} className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 text-left text-sm transition hover:border-brand">
              <PlusIcon size={14} className="shrink-0 text-brand" /> {s}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
        <Field
          label={editing ? 'Change this reply' : 'New reply'}
          htmlFor="quick-reply"
          hint={`${draft.length}/${QUICK_REPLY_MAX} · ${list.length} of ${MAX_QUICK_REPLIES} saved`}
          error={showError && problem ? problem : undefined}
        >
          <textarea ref={box} id="quick-reply" rows={2} value={draft} maxLength={QUICK_REPLY_MAX} onChange={(e) => setDraft(e.target.value)} className={cx(inputCls, 'py-3')} placeholder="e.g. It comes with a 6-month warranty." />
        </Field>
        <div className="flex gap-2">
          {editing ? (
            <Button variant="outline" size="sm" className="min-h-11" onClick={reset}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" size="sm" className="min-h-11 flex-1" loading={save.isPending}>
            {editing ? 'Save change' : 'Save reply'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
