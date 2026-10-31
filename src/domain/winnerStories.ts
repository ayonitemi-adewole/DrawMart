/**
 * Winners wall: a winner may choose to show their first name next to what they
 * won. Mirrored in private.winner_story_error.
 *
 * The name is one word with no digits, which rules out a full name or a phone number.
 */

/** Bump when WINNER_CONSENT_TEXT changes, so we know what each winner agreed to. */
export const WINNER_CONSENT_VERSION = 2
export const WINNER_CONSENT_TEXT = 'I agree to DrawMart showing my first name, what I won and the draw on the public Winners page. I can withdraw this at any time.'

export type WinnerStoryError = 'first_name' | 'consent'

export const WINNER_STORY_ERROR_TEXT: Record<WinnerStoryError, string> = {
  first_name: 'Enter just your first name: one word, with no numbers.',
  consent: 'Tick the box to agree, or leave this out. Your prize isn’t affected.',
}

const FIRST_NAME = /^[\p{L}'’-]{2,30}$/u

export function winnerStoryError(input: { firstName: string; consent: boolean }): WinnerStoryError | null {
  if (!FIRST_NAME.test(input.firstName.trim())) return 'first_name'
  if (!input.consent) return 'consent'
  return null
}

/** Starts the form from the first word of the account name, for the winner to check. Never the whole name. */
export function suggestedFirstName(displayName: string | null | undefined): string {
  const first = (displayName ?? '').trim().split(/\s+/)[0] ?? ''
  return FIRST_NAME.test(first) ? first : ''
}
