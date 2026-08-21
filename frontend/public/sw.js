// Kelionai service worker — PWA installability + a light resilience layer for
// weak mobile links: the app SHELL opens instantly and still STARTS with no
// signal; live data (API, chat) always goes to the network — never cached.
//
// REGULA DE AUR (Adrian, 10 iul: „să fie preluată ultima versiune în permanență"):
// HTML-ul (index.html / navigări) se ia MEREU proaspăt din rețea (no-store), ca
// să pointeze mereu spre ultimul bundle cu hash. Fișierele cu hash (index-*.js/css)
// sunt imutabile — o schimbare de conținut schimbă hash-ul — deci se pot pune în
// cache liniștit. Așa un deploy ajunge INSTANT la toți, fără versiuni vechi lipite.
const SHELL = 'kelionai-shell-v2'

// CACHE-urile MODELELOR OFFLINE nu se ating NICIODATĂ (owner 20/21 aug: „nu descarcă
// nimic pentru offline" + „la fiecare update nu trebuie descărcate din nou modelele").
//  • CREIERUL: WebLLM ține modelul (~GB) sub `webllm/model|wasm|config`.
//  • URECHEA (Faza 1 · M4): transformers.js (Whisper) ține modelul sub cache-uri care
//    încep cu `transformers` (`transformers-cache`, `experimental_transformers-...`).
//    Runtime-ul .wasm (/ort/) e cache-uit în SHELL de fetch handler → deja protejat.
// Curățările de mai jos (upgrade de shell / rutina de versiune) le ȘTERGEAU pe toate →
// fiecare update automat distrugea modelele descărcate. Le protejăm pe TOATE.
const ePastrat = (k) => k === SHELL || k.startsWith('webllm/') || k.startsWith('transformers')

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      // PRECACHE SHELL (owner 20 aug: „în avion zice că nu poate accesa aplicația").
      // Punem shell-ul rădăcină ('/') în cache CHIAR la instalare, ca app-ul să
      // pornească fără semnal chiar dacă n-a mai fost deschisă online între timp.
      // La instalare există net (SW-ul se instalează online) → `add` reușește; dacă
      // totuși nu, fetch handler-ul îl prinde la prima vizită online.
      try {
        const cache = await caches.open(SHELL)
        await cache.add('/')
      } catch {
        /* offline la instalare (rar) — cade pe cache-ul leneș din fetch handler */
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Șterge cache-urile vechi la upgrade (shell-v1), DAR păstrează shell-ul curent
      // ȘI modelul offline (webllm/*) — altfel update-ul ar rade creierul local.
      for (const k of await caches.keys()) if (!ePastrat(k)) await caches.delete(k)
      await self.clients.claim()
    })(),
  )
})

// Permite paginii să forțeze curățarea cache-ului (rutina de versiune). Golește TOT
// în afară de modelele offline (creier `webllm/*` + ureche `transformers*`) — un update
// NU trebuie să șteargă gigabytes descărcați cu greu; altfel offline-ul repornește de la
// zero la fiecare publicare. (SHELL-ul se golește aici intenționat, se reface din rețea.)
self.addEventListener('message', (e) => {
  if (e.data === 'kelion-clear-caches') {
    e.waitUntil((async () => {
      for (const k of await caches.keys())
        if (!k.startsWith('webllm/') && !k.startsWith('transformers')) await caches.delete(k)
    })())
  }
})

// ── NOTIFICĂRI PUSH (Web Push, VAPID — serverul le trimite prin
// /api/push/*) ── notificarea se ARATĂ mereu (userVisibleOnly e promisiunea
// făcută browserului la abonare); clicul duce înapoi în aplicație.
self.addEventListener('push', (e) => {
  let date = { titlu: 'Kelion', mesaj: '' }
  try {
    date = { ...date, ...e.data.json() }
  } catch {
    date.mesaj = e.data ? e.data.text() : ''
  }
  e.waitUntil(
    self.registration.showNotification(date.titlu, {
      body: date.mesaj,
      icon: '/kelion-logo.png',
      badge: '/kelion-logo.png',
      data: { url: date.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/'
  e.waitUntil(
    (async () => {
      const ferestre = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const f of ferestre) {
        if ('focus' in f) {
          await f.focus()
          if ('navigate' in f && url !== '/') await f.navigate(url).catch(() => {})
          return
        }
      }
      await self.clients.openWindow(url)
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

  // HTML-ul (navigări, „/", *.html) → MEREU din rețea, no-store, ca să nu rămână
  // niciodată o versiune veche care trimite spre bundle vechi.
  const isHTML =
    e.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html')

  e.respondWith(
    (async () => {
      const cache = await caches.open(SHELL)
      try {
        const res = await fetch(e.request, isHTML ? { cache: 'no-store' } : {})
        // ONLINE: mereu proaspăt (network-first). DAR punem ȘI shell-ul (HTML) în
        // cache, sub „/", ca aplicația să se DESCHIDĂ și OFFLINE (mod companion,
        // owner 20 aug: „în avion zice că nu poate accesa aplicația"). Fără asta,
        // fallback-ul de mai jos n-avea ce servi → app-ul nu pornea fără net.
        if (res.ok) void cache.put(isHTML ? '/' : e.request, res.clone())
        return res
      } catch {
        const hit = await cache.match(e.request)
        if (hit) return hit
        // Navigare fără cache: servește shell-ul rădăcină cached (dacă există).
        if (e.request.mode === 'navigate') {
          const root = await cache.match('/')
          if (root) return root
        }
        throw new Error('offline')
      }
    })(),
  )
})
