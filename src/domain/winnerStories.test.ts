import { describe, expect, it } from 'vitest'
import { WINNER_CONSENT_TEXT, suggestedFirstName, winnerStoryError } from './winnerStories'

const ok = { firstName: 'Tunde', consent: true }

describe('winnerStoryError', () => {
  it('accepts a first name and consent', () => {
    expect(winnerStoryError(ok)).toBeNull()
    expect(winnerStoryError({ ...ok, firstName: '  Oluwaṣeun ' })).toBeNull()
    expect(winnerStoryError({ ...ok, firstName: 'Ngozi-Ada' })).toBeNull()
  })

  it('refuses anything that isn’t just a first name', () => {
    for (const firstName of ['Tunde Bakare', '08031234567', 'T', '', 'Tunde1', 'tunde@mail.com', 'A'.repeat(31)]) expect(winnerStoryError({ ...ok, firstName })).toBe('first_name')
  })

  it('needs consent', () => {
    expect(winnerStoryError({ ...ok, consent: false })).toBe('consent')
  })

  it('asks consent only for what’s shown', () => {
    expect(WINNER_CONSENT_TEXT).toContain('first name')
    expect(WINNER_CONSENT_TEXT).not.toMatch(/\barea\b/i)
  })
})

describe('suggestedFirstName', () => {
  it('takes only the first word of the account name', () => {
    expect(suggestedFirstName('Funke Adeyemi')).toBe('Funke')
    expect(suggestedFirstName('  Tunde  ')).toBe('Tunde')
  })

  it('suggests nothing when that wouldn’t pass', () => {
    for (const name of ['', null, undefined, 'buyer1', 'a@b.co']) expect(suggestedFirstName(name)).toBe('')
  })
})
