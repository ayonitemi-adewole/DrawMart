import { GENERAL_PREVIEW, fetchListing, isListingId, originOf, previewHtml, previewLine } from './_lib/preview.mjs'

/** /listings/:id for chat apps and social networks, sent here by vercel.json. */
export default async function handler(req, res) {
  const id = String(req.query?.id ?? '')
  const origin = originOf(req)
  const listing = await fetchListing(id)
  const url = isListingId(id) ? `${origin}/listings/${id}` : `${origin}/`
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // Share of tickets sold changes, so it can't be kept for long.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
  res.status(200).send(
    previewHtml(
      listing
        ? { title: listing.title, description: `${previewLine(listing)}, on DrawMart`, url, imageUrl: `${origin}/api/listing-preview-image?id=${listing.id}` }
        : { ...GENERAL_PREVIEW, url, imageUrl: `${origin}/assets/heroBanner-1-900.jpg` },
    ),
  )
}
