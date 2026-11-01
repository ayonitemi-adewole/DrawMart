import { describe, expect, it, vi } from 'vitest'
import { banksOrFallback, COMMERCIAL_BANKS, isTestKey, listBanks, resolveAccount, sameSecret, verifyPayment, webhookTxRef } from '../functions/_shared/flutterwave.ts'

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('bank account lookups', () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('returns the bank’s name for an account', async () => {
    let sent: unknown
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ status: 'success', data: { account_number: '0690000031', account_name: 'ADA OKAFOR' } }))
    }) as unknown as typeof fetch
    expect(await resolveAccount('044', '0690000031', 'k', fetchFn)).toBe('ADA OKAFOR')
    expect(sent).toEqual({ account_number: '0690000031', account_bank: '044' })
  })

  it('says no such account, but treats an outage as an error rather than an answer', async () => {
    expect(await resolveAccount('044', '0000000000', 'k', reply(400, { status: 'error', message: 'Could not resolve' }))).toBeNull()
    expect(await resolveAccount('058', '0000000000', 'k', reply(422, { status: 'error', message: 'Only 044 is allowed' }))).toBeNull()
    await expect(resolveAccount('044', '0000000000', 'k', reply(500, { status: 'error' }))).rejects.toThrow('500')
    await expect(resolveAccount('044', '0000000000', 'k', reply(401, { status: 'error', message: 'Invalid authorization key' }))).rejects.toThrow('Invalid authorization key')
    await expect(resolveAccount('044', '0000000000', 'k', reply(429, { status: 'error' }))).rejects.toThrow('429')
  })

  it('won’t accept a name for a different account', async () => {
    await expect(resolveAccount('044', '0690000031', 'k', reply(200, { status: 'success', data: { account_number: '1111111111', account_name: 'SOMEONE' } }))).rejects.toThrow('different')
  })

  it('falls back to the built-in banks if Flutterwave’s list fails, and has Access Bank for testing', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await banksOrFallback('k', reply(500, { status: 'error', message: 'An error occurred' }))).toBe(COMMERCIAL_BANKS)
    expect(await banksOrFallback('k', (async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBe(COMMERCIAL_BANKS)
    quiet.mockRestore()
    expect(COMMERCIAL_BANKS.find((b) => b.code === '044')?.name).toBe('Access Bank')
    expect(await banksOrFallback('k', reply(200, { status: 'success', data: [{ code: '999', name: 'Live bank' }] }))).toEqual([{ code: '999', name: 'Live bank' }])
  })

  it('lists banks by name', async () => {
    const banks = await listBanks('k', reply(200, { status: 'success', data: [{ code: '057', name: 'Zenith' }, { code: '044', name: 'Access' }, { name: 'No code' }] }))
    expect(banks).toEqual([{ code: '044', name: 'Access' }, { code: '057', name: 'Zenith' }])
    await expect(listBanks('k', reply(401, { status: 'error', message: 'bad key' }))).rejects.toThrow('bad key')
  })
})

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
