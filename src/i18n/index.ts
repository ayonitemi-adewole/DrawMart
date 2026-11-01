import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import { DEFAULT_LANGUAGE, isLanguageCode, type LanguageCode } from './languages'

/**
 * The app's text. English always loads, and fills in anything a language doesn't
 * have, such as the regulated wording that stays in English until it's reviewed.
 * Other languages load only for people who choose them.
 */
const KEY = 'drawmart:language'

const LOADERS: Partial<Record<LanguageCode, () => Promise<{ default: object }>>> = {
  pcm: () => import('./pcm.json'),
}

export function savedLanguage(): LanguageCode {
  try {
    const saved = localStorage.getItem(KEY)
    return isLanguageCode(saved) ? saved : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

void i18n.use(initReactI18next).init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  resources: { en: { translation: en } },
  // React already escapes what it renders.
  interpolation: { escapeValue: false },
})

/** Switches the app's language, remembered on this device. Saving it on the account is the caller's job. */
export async function setLanguage(code: LanguageCode): Promise<void> {
  const load = LOADERS[code]
  if (load && !i18n.hasResourceBundle(code, 'translation')) {
    i18n.addResourceBundle(code, 'translation', (await load()).default)
  }
  await i18n.changeLanguage(code)
  if (typeof document !== 'undefined') document.documentElement.lang = code
  try {
    localStorage.setItem(KEY, code)
  } catch {
    /* storage blocked: it still applies for this visit */
  }
}

export const currentLanguage = (): LanguageCode => (isLanguageCode(i18n.language) ? i18n.language : DEFAULT_LANGUAGE)

export default i18n
