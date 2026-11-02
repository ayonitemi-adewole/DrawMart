import { describe, expect, it } from 'vitest'
import { normalizeCac, storeAccountBlocker, validateStoreApplication } from './storeApplications'

const ok = {
  businessName: 'Ikorodu Home Goods Ltd',
  cacNumber: 'RC 1234567',
  directorName: 'Bola Adeyemi',
  phone: '0803 123 4567',
  address: '12 Ikorodu Road, Ikorodu',
  area: 'Ikorodu',
  certificatePhoto: 'data:image/jpeg;base64,x',
  directorIdPhoto: 'data:image/jpeg;base64,y',
}

describe('store applications', () => {
  it('reads CAC numbers the ways people write them', () => {
    expect(normalizeCac('RC 1234567')).toBe('RC 1234567')
    expect(normalizeCac('rc-1234567')).toBe('RC 1234567')
    expect(normalizeCac(' BN3456789 ')).toBe('BN 3456789')
    expect(normalizeCac('IT 12345')).toBe('IT 12345')
    for (const bad of ['', '1234567', 'RC', 'RC 12', 'AB 1234567', 'RC 123456789']) expect(normalizeCac(bad)).toBeNull()
  })

  it('checks every field', () => {
    expect(validateStoreApplication(ok)).toEqual([])
    expect(validateStoreApplication({ ...ok, businessName: 'X', cacNumber: '123', directorName: 'Bola', phone: '1', address: 'short', area: '', certificatePhoto: '', directorIdPhoto: '' })).toEqual([
      'business_name_required', 'cac_invalid', 'director_name_required', 'phone_invalid', 'address_required', 'area_required', 'certificate_required', 'director_id_required',
    ])
  })

  it('needs a buyer account that hasn’t bought or sold', () => {
    const fresh = { isBuyer: true, sellsAsIndividual: false, hasBought: false }
    expect(storeAccountBlocker(fresh)).toBeNull()
    expect(storeAccountBlocker({ ...fresh, isBuyer: false })).not.toBeNull()
    expect(storeAccountBlocker({ ...fresh, sellsAsIndividual: true })).toMatch(/individual/)
    expect(storeAccountBlocker({ ...fresh, hasBought: true })).toMatch(/already bought/)
  })
})
