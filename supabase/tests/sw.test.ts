import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

/** Runs public/sw.js against stand-ins for what a browser gives a service worker. */
function worker(windows: { url: string; focus: () => Promise<void>; navigate: (u: string) => Promise<void> }[] = []) {
  const handlers: Record<string, (e: unknown) => void> = {}
  const showNotification = vi.fn(async () => {})
  const openWindow = vi.fn(async () => {})
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => void (handlers[type] = fn),
    registration: { showNotification },
    clients: { matchAll: async () => windows, openWindow },
    location: { origin: 'https://drawmart.example' },
  }
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self, URL, console })

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
  return { push, click, showNotification, openWindow }
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

  it('doesn’t take over page loads or cache anything', () => {
    const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')
    expect(source).not.toMatch(/addEventListener\('fetch'|caches\./)
  })
})
