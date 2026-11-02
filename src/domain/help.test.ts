import { describe, expect, it } from 'vitest'
import { HELP_TOPICS, helpTopics } from './help'

describe('help centre', () => {
  it('shows stores the draw answers, and individuals the new-seller limits', () => {
    const store = helpTopics('store').map((t) => t.id)
    const individual = helpTopics('individual').map((t) => t.id)
    expect(store).toContain('draws')
    expect(store).not.toContain('new-sellers')
    expect(individual).toContain('new-sellers')
    expect(individual).not.toContain('draws')
  })

  it('uses the rules’ own numbers', () => {
    const text = JSON.stringify(HELP_TOPICS)
    expect(text).toContain('48 hours after delivery')
    expect(text).toContain('between 9am and 10pm')
    expect(text).toContain('₦200,000')
  })

  it('never gives the platform fee as a percentage', () => {
    expect(JSON.stringify(HELP_TOPICS.find((t) => t.id === 'fees'))).not.toMatch(/%|per ?cent/i)
  })
})
