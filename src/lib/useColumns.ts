import { useSyncExternalStore } from 'react'

/**
 * How many cards fit in a row of the listing grid (`sm:grid-cols-2
 * lg:grid-cols-3`): 1 on phones, 2 from 640px, 3 from 1024px. Lets lists be
 * capped by rows rather than by a fixed count.
 */
const QUERIES = ['(min-width: 1024px)', '(min-width: 640px)'] as const

function columns(): number {
  if (typeof window === 'undefined' || !window.matchMedia) return 3
  if (window.matchMedia(QUERIES[0]).matches) return 3
  if (window.matchMedia(QUERIES[1]).matches) return 2
  return 1
}

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined
  const lists = QUERIES.map((q) => window.matchMedia(q))
  for (const l of lists) l.addEventListener('change', onChange)
  return () => lists.forEach((l) => l.removeEventListener('change', onChange))
}

export const useColumns = () => useSyncExternalStore(subscribe, columns, () => 3)
