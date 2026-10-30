import { describe, expect, it } from 'vitest'
import { reverseGeocode, searchPlaces, shortenAddress } from './geocode'

const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch

describe('geocode', () => {
  it('drops the postcode and country from addresses', () => {
    expect(shortenAddress('12 Allen Avenue, Ikeja, Lagos State, 100001, Nigeria')).toBe('12 Allen Avenue, Ikeja, Lagos State')
  })

  it('searches inside Lagos and skips unusable results', async () => {
    let url = ''
    const fetchFn = (async (u: string) => {
      url = u
      return { ok: true, json: async () => [{ display_name: 'Ikeja, Lagos State, Nigeria', lat: '6.6', lon: '3.35' }, { display_name: 'Broken' }] }
    }) as unknown as typeof fetch
    expect(await searchPlaces('Ikeja', fetchFn)).toEqual([{ label: 'Ikeja, Lagos State', point: { lat: 6.6, lng: 3.35 } }])
    expect(url).toContain('bounded=1')
    await expect(searchPlaces('Ikeja', reply({}, false))).rejects.toThrow(/unavailable/)
  })

  it('looks up the address at a point, or nothing', async () => {
    expect(await reverseGeocode({ lat: 6.6, lng: 3.35 }, reply({ display_name: 'Allen Avenue, Ikeja, Nigeria' }))).toBe('Allen Avenue, Ikeja')
    expect(await reverseGeocode({ lat: 6.6, lng: 3.35 }, reply({ error: 'Unable to geocode' }))).toBeNull()
    expect(await reverseGeocode({ lat: 6.6, lng: 3.35 }, reply({}, false))).toBeNull()
  })
})
