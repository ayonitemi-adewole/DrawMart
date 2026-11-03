import { describe, expect, it } from 'vitest'
import { categoryOrder, feedJitter, forgetSearch, personalFeed, recentSearchSuggestions, rememberSearch, rememberView, tasteFrom, type FeedItem, type FeedListing, type FeedSignals } from './feed'
import type { Category } from './types'

const NONE: FeedSignals = { bought: [], saved: [], viewed: [], searches: [] }

const listing = (id: string, category: Category, merchantId = 'm-a', title = id): FeedListing => ({
  id, category, merchantId, ticketsSold: 0, ticketCount: 100, productCode: `PRD-${id.toUpperCase().padEnd(6, '2')}`, title, description: '', merchant: { name: 'Shop', area: 'Ikeja' },
})
const item = (listingId: string, category: Category, merchantId = 'm-a'): FeedItem => ({ listingId, category, merchantId })

const MIX = [
  listing('p1', 'Phones'), listing('p2', 'Phones'), listing('f1', 'Fashion'), listing('f2', 'Fashion'),
  listing('h1', 'Home'), listing('h2', 'Home'), listing('e1', 'Electronics'), listing('e2', 'Electronics'),
]

describe('personal feed', () => {
  it('puts what they buy first', () => {
    const taste = tasteFrom({ ...NONE, bought: [item('old', 'Fashion', 'm-z')] })
    const feed = personalFeed(MIX, taste, 'seed-1')
    expect(feed.slice(0, 2).map((l) => l.category)).toEqual(['Fashion', 'Fashion'])
  })

  it('follows searches, newest first', () => {
    const list = [listing('a', 'Home', 'm-a', 'Standing fan'), listing('b', 'Home', 'm-a', 'Blender'), listing('c', 'Phones', 'm-a', 'iPhone 13')]
    const feed = personalFeed(list, tasteFrom({ ...NONE, searches: ['iphone', 'fan'] }), 's')
    expect(feed.map((l) => l.id).slice(0, 2)).toEqual(['c', 'a'])
  })

  it('moves things they already hold down, so there’s something new', () => {
    const list = [listing('held', 'Phones'), listing('fresh', 'Phones')]
    const taste = tasteFrom({ ...NONE, bought: [item('held', 'Phones')] })
    // Over many openings, the new one leads far more often.
    let freshFirst = 0
    for (let i = 0; i < 100; i++) if (personalFeed(list, taste, `s${i}`)[0].id === 'fresh') freshFirst++
    expect(freshFirst).toBeGreaterThan(80)
  })

  it('changes with each opening and holds while open', () => {
    const taste = tasteFrom(NONE)
    expect(personalFeed(MIX, taste, 'a')).toEqual(personalFeed(MIX, taste, 'a'))
    const orders = new Set(Array.from({ length: 10 }, (_, i) => personalFeed(MIX, taste, `open-${i}`).map((l) => l.id).join()))
    expect(orders.size).toBeGreaterThan(5)
  })

  it('keeps every listing, just reordered', () => {
    const feed = personalFeed(MIX, tasteFrom({ ...NONE, saved: [item('h1', 'Home')] }), 'x')
    expect([...feed].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...MIX].sort((a, b) => a.id.localeCompare(b.id)))
  })

  it('orders categories by taste', () => {
    const taste = tasteFrom({ ...NONE, bought: [item('a', 'Cars')], saved: [item('b', 'Home')] })
    expect(categoryOrder(['Phones', 'Electronics', 'Home', 'Cars', 'Fashion'], taste, 'z').slice(0, 2)).toEqual(['Cars', 'Home'])
  })

  it('knows when there’s nothing to go on', () => {
    expect(tasteFrom(NONE).known).toBe(false)
    expect(tasteFrom({ ...NONE, searches: ['tv'] }).known).toBe(true)
  })

  it('jitter is steady and in range', () => {
    expect(feedJitter('s', 'k')).toBe(feedJitter('s', 'k'))
    for (let i = 0; i < 50; i++) {
      const j = feedJitter(`s${i}`, 'k')
      expect(j).toBeGreaterThanOrEqual(0)
      expect(j).toBeLessThan(1)
    }
  })
})

describe('remembering', () => {
  it('keeps the finished word, not each step of typing', () => {
    let list: string[] = []
    for (const t of ['i', 'ip', 'iph', 'iphone']) list = rememberSearch(list, t)
    expect(list).toEqual(['iphone'])
    list = rememberSearch(list, 'Fan ')
    expect(list).toEqual(['fan', 'iphone'])
    expect(rememberSearch(list, 'iphone')).toEqual(['iphone', 'fan'])
  })

  it('caps both lists', () => {
    let s: string[] = []
    for (let i = 0; i < 15; i++) s = rememberSearch(s, `word${i}x`.replace(/\d/g, (d) => 'abcdefghij'[+d]))
    expect(s.length).toBe(10)
    let v: FeedItem[] = []
    for (let i = 0; i < 40; i++) v = rememberView(v, item(`l${i}`, 'Home'))
    expect(v.length).toBe(30)
    expect(rememberView(v, item('l5', 'Home'))[0].listingId).toBe('l5')
    expect(rememberView(v, item('l5', 'Home')).length).toBe(30)
  })
})

describe('recent searches under the box', () => {
  const list = ['iphone', 'fan', 'generator', 'iphone case', 'tv', 'laptop', 'blender', 'shoes']

  it('shows the newest 6', () => {
    expect(recentSearchSuggestions(list, '')).toEqual(list.slice(0, 6))
  })

  it('narrows to what’s typed, leaving out an exact match', () => {
    expect(recentSearchSuggestions(list, 'IPH')).toEqual(['iphone', 'iphone case'])
    expect(recentSearchSuggestions(list, 'iphone')).toEqual(['iphone case'])
  })

  it('forgets one', () => {
    expect(forgetSearch(['a1', 'b2'], 'a1')).toEqual(['b2'])
  })
})
