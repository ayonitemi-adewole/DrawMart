import type { PushSubscriptionKeys } from '@/domain/push'

/** The browser's side of phone notifications: permission, the service worker and this device's subscription. */

export type PushDeviceState =
  /** This browser can't do it. */
  | 'unsupported'
  /** An iPhone or iPad, which only allows it once the app is on the home screen. */
  | 'needs_home_screen'
  /** The buyer said no; only the phone's settings can change that now. */
  | 'blocked'
  | 'off'
  | 'on'

const isStandalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

const isAppleMobile = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration()
  return registration ? registration.pushManager.getSubscription() : null
}

export async function pushDeviceState(): Promise<PushDeviceState> {
  if (typeof window === 'undefined') return 'unsupported'
  if (isAppleMobile() && !isStandalone()) return 'needs_home_screen'
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return Notification.permission === 'granted' && (await currentSubscription()) ? 'on' : 'off'
}

function toKey(base64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '='))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

/** Asks permission, so only ever call this from something the buyer just tapped. Null if they said no. */
export async function subscribeThisDevice(publicKey: string): Promise<PushSubscriptionKeys | null> {
  if ((await Notification.requestPermission()) !== 'granted') return null
  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) })
  const { endpoint, keys } = subscription.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('This browser didn’t give us what notifications need.')
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth }
}

/** Stops this device getting notifications. Returns its address so the server can forget it too. */
export async function unsubscribeThisDevice(): Promise<string | null> {
  if (!supported()) return null
  const subscription = await currentSubscription()
  if (!subscription) return null
  const { endpoint } = subscription
  await subscription.unsubscribe()
  return endpoint
}

const PROMPT_KEY = 'drawmart:push-prompt-dismissed'

export function pushPromptDismissed(): boolean {
  try {
    return localStorage.getItem(PROMPT_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissPushPrompt() {
  try {
    localStorage.setItem(PROMPT_KEY, '1')
  } catch {
    /* storage blocked: it just asks again next time */
  }
}
