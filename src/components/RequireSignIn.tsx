import type { ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { useAccess, useSignOut } from '@/api/hooks'
import type { AccountRole } from '@/api/types'
import { APP_HOME, APP_LABEL } from '@/lib/apps'
import { LockIcon } from './icons'
import { Button, EmptyState, Skeleton, buttonClass } from './ui'

/**
 * Lets in only accounts of one app. Signed-out visitors go to /login, which
 * brings them back here; accounts from another app are turned away.
 */
export function RequireSignIn({ role, children }: { role: AccountRole; children: ReactNode }) {
  const access = useAccess()
  const location = useLocation()
  if (!access.ready) return <Skeleton className="m-4 h-72" />
  if (!access.signedIn) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (access.role !== role) return <WrongApp needed={role} />
  return children
}

function WrongApp({ needed }: { needed: AccountRole }) {
  const { role, email } = useAccess()
  const signOut = useSignOut()
  const navigate = useNavigate()
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <EmptyState
        icon={LockIcon}
        tone="neutral"
        title={`This is the ${APP_LABEL[needed]} app`}
        body={`You’re signed in as ${email ?? 'someone else'}, which is a ${role ? APP_LABEL[role] : ''} account. Each account opens one app. Sign out and sign in with a ${APP_LABEL[needed]} account to continue.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {role ? (
              <Link to={APP_HOME[role]} className={buttonClass('outline')}>
                Back to my app
              </Link>
            ) : null}
            <Button loading={signOut.isPending} onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate(`/login?next=${encodeURIComponent(APP_HOME[needed])}`) })}>
              Sign out
            </Button>
          </div>
        }
      />
    </div>
  )
}
