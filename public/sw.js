const CACHE = 'phygital-pass-static-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone()
        void caches.open(CACHE).then((cache) => cache.put(request, copy))
      }
      return response
    })),
  )
})
