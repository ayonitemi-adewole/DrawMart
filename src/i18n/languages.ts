/**
 * Languages the app can show. Mirrored in public.set_language.
 *
 * Yoruba, Hausa and Igbo come next, one message file each. A language only reaches
 * real buyers once a native speaker has checked it and `reviewed` is true; until
 * then it only shows in test mode.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', reviewed: true },
  { code: 'pcm', name: 'Pidgin (draft)', reviewed: false },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

export const DEFAULT_LANGUAGE: LanguageCode = 'en'

export const isLanguageCode = (code: unknown): code is LanguageCode => LANGUAGES.some((l) => l.code === code)

export const availableLanguages = (testMode: boolean): { code: LanguageCode; name: string; reviewed: boolean }[] => LANGUAGES.filter((l) => l.reviewed || testMode)
