import { readFileSync } from 'node:fs'
import satori from 'satori'
import sharp from 'sharp'
import { fetchListing, originOf, photoUrl, previewLine } from './_lib/preview.mjs'

const WIDTH = 1200
const HEIGHT = 630
const STRIP = 150
const MAX_PHOTO_BYTES = 12 * 1024 * 1024

// Vercel's servers have no system fonts, so the text is drawn from these. Manrope has no ₦ (in the
// app, browsers quietly borrow it from another font), so Roboto supplies that one character.
const FONTS = [
  ['Manrope', 'manrope-latin-800-normal'],
  ['Manrope Ext', 'manrope-latin-ext-800-normal'],
  ['Roboto Ext', 'roboto-latin-ext-800-normal'],
].map(([name, file]) => ({
  name,
  weight: 800,
  style: 'normal',
  data: readFileSync(new URL(`./_lib/fonts/${file}.woff`, import.meta.url)),
}))
const FONT_FAMILY = 'Manrope, Manrope Ext, Roboto Ext'

const text = (children, style) => ({ type: 'div', props: { style: { display: 'block', width: WIDTH - 96, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...style }, children } })

/** Draws text the way the image does, so a test can check every character really has a shape. */
export const drawText = (children, width = WIDTH, height = 100) => satori(text(children, { width, fontFamily: FONT_FAMILY, fontSize: 40, color: '#000' }), { width, height, fonts: FONTS })

/** The price strip along the bottom. Colours match --color-hero and --color-ticket in src/index.css. */
async function stripPng(listing) {
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', width: WIDTH, height: STRIP, padding: '0 48px', gap: 6, backgroundColor: '#053B25', fontFamily: FONT_FAMILY },
        children: [text(listing.title, { color: '#FFFFFF', fontSize: 42 }), text(previewLine(listing), { color: '#FFC21A', fontSize: 36 })],
      },
    },
    { width: WIDTH, height: STRIP, fonts: FONTS },
  )
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** For a listing with no usable photo: the name, rather than an empty block. */
async function brandPng() {
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: WIDTH, height: HEIGHT - STRIP, backgroundColor: '#0B5A3A', color: '#FFC21A', fontFamily: FONT_FAMILY, fontSize: 96 },
        children: 'DrawMart',
      },
    },
    { width: WIDTH, height: HEIGHT - STRIP, fonts: FONTS },
  )
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** The first photo, or null if there isn't one we can use. */
async function photoBuffer(listing, origin) {
  const url = photoUrl(listing, origin)
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    return buffer.length <= MAX_PHOTO_BYTES ? buffer : null
  } catch {
    return null
  }
}

/** A JPEG, kept small: WhatsApp quietly drops preview images that are too big. */
export async function renderPreview(listing, photo) {
  const layers = [{ input: await stripPng(listing), top: HEIGHT - STRIP, left: 0 }]
  const top = photo
    ? await sharp(photo)
        .rotate()
        .resize(WIDTH, HEIGHT - STRIP, { fit: 'contain', background: '#F4F5F0' })
        .flatten({ background: '#F4F5F0' })
        .png()
        .toBuffer()
    : await brandPng()
  layers.unshift({ input: top, top: 0, left: 0 })
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#0B5A3A' } })
    .composite(layers)
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer()
}

export default async function handler(req, res) {
  const origin = originOf(req)
  try {
    const listing = await fetchListing(String(req.query?.id ?? ''))
    if (!listing) throw new Error('no listing')
    const image = await renderPreview(listing, await photoBuffer(listing, origin))
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600')
    res.status(200).send(image)
  } catch {
    // A hidden or missing listing, or a photo that can't be read: the general picture, not an error.
    res.setHeader('Cache-Control', 'public, s-maxage=60')
    res.redirect(302, `${origin}/assets/heroBanner-1-900.jpg`)
  }
}
