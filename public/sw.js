const CACHE = 'phygital-pass-static-v3'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      }).catch(() => caches.match(request))
    )
    return
  }

  const isImage = request.destination === 'image' || /\.(png|jpe?g|webp|svg|ico)$/i.test(url.pathname)

  event.respondWith(
    caches.match(request).then((cached) => {
      // If cached response for an image accidentally received text/html earlier, discard it
      if (cached && isImage && cached.headers.get('content-type')?.includes('text/html')) {
        return fetch(request).then((response) => {
          if (response.ok && response.type === 'basic' && !response.headers.get('content-type')?.includes('text/html')) {
            const copy = response.clone()
            void caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
      }
      return cached ?? fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          // Never cache HTML as image
          if (isImage && response.headers.get('content-type')?.includes('text/html')) {
            return response
          }
          const copy = response.clone()
          void caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
    })
  )
})


