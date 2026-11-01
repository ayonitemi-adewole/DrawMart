import { beforeEach, describe, expect, it } from 'vitest'
import en from './en.json'
import pcm from './pcm.json'
import i18n, { setLanguage } from './index'
import { LANGUAGES, availableLanguages, isLanguageCode } from './languages'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out[prefix + k] = v
    else Object.assign(out, flatten(v, `${prefix}${k}.`))
  }
  return out
}
const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()

const flatEn = flatten(en)
const flatPcm = flatten(pcm)

describe('message files', () => {
  it('has nothing in Pidgin that English doesn’t have', () => {
    expect(Object.keys(flatPcm).filter((k) => !(k in flatEn))).toEqual([])
  })

  it('has every non-regulated key in Pidgin, so nothing drops to English by accident', () => {
    expect(Object.keys(flatEn).filter((k) => !k.startsWith('regulated.') && !(k in flatPcm))).toEqual([])
  })

  it('keeps the same placeholders, or the numbers and names would go missing', () => {
    for (const [k, v] of Object.entries(flatPcm)) expect([k, placeholders(v)]).toEqual([k, placeholders(flatEn[k])])
  })

  it('leaves nothing empty', () => {
    for (const [k, v] of [...Object.entries(flatEn), ...Object.entries(flatPcm)]) expect([k, v.trim().length > 0]).toEqual([k, true])
  })
})

describe('regulated wording', () => {
  it('stays out of any language nobody has reviewed', () => {
    expect(Object.keys(flatPcm).filter((k) => k.startsWith('regulated.'))).toEqual([])
    expect(LANGUAGES.find((l) => l.code === 'pcm')?.reviewed).toBe(false)
  })
})

describe('choosing a language', () => {
  beforeEach(() => setLanguage('en'))

  it('shows Pidgin once chosen, with the placeholders filled in', async () => {
    await setLanguage('pcm')
    expect(i18n.t('nav.tickets')).toBe('Ticket')
    expect(i18n.t('card.percentSold', { percent: 40 })).toBe('40% don sell')
  })

  it('falls back to English for regulated text, so draw rules are never a guess', async () => {
    await setLanguage('pcm')
    expect(i18n.t('regulated.licenceShort')).toBe(en.regulated.licenceShort)
    expect(i18n.t('regulated.backIfYouLose', { percent: 20 })).toBe('20% back if you lose')
  })

  it('uses singular and plural in both languages', async () => {
    expect(i18n.t('browse.items', { count: 1 })).toBe('1 item')
    expect(i18n.t('browse.items', { count: 3 })).toBe('3 items')
    await setLanguage('pcm')
    expect(i18n.t('browse.items', { count: 3 })).toBe('3 items')
  })

  it('only offers unreviewed languages in test mode', () => {
    expect(availableLanguages(true).map((l) => l.code)).toEqual(['en', 'pcm'])
    expect(availableLanguages(false).map((l) => l.code)).toEqual(['en'])
  })

  it('knows its own codes', () => {
    expect(isLanguageCode('pcm')).toBe(true)
    expect(isLanguageCode('yo')).toBe(false)
    expect(isLanguageCode(null)).toBe(false)
  })
})

describe('screens moved to message files', () => {
  /** Grows as screens move over. Stops English creeping back into them. */
  const MIGRATED = import.meta.glob(['/src/components/NavMenu.tsx', '/src/components/ListingCard.tsx', '/src/pages/BrowsePage.tsx', '/src/pages/HomePage.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

  it('has no hard-coded sentences left in the markup', () => {
    expect(Object.keys(MIGRATED)).toHaveLength(4)
    for (const [file, source] of Object.entries(MIGRATED)) {
      const lines = source.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\/\*|\*|import )/.test(l))
      const found = lines.filter((l) => />\s*[A-Z][a-z]+(\s+[a-z]+)+\s*</.test(l) || /^\s+[A-Z][a-z]+(\s+[a-z]+)+[.,]?\s*$/.test(l) || /(title|placeholder|aria-label|label|body)="[A-Z][a-z]+/.test(l))
      expect([file, found]).toEqual([file, []])
    }
  })
})
