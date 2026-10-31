import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { percentSold as domainPercentSold } from '../../src/domain/chance'
import { formatNaira as domainFormatNaira } from '../../src/domain/money'
import previewHandler from '../listing-preview.mjs'
import imageHandler, { drawText, renderPreview } from '../listing-preview-image.mjs'
import { LISTING_COLUMNS, escapeHtml, fetchListing, formatNaira, isListingId, originOf, percentSold, photoUrl, previewHtml, previewLine } from './preview.mjs'

const ID = '11111111-1111-4111-8111-000000000001'
const ENV = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'pub' }
const draw = { id: ID, kind: 'raffle', status: 'live', title: 'Toyota Corolla 2022', images: ['/assets/toyota-corolla-2022.jpg'], price_kobo: 2_600_000_000, fallback_price_kobo: null, buyer_ticket_price_kobo: 5_000_000, ticket_count: 520, tickets_sold: 447 }
const product = { ...draw, kind: 'product', status: 'for_sale', price_kobo: 45_000_000, buyer_ticket_price_kobo: 0, ticket_count: 0, tickets_sold: 0 }

function fakeRes() {
  const res = { headers: {}, code: null, body: null, redirected: null }
  res.setHeader = (k, v) => void (res.headers[k.toLowerCase()] = v)
  res.status = (c) => ((res.code = c), res)
  res.send = (b) => ((res.body = b), res)
  res.redirect = (c, to) => ((res.code = c), (res.redirected = to), res)
  return res
}
const req = (id) => ({ query: { id }, headers: { host: 'drawmart.example', 'x-forwarded-proto': 'https' } })

describe('preview text', () => {
  it('formats money and share sold exactly as the app does', () => {
    for (const k of [0, 100, 50_000, 100_000, 123_456_789, 5_000_050]) expect(formatNaira(k)).toBe(domainFormatNaira(k))
    for (const [s, c] of [[0, 0], [1, 520], [241, 260], [999, 1000], [1000, 1000]]) expect(percentSold(s, c)).toBe(domainPercentSold(s, c))
  })

  it('says the ticket price and share sold for a live draw', () => {
    expect(previewLine(draw)).toBe('₦50,000 a ticket · 85% sold')
  })

  it('says the price for anything on sale, and never promises tickets once sales have ended', () => {
    expect(previewLine(product)).toBe('Buy now for ₦450,000')
    expect(previewLine({ ...draw, status: 'for_sale', fallback_price_kobo: 2_500_000_000 })).toBe('Buy now for ₦25,000,000')
    expect(previewLine({ ...draw, status: 'sold_out' })).toBe('All tickets sold')
    expect(previewLine({ ...draw, status: 'drawn' })).toBe('Draw complete')
    expect(previewLine({ ...draw, status: 'sold' })).toBe('Sold')
  })

  it('can’t be broken out of by a listing title', () => {
    const html = previewHtml({ title: `"><script>alert('x')</script>`, description: 'd', url: 'https://a/b', imageUrl: 'https://a/i?x=1&y=2' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('https://a/i?x=1&amp;y=2')
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})

describe('reading a listing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks only for named columns, with the public key', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([draw])))
    vi.stubGlobal('fetch', f)
    expect(await fetchListing(ID, ENV)).toEqual(draw)
    const [url, opts] = f.mock.calls[0]
    expect(url).toContain(`select=${LISTING_COLUMNS}`)
    expect(url).not.toContain('*')
    expect(LISTING_COLUMNS).not.toMatch(/seed|winner|handover|phone|address/)
    expect(opts.headers.apikey).toBe('pub')
  })

  it('rejects anything but a listing id before it reaches the query', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(isListingId(ID)).toBe(true)
    for (const bad of ['', 'L-abc123', `${ID}&select=*`, `${ID}/../x`, null]) expect(await fetchListing(bad, ENV)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('copes with no backend, a hidden listing and a failed request', async () => {
    expect(await fetchListing(ID, {})).toBeNull()
    vi.stubGlobal('fetch', async () => new Response('[]'))
    expect(await fetchListing(ID, ENV)).toBeNull()
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }))
    expect(await fetchListing(ID, ENV)).toBeNull()
    vi.stubGlobal('fetch', async () => {
      throw new Error('down')
    })
    expect(await fetchListing(ID, ENV)).toBeNull()
  })

  it('only fetches photos from our own assets and storage', () => {
    const at = (image) => photoUrl({ images: [image] }, 'https://drawmart.example', ENV)
    expect(at('/assets/a-b_c.jpg')).toBe('https://drawmart.example/assets/a-b_c.jpg')
    const stored = 'https://x.supabase.co/storage/v1/object/public/listing-photos/a.jpg'
    expect(at(stored)).toBe(stored)
    for (const bad of ['https://evil.example/a.jpg', 'http://169.254.169.254/latest', 'https://x.supabase.co/rest/v1/listings', 'https://x.supabase.co.evil.example/storage/v1/object/public/a.jpg', '/assets/../secret', '//evil.example/a.jpg']) expect(at(bad)).toBeNull()
    expect(photoUrl({ images: [] }, 'https://a', ENV)).toBeNull()
  })

  it('takes its address from the platform, ignoring a bad host', () => {
    expect(originOf(req(ID))).toBe('https://drawmart.example')
    expect(originOf({ headers: { 'x-forwarded-host': 'a.example, b.example' } })).toBe('https://a.example')
    expect(originOf({ headers: { host: 'bad host"><x' } })).toBe('')
  })
})

describe('the preview page', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', ENV.VITE_SUPABASE_URL)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', ENV.VITE_SUPABASE_PUBLISHABLE_KEY)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('shows the title, ticket price and generated image for a listing', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify([draw])))
    const res = fakeRes()
    await previewHandler(req(ID), res)
    expect(res.code).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('<meta property="og:title" content="Toyota Corolla 2022" />')
    expect(res.body).toContain('₦50,000 a ticket · 85% sold')
    expect(res.body).toContain(`<meta property="og:image" content="https://drawmart.example/api/listing-preview-image?id=${ID}" />`)
    expect(res.body).toContain(`<meta property="og:url" content="https://drawmart.example/listings/${ID}" />`)
  })

  it('gives a hidden listing the general preview, saying nothing about it', async () => {
    vi.stubGlobal('fetch', async () => new Response('[]'))
    const res = fakeRes()
    await previewHandler(req(ID), res)
    expect(res.code).toBe(200)
    expect(res.body).toContain('DrawMart: win it for the price of a ticket')
    expect(res.body).toContain('/assets/heroBanner-1-900.jpg')
    expect(res.body).not.toContain('listing-preview-image')
  })
})

describe('the preview image', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  const photo = () => sharp({ create: { width: 900, height: 1200, channels: 3, background: '#884422' } }).jpeg().toBuffer()

  it('is a small JPEG of the size chat apps expect, with or without a photo', async () => {
    for (const p of [await photo(), null]) {
      const jpeg = await renderPreview(draw, p)
      const meta = await sharp(jpeg).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1200, 630])
      expect(jpeg.length).toBeLessThan(300 * 1024)
    }
  })

  it('draws every character it uses, above all the naira sign', async () => {
    // A character the fonts lack is drawn as the same empty box as any other they lack.
    const missing = await drawText('\uE000')
    for (const c of ['₦', '5', 'a', 'é', '·', ',', '%']) expect(await drawText(c)).not.toBe(missing)
    expect(await drawText('₦')).not.toBe(await drawText('5'))
  })

  it('copes with a very long title', async () => {
    expect((await sharp(await renderPreview({ ...draw, title: 'A very long title '.repeat(20) }, null)).metadata()).width).toBe(1200)
  })

  it('serves a listing’s picture, and falls back rather than failing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', ENV.VITE_SUPABASE_URL)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', ENV.VITE_SUPABASE_PUBLISHABLE_KEY)
    const image = await photo()
    vi.stubGlobal('fetch', async (url) => (String(url).includes('/rest/v1/') ? new Response(JSON.stringify([draw])) : new Response(image, { headers: { 'content-type': 'image/jpeg' } })))
    const ok = fakeRes()
    await imageHandler(req(ID), ok)
    expect(ok.code).toBe(200)
    expect(ok.headers['content-type']).toBe('image/jpeg')

    vi.stubGlobal('fetch', async () => new Response('[]'))
    const hidden = fakeRes()
    await imageHandler(req(ID), hidden)
    expect(hidden.code).toBe(302)
    expect(hidden.redirected).toContain('/assets/heroBanner-1-900.jpg')
  })
})

describe('vercel.json', () => {
  const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
  const rule = config.rewrites[0]
  const agent = new RegExp(`^${rule.has[0].value}$`)

  it('sends chat apps and social networks to the preview', () => {
    for (const ua of ['WhatsApp/2.23.20.0 A', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'Twitterbot/1.0', 'TelegramBot (like TwitterBot)', 'LinkedInBot/1.0', 'Slackbot-LinkExpanding 1.0', 'Mozilla/5.0 (compatible; Discordbot/2.0)']) expect(agent.test(ua)).toBe(true)
  })

  it('leaves people with the app, including inside Facebook’s and WhatsApp’s browsers', () => {
    for (const ua of ['Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1', 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440]']) expect(agent.test(ua)).toBe(false)
  })

  it('checks the preview rule first, and keeps the app as the catch-all', () => {
    expect(rule.source).toBe('/listings/:id')
    expect(rule.destination).toBe('/api/listing-preview?id=:id')
    expect(config.rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/index.html' })
  })
})
