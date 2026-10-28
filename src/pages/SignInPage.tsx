import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Outlet } from 'react-router'
import { api } from '@/api'
import type { AuthAdapter, AuthSession } from '@/api/types'
import { MailIcon, ShieldIcon } from '@/components/icons'
import { Button, Card, Field, Notice, Spinner, errorMessage, inputCls } from '@/components/ui'
import { Logo, TestModeBanner } from '@/layouts/BuyerLayout'

/**
 * Root route. With the mock backend (no accounts) it just renders the app.
 * With Supabase it waits for the session and shows sign-in when there is none.
 */
export function AuthGate() {
  if (!api.auth) return <Outlet />
  return <SessionGate auth={api.auth} />
}

function SessionGate({ auth }: { auth: AuthAdapter }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined)
  const lastUser = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    const update = (s: AuthSession | null) => {
      if (!alive) return
      // Never show one account's cached data to another.
      if (lastUser.current !== undefined && lastUser.current !== (s?.userId ?? null)) queryClient.clear()
      lastUser.current = s?.userId ?? null
      setSession(s)
    }
    auth.getSession().then(update, () => update(null))
    const unsubscribe = auth.onChange(update)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [auth, queryClient])

  if (session === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted" role="status" aria-label="Loading">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (!session) return <SignInPage auth={auth} />
  return <Outlet />
}

function SignInPage({ auth }: { auth: AuthAdapter }) {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const address = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter a valid email address.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await auth.sendSignInLink(address, window.location.origin + window.location.pathname)
      setSentTo(address)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <TestModeBanner />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5 py-10">
        <Logo />
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Sign in to play</h1>
          <p className="text-sm text-muted">No password needed. We’ll email you a link that signs you in.</p>
        </div>

        <Card className="flex flex-col gap-4 p-5">
          {sentTo ? (
            <>
              <Notice tone="brand" icon={MailIcon} title="Check your email">
                We sent a sign-in link to <strong>{sentTo}</strong>. Open it on this device to continue.
              </Notice>
              <Button variant="outline" onClick={() => setSentTo(null)}>
                Use a different email
              </Button>
            </>
          ) : (
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              <Field label="Email address" htmlFor="email" error={error ?? undefined}>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputCls}
                />
              </Field>
              <Button type="submit" size="lg" loading={busy}>
                Email me a sign-in link
              </Button>
            </form>
          )}
        </Card>

        <p className="flex items-start gap-2 text-xs text-subtle">
          <ShieldIcon size={16} className="mt-px shrink-0" />
          DrawMart is for adults 18+ living in licensed states. Play responsibly.
        </p>
      </main>
    </div>
  )
}
