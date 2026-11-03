import { useSyncExternalStore } from 'react'
import { onlineManager, useMutationState } from '@tanstack/react-query'
import { ClockIcon, InfoIcon } from './icons'
import { Notice } from './ui'

/** Whether there's signal, as TanStack Query sees it: actions wait while it's false. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
  )
}

/** For riders (offlineJobs.ts): what still works without signal, and what's waiting to send. */
export function OfflineBanner() {
  const online = useOnline()
  const waiting = useMutationState({ filters: { status: 'pending' }, select: (m) => m.state.isPaused }).filter(Boolean).length
  if (online && !waiting) return null
  return (
    <Notice tone="ticket" icon={online ? ClockIcon : InfoIcon} title={online ? 'Sending what you did offline…' : 'No signal'}>
      {online ? null : (
        <>
          Your jobs are saved on this phone, so addresses, numbers and checklists still work. Maps may not load, but Get directions opens your map app.{' '}
        </>
      )}
      {waiting ? `${waiting === 1 ? '1 thing you did is' : `${waiting} things you did are`} waiting to send. Keep DrawMart open and it sends itself.` : 'Anything you do waits and sends itself when signal is back.'}
    </Notice>
  )
}

/** Next to an action that's waiting for signal. */
export function WaitingForSignal({ paused, children }: { paused: boolean; children?: React.ReactNode }) {
  if (!paused) return null
  return (
    <Notice tone="ticket" icon={ClockIcon} title="Waiting for signal">
      {children ?? 'This sends itself once you’re back online. Keep DrawMart open.'}
    </Notice>
  )
}
