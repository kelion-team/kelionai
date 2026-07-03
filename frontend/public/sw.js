// Kelionai service worker — the PWA installability requirement plus a light
// resilience layer for weak mobile links (3G↔5G): the app SHELL (last good
// index.html + static assets) is cached so the app opens instantly and still
// STARTS with no signal; live data (API, chat) always goes to the network —
// never cached, so nothing is ever stale or replayed.
const SHELL = 'kelionai-shell-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Drop old shell caches on upgrade.
      for (const k of await caches.keys()) if (k !== SHELL) await caches.delete(k)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return
  // Live endpoints: network only (auth, chat streams, TTS, webhooks…).
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/health')
  )
    return

  // App shell & static assets: network-first with cache fallback — fresh when
  // online (each deploy reaches everyone instantly), still opens when offline.
  e.respondWith(
    (async () => {
      const cache = await caches.open(SHELL)
      try {
        const res = await fetch(e.request)
        if (res.ok) void cache.put(e.request, res.clone())
        return res
      } catch {
        const hit = await cache.match(e.request)
        if (hit) return hit
        // SPA navigation with no cache entry: serve the cached shell root.
        if (e.request.mode === 'navigate') {
          const root = await cache.match('/')
          if (root) return root
        }
        throw new Error('offline')
      }
    })(),
  )
})
