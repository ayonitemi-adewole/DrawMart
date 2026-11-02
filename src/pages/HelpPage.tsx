import { useEffect } from 'react'
import { Link } from 'react-router'
import { useHasShop, useMarkSupportRead, useMerchant, useSendSupportMessage, useSupportThread } from '@/api/hooks'
import { BackIcon, ChatIcon } from '@/components/icons'
import { Card, ErrorState, PageTitle, Skeleton } from '@/components/ui'
import { helpTopics } from '@/domain/help'
import { MessageBox, MessageList } from './MessagesPage'

/**
 * Seller help: short answers (domain/help.ts), and a chat with DrawMart's team.
 * /store/help in the store app; /sell/help for individual sellers.
 */
export function HelpPage({ app }: { app: 'store' | 'sell' }) {
  const shop = useMerchant()
  const topics = helpTopics(shop.data?.kind ?? (app === 'store' ? 'store' : 'individual'))

  return (
    <div className="flex flex-col gap-6">
      {app === 'sell' ? (
        <Link to="/sell" className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-xl px-2 text-sm font-bold text-muted no-underline hover:bg-sunken hover:text-ink">
          <BackIcon size={18} /> Your shop
        </Link>
      ) : null}
      <PageTitle eyebrow="Help" sub="Short answers to what sellers ask most. Can’t find yours? Ask us.">
        Selling on DrawMart
      </PageTitle>
      <div className="grid gap-6 lg:grid-cols-[1fr_400px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {topics.map((t) => (
            <Card key={t.id} className="flex flex-col p-5">
              <h2 className="pb-1 font-display text-lg font-extrabold">{t.title}</h2>
              {t.answers.map((a) => (
                <details key={a.q} className="group border-t border-line first-of-type:border-t-0">
                  <summary className="flex min-h-11 cursor-pointer items-center py-2 text-sm font-bold">{a.q}</summary>
                  <p className="pb-3 text-sm text-muted">{a.a}</p>
                </details>
              ))}
            </Card>
          ))}
        </div>
        <SupportChat />
      </div>
    </div>
  )
}

function SupportChat() {
  if (!useHasShop())
    return (
      <Card className="flex flex-col gap-2 p-5 text-sm lg:sticky lg:top-24">
        <strong className="flex items-center gap-2">
          <ChatIcon size={18} /> Contact DrawMart
        </strong>
        <p className="text-muted">Once your shop is open, you can message DrawMart’s team from here.</p>
      </Card>
    )
  return <SupportThread />
}

function SupportThread() {
  const q = useSupportThread()
  const send = useSendSupportMessage()
  const markRead = useMarkSupportRead()
  const unread = q.data?.unread ?? 0

  useEffect(() => {
    if (unread > 0 && !markRead.isPending) markRead.mutate(undefined)
  }, [unread]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className="flex flex-col gap-3 p-4 lg:sticky lg:top-24">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
          <ChatIcon size={20} />
        </span>
        <div className="flex flex-col">
          <strong>Contact DrawMart</strong>
          <span className="text-xs text-subtle">Our team usually replies within a working day.</span>
        </div>
      </div>
      <div className="flex max-h-[28rem] min-h-40 flex-col overflow-y-auto rounded-2xl bg-ground p-3">
        {q.isPending ? (
          <Skeleton className="h-32" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.data.messages.length ? (
          <MessageList messages={q.data.messages} me="shop" warnOffPlatform={false} />
        ) : (
          <p className="m-auto max-w-xs text-center text-sm text-subtle">Ask anything about selling, an order or a payout. Include the product ID if it’s about one item.</p>
        )}
      </div>
      <MessageBox send={send} placeholder="Write to DrawMart…" inline />
    </Card>
  )
}
