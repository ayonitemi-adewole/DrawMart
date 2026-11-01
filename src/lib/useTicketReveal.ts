import { useCallback, useEffect, useRef, useState } from 'react'
import { REVEAL_FRAME_MS, revealFrames } from '@/domain/reveal'

export const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Plays the roll that ends on the real winning ticket. With reduced motion, there's no roll at all. */
export function useTicketReveal({ ticketCount, winningNumber, myNumbers, autoplay, onFinished }: { ticketCount: number; winningNumber: number; myNumbers: readonly number[]; autoplay: boolean; onFinished?: () => void }) {
  const canAnimate = !prefersReducedMotion()
  const build = useCallback(() => (canAnimate ? revealFrames(ticketCount, winningNumber, myNumbers) : []), [canAnimate, ticketCount, winningNumber, myNumbers])
  const [frames, setFrames] = useState<number[]>(() => (autoplay ? build() : []))
  const [index, setIndex] = useState(0)
  const rolling = index < frames.length
  const finished = useRef(onFinished)
  finished.current = onFinished

  useEffect(() => {
    if (!frames.length) return
    if (index >= frames.length) {
      finished.current?.()
      return
    }
    const timer = setTimeout(() => setIndex((i) => i + 1), REVEAL_FRAME_MS)
    return () => clearTimeout(timer)
  }, [frames, index])

  return {
    rolling,
    /** Always the real winner once the roll is over. */
    shown: rolling ? frames[index] : winningNumber,
    canAnimate,
    skip: () => setIndex(frames.length),
    replay: () => {
      setIndex(0)
      setFrames(build())
    },
  }
}
