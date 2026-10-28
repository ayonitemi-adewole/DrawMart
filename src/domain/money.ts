import type { Kobo } from './types'

export const KOBO_PER_NAIRA = 100

export function nairaToKobo(naira: number): Kobo {
  return Math.round(naira * KOBO_PER_NAIRA)
}

export function koboToNaira(kobo: Kobo): number {
  return kobo / KOBO_PER_NAIRA
}

/** "₦1,250,000" — kobo are shown only when the amount isn't whole naira. */
export function formatNaira(kobo: Kobo, opts: { signed?: boolean } = {}): string {
  const negative = kobo < 0
  const abs = Math.abs(kobo)
  const whole = Math.floor(abs / KOBO_PER_NAIRA)
  const rest = abs % KOBO_PER_NAIRA
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const body = `₦${grouped}${rest ? '.' + rest.toString().padStart(2, '0') : ''}`
  if (negative) return `−${body}`
  return opts.signed && kobo > 0 ? `+${body}` : body
}

/** Parses user input like "1,000,000" or "₦5000" into kobo. Returns 0 for junk. */
export function parseNairaInput(input: string): Kobo {
  const n = Number(input.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? nairaToKobo(n) : 0
}

/** Multiply by a basis-point rate, rounding to the nearest kobo. */
export function applyBps(amount: Kobo, bps: number): Kobo {
  return Math.round((amount * bps) / 10_000)
}
