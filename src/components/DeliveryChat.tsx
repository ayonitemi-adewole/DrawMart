import { useDeliveryChat, useSendDeliveryMessage } from '@/api/hooks'
import { MessageBox, MessageList } from '@/pages/MessagesPage'
import { LockIcon } from './icons'
import { Sheet } from './Sheet'
import { ErrorState, Notice, Skeleton } from './ui'

/** The buyer ↔ rider chat for one order (deliveryChat.ts). Mounted only while open, so it only polls then. */
export function DeliveryChatSheet({ orderId, title, open, onClose }: { orderId: string; title: string; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <h2 className="pr-10 font-display text-2xl font-extrabold">{title}</h2>
      {open ? <Chat orderId={orderId} /> : null}
    </Sheet>
  )
}

function Chat({ orderId }: { orderId: string }) {
  const q = useDeliveryChat(orderId)
  const send = useSendDeliveryMessage(orderId)
  if (q.isPending) return <Skeleton className="h-40" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data.open) return <Notice tone="ticket">This chat has closed: the order has arrived or isn’t on its way any more.</Notice>
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 text-xs text-subtle">
        <LockIcon size={14} className="mt-0.5 shrink-0" /> Only you and {q.data.me === 'buyer' ? 'your rider' : 'the buyer'} see this, and it closes once the order arrives. Keep phone numbers out of it.
      </p>
      {q.data.messages.length ? (
        <MessageList messages={q.data.messages} me={q.data.me} />
      ) : (
        <p className="text-sm text-muted">{q.data.me === 'buyer' ? 'Tell your rider anything that helps them find you.' : 'Ask the buyer anything that helps you find them.'}</p>
      )}
      <MessageBox send={send} placeholder={q.data.me === 'buyer' ? 'e.g. Blue gate, ring twice' : 'e.g. I’m at the gate'} />
    </div>
  )
}
