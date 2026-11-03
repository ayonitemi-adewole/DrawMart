// Shows push notifications, and keeps the app itself on the phone so riders can open
// their saved jobs without signal (src/domain/offlineJobs.ts). Pages always come from
// the network first, so a new release wins; the last good page only when there's no
// signal. Only Vite's hashed /assets/ files are served from the cache. Data is never
// cached here: the app keeps the rider's own jobs itself.
const SHELL = 'drawmart-shell-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('drawmart-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
            const copy = response.clone()
            event.waitUntil(caches.open(SHELL).then((cache) => cache.put('/', copy)))
          }
          return response
        })
        .catch(() => caches.match('/').then((page) => page || Response.error())),
    )
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        const response = await fetch(request)
        if (response.ok) event.waitUntil(cache.put(request, response.clone()))
        return response
      }),
    )
  }
})

self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    /* not ours to read: still show something, as browsers require */
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'DrawMart', {
      body: message.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: message.tag,
      data: { url: message.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (!open) return self.clients.openWindow(url)
      await open.focus()
      return open.navigate(url)
    }),
  )
})
