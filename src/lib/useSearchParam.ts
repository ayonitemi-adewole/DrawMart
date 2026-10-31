import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

/** Long enough to cover a burst of typing, short enough that results feel live. */
const WAIT_MS = 200

/**
 * A search box kept in the URL (?q=), so a link or the back button restores it.
 * The box holds its own text, because the URL updates too late to be an input's
 * value: fast typing or a pasted ID would lose characters. Going to a new search
 * also starts the list from its first page.
 */
export function useSearchParam(name = 'q') {
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

  function change(value: string) {
    setText(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
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
    }, WAIT_MS)
  }

  return { text, change }
}
