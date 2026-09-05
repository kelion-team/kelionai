// Shell-ul PWA este precached separat de runtime-urile mari ale kitului offline.
// Listele sunt generate din dist după build; runtime-ul este descărcat numai
// după consimțământul explicit din Setări.
const SHELL = 'kelionai-shell-dev' // __KELION_SHELL_VERSION__
const PRECACHE_SHELL = ['/?v=dev', '/index.html?v=dev'] // __KELION_PRECACHE__
const PRECACHE_OFFLINE_RUNTIME = [] // __KELION_OFFLINE_RUNTIME__
// Asseturile revizuite sunt partajate între generații. O versiune nouă
// descarcă numai conținutul al cărui ?v=hash s-a schimbat; cache-ul SHELL ține
// doar manifestul mic și marchează o instalare completă.
const ASSET_CACHE = 'kelionai-precache-assets-v1'
const OFFLINE_RUNTIME_META_CACHE = 'kelionai-offline-runtime-meta-v1'
const OFFLINE_RUNTIME_MANIFEST = '/__kelion-offline-runtime-manifest__'
const runtimeInstalls = new Map()
let runtimeOperation = Promise.resolve()
let offlineUntil = 0
const marcheazaOffline = () => { offlineUntil = Math.max(offlineUntil, Date.now() + 10_000) }
const offlineCunoscut = () => (self.navigator && self.navigator.onLine === false) || Date.now() < offlineUntil
const MANIFEST_KEY = '/__kelion-shell-manifest__'
const caleRevizuita = (pathname) =>
  [...PRECACHE_SHELL, ...PRECACHE_OFFLINE_RUNTIME.map((asset) => asset.url)]
    .find((entry) => new URL(entry, self.location.origin).pathname === pathname) || null
const manifestaShellPastrate = async () => {
  const manifests = []
  for (const key of (await caches.keys()).filter((name) => name.startsWith('kelionai-shell-'))) {
    const meta = await caches.open(key)
    const response = await meta.match(MANIFEST_KEY)
    const manifest = response ? await response.json().catch(() => null) : null
    if (manifest && Array.isArray(manifest.urls)) {
      manifests.push({ key, urls: manifest.urls, installedAt: Number(manifest.installedAt) || 0 })
    }
  }
  manifests.sort((a, b) => {
    if (a.key === SHELL) return -1
    if (b.key === SHELL) return 1
    return b.installedAt - a.installedAt
  })
  // Un tab poate amâna mai multe actualizări. Lookup-ul trebuie să poată servi
  // orice generație păstrată, inclusiv un chunk lazy încă necerut de acel tab.
  return manifests
}
const caleRevizuitaPastrata = async (pathname) => {
  const current = caleRevizuita(pathname)
  if (current) return current
  for (const manifest of await manifestaShellPastrate()) {
    const entry = manifest.urls.find((candidate) =>
      new URL(candidate, self.location.origin).pathname === pathname)
    if (entry) return entry
  }
  return null
}
const assetCurent = async (cache, request) => {
  const pathname = typeof request === 'string' ? request : new URL(request.url).pathname
  const revizuit = await caleRevizuitaPastrata(pathname)
  if (!revizuit) return null
  // Exact este regula; ignoreSearch e plasa pentru cache-uri migrate din v2.
  return (await cache.match(revizuit)) || (await cache.match(pathname, { ignoreSearch: true }))
}

// Cache-urile modelelor sunt gestionate de instalatorul kitului, nu de update-ul
// shellului. Astfel un update UI nu șterge modelele deja verificate.
const eModelOffline = (k) => k.startsWith('webllm/') || k === 'transformers-cache'
const ePastrat = (k) => k === SHELL || k === ASSET_CACHE || k === OFFLINE_RUNTIME_META_CACHE || eModelOffline(k)

const digestComplet = async (buffer) => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const totalRuntimeBytes = () => PRECACHE_OFFLINE_RUNTIME.reduce((total, asset) => total + asset.sizeBytes, 0)

async function runtimeResponseValid(response, asset) {
  if (!response || !asset || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(asset.sha256) || typeof asset.url !== 'string') return false
  const bytes = await response.arrayBuffer()
  return bytes.byteLength === asset.sizeBytes && await digestComplet(bytes) === asset.sha256
}

async function cacheRuntimeOffline(signal, onProgress = () => {}) {
  const cache = await caches.open(ASSET_CACHE)
  const adaugate = []
  try {
    const totalBytes = totalRuntimeBytes()
    let doneBytes = 0
    for (let index = 0; index < PRECACHE_OFFLINE_RUNTIME.length; index++) {
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
      const asset = PRECACHE_OFFLINE_RUNTIME[index]
      const { url } = asset
      if (new URL(url, self.location.origin).searchParams.get('v') !== asset.sha256) {
        throw new Error('offline_runtime_revision_missing')
      }
      const cached = await cache.match(url)
      const valid = await runtimeResponseValid(cached, asset)
      if (cached && !valid) await cache.delete(url)
      if (!valid) {
        const response = await fetch(new Request(url, { cache: 'reload', signal }))
        if (!response.ok) throw new Error(`offline_runtime_${response.status}`)
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength !== asset.sizeBytes || await digestComplet(bytes) !== asset.sha256) {
          throw new Error('offline_runtime_integrity')
        }
        await cache.put(url, new Response(bytes, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }))
        adaugate.push(url)
      }
      doneBytes += asset.sizeBytes
      onProgress(index + 1, PRECACHE_OFFLINE_RUNTIME.length, doneBytes, totalBytes)
    }
    const meta = await caches.open(OFFLINE_RUNTIME_META_CACHE)
    const previousMarker = await meta.match(OFFLINE_RUNTIME_MANIFEST)
    const previous = previousMarker ? await previousMarker.json().catch(() => null) : null
    await meta.put(OFFLINE_RUNTIME_MANIFEST, new Response(JSON.stringify({
      assets: PRECACHE_OFFLINE_RUNTIME,
      installedAt: Date.now(),
    }), { headers: { 'content-type': 'application/json' } }))
    const currentUrls = new Set(PRECACHE_OFFLINE_RUNTIME.map((asset) => asset.url))
    const previousUrls = Array.isArray(previous?.assets)
      ? previous.assets.map((asset) => asset?.url).filter((url) => typeof url === 'string')
      : Array.isArray(previous?.urls) ? previous.urls.filter((url) => typeof url === 'string') : []
    await Promise.all(previousUrls.filter((url) => !currentUrls.has(url)).map((url) => cache.delete(url)))
  } catch (error) {
    await Promise.all(adaugate.map((url) => cache.delete(url)))
    throw error
  }
}

async function verificaRuntimeOffline() {
  const meta = await caches.open(OFFLINE_RUNTIME_META_CACHE)
  const marker = await meta.match(OFFLINE_RUNTIME_MANIFEST)
  const saved = marker ? await marker.json().catch(() => null) : null
  if (!saved || !Array.isArray(saved.assets) ||
    JSON.stringify(saved.assets) !== JSON.stringify(PRECACHE_OFFLINE_RUNTIME)) {
    return { ready: false, totalBytes: totalRuntimeBytes() }
  }
  const cache = await caches.open(ASSET_CACHE)
  for (const asset of PRECACHE_OFFLINE_RUNTIME) {
    const response = await cache.match(asset.url)
    if (!(await runtimeResponseValid(response, asset))) {
      return { ready: false, totalBytes: totalRuntimeBytes() }
    }
  }
  return { ready: true, totalBytes: totalRuntimeBytes() }
}

function serializeazaRuntime(operation) {
  const running = runtimeOperation.catch(() => {}).then(operation)
  runtimeOperation = running.catch(() => {})
  return running
}

async function stergeRuntimeOffline() {
  const meta = await caches.open(OFFLINE_RUNTIME_META_CACHE)
  const marker = await meta.match(OFFLINE_RUNTIME_MANIFEST)
  const saved = marker ? await marker.json().catch(() => null) : null
  const urls = new Set([
    ...PRECACHE_OFFLINE_RUNTIME.map((asset) => asset.url),
    ...(saved && Array.isArray(saved.assets)
      ? saved.assets.map((asset) => asset?.url).filter((url) => typeof url === 'string')
      : []),
    ...(saved && Array.isArray(saved.urls) ? saved.urls.filter((url) => typeof url === 'string') : []),
  ])
  const cache = await caches.open(ASSET_CACHE)
  for (const url of urls) {
    if (!(await cache.delete(url))) {
      const stillPresent = await cache.match(url)
      if (stillPresent) throw new Error('offline_runtime_remove_failed')
    }
  }
  await meta.delete(OFFLINE_RUNTIME_MANIFEST)
  if (await meta.match(OFFLINE_RUNTIME_MANIFEST)) throw new Error('offline_runtime_marker_remove_failed')
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      // Instalarea este tranzacțională: dacă un asset lipsește, workerul nou NU
      // se activează peste cel vechi. Manifestul este derivat din dist, deci
      // fiecare URL există în exact build-ul care livrează acest sw.js.
      const cache = await caches.open(ASSET_CACHE)
      const adaugate = []
      try {
        for (const url of PRECACHE_SHELL) {
          // Același URL revizuit = aceiași octeți; îl reutilizăm din generația
          // precedentă fără download și fără o a doua copie de ~102 MiB.
          if (await cache.match(url)) continue
          const res = await fetch(new Request(url, { cache: 'reload' }))
          if (!res.ok) throw new Error(`precache_${res.status}`)
          await cache.put(url, res)
          adaugate.push(url)
        }
        const meta = await caches.open(SHELL)
        await meta.put(MANIFEST_KEY, new Response(JSON.stringify({
          urls: PRECACHE_SHELL,
          installedAt: Date.now(),
        }), { headers: { 'content-type': 'application/json' } }))
      } catch (err) {
        // Workerul vechi rămâne activ, iar încercarea e rollback-uită; nu lăsăm
        // asseturi orfane dintr-o instalare incompletă.
        await Promise.all(adaugate.map((url) => cache.delete(url)))
        await caches.delete(SHELL)
        throw err
      }
    })(),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Fără un registru per-tab nu putem dovedi ce generație folosește fiecare
      // fereastră. Amânăm reclamarea cât există oricare, inclusiv necontrolată;
      // eroarea de enumerare nu este dovadă că toate ferestrele s-au închis.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => null)
      if (windows === null || windows.length > 0) {
        await self.clients.claim()
        return
      }
      // Retenția poate crește până la o activare ulterioară fără ferestre.
      // Atunci păstrăm politica existentă: manifestul curent + cel precedent.
      const keys = await caches.keys()
      const runtimeMeta = await caches.open(OFFLINE_RUNTIME_META_CACHE)
      const runtimeMarker = await runtimeMeta.match(OFFLINE_RUNTIME_MANIFEST)
      // Activarea nu repară și nu descarcă runtime-uri. Readiness-ul local va
      // cere o reinstalare explicită dacă inventarul noii versiuni diferă.
      const pastrate = (await manifestaShellPastrate()).slice(0, 2)
      const cheiPastrate = new Set(pastrate.map((m) => m.key))
      const urluriPastrate = new Set(pastrate.flatMap((m) => m.urls))
      if (runtimeMarker) {
        const saved = await runtimeMarker.json().catch(() => null)
        const savedUrls = Array.isArray(saved?.assets)
          ? saved.assets.map((asset) => asset?.url).filter((url) => typeof url === 'string')
          : Array.isArray(saved?.urls) ? saved.urls.filter((url) => typeof url === 'string') : []
        for (const url of savedUrls) urluriPastrate.add(url)
      }
      const assetCache = await caches.open(ASSET_CACHE)
      for (const req of await assetCache.keys()) {
        const relativ = `${new URL(req.url).pathname}${new URL(req.url).search}`
        if (!urluriPastrate.has(relativ)) await assetCache.delete(req)
      }
      for (const k of keys) {
        if (k.startsWith('kelionai-shell-') && !cheiPastrate.has(k)) await caches.delete(k)
        else if (!k.startsWith('kelionai-shell-') && !ePastrat(k)) await caches.delete(k)
      }
      await self.clients.claim()
    })(),
  )
})

// Un build nou rămâne în `waiting` până când utilizatorul acceptă actualizarea
// din UI. Nu ștergem storage/cache și nu întrerupem o sesiune vocală în lucru.
self.addEventListener('message', (e) => {
  if (e.data === 'kelion-activate-update') e.waitUntil(self.skipWaiting())
  if (e.data?.type === 'kelion-cache-offline-runtime' && typeof e.data.id === 'string') {
    const controller = new AbortController()
    runtimeInstalls.set(e.data.id, controller)
    const port = e.ports?.[0]
    e.waitUntil(serializeazaRuntime(() => cacheRuntimeOffline(controller.signal, (done, total, doneBytes, totalBytes) => {
      port?.postMessage({ type: 'progress', done, total, doneBytes, totalBytes })
    })).then(
      () => port?.postMessage({ type: 'done', ready: true, totalBytes: totalRuntimeBytes() }),
      (error) => port?.postMessage({
        type: controller.signal.aborted ? 'cancelled' : 'error',
        error: error instanceof Error ? error.message : 'offline_runtime_failed',
      }),
    ).finally(() => runtimeInstalls.delete(e.data.id)))
  }
  if (e.data?.type === 'kelion-cancel-offline-runtime' && typeof e.data.id === 'string') {
    runtimeInstalls.get(e.data.id)?.abort()
  }
  if (e.data?.type === 'kelion-remove-offline-runtime') {
    for (const controller of runtimeInstalls.values()) controller.abort()
    const port = e.ports?.[0]
    e.waitUntil(serializeazaRuntime(stergeRuntimeOffline).then(
      () => port?.postMessage({ type: 'done' }),
      (error) => port?.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : 'offline_runtime_remove_failed',
      }),
    ))
  }
  if (e.data?.type === 'kelion-check-offline-runtime') {
    const port = e.ports?.[0]
    e.waitUntil(serializeazaRuntime(verificaRuntimeOffline).then(
      (status) => port?.postMessage({ type: 'done', ...status }),
      () => port?.postMessage({ type: 'done', ready: false, totalBytes: totalRuntimeBytes() }),
    ))
  }
})

// ── NOTIFICĂRI PUSH (Web Push, VAPID — serverul le trimite prin
// /api/push/*) ── notificarea se ARATĂ mereu (userVisibleOnly e promisiunea
// făcută browserului la abonare); clicul duce înapoi în aplicație.
const caleNotificareSigura = (valoare) => {
  try {
    const url = new URL(typeof valoare === 'string' ? valoare : '/', self.location.origin)
    if (url.origin !== self.location.origin) return '/'
    return `${url.pathname}${url.search}${url.hash}` || '/'
  } catch {
    return '/'
  }
}

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
      data: { url: caleNotificareSigura(date.url) },
    }),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  // Revalidăm la click: notificarea poate proveni de la un worker vechi sau
  // dintr-un payload persistat înainte de validarea de la recepție.
  const url = caleNotificareSigura(e.notification.data && e.notification.data.url)
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
  if (url.origin !== self.location.origin) return
  const liveEndpoint =
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/health')
  if (liveEndpoint) {
    // La cold-start în avion, pagina poate raporta temporar `online=true`, însă
    // workerul păstrează și un latch scurt după primul eșec real. Endpointurile
    // rămân network-only: răspunsul nu este niciodată pus în cache.
    const raspunsOffline = () => new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    e.respondWith((async () => {
      if (offlineCunoscut()) return raspunsOffline()
      try {
        return await fetch(e.request)
      } catch (error) {
        if (e.request.signal?.aborted || error?.name === 'AbortError') throw error
        marcheazaOffline()
        return raspunsOffline()
      }
    })())
    return
  }
  if (e.request.method !== 'GET') return

  // HTML-ul (navigări, „/", *.html) → MEREU din rețea, no-store, ca să nu rămână
  // niciodată o versiune veche care trimite spre bundle vechi.
  const isHTML =
    e.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html')

  // Runtime-ul ORT este instalat și verificat numai prin fluxul explicit al
  // kitului. Cererile modelului îl pot citi exclusiv din cache; un asset lipsă
  // nu declanșează rețea sau o reinstalare ascunsă.
  const isOfflineRuntimeFile = !url.pathname.startsWith('/assets/') &&
    PRECACHE_OFFLINE_RUNTIME.some((asset) => new URL(asset.url, self.location.origin).pathname === url.pathname)
  if (!isHTML && isOfflineRuntimeFile) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE)
        const hit = await assetCurent(cache, e.request)
        if (hit) return hit
        throw new Error('offline_runtime_missing')
      })(),
    )
    return
  }

  // Bundle-urile Vite au hash în nume și sunt imuabile. Cache-first elimină
  // dependența de rețea la cold-start; o versiune nouă are alte URL-uri și alt
  // cache SHELL. Resursele publice fără hash rămân network-first mai jos.
  if (!isHTML && url.pathname.startsWith('/assets/')) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE)
        const hit = await assetCurent(cache, e.request)
        if (hit) return hit
        const res = await fetch(e.request)
        const revizuit = await caleRevizuitaPastrata(url.pathname)
        if (res.ok && revizuit) await cache.put(revizuit, res.clone())
        return res
      })(),
    )
    return
  }

  e.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE)
      if (offlineCunoscut()) {
        if (self.navigator && self.navigator.onLine === false) marcheazaOffline()
        const direct = await assetCurent(cache, e.request)
        if (direct) return direct
        if (isHTML || e.request.mode === 'navigate') {
          const root = await assetCurent(cache, '/')
          if (root) return root
        }
        throw new Error(isHTML ? 'offline_shell_missing' : 'offline_asset_missing')
      }
      try {
        const res = await fetch(e.request, isHTML ? { cache: 'no-store' } : {})
        // Rădăcina actualizează shell-ul „/". Alte navigări se cachează sub URL-ul
        // lor, ca /privacy sau /manual să nu suprascrie shell-ul offline.
        if (res.ok) {
          const cheia = await caleRevizuitaPastrata(isHTML && url.pathname === '/' ? '/' : url.pathname)
          if (cheia) void cache.put(cheia, res.clone())
        }
        return res
      } catch {
        marcheazaOffline()
        const hit = await assetCurent(cache, e.request)
        if (hit) return hit
        // Navigare fără cache: servește shell-ul rădăcină cached (dacă există).
        if (e.request.mode === 'navigate') {
          const root = await assetCurent(cache, '/')
          if (root) return root
        }
        throw new Error('offline')
      }
    })(),
  )
})
