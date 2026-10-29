import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useCallPhone, useConversations, useHasShop, useListing, useMarkConversationRead, useMessages, useSendFirstMessage, useSendMessage, useSetCallPhone } from '@/api/hooks'
import type { ChatMessage, ConversationView } from '@/api/types'
import { AlertIcon, BackIcon, ChatIcon, PhoneIcon, SendIcon, ShieldIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Notice, PageTitle, ProductImage, Skeleton, buttonClass, cx, errorMessage, inputCls } from '@/components/ui'
import { isNigerianMobile } from '@/domain/listing'
import { MAX_MESSAGE_LENGTH, asksForOffPlatformPayment, messageError } from '@/domain/messages'
import { formatNaira } from '@/domain/money'
import { dayLabel, timeOfDay } from '@/lib/time'

/**
 * Buyer ↔ seller chat. Used by the buyer app (/messages) and the store app
 * (/store/messages); `basePath` keeps links inside the app you're in.
 */

const otherName = (c: ConversationView) => (c.me === 'buyer' ? c.merchantName : c.buyerName)

export function MessagesPage({ basePath }: { basePath: string }) {
  const q = useConversations()
  const hasShop = useHasShop()

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Messages" sub="Ask sellers about an item before you buy, or answer buyers about yours.">
        Your chats
      </PageTitle>
      <div className={cx('grid gap-6', hasShop && 'lg:grid-cols-[1fr_340px] lg:items-start')}>
        {q.isPending ? (
          <Skeleton className="h-72" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.data.length === 0 ? (
          <EmptyState
            icon={ChatIcon}
            title="No chats yet"
            body={hasShop ? 'When a buyer messages you about one of your items, it shows up here.' : 'Open a product and tap “Message seller” to ask about it.'}
          />
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {q.data.map((c) => (
              <InboxRow key={c.id} conversation={c} to={`${basePath}/${c.id}`} />
            ))}
          </Card>
        )}
        {hasShop ? <CallSettings /> : null}
      </div>
    </div>
  )
}

function InboxRow({ conversation: c, to }: { conversation: ConversationView; to: string }) {
  const last = c.lastMessage
  return (
    <Link to={to} className="flex items-center gap-3 p-4 text-ink no-underline transition hover:bg-sunken/60">
      <ProductImage category={c.category} src={c.listingImage ?? undefined} alt="" size="sm" className="size-14 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <strong className={cx('truncate', c.unread ? 'font-extrabold' : 'font-bold')}>{otherName(c)}</strong>
          <span className="shrink-0 text-[11px] text-subtle">{last ? `${dayLabel(last.createdAt)} ${timeOfDay(last.createdAt)}` : ''}</span>
        </div>
        <span className="truncate text-xs text-subtle">
          {c.me === 'seller' ? 'Asking about ' : ''}
          {c.listingTitle} · {formatNaira(c.priceKobo)}
        </span>
        <span className={cx('truncate text-sm', c.unread ? 'font-semibold text-ink' : 'text-muted')}>
          {last ? `${last.sender === c.me ? 'You: ' : ''}${last.body}` : 'No messages yet'}
        </span>
      </div>
      {c.unread ? (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-extrabold text-on-brand" aria-label={`${c.unread} unread`}>
          {c.unread}
        </span>
      ) : null}
    </Link>
  )
}

/** Sellers choose whether buyers they're chatting with can call them. */
function CallSettings() {
  const q = useCallPhone()
  const save = useSetCallPhone()
  const toast = useToast()
  const [draft, setDraft] = useState<string | null>(null)
  const current = q.data ?? null
  const value = draft ?? current ?? ''
  const invalid = !!value.trim() && !isNigerianMobile(value)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (invalid) return
    save.mutate(value.trim() || null, {
      onSuccess: () => {
        setDraft(null)
        toast(value.trim() ? 'Buyers you’re chatting with can now call you.' : 'Calls turned off.')
      },
      onError: (err) => toast(errorMessage(err), 'error'),
    })
  }

  return (
    <Card className="flex flex-col gap-4 p-5 lg:sticky lg:top-24">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
          <PhoneIcon size={20} />
        </span>
        <div className="flex flex-col">
          <strong>Let buyers call you</strong>
          <span className="text-xs text-subtle">{current ? `On: ${current}` : 'Off. Buyers can only message you.'}</span>
        </div>
      </div>
      {q.isPending ? (
        <Skeleton className="h-24" />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field
            label="Number buyers can call"
            htmlFor="call-phone"
            error={invalid ? 'Enter a Nigerian mobile number, e.g. 0803 123 4567.' : undefined}
            hint="Only shown inside chats, to buyers who’ve messaged you. Never on your listings."
          >
            <input id="call-phone" type="tel" inputMode="tel" value={value} onChange={(e) => setDraft(e.target.value)} placeholder="0803 123 4567" className={inputCls} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="min-h-11 flex-1" loading={save.isPending && !!value.trim()} disabled={invalid || value.trim() === (current ?? '')}>
              Save
            </Button>
            {current ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                loading={save.isPending && !value.trim()}
                onClick={() => save.mutate(null, { onSuccess: () => (setDraft(null), toast('Calls turned off.')), onError: (err) => toast(errorMessage(err), 'error') })}
              >
                Turn off
              </Button>
            ) : null}
          </div>
        </form>
      )}
    </Card>
  )
}

export function ConversationPage({ basePath }: { basePath: string }) {
  const { id = '' } = useParams()
  const conversations = useConversations()
  const c = conversations.data?.find((x) => x.id === id)

  if (conversations.isPending) return <Skeleton className="h-112" />
  if (conversations.isError) return <ErrorState error={conversations.error} onRetry={() => conversations.refetch()} />
  if (!c)
    return (
      <EmptyState
        icon={ChatIcon}
        title="Chat not found"
        body="It may have been removed, or it belongs to another account."
        action={
          <Link to={basePath} className={buttonClass('outline')}>
            Back to messages
          </Link>
        }
      />
    )
  return <Thread conversation={c} basePath={basePath} />
}

function Thread({ conversation: c, basePath }: { conversation: ConversationView; basePath: string }) {
  const messages = useMessages(c.id)
  const markRead = useMarkConversationRead()
  const bottom = useRef<HTMLDivElement>(null)
  const count = messages.data?.length ?? 0

  // Read receipts and scroll-to-latest whenever new messages arrive.
  useEffect(() => {
    if (c.unread > 0 && !markRead.isPending) markRead.mutate(c.id)
  }, [c.id, c.unread, count]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [count])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link to={basePath} className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-xl px-2 text-sm font-bold text-muted no-underline hover:bg-sunken hover:text-ink">
        <BackIcon size={18} /> All chats
      </Link>

      <Card className="flex items-center gap-3 p-3 sm:p-4">
        <ProductImage category={c.category} src={c.listingImage ?? undefined} alt="" size="sm" className="size-14 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <strong className="truncate">{otherName(c)}</strong>
          {c.me === 'buyer' ? (
            <Link to={`/listings/${c.listingId}`} className="truncate text-xs">
              {c.listingTitle} · {formatNaira(c.priceKobo)}
            </Link>
          ) : (
            <span className="truncate text-xs text-subtle">
              {c.listingTitle} · {formatNaira(c.priceKobo)}
            </span>
          )}
        </div>
        {c.listingStatus === 'sold' ? <Badge tone="neutral">Sold</Badge> : null}
        {c.me === 'buyer' && c.callPhone ? (
          <a href={`tel:${c.callPhone.replace(/\s/g, '')}`} className={buttonClass('outline', 'md', 'shrink-0')} aria-label={`Call ${c.merchantName}`}>
            <PhoneIcon size={16} /> <span className="hidden sm:inline">Call</span>
          </a>
        ) : null}
      </Card>

      <Notice tone="neutral" icon={ShieldIcon}>
        {c.me === 'buyer'
          ? 'Always pay through DrawMart: your money is only released to the seller after you confirm delivery. Never send money to an account number from a chat.'
          : 'Keep sales on DrawMart so you’re covered. Never ask buyers to pay you directly.'}
      </Notice>

      <Card className="flex min-h-80 flex-col gap-2 p-3 sm:p-4">
        {messages.isPending ? (
          <Skeleton className="h-60" />
        ) : messages.isError ? (
          <ErrorState error={messages.error} onRetry={() => messages.refetch()} />
        ) : messages.data.length === 0 ? (
          <p className="m-auto max-w-xs text-center text-sm text-subtle">
            {c.me === 'buyer' ? `Say hello and ask ${c.merchantName} anything about the item.` : 'No messages yet.'}
          </p>
        ) : (
          <MessageList messages={messages.data} me={c.me} />
        )}
        <div ref={bottom} />
      </Card>

      <Composer conversationId={c.id} />
    </div>
  )
}

function MessageList({ messages, me }: { messages: ChatMessage[]; me: ChatMessage['sender'] }) {
  let lastDay = ''
  return (
    <ol className="flex flex-col gap-2" aria-label="Messages">
      {messages.map((m) => {
        const day = dayLabel(m.createdAt)
        const showDay = day !== lastDay
        lastDay = day
        const mine = m.sender === me
        const warn = !mine && asksForOffPlatformPayment(m.body)
        return (
          <li key={m.id} className="flex flex-col gap-1">
            {showDay ? <span className="my-2 self-center rounded-full bg-sunken px-3 py-1 text-[11px] font-bold text-subtle">{day}</span> : null}
            <div className={cx('flex max-w-[85%] flex-col gap-1', mine ? 'items-end self-end' : 'items-start self-start')}>
              <p
                className={cx(
                  'rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words',
                  mine ? 'rounded-br-md bg-brand text-on-brand' : 'rounded-bl-md bg-sunken text-ink',
                )}
              >
                {m.body}
              </p>
              {warn ? (
                <span className="flex items-start gap-1.5 rounded-xl bg-hot-soft px-2.5 py-1.5 text-[11px] font-semibold text-hot-ink">
                  <AlertIcon size={14} className="mt-px shrink-0" /> This looks like a request to pay outside DrawMart. Don’t: you’d lose buyer protection.
                </span>
              ) : null}
              <span className="px-1 text-[10px] text-subtle">{timeOfDay(m.createdAt)}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Composer({ conversationId }: { conversationId: string }) {
  return <MessageBox send={useSendMessage(conversationId)} />
}

/** The text box and send button. `send` is a mutation taking the message text. */
function MessageBox({ send, placeholder = 'Write a message…', autoFocus }: { send: { mutate: (body: string, o: { onSuccess: () => void; onError: (e: unknown) => void }) => void; isPending: boolean }; placeholder?: string; autoFocus?: boolean }) {
  const toast = useToast()
  const [body, setBody] = useState('')
  const problem = body ? messageError(body) : 'empty'

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (problem) return
    send.mutate(body, { onSuccess: () => setBody(''), onError: (err) => toast(errorMessage(err), 'error') })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a line.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={submit} className="sticky bottom-[calc(max(env(safe-area-inset-bottom),12px)+84px)] flex items-end gap-2 rounded-3xl border border-line bg-raised/95 p-2 shadow-lift backdrop-blur-xl md:bottom-4">
      <label htmlFor="message" className="sr-only">
        Message
      </label>
      <textarea
        id="message"
        rows={1}
        value={body}
        maxLength={MAX_MESSAGE_LENGTH}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={cx(inputCls, 'max-h-40 min-h-11 flex-1 resize-none border-0 bg-transparent py-2.5 shadow-none')}
      />
      <Button type="submit" aria-label="Send message" loading={send.isPending} disabled={!!problem} className="size-11 shrink-0 rounded-2xl p-0">
        <SendIcon size={18} />
      </Button>
    </form>
  )
}

/**
 * /messages/new/:listingId: a buyer writing to a seller for the first time.
 * Nothing is created until they send, so leaving this screen leaves no empty
 * chat for the seller to find.
 */
export function NewConversationPage({ basePath }: { basePath: string }) {
  const { listingId = '' } = useParams()
  const listing = useListing(listingId)
  const conversations = useConversations()
  const navigate = useNavigate()
  const send = useSendFirstMessage(listingId)
  const existing = conversations.data?.find((c) => c.listingId === listingId && c.me === 'buyer')

  // Already talking about this item: carry on in that chat.
  useEffect(() => {
    if (existing) navigate(`${basePath}/${existing.id}`, { replace: true })
  }, [existing, basePath, navigate])

  if (listing.isPending || conversations.isPending) return <Skeleton className="h-112" />
  if (listing.isError) return <ErrorState error={listing.error} onRetry={() => listing.refetch()} />
  const l = listing.data
  const seller = l.merchant.kind === 'individual' ? 'the seller' : l.merchant.name

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link to={`/listings/${l.id}`} className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-xl px-2 text-sm font-bold text-muted no-underline hover:bg-sunken hover:text-ink">
        <BackIcon size={18} /> Back to the item
      </Link>
      <Card className="flex items-center gap-3 p-3 sm:p-4">
        <ProductImage category={l.category} src={l.images[0]} alt="" size="sm" className="size-14 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <strong className="truncate">{l.merchant.name}</strong>
          <span className="truncate text-xs text-subtle">{l.title}</span>
        </div>
      </Card>
      <Notice tone="neutral" icon={ShieldIcon}>
        Always pay through DrawMart: your money is only released to the seller after you confirm delivery. Never send money to an account number from a chat.
      </Notice>
      <Card className="flex min-h-60 flex-col p-4">
        <p className="m-auto max-w-xs text-center text-sm text-subtle">Ask {seller} anything about the item. They’ll see the chat once you send your first message.</p>
      </Card>
      <MessageBox
        autoFocus
        placeholder={`Message ${seller}…`}
        send={{
          isPending: send.isPending,
          mutate: (body, o) =>
            send.mutate(body, {
              onSuccess: (c) => {
                o.onSuccess()
                navigate(`${basePath}/${c.id}`, { replace: true })
              },
              onError: o.onError,
            }),
        }}
      />
    </div>
  )
}
