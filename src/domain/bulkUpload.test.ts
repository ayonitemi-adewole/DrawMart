import { describe, expect, it } from 'vitest'
import { BULK_TEMPLATE_CSV, MAX_BULK_ROWS, parseCsv, readBulkSheet } from './bulkUpload'

describe('bulk upload', () => {
  it('reads quoted cells, commas and line breaks inside them, and a byte-order mark', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
    ])
  })

  it('accepts its own template once the photos are chosen', () => {
    const files = ['FAN-FRONT.jpg', 'fan-side.jpg', 'a15.jpg']
    const { rows, error } = readBulkSheet(BULK_TEMPLATE_CSV, files)
    expect(error).toBeNull()
    expect(rows.map((r) => r.errors)).toEqual([[], []])
    expect(rows[0]).toMatchObject({ line: 2, title: 'Standing fan 16 inch', category: 'Home', priceKobo: 2_500_000, stock: 10, packageSize: 'medium', photoNames: ['fan-front.jpg', 'fan-side.jpg'] })
  })

  it('explains each row’s problems', () => {
    const csv = ['Title,Category,Price,Stock,Photos,Serial', ',Toys,50,0,,', 'Phone,phones,"₦90,000",2,missing.jpg,', 'Lamp,Home,20000,,a.jpg;b.jpg;c.jpg;d.jpg;e.jpg,'].join('\n')
    const { rows } = readBulkSheet(csv, ['a.jpg'])
    expect(rows[0].errors).toHaveLength(5) // title, category, price, stock, photos
    expect(rows[1].category).toBe('Phones')
    expect(rows[1].priceKobo).toBe(9_000_000)
    expect(rows[1].errors).toEqual(['Add the serial or IMEI number.', 'Not in the photos you chose: missing.jpg.'])
    expect(rows[2].stock).toBe(1)
    expect(rows[2].errors[0]).toMatch(/up to 4 photos/)
  })

  it('needs the right columns and a sensible number of rows', () => {
    expect(readBulkSheet('name,price\nx,1', []).error).toMatch(/title, category, photos/)
    expect(readBulkSheet('', []).error).toMatch(/empty/)
    const many = ['title,category,price,photos', ...Array.from({ length: MAX_BULK_ROWS + 1 }, (_, i) => `Item ${i},Home,1000,a.jpg`)].join('\n')
    expect(readBulkSheet(many, ['a.jpg']).error).toMatch(/up to 100/)
  })
})
