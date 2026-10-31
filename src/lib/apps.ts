import type { AccountRole } from '@/api/types'

/** Where each app lives. An account only ever opens its own. */
export const APP_HOME: Record<AccountRole, string> = { buyer: '/', store: '/store', admin: '/admin', delivery: '/delivery' }

export const APP_LABEL: Record<AccountRole, string> = { buyer: 'buyer', store: 'store', admin: 'admin', delivery: 'delivery' }

/** Which app a path belongs to. Everything outside /store, /admin and /delivery is the buyer app. */
export function appFor(path: string): AccountRole {
  for (const role of ['store', 'admin', 'delivery'] as const) {
    if (path === APP_HOME[role] || path.startsWith(`${APP_HOME[role]}/`) || path.startsWith(`${APP_HOME[role]}?`)) return role
  }
  return 'buyer'
}

/** Where to go after signing in: `next` if it's inside this account's app, otherwise the app's home. */
export function landingFor(role: AccountRole, next: string | null): string {
  const safe = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : null
  return safe && appFor(safe) === role ? safe : APP_HOME[role]
}
