/**
 * What chat apps see for a shared listing. They don't run the app's JavaScript,
 * so a Vercel function answers them (vercel.json). Files in api/ deploy on their
 * own and can't reach src/, so the two formats here are checked against
 * src/domain in preview.test.mjs.
 *
 * Reads with the publishable key only, so row-level security applies: a listing
 * buyers can't see comes back empty and gets the general preview.
 */

/** Named columns: nothing here needs anything private, and nothing private can slip in. */
export const LISTING_COLUMNS = 'id,kind,status,title,images,price_kobo,fallback_price_kobo,buyer_ticket_price_kobo,ticket_count,tickets_sold'

export const GENERAL_PREVIEW = {
  title: 'DrawMart: win it for the price of a ticket',
  description: 'Real items from verified Lagos stores. Every draw is public, and anyone can check it.',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isListingId = (id) => typeof id === 'string' && UUID.test(id)

/** Same as formatNaira in src/domain/money.ts. */
export function formatNaira(kobo) {
  const whole = Math.floor(kobo / 100)
  const rest = kobo % 100
  return `₦${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${rest ? '.' + rest.toString().padStart(2, '0') : ''}`
}

/** Same as percentSold in src/domain/chance.ts. */
export const percentSold = (sold, count) => (count > 0 ? Math.floor((sold / count) * 100) : 0)

/** The one line that goes under the title, in both the text and the image. */
export function previewLine(l) {
  switch (l.status) {
    case 'live':
      return `${formatNaira(l.buyer_ticket_price_kobo)} a ticket · ${percentSold(l.tickets_sold, l.ticket_count)}% sold`
    case 'for_sale':
      return `Buy now for ${formatNaira(l.kind === 'product' ? l.price_kobo : (l.fallback_price_kobo ?? l.price_kobo))}`
    case 'sold_out':
      return 'All tickets sold'
    case 'drawn':
      return 'Draw complete'
    case 'sold':
      return 'Sold'
    default:
      return 'On DrawMart'
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

/** The page chat apps read. There's nothing for people here: they get the app itself. */
export function previewHtml({ title, description, url, imageUrl }) {
  const [t, d, u, i] = [title, description, url, imageUrl].map(escapeHtml)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${t}</title>
<meta name="description" content="${d}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="DrawMart" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:url" content="${u}" />
<meta property="og:image" content="${i}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="canonical" href="${u}" />
</head>
<body><a href="${u}">${t}</a></body>
</html>
`
}

/** The site's own address, from what the platform says it was reached on. */
export function originOf(req) {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim()
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0].trim()
  return /^[a-z0-9.:-]+$/i.test(host) ? `${proto === 'http' ? 'http' : 'https'}://${host}` : ''
}

/** Null when it can't be read, is hidden, or there's no backend configured. Never throws. */
export async function fetchListing(id, env = process.env) {
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key || !isListingId(id)) return null
  try {
    const res = await fetch(`${url}/rest/v1/listings?id=eq.${id}&select=${LISTING_COLUMNS}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const rows = await res.json()
    return rows[0] ?? null
  } catch {
    return null
  }
}

/**
 * Where to fetch a listing's first photo, only from our own assets or our own
 * storage: this server shouldn't fetch whatever address a listing happens to hold.
 */
export function photoUrl(l, origin, env = process.env) {
  const image = l.images?.[0]
  if (typeof image !== 'string') return null
  if (/^\/assets\/[\w.-]+$/.test(image)) return origin ? `${origin}${image}` : null
  const base = env.VITE_SUPABASE_URL
  return base && image.startsWith(`${base}/storage/v1/object/public/`) ? image : null
}
