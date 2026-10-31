/**
 * Confirming a delivery. Each order has a 6-digit PIN only its buyer can see,
 * which they give the rider once they have the item, so a delivery can't be
 * claimed without them. Mirrored in public.confirm_delivery.
 */
export const DELIVERY_PIN_LENGTH = 6
/** Wrong tries before a pause: a PIN could otherwise simply be guessed. */
export const MAX_PIN_ATTEMPTS = 5
export const PIN_LOCK_MINUTES = 30

export function newDeliveryPin(random: () => number = Math.random): string {
  return String(Math.floor(random() * 10 ** DELIVERY_PIN_LENGTH)).padStart(DELIVERY_PIN_LENGTH, '0')
}

export const isDeliveryPin = (s: string) => new RegExp(`^[0-9]{${DELIVERY_PIN_LENGTH}}$`).test(s)

export interface PinState {
  attempts: number
  lockedUntil: string | null
}

export interface PinResult {
  confirmed: boolean
  attemptsLeft: number
  /** Set while nobody can try again. */
  lockedUntil: string | null
}

/** One try at a PIN: the outcome, and the state to keep for next time. */
export function checkPin(pin: string, entered: string, state: PinState, nowMs: number): { result: PinResult; state: PinState } {
  if (state.lockedUntil && Date.parse(state.lockedUntil) > nowMs) return { result: { confirmed: false, attemptsLeft: 0, lockedUntil: state.lockedUntil }, state }
  if (entered === pin) return { result: { confirmed: true, attemptsLeft: 0, lockedUntil: null }, state: { attempts: 0, lockedUntil: null } }
  // A lock that's run out starts the count again.
  const attempts = state.lockedUntil ? 1 : state.attempts + 1
  const lockedUntil = attempts >= MAX_PIN_ATTEMPTS ? new Date(nowMs + PIN_LOCK_MINUTES * 60_000).toISOString() : null
  return { result: { confirmed: false, attemptsLeft: Math.max(MAX_PIN_ATTEMPTS - attempts, 0), lockedUntil }, state: { attempts, lockedUntil } }
}
