import { describe, expect, it, vi } from 'vitest'
import { encryptPayload, fromBase64Url, sendWebPush, toBase64Url, vapidAuthorization, type PushTarget, type VapidKeys } from '../functions/_shared/webpush'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

/** A browser: makes the keys a subscription holds, and reads a message as RFC 8291 says to. */
async function fakeBrowser() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  const target: PushTarget = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: toBase64Url(publicRaw), auth: toBase64Url(auth) }

  async function read(body: Uint8Array<ArrayBuffer>) {
    const salt = body.slice(0, 16)
    const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16)
    const idLength = body[20]
    const senderRaw = body.slice(21, 21 + idLength)
    const senderKey = await crypto.subtle.importKey('raw', senderRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, pair.privateKey, 256))
    const info = new Uint8Array([...encoder.encode('WebPush: info\0'), ...publicRaw, ...senderRaw])
    const ikm = await hkdf(auth, shared, info, 32)
    const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
    const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12)
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idLength)))
    return { recordSize, idLength, lastByte: plain[plain.length - 1], text: decoder.decode(plain.slice(0, -1)) }
  }
  return { target, read }
}

async function vapidKeys(): Promise<VapidKeys & { verifyKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return { publicKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), privateKey: jwk.d!, subject: 'mailto:test@drawmart.example', verifyKey: pair.publicKey }
}

describe('message encryption', () => {
  it('can be read by the browser it was meant for', async () => {
    const browser = await fakeBrowser()
    const message = JSON.stringify({ title: 'You won a draw', body: 'Toyota Corolla 2022 · ₦50,000', url: '/draws/abc' })
    const read = await browser.read(await encryptPayload(message, browser.target))
    expect(read.text).toBe(message)
    expect(read.lastByte).toBe(2)
    expect(read.recordSize).toBe(4096)
    expect(read.idLength).toBe(65)
  })

  it('can’t be read by anyone else', async () => {
    const [meant, other] = [await fakeBrowser(), await fakeBrowser()]
    await expect(other.read(await encryptPayload('secret', meant.target))).rejects.toThrow()
  })

  it('never contains the message in the clear, and differs every time', async () => {
    const browser = await fakeBrowser()
    const [a, b] = [await encryptPayload('findme', browser.target), await encryptPayload('findme', browser.target)]
    expect(decoder.decode(a)).not.toContain('findme')
    expect(toBase64Url(a)).not.toBe(toBase64Url(b))
  })
})

describe('sender identification', () => {
  it('signs a token a push service can check, for that service only', async () => {
    const vapid = await vapidKeys()
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, 1_000_000)
    const [, jwt, key] = header.match(/^vapid t=([^,]+), k=(.+)$/)!
    expect(key).toBe(vapid.publicKey)
    const [head, claims, signature] = jwt.split('.')
    expect(JSON.parse(decoder.decode(fromBase64Url(head)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(decoder.decode(fromBase64Url(claims)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_000_000 + 12 * 3600, sub: vapid.subject })
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.verifyKey, fromBase64Url(signature), encoder.encode(`${head}.${claims}`))
    expect(valid).toBe(true)
  })
})

describe('sendWebPush', () => {
  const send = async (status: number) => {
    const browser = await fakeBrowser()
    const f = vi.fn(async () => new Response(null, { status }))
    const outcome = await sendWebPush(browser.target, 'hello', await vapidKeys(), f as unknown as typeof fetch)
    return { outcome, f, browser }
  }

  it('posts an encrypted message with the right headers', async () => {
    const { outcome, f, browser } = await send(201)
    expect(outcome).toBe('sent')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(browser.target.endpoint)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '86400' })
    expect((await browser.read(init.body as Uint8Array<ArrayBuffer>)).text).toBe('hello')
  })

  it('tells a dropped subscription from a passing failure', async () => {
    expect((await send(410)).outcome).toBe('gone')
    expect((await send(404)).outcome).toBe('gone')
    expect((await send(500)).outcome).toBe('failed')
    expect((await send(429)).outcome).toBe('failed')
  })
})
