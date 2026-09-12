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
  event.respondWith(
    self.caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request)
      const fetched = fetch(event.request).then((response) => {
        if (response.ok) void cache.put(event.request, response.clone())
        return response
      })
      return cached ?? fetched
    }),
  )
})
