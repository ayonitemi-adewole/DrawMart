/**
 * Bulk product upload for stores: a spreadsheet of products plus their photos, matched by
 * file name. Every row is checked before anything is created. Spot checks still apply: the
 * database picks some rows, which the store then adds with the form and a video.
 * Mirrored in supabase/migrations/…_bulk_upload.sql.
 */
import { serialError } from './listingChecks'
import { formatNaira, parseNairaInput } from './money'
import { MAX_STOCK, MIN_PRODUCT_PRICE_KOBO } from './orders'
import { CATEGORIES, type Category, type Kobo, type PackageSize } from './types'

export const MAX_BULK_ROWS = 100
export const MAX_PHOTOS_PER_PRODUCT = 4
const TITLE_MAX = 120
const DESCRIPTION_MAX = 2000

export const BULK_COLUMNS = ['title', 'category', 'price', 'stock', 'description', 'package_size', 'serial', 'photos'] as const
const REQUIRED_COLUMNS = ['title', 'category', 'price', 'photos'] as const

/** Downloaded from the upload page. Prices in naira; photos are file names, separated by semicolons. */
export const BULK_TEMPLATE_CSV = [
  BULK_COLUMNS.join(','),
  'Standing fan 16 inch,Home,25000,10,"Three speeds, remote control",medium,,fan-front.jpg;fan-side.jpg',
  'Samsung Galaxy A15 128GB,Phones,180000,3,Brand new and sealed,small,356938035643809,a15.jpg',
].join('\r\n')

/** Quoted fields, doubled quotes, commas and line breaks inside quotes, and a byte-order mark. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((x) => x.trim()))
}

export interface BulkRow {
  /** Its line in the spreadsheet, counting the header as 1. */
  line: number
  title: string
  category: Category | null
  priceKobo: Kobo
  stock: number
  description: string
  packageSize: PackageSize | null
  serial: string
  photoNames: string[]
  errors: string[]
}

export const photoKey = (name: string) => name.trim().toLowerCase()

function readRow(cells: Record<string, string>, line: number, files: ReadonlySet<string>): BulkRow {
  const errors: string[] = []
  const title = cells.title?.trim() ?? ''
  const category = CATEGORIES.find((c) => c.toLowerCase() === (cells.category ?? '').trim().toLowerCase()) ?? null
  const priceKobo = /\d/.test(cells.price ?? '') ? parseNairaInput(cells.price) : 0
  const stockText = (cells.stock ?? '').trim()
  const stock = stockText ? Number(stockText.replace(/,/g, '')) : 1
  const size = (cells.package_size ?? '').trim().toLowerCase()
  const serial = (cells.serial ?? '').trim()
  const photoNames = (cells.photos ?? '').split(/[;|]/).map((x) => x.trim()).filter(Boolean)
  const description = (cells.description ?? '').trim()

  if (!title) errors.push('Add a title.')
  else if (title.length > TITLE_MAX) errors.push(`Keep the title to ${TITLE_MAX} characters.`)
  if (!category) errors.push(`Use one of these categories: ${CATEGORIES.join(', ')}.`)
  if (!(priceKobo >= MIN_PRODUCT_PRICE_KOBO)) errors.push(`Set a price of at least ${formatNaira(MIN_PRODUCT_PRICE_KOBO)}, in naira.`)
  if (!Number.isInteger(stock) || stock < 1 || stock > MAX_STOCK) errors.push(`Stock must be a whole number from 1 to ${MAX_STOCK.toLocaleString('en-NG')}.`)
  if (description.length > DESCRIPTION_MAX) errors.push(`Keep the description to ${DESCRIPTION_MAX.toLocaleString('en-NG')} characters.`)
  if (size && size !== 'small' && size !== 'medium' && size !== 'large') errors.push('Package size must be small, medium or large, or left blank.')
  if (category) {
    const problem = serialError(category, priceKobo, serial)
    if (problem) errors.push(problem)
  }
  if (!photoNames.length) errors.push('Add at least one photo file name.')
  else if (photoNames.length > MAX_PHOTOS_PER_PRODUCT) errors.push(`Use up to ${MAX_PHOTOS_PER_PRODUCT} photos.`)
  const missing = photoNames.filter((n) => !files.has(photoKey(n)))
  if (missing.length) errors.push(`Not in the photos you chose: ${missing.join(', ')}.`)

  return { line, title, category, priceKobo, stock, description, packageSize: (size || null) as PackageSize | null, serial, photoNames, errors }
}

/** The spreadsheet's rows, each with its problems, or one problem with the sheet as a whole. */
export function readBulkSheet(text: string, photoFileNames: readonly string[]): { rows: BulkRow[]; error: string | null } {
  const table = parseCsv(text)
  if (!table.length) return { rows: [], error: 'That file is empty.' }
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c))
  if (missing.length) return { rows: [], error: `The first row needs these column names: ${missing.join(', ')}. Start from the template.` }
  const body = table.slice(1)
  if (!body.length) return { rows: [], error: 'Add at least one product under the column names.' }
  if (body.length > MAX_BULK_ROWS) return { rows: [], error: `Upload up to ${MAX_BULK_ROWS} products at a time.` }
  const files = new Set(photoFileNames.map(photoKey))
  const rows = body.map((cells, i) => readRow(Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ''])), i + 2, files))
  return { rows, error: null }
}
