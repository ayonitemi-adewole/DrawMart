import { describe, expect, it } from 'vitest'
import { maskNin, validateSellerApplication, type SellerApplicationInput } from './sellers'

const good: SellerApplicationInput = {
  shopName: 'Tolu’s Gadgets',
  legalName: 'Toluwani Adebayo',
  nin: '123 4567 8901',
  phone: '0803 123 4567',
  address: '12 Herbert Macaulay Way, Yaba',
  area: 'Yaba',
  idPhoto: 'data:image/jpeg;base64,x',
  selfie: 'data:image/jpeg;base64,y',
}

describe('seller applications', () => {
  it('accepts a complete application', () => expect(validateSellerApplication(good)).toEqual([]))

  it('lists every problem', () => {
    expect(validateSellerApplication({ ...good, shopName: ' ', legalName: 'Tolu', nin: '1234', phone: '123', address: 'Yaba', area: '', idPhoto: '', selfie: '' })).toEqual([
      'shop_name_required',
      'legal_name_required',
      'nin_invalid',
      'phone_invalid',
      'address_required',
      'area_required',
      'id_photo_required',
      'selfie_required',
    ])
  })

  it('masks the NIN', () => expect(maskNin('123 4567 8901')).toBe('•••••••8901'))
})
