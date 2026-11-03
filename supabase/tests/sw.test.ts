import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

/** A stand-in for the Cache API, keyed by URL. */
function cacheStorage(initial: Record<string, Record<string, string>> = {}) {
  const stores = new Map(Object.entries(initial).map(([name, entries]) => [name, new Map(Object.entries(entries))]))
  const keyOf = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, 'https://drawmart.example').href
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      match: async (r: string | { url: string }) => store.get(keyOf(r)),
      put: async (r: string | { url: string }, body: string) => void store.set(keyOf(r), body),
    }
  }
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (r: string) => [...stores.values()].map((st) => st.get(keyOf(r))).find((x) => x !== undefined),
    },
  }
}

/** Responses here are just their body text, with clone() and the bits the worker reads. */
const response = (body: string, type = 'text/html') => ({ body, ok: true, headers: { get: () => type }, clone: () => body })

/** Runs public/sw.js against stand-ins for what a browser gives a service worker. */
function worker(windows: { url: string; focus: () => Promise<void>; navigate: (u: string) => Promise<void> }[] = [], net: { fetch?: (r: unknown) => Promise<unknown>; caches?: ReturnType<typeof cacheStorage> } = {}) {
  const handlers: Record<string, (e: unknown) => void> = {}
  const showNotification = vi.fn(async () => {})
  const openWindow = vi.fn(async () => {})
  const claim = vi.fn(async () => {})
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => void (handlers[type] = fn),
    registration: { showNotification },
    clients: { matchAll: async () => windows, openWindow, claim },
    location: { origin: 'https://drawmart.example' },
    skipWaiting: vi.fn(),
  }
  const caches = net.caches ?? cacheStorage()
  const fetch = vi.fn(net.fetch ?? (async () => response('network')))
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self, URL, console, caches: caches.api, fetch, Response: { error: () => 'network error' } })

  /** What the page gets back, or undefined if the worker left the request to the browser. */
  const request = async (url: string, init: { method?: string; mode?: string } = {}) => {
    let answer: Promise<unknown> | undefined
    const waits: Promise<unknown>[] = []
    handlers.fetch({ request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' }, respondWith: (p: Promise<unknown>) => (answer = p), waitUntil: (p: Promise<unknown>) => waits.push(p) })
    const got = answer ? await answer : undefined
    await Promise.all(waits)
    return got
  }
  const activate = async () => {
    let done: Promise<unknown> = Promise.resolve()
    handlers.activate({ waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
  }

  const push = async (data: { json: () => unknown } | null) => {
    let done: Promise<unknown> = Promise.resolve()
    handlers.push({ data, waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
  }
  const click = async (url?: string) => {
    let done: Promise<unknown> = Promise.resolve()
    const close = vi.fn()
    handlers.notificationclick({ notification: { close, data: url ? { url } : undefined }, waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
    return close
  }
  return { push, click, showNotification, openWindow, request, activate, fetch, caches, claim }
}

const page = (url: string) => ({ url, focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) })

describe('the service worker', () => {
  it('shows what the server sent', async () => {
    const w = worker()
    await w.push({ json: () => ({ title: 'You won a draw', body: 'Toyota Corolla 2022.', url: '/draws/abc', tag: 'draw-abc' }) })
    expect(w.showNotification).toHaveBeenCalledWith('You won a draw', expect.objectContaining({ body: 'Toyota Corolla 2022.', tag: 'draw-abc', icon: '/icons/icon-192.png' }))
    const [, options] = w.showNotification.mock.calls[0] as unknown as [string, { data: { url: string } }]
    expect(options.data.url).toBe('/draws/abc')
  })

  it('still shows something for a push it can’t read, as browsers require', async () => {
    for (const data of [{ json: () => { throw new Error('not json') } }, null]) {
      const w = worker()
      await w.push(data)
      expect(w.showNotification).toHaveBeenCalledWith('DrawMart', expect.objectContaining({ body: '' }))
    }
  })

  it('opens the app at the right page when tapped with the app closed', async () => {
    const w = worker()
    const close = await w.click('/draws/abc')
    expect(close).toHaveBeenCalled()
    expect(w.openWindow).toHaveBeenCalledWith('https://drawmart.example/draws/abc')
  })

  it('uses a window that’s already open', async () => {
    const open = page('https://drawmart.example/wallet')
    const w = worker([open])
    await w.click('/messages/abc')
    expect(open.focus).toHaveBeenCalled()
    expect(open.navigate).toHaveBeenCalledWith('https://drawmart.example/messages/abc')
    expect(w.openWindow).not.toHaveBeenCalled()
  })

  it('goes home if a notification has nowhere to go', async () => {
    const w = worker()
    await w.click()
    expect(w.openWindow).toHaveBeenCalledWith('https://drawmart.example/')
  })

  it('leaves data, other sites and anything but GET to the browser', async () => {
    const w = worker()
    expect(await w.request('https://abc.supabase.co/rest/v1/rpc/delivery_jobs')).toBeUndefined()
    expect(await w.request('https://drawmart.example/api/listing-preview')).toBeUndefined()
    expect(await w.request('https://drawmart.example/assets/index-abc.js', { method: 'POST' })).toBeUndefined()
    expect(await w.request('https://tile.openstreetmap.org/1/2/3.png')).toBeUndefined()
    expect(w.fetch).not.toHaveBeenCalled()
  })

  it('loads pages from the network first, and the last good one only without signal', async () => {
    const online = worker()
    expect(await online.request('https://drawmart.example/delivery', { mode: 'navigate' })).toMatchObject({ body: 'network' })
    expect(online.caches.stores.get('drawmart-shell-v1')?.get('https://drawmart.example/')).toBe('network')

    const caches = cacheStorage({ 'drawmart-shell-v1': { 'https://drawmart.example/': 'saved page' } })
    const offline = worker([], { caches, fetch: async () => { throw new TypeError('Failed to fetch') } })
    expect(await offline.request('https://drawmart.example/delivery/abc', { mode: 'navigate' })).toBe('saved page')
  })

  it('keeps the app’s own files once fetched, and serves them from the phone after', async () => {
    const w = worker([], { fetch: async () => response('code', 'text/javascript') })
    await w.request('https://drawmart.example/assets/index-abc.js')
    expect(w.fetch).toHaveBeenCalledTimes(1)
    expect(await w.request('https://drawmart.example/assets/index-abc.js')).toBe('code')
    expect(w.fetch).toHaveBeenCalledTimes(1)
  })

  it('clears an older copy of the app when a new worker takes over', async () => {
    const caches = cacheStorage({ 'drawmart-shell-v0': {}, 'drawmart-shell-v1': {}, 'someone-else': {} })
    const w = worker([], { caches })
    await w.activate()
    expect([...caches.stores.keys()].sort()).toEqual(['drawmart-shell-v1', 'someone-else'])
    expect(w.claim).toHaveBeenCalled()
  })
})
