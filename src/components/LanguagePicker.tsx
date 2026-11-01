import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api'
import { useAccess, useMe, useSetLanguage } from '@/api/hooks'
import { currentLanguage, setLanguage } from '@/i18n'
import { availableLanguages, isLanguageCode, type LanguageCode } from '@/i18n/languages'
import { cx, inputCls } from './ui'

/** Remembered on the account when signed in, and on this device either way. */
export function LanguagePicker({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const { signedIn, role } = useAccess()
  const save = useSetLanguage()
  const languages = availableLanguages(api.testMode)
  // Only English means there's nothing to choose.
  if (languages.length < 2) return null

  function choose(code: LanguageCode) {
    void setLanguage(code)
    if (signedIn && role === 'buyer') save.mutate(code)
  }

  return (
    <label className={cx('flex flex-col gap-1.5 text-sm', className)}>
      <span className="font-bold">{t('language.label')}</span>
      <select value={isLanguageCode(i18n.language) ? i18n.language : 'en'} onChange={(e) => choose(e.target.value as LanguageCode)} className={cx(inputCls, 'min-h-11 bg-surface font-bold')}>
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
      {i18n.language !== 'en' ? <span className="text-xs text-subtle">{t('language.draftNote')}</span> : null}
    </label>
  )
}

/** Applies the language saved on the account, so it follows the buyer to a new device. */
export function LanguageSync() {
  const me = useMe()
  const chosen = me.data?.language
  useEffect(() => {
    if (chosen && chosen !== currentLanguage()) void setLanguage(chosen)
  }, [chosen])
  return null
}
