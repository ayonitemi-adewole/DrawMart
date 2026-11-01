/** Whether this is a phone or tablet, for things that need a camera in the seller's hand. */
export interface DeviceSignals {
  userAgent: string
  maxTouchPoints: number
  /** navigator.userAgentData.mobile, where the browser has it. */
  mobileHint?: boolean
}

export function isPhoneOrTablet({ userAgent, maxTouchPoints, mobileHint }: DeviceSignals): boolean {
  if (mobileHint) return true
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile/i.test(userAgent)) return true
  // iPads say they're Macs, but no Mac has a multi-touch screen. A touchscreen Windows laptop stays a laptop.
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1
}

export function thisDevice(): DeviceSignals {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  return { userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints, mobileHint: nav.userAgentData?.mobile }
}
