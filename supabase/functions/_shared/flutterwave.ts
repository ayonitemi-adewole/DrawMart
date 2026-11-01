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

/** A reply from Flutterwave that isn't an answer. `reason` is its own words, for logs and test mode. */
export class FlutterwaveError extends Error {
  constructor(readonly reason: string, readonly status: number) {
    super(`Flutterwave ${status}: ${reason}`)
  }
}

export interface BankOption {
  code: string
  name: string
}

/**
 * The commercial banks, by their CBN codes. Used with no Flutterwave key in test mode, or
 * when Flutterwave's list fails: it's only a menu, since the account itself is always
 * checked. It leaves out mobile-money providers, which only Flutterwave's list has.
 */
export const COMMERCIAL_BANKS: BankOption[] = [
  { code: '044', name: 'Access Bank' },
  { code: '023', name: 'Citibank' },
  { code: '050', name: 'Ecobank' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '011', name: 'First Bank' },
  { code: '214', name: 'FCMB' },
  { code: '058', name: 'GTBank' },
  { code: '030', name: 'Heritage Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '221', name: 'Stanbic IBTC' },
  { code: '068', name: 'Standard Chartered' },
  { code: '232', name: 'Sterling Bank' },
  { code: '033', name: 'UBA' },
  { code: '032', name: 'Union Bank' },
  { code: '215', name: 'Unity Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' },
]

/** Flutterwave's list, or the built-in one if that fails, so a bad moment there doesn't block the form. */
export async function banksOrFallback(secretKey: string, fetchFn: typeof fetch = fetch): Promise<BankOption[]> {
  try {
    return await listBanks(secretKey, fetchFn)
  } catch (e) {
    console.error('Using the built-in bank list', e)
    return COMMERCIAL_BANKS
  }
}

export async function listBanks(secretKey: string, fetchFn: typeof fetch = fetch): Promise<BankOption[]> {
  const res = await fetchFn(`${FLUTTERWAVE_API}/banks/NG`, { headers: { Authorization: `Bearer ${secretKey}` } })
  const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string; data?: { code?: string; name?: string }[] }
  if (body.status !== 'success' || !body.data) throw new FlutterwaveError(body.message ?? 'no message', res.status)
  return body.data
    .filter((b): b is BankOption => !!b.code && !!b.name)
    .map((b) => ({ code: b.code, name: b.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The name the bank holds for an account, or null if there's no such account. */
export async function resolveAccount(bankCode: string, accountNumber: string, secretKey: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchFn(`${FLUTTERWAVE_API}/accounts/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_number: accountNumber, account_bank: bankCode }),
  })
  const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string; data?: { account_number?: string; account_name?: string } | null }
  if (body.status === 'success' && body.data?.account_name) {
    if (body.data.account_number && body.data.account_number !== accountNumber) throw new Error('Flutterwave returned a different account.')
    return body.data.account_name
  }
  // A bad key, a rate limit or an outage isn't an answer about this account. Any other
  // refusal means it couldn't be resolved, whichever status Flutterwave picks for that.
  if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403 && res.status !== 429) return null
  throw new FlutterwaveError(body.message ?? 'no message', res.status)
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
