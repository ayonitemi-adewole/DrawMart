/**
 * Talks to Flutterwave's v3 API. Plain TypeScript (no Deno globals) so
 * supabase/tests/flutterwave.test.ts can run it under Vitest.
 */

export const FLUTTERWAVE_API = 'https://api.flutterwave.com/v3'

export type PaymentStatus = 'successful' | 'failed' | 'pending'

/** What Flutterwave says about a tx_ref, in the shape complete_deposit takes. */
export interface VerifiedPayment {
  status: PaymentStatus
  amountKobo: number | null
  currency: string | null
  /** Flutterwave's transaction id. */
  providerRef: string | null
}

interface VerifyResponse {
  status?: string
  message?: string
  data?: { id?: number | string; tx_ref?: string; status?: string; amount?: number; currency?: string } | null
}

/** Test keys move no real money: FLWSECK_TEST-… / FLWPUBK_TEST-…. */
export const isTestKey = (key: string) => /^FLW(SECK|PUBK)_TEST-/.test(key)

/**
 * Asks Flutterwave whether a tx_ref was paid. Never trust the browser's
 * callback or a webhook body for this: only this answer moves money.
 */
export async function verifyPayment(txRef: string, secretKey: string, fetchFn: typeof fetch = fetch): Promise<VerifiedPayment> {
  const res = await fetchFn(`${FLUTTERWAVE_API}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  })
  const body = (await res.json().catch(() => ({}))) as VerifyResponse

  if (body.status !== 'success' || !body.data) {
    // Nothing paid against this reference yet.
    if (/no transaction/i.test(body.message ?? '')) return { status: 'pending', amountKobo: null, currency: null, providerRef: null }
    throw new Error(`Flutterwave verify failed (${res.status}): ${body.message ?? 'no message'}`)
  }

  const d = body.data
  if (d.tx_ref !== txRef) throw new Error('Flutterwave returned a different transaction.')
  const status: PaymentStatus = d.status === 'successful' ? 'successful' : d.status === 'failed' || d.status === 'cancelled' ? 'failed' : 'pending'
  return {
    status,
    // Flutterwave amounts are in naira and may have kobo decimals.
    amountKobo: typeof d.amount === 'number' ? Math.round(d.amount * 100) : null,
    currency: d.currency ?? null,
    providerRef: d.id != null ? String(d.id) : null,
  }
}

/** Compares a webhook's `verif-hash` header with the secret hash without leaking timing. */
export function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]
  return b.length > 0 && diff === 0
}

/** The tx_ref in a webhook body (v3 `data.tx_ref`, or the older top-level `txRef`). */
export function webhookTxRef(body: unknown): string | null {
  const b = body as { data?: { tx_ref?: unknown }; txRef?: unknown } | null
  const ref = b?.data?.tx_ref ?? b?.txRef
  return typeof ref === 'string' ? ref : null
}
