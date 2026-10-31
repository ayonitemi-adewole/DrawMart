import { useSyncExternalStore } from 'react'
import { formatNaira } from '@/domain/money'
import type { Kobo } from '@/domain/types'

const KEY = 'drawmart:balance-hidden'
export const HIDDEN_BALANCE = '₦ ••••••'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

const listeners = new Set<() => void>()
let current = typeof window === 'undefined' ? false : read()

function update(hidden: boolean) {
  current = hidden
  listeners.forEach((l) => l())
}

export function setBalanceHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* storage blocked: it still applies for this visit */
  }
  update(hidden)
}

// Other tabs follow along.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) update(read())
  })
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Whether wallet balances are hidden, remembered per browser and shared across the app. */
export function useBalanceHidden() {
  const hidden = useSyncExternalStore(subscribe, () => current)
  return [hidden, setBalanceHidden] as const
}

/** Formats a wallet balance, or masks it. Use this wherever the buyer's balance is shown. */
export function useBalanceText() {
  const [hidden] = useBalanceHidden()
  return (kobo: Kobo) => (hidden ? HIDDEN_BALANCE : formatNaira(kobo))
}
