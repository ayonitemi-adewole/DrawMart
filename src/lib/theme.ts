import { useSyncExternalStore } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'drawmart:theme'

/** Light unless they've chosen dark or Auto (follow the device). */
function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'system' ? v : 'light'
  } catch {
    return 'light'
  }
}

const media = () => window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()
let current: ThemePref = typeof window === 'undefined' ? 'light' : read()

function apply() {
  const dark = current === 'dark' || (current === 'system' && media().matches)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0A110E' : '#053B25')
}

if (typeof window !== 'undefined') {
  media().addEventListener('change', () => current === 'system' && apply())
}

export function setTheme(p: ThemePref) {
  try {
    if (p === 'light') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, p)
  } catch {
    /* storage blocked: the theme still applies for this visit */
  }
  current = p
  apply()
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Light/dark/system theme, remembered per browser and shared across components. */
export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => current)
  return [pref, setTheme] as const
}

export function isDark() {
  return document.documentElement.classList.contains('dark')
}
