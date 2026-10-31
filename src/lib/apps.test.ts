import { describe, expect, it } from 'vitest'
import { appFor, landingFor } from './apps'

describe('apps', () => {
  it('tells which app a path is in', () => {
    expect(appFor('/')).toBe('buyer')
    expect(appFor('/wallet')).toBe('buyer')
    expect(appFor('/storefront')).toBe('buyer')
    expect(appFor('/store')).toBe('store')
    expect(appFor('/store/x')).toBe('store')
    expect(appFor('/admin/draws')).toBe('admin')
    expect(appFor('/delivery')).toBe('delivery')
    expect(appFor('/delivery/O-1')).toBe('delivery')
    expect(appFor('/deliveryman')).toBe('buyer')
  })

  it('only follows `next` inside the account’s own app', () => {
    expect(landingFor('buyer', '/wallet')).toBe('/wallet')
    expect(landingFor('buyer', '/admin')).toBe('/')
    expect(landingFor('store', '/wallet')).toBe('/store')
    expect(landingFor('admin', '/admin/draws')).toBe('/admin/draws')
    expect(landingFor('admin', null)).toBe('/admin')
    expect(landingFor('delivery', null)).toBe('/delivery')
    expect(landingFor('delivery', '/wallet')).toBe('/delivery')
    expect(landingFor('buyer', '/delivery')).toBe('/')
    expect(landingFor('buyer', '//evil.example')).toBe('/')
    expect(landingFor('buyer', '/login')).toBe('/')
  })
})
