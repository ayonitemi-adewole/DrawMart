import { describe, expect, it } from 'vitest'
import { isTestKey, sameSecret, verifyPayment, webhookTxRef } from '../functions/_shared/flutterwave.ts'

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('flutterwave helpers', () => {
  it('reads a successful payment in kobo', async () => {
    const fetchFn = reply({ status: 'success', data: { id: 4242, tx_ref: 'DM-1', status: 'successful', amount: 15000.5, currency: 'NGN' } })
    expect(await verifyPayment('DM-1', 'FLWSECK_TEST-x', fetchFn)).toEqual({ status: 'successful', amountKobo: 1_500_050, currency: 'NGN', providerRef: '4242' })
  })

  it('sends the secret key and the tx_ref', async () => {
    let seen: { url: string; auth: string | null } | undefined
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get('Authorization') }
      return new Response(JSON.stringify({ status: 'success', data: { tx_ref: 'DM-A&B', status: 'pending' } }))
    }) as unknown as typeof fetch
    await verifyPayment('DM-A&B', 'FLWSECK_TEST-x', fetchFn)
    expect(seen).toEqual({ url: 'https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=DM-A%26B', auth: 'Bearer FLWSECK_TEST-x' })
  })

  it('treats an unpaid reference as pending, and failures as failed', async () => {
    expect((await verifyPayment('DM-1', 'k', reply({ status: 'error', message: 'No transaction was found for this id', data: null }, 400))).status).toBe('pending')
    expect((await verifyPayment('DM-1', 'k', reply({ status: 'success', data: { tx_ref: 'DM-1', status: 'failed' } }))).status).toBe('failed')
  })

  it('throws on a bad key or a mismatched transaction', async () => {
    await expect(verifyPayment('DM-1', 'bad', reply({ status: 'error', message: 'Invalid authorization key' }, 401))).rejects.toThrow(/Invalid authorization key/)
    await expect(verifyPayment('DM-1', 'k', reply({ status: 'success', data: { tx_ref: 'DM-2', status: 'successful' } }))).rejects.toThrow(/different transaction/)
  })

  it('tells test keys from live ones', () => {
    expect(isTestKey('FLWSECK_TEST-abc')).toBe(true)
    expect(isTestKey('FLWPUBK_TEST-abc')).toBe(true)
    expect(isTestKey('FLWSECK-abc')).toBe(false)
  })

  it('checks the webhook secret hash', () => {
    expect(sameSecret('s3cret', 's3cret')).toBe(true)
    expect(sameSecret('s3cre', 's3cret')).toBe(false)
    expect(sameSecret('', '')).toBe(false) // an unset hash never matches
  })

  it('finds the tx_ref in both webhook formats', () => {
    expect(webhookTxRef({ event: 'charge.completed', data: { tx_ref: 'DM-1' } })).toBe('DM-1')
    expect(webhookTxRef({ txRef: 'DM-2' })).toBe('DM-2')
    expect(webhookTxRef(null)).toBeNull()
  })
})
