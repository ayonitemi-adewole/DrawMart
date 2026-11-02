import { useAcceptStoreInvite, useMyStoreInvites } from '@/api/hooks'
import { ROLE_TEXT } from '@/domain/team'
import { StoreIcon } from './icons'
import { useToast } from './toast'
import { Button, Notice, errorMessage } from './ui'

/** In the buyer app: a store has invited this email to join its team. */
export function StoreInviteBanner() {
  const q = useMyStoreInvites()
  const accept = useAcceptStoreInvite()
  const toast = useToast()
  if (!q.data?.length) return null

  return (
    <div className="mb-5 flex flex-col gap-3">
      {q.data.map((i) => (
        <Notice
          key={i.id}
          tone="sky"
          icon={StoreIcon}
          title={`${i.storeName} invited you to join their team as ${ROLE_TEXT[i.role].label.toLowerCase()}`}
          action={
            <Button
              size="sm"
              className="min-h-11"
              loading={accept.isPending}
              onClick={() =>
                accept.mutate(i.id, {
                  // A full load, so the app picks up the account's new role.
                  onSuccess: () => window.location.assign('/store'),
                  onError: (e) => toast(errorMessage(e), 'error'),
                })
              }
            >
              Accept
            </Button>
          }
        >
          This account becomes a store account for {i.storeName}: you’ll use it to work for the store, and won’t be able to buy with it.
        </Notice>
      ))}
    </div>
  )
}
