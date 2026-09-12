/* dsh static-asset cache: stale-while-revalidate for the subresources a
 * document loads. Navigations, /api traffic, fetch/XHR/EventSource requests,
 * and the worker's own script go straight to the network: the dev SSE channel
 * at /plugins/events never ends, so mediating it would hold a connection open
 * for the life of the page. */
const CACHE = 'dsh-static-v1'
const CACHED_DESTINATIONS = new Set(['script', 'style', 'image', 'font', 'manifest'])

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api')) return
  if (!CACHED_DESTINATIONS.has(event.request.destination)) return
  const revalidation = fetch(event.request).then((response) => {
    if (!response.ok) return response
    const stored = response.clone()
    return self.caches.open(CACHE)
      .then((cache) => cache.put(event.request, stored))
      .then(() => response)
  })
  // A cached answer returns before the network does, so the revalidation gets
  // its own lifetime: otherwise the worker may be terminated mid-`put` and the
  // asset stays stale. The catch keeps an offline rejection, which no caller
  // observes once the cached response won, out of the worker's error channel.
  event.waitUntil(revalidation.then(() => undefined, () => undefined))
  event.respondWith(
    self.caches.open(CACHE)
      .then(async (cache) => (await cache.match(event.request)) ?? revalidation),
  )
})
