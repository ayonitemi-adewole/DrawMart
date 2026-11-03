import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { isPhoneOrTablet, thisDevice } from '@/lib/device'

/** Long enough to cover a burst of typing, short enough that results feel live. */
const WAIT_MS = 200

/**
 * A search box kept in the URL (?q=), so a link or the back button restores it.
 * The box holds its own text, because the URL updates too late to be an input's
 * value: fast typing or a pasted ID would lose characters. Going to a new search
 * also starts the list from its first page.
 *
 * `live: false` searches only on `submit` (the keyboard's Search key), for pages
 * whose length jumps as results change: on a phone that moves the box while
 * someone is typing in it.
 */
export function useSearchParam(name = 'q', { live = true }: { live?: boolean } = {}) {
  const [params, setParams] = useSearchParams()
  const inUrl = params.get(name) ?? ''
  const [text, setText] = useState(inUrl)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef(inUrl)
  const sent = useRef(new Set([inUrl]))

  useEffect(() => {
    // Anything else changing it (a Clear button, a link, going back) shows in the box.
    if (!sent.current.has(inUrl)) {
      clearTimeout(timer.current)
      latest.current = inUrl
      setText(inUrl)
    }
    if (inUrl === latest.current) sent.current = new Set([inUrl])
  }, [inUrl])

  useEffect(() => () => clearTimeout(timer.current), [])

  function send(value: string) {
    clearTimeout(timer.current)
    latest.current = value
    sent.current.add(value)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(name, value)
        else next.delete(name)
        next.delete('page')
        return next
      },
      { replace: true, preventScrollReset: true },
    )
  }

  function change(value: string) {
    setText(value)
    clearTimeout(timer.current)
    if (live) timer.current = setTimeout(() => send(value), WAIT_MS)
  }

  /** Searches for what's in the box now, or for `value`. */
  function submit(value = text) {
    setText(value)
    send(value.trim() ? value : '')
  }

  return { text, change, submit }
}

/**
 * The explore page's search (the hero box and the top bar's). Live on computers;
 * on phones and tablets it waits for the Search key, since results arriving while
 * typing make the page jump under the keyboard.
 */
export function useExploreSearch() {
  const [live] = useState(() => !isPhoneOrTablet(thisDevice()))
  return useSearchParam('q', { live })
}
