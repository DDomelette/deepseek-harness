/* dsh static-asset cache: stale-while-revalidate for app files; /api and the
 * realtime WebSocket always go to the network. */
const CACHE = 'dsh-static-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api')) return
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
