/**
 * Flutterwave Inline checkout (https://checkout.flutterwave.com/v3.js).
 * Opens Flutterwave's payment modal over the app. The result it reports is
 * only a hint: the wallet is credited after the confirm-deposit Edge Function
 * checks the payment with Flutterwave.
 */
import { koboToNaira } from '@/domain/money'
import type { Kobo } from '@/domain/types'

const SCRIPT_URL = 'https://checkout.flutterwave.com/v3.js'

interface FlutterwaveConfig {
  public_key: string
  tx_ref: string
  amount: number
  currency: 'NGN'
  payment_options: string
  customer: { email: string; name?: string }
  customizations: { title: string; description: string; logo?: string }
  callback: (data: { status?: string; tx_ref?: string; transaction_id?: number }) => void
  onclose: (incomplete?: boolean) => void
}

declare global {
  interface Window {
    FlutterwaveCheckout?: (config: FlutterwaveConfig) => { close: () => void } | undefined
  }
}

/** Public keys for Flutterwave's sandbox start with FLWPUBK_TEST-. */
export const isFlutterwaveTestKey = (key: string) => key.startsWith('FLWPUBK_TEST-')

let loading: Promise<void> | undefined

function loadScript(): Promise<void> {
  if (window.FlutterwaveCheckout) return Promise.resolve()
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_URL
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      loading = undefined
      s.remove()
      reject(new Error('Couldn’t load Flutterwave. Check your connection and try again.'))
    }
    document.head.appendChild(s)
  })
  return loading
}

export interface CheckoutInput {
  publicKey: string
  txRef: string
  amountKobo: Kobo
  email: string
  name: string
}

/** 'paid' when Flutterwave reports a payment, 'closed' when the buyer leaves without one. */
export async function openFlutterwaveCheckout(input: CheckoutInput): Promise<'paid' | 'closed'> {
  await loadScript()
  return new Promise((resolve) => {
    let done = false
    const finish = (r: 'paid' | 'closed') => {
      if (!done) {
        done = true
        resolve(r)
      }
    }
    const modal = window.FlutterwaveCheckout!({
      public_key: input.publicKey,
      tx_ref: input.txRef,
      amount: koboToNaira(input.amountKobo),
      currency: 'NGN',
      payment_options: 'card, banktransfer, ussd',
      customer: { email: input.email, name: input.name },
      customizations: { title: 'DrawMart', description: 'Wallet top-up', logo: `${window.location.origin}/favicon.svg` },
      callback: (data) => {
        finish(data.status === 'successful' || data.status === 'completed' ? 'paid' : 'closed')
        modal?.close()
      },
      onclose: () => finish('closed'),
    })
  })
}
