import { describe, expect, it } from 'vitest'
import { isPhoneOrTablet } from './device'

const ua = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
}

describe('isPhoneOrTablet', () => {
  it('knows phones and tablets', () => {
    expect(isPhoneOrTablet({ userAgent: ua.iphone, maxTouchPoints: 5 })).toBe(true)
    expect(isPhoneOrTablet({ userAgent: ua.androidPhone, maxTouchPoints: 5, mobileHint: true })).toBe(true)
    expect(isPhoneOrTablet({ userAgent: ua.androidTablet, maxTouchPoints: 5, mobileHint: false })).toBe(true)
  })

  it('knows an iPad, which says it’s a Mac', () => {
    expect(isPhoneOrTablet({ userAgent: ua.mac, maxTouchPoints: 5 })).toBe(true)
  })

  it('knows laptops, even with a touchscreen', () => {
    expect(isPhoneOrTablet({ userAgent: ua.mac, maxTouchPoints: 0 })).toBe(false)
    expect(isPhoneOrTablet({ userAgent: ua.windows, maxTouchPoints: 0, mobileHint: false })).toBe(false)
    expect(isPhoneOrTablet({ userAgent: ua.windows, maxTouchPoints: 10, mobileHint: false })).toBe(false)
  })
})
