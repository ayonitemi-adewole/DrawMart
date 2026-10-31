import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '@/api'
import { useDisablePush, useEnablePush, usePushDeviceState, usePushPreferences, useSetPushPreference } from '@/api/hooks'
import { PUSH_CATEGORIES } from '@/domain/push'
import { dismissPushPrompt, pushPromptDismissed } from '@/lib/push'
import { BellIcon } from './icons'
import { useToast } from './toast'
import { Button, Card, cx, errorMessage } from './ui'

function useTurnOn() {
  const enable = useEnablePush()
  const toast = useToast()
  return {
    pending: enable.isPending,
    turnOn: (onDone?: () => void) =>
      enable.mutate(undefined, {
        onSuccess: (on) => {
          toast(on ? 'Notifications are on for this device.' : 'Notifications stay off. You can change this in your browser or device settings.', on ? 'success' : 'info')
          onDone?.()
        },
        onError: (e) => toast(errorMessage(e), 'error'),
      }),
  }
}

/**
 * Offered after a meaningful moment, such as buying a ticket, and never on a first
 * visit. Permission is only asked for when they tap, because a browser only lets
 * you ask once.
 */
export function PushPrompt({ className }: { className?: string }) {
  const state = usePushDeviceState()
  const { turnOn, pending } = useTurnOn()
  const [dismissed, setDismissed] = useState(pushPromptDismissed)
  if (!api.pushPublicKey || dismissed || state.data !== 'off') return null
  const close = () => {
    dismissPushPrompt()
    setDismissed(true)
  }
  return (
    <div className={cx('flex w-full flex-col gap-2 rounded-2xl bg-sunken p-3 text-left text-sm', className)}>
      <div className="flex items-start gap-2">
        <BellIcon size={18} className="mt-0.5 shrink-0 text-brand" />
        <span className="min-w-0">
          <strong>Get results on this device?</strong> We’ll tell you when a draw you’re in has a result and when your order moves, even with the app closed. Choose what you get in Account.
        </span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" loading={pending} onClick={() => turnOn(close)}>
          Turn on
        </Button>
        <Button variant="ghost" size="sm" onClick={close}>
          Not now
        </Button>
      </div>
    </div>
  )
}

const STATE_TEXT = {
  unsupported: 'This browser can’t show notifications when the app is closed.',
  needs_home_screen: 'On iPhone, add DrawMart to your Home Screen first: tap Share, then Add to Home Screen. Open it from there and turn notifications on here.',
  blocked: 'Notifications are blocked for DrawMart. You can allow them in your browser or device settings.',
}

/** On the notifications page: one switch for this device. Which kinds to get stays in Account. */
export function PushToggle() {
  const state = usePushDeviceState()
  const disable = useDisablePush()
  const toast = useToast()
  const { turnOn, pending } = useTurnOn()
  // Hidden from real buyers if the keys are missing, but testers need to know why there's no switch.
  if (!api.pushPublicKey && !api.testMode) return null

  const on = state.data === 'on'
  const canSwitch = !!api.pushPublicKey && (on || state.data === 'off')
  const sub = !api.pushPublicKey
    ? 'Not set up yet: this needs the push keys from the setup guide.'
    : state.data === 'unsupported' || state.data === 'needs_home_screen' || state.data === 'blocked'
      ? STATE_TEXT[state.data]
      : on
        ? null
        : 'Get told on this device, even with the app closed.'

  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sunken text-muted">
        <BellIcon size={18} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col text-sm">
        <span id="push-toggle-label" className="font-bold">
          Push notifications
        </span>
        {on ? (
          <span className="text-xs text-subtle">
            On for this device. <Link to="/account">Choose what you get</Link>
          </span>
        ) : (
          <span className="text-xs text-subtle">{sub}</span>
        )}
      </div>
      {canSwitch ? (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="push-toggle-label"
          disabled={pending || disable.isPending}
          onClick={() => (on ? disable.mutate(undefined, { onError: (e) => toast(errorMessage(e), 'error') }) : turnOn())}
          className="flex size-11 w-14 shrink-0 cursor-pointer items-center justify-center disabled:opacity-60"
        >
          <span className={cx('flex h-7 w-12 items-center rounded-full p-0.5 transition', on ? 'justify-end bg-brand' : 'justify-start bg-line-strong')}>
            <span className="size-6 rounded-full bg-surface shadow-card" />
          </span>
        </button>
      ) : null}
    </Card>
  )
}

/** In Account: this device on or off, and which kinds to get on every device. */
export function PushSettings() {
  const state = usePushDeviceState()
  const prefs = usePushPreferences()
  const setPreference = useSetPushPreference()
  const disable = useDisablePush()
  const toast = useToast()
  const { turnOn, pending } = useTurnOn()
  const onError = (e: unknown) => toast(errorMessage(e), 'error')
  if (!api.pushPublicKey) return null

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <BellIcon size={18} className="shrink-0 text-muted" />
        <strong className="min-w-0 flex-1">Push notifications</strong>
        {state.data === 'on' ? (
          <Button variant="ghost" size="sm" loading={disable.isPending} onClick={() => disable.mutate(undefined, { onError })}>
            Turn off
          </Button>
        ) : state.data === 'off' ? (
          <Button size="sm" loading={pending} onClick={() => turnOn()}>
            Turn on
          </Button>
        ) : null}
      </div>
      {state.data === 'unsupported' || state.data === 'needs_home_screen' || state.data === 'blocked' ? <p className="text-sm text-muted">{STATE_TEXT[state.data]}</p> : null}
      {state.data === 'on' ? (
        <ul className="flex flex-col border-t border-line pt-1">
          {PUSH_CATEGORIES.map((c) => (
            <li key={c.value}>
              <label className="flex min-h-14 cursor-pointer items-center gap-3">
                <span className="flex min-w-0 flex-1 flex-col text-sm">
                  <span className="font-bold">{c.label}</span>
                  <span className="text-xs text-subtle">{c.sub}</span>
                </span>
                <input
                  type="checkbox"
                  className="size-5 shrink-0"
                  checked={prefs.data?.[c.value] ?? true}
                  disabled={!prefs.data}
                  onChange={(e) => setPreference.mutate({ category: c.value, enabled: e.target.checked }, { onError })}
                />
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}
