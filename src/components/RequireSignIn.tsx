import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { useAccess } from '@/api/hooks'
import { LockIcon } from './icons'
import { EmptyState, Skeleton, buttonClass } from './ui'

type Need = 'account' | 'store' | 'admin'

const NEED_TEXT: Record<Exclude<Need, 'account'>, { title: string; body: string }> = {
  store: { title: 'For store accounts', body: 'This account isn’t linked to a store. Ask a DrawMart admin to link it.' },
  admin: { title: 'For admins', body: 'Only DrawMart admins can review listings.' },
}

/** Sends signed-out visitors to /login and keeps out accounts without the right access. */
export function RequireSignIn({ need = 'account', children }: { need?: Need; children: ReactNode }) {
  const access = useAccess()
  const location = useLocation()
  if (!access.ready) return <Skeleton className="h-72" />
  if (!access.signedIn) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if ((need === 'store' && !access.isStore) || (need === 'admin' && !access.isAdmin)) {
    return (
      <EmptyState
        icon={LockIcon}
        tone="neutral"
        title={NEED_TEXT[need].title}
        body={`You’re signed in as ${access.email ?? 'a buyer'}. ${NEED_TEXT[need].body}`}
        action={
          <Link to="/" className={buttonClass('outline')}>
            Back to live draws
          </Link>
        }
      />
    )
  }
  return children
}
