import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { useMarkSupportRead, useReplySupport, useSetSupportResolved, useSupportInbox, useSupportMessages } from '@/api/hooks'
import type { SupportThreadSummary } from '@/api/types'
import { ChatIcon, CheckIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, PageTitle, Skeleton, cx, errorMessage } from '@/components/ui'
import { dateTime } from '@/lib/time'
import { MessageBox, MessageList } from '../MessagesPage'

/** /admin/support: chats from stores and individual sellers. */
export function AdminSupportPage() {
  const inbox = useSupportInbox()
  const [params, setParams] = useSearchParams()
  const selected = inbox.data?.find((t) => t.merchantId === params.get('shop')) ?? null

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Admin" sub="Questions from stores and individual sellers. Mark a chat resolved once it’s answered; a new message opens it again.">
        Support
      </PageTitle>
      {inbox.isPending ? (
        <Skeleton className="h-72" />
      ) : inbox.isError ? (
        <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />
      ) : inbox.data.length === 0 ? (
        <EmptyState icon={ChatIcon} title="No chats yet" body="When a seller writes to DrawMart, it shows up here." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr] lg:items-start">
          <Card className="divide-y divide-line overflow-hidden">
            {inbox.data.map((t) => (
              <button
                key={t.merchantId}
                type="button"
                onClick={() => setParams({ shop: t.merchantId }, { replace: true })}
                aria-current={selected?.merchantId === t.merchantId}
                className={cx('flex min-h-11 w-full flex-col gap-1 p-4 text-left transition hover:bg-sunken', selected?.merchantId === t.merchantId && 'bg-brand-soft')}
              >
                <span className="flex items-center gap-2">
                  <strong className="min-w-0 flex-1 truncate">{t.merchantName}</strong>
                  {t.unread ? <Badge tone="hot">{t.unread} new</Badge> : t.resolved ? <Badge tone="neutral">Resolved</Badge> : null}
                </span>
                <span className="truncate text-sm text-muted">
                  {t.lastSender === 'drawmart' ? 'You: ' : ''}
                  {t.lastMessage}
                </span>
                <span className="text-xs text-subtle">
                  {t.kind === 'individual' ? 'Individual seller' : 'Store'} · {dateTime(t.lastMessageAt)}
                </span>
              </button>
            ))}
          </Card>
          {selected ? <Thread key={selected.merchantId} thread={selected} /> : <p className="text-sm text-muted">Pick a chat to read and reply.</p>}
        </div>
      )}
    </div>
  )
}

function Thread({ thread: t }: { thread: SupportThreadSummary }) {
  const messages = useSupportMessages(t.merchantId)
  const reply = useReplySupport(t.merchantId)
  const markRead = useMarkSupportRead()
  const resolve = useSetSupportResolved()
  const toast = useToast()

  useEffect(() => {
    if (t.unread > 0 && !markRead.isPending) markRead.mutate(t.merchantId)
  }, [t.merchantId, t.unread]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="min-w-0 flex-1 truncate text-lg">{t.merchantName}</strong>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          loading={resolve.isPending}
          onClick={() =>
            resolve.mutate({ merchantId: t.merchantId, resolved: !t.resolved }, { onSuccess: () => toast(t.resolved ? 'Opened again.' : 'Marked resolved.'), onError: (e) => toast(errorMessage(e), 'error') })
          }
        >
          <CheckIcon size={16} /> {t.resolved ? 'Open again' : 'Mark resolved'}
        </Button>
      </div>
      <div className="flex max-h-[32rem] min-h-60 flex-col overflow-y-auto rounded-2xl bg-ground p-3">
        {messages.isPending ? <Skeleton className="h-40" /> : messages.isError ? <ErrorState error={messages.error} onRetry={() => messages.refetch()} /> : <MessageList messages={messages.data} me="drawmart" />}
      </div>
      <MessageBox send={reply} placeholder={`Reply to ${t.merchantName}…`} inline />
    </Card>
  )
}
