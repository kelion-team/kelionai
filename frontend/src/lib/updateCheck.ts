// RUTINA DE VERSIUNE (ordinul lui Adrian, 10 iul): „la ORICE deploy nou se
// actualizează filigranul, browserul repornește curat ca la prima logare —
// memoriile și restul nu se pierd (stau pe server), dar totul revine la
// default." Urmărim VERSIUNEA DEPLOY-ULUI de pe server (/api/version — se
// schimbă la orice publicare, chiar dacă interfața n-a fost atinsă), nu doar
// numele bundle-ului. Când se schimbă → reset dur automat.

export interface ServerVersion {
  v: string
  at: string
}

export async function fetchServerVersion(): Promise<ServerVersion | null> {
  try {
    const r = await fetch(`/api/version?_v=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json()) as ServerVersion
    return j && typeof j.v === 'string' ? j : null
  } catch {
    return null
  }
}

function currentBundle(): string | null {
  const s = document.querySelector('script[src*="/assets/index-"]') as HTMLScriptElement | null
  const m = s?.src.match(/index-[A-Za-z0-9_-]+\.js/)
  return m ? m[0] : null
}

// RESET DUR LA ULTIMA VERSIUNE: golește TOT (cache-uri, service worker,
// localStorage, sessionStorage) și reîncarcă anti-cache — browserul pornește
// curat, ca la prima logare (cookie-ul de sesiune RĂMÂNE — nu te deloghează;
// memoriile și istoricul stau pe server și revin singure).
let resetting = false
export async function hardResetToLatest(): Promise<void> {
  if (resetting) return
  resetting = true
  // ANTI-BUCLĂ de reload (supraviețuiește reîncărcării): dacă am resetat în
  // ultimele 30s, NU mai reîncărcăm încă o dată — o buclă de reload ar face
  // aplicația inutilizabilă.
  try {
    const last = Number(sessionStorage.getItem('kelion_last_reset') || 0)
    if (Date.now() - last < 30_000) return
  } catch {
    /* storage indisponibil — continuăm cu resetul */
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      reg?.active?.postMessage('kelion-clear-caches')
    }
  } catch {
    /* best-effort — reîncărcăm oricum */
  }
  // „Tot default": starea locală se golește COMPLET (fără restaurare de chat pe
  // pagină — istoricul revine de pe server la încărcare, ca la prima logare).
  // EXCEPȚIE: amprenta vocală (kelion.voiceprint). BUG găsit 10 iul (Adrian:
  // „microfonul nu se deschide automat să zic da" — de fapt calibrarea îi era
  // ștearsă la FIECARE publicare de resetul ăsta, deci mereu cerea reînrolare).
  // Nu e „stare de sesiune" — e o calibrare hardware/voce care trebuie să
  // supraviețuiască oricărei publicări, la fel ca memoriile de pe server.
  try {
    const voiceprint = localStorage.getItem('kelion.voiceprint')
    localStorage.clear()
    if (voiceprint) localStorage.setItem('kelion.voiceprint', voiceprint)
  } catch {
    /* indisponibil */
  }
  try {
    sessionStorage.clear()
    sessionStorage.setItem('kelion_last_reset', String(Date.now())) // plasa anti-buclă
  } catch {
    /* indisponibil */
  }
  const u = new URL(window.location.href)
  u.search = `?_v=${Date.now()}` // curăță și parametrii vechi — pornire default
  window.location.replace(u.toString())
}

/**
 * Cheamă `onUpdate` când apare un DEPLOY nou: versiunea serverului (/api/version)
 * s-a schimbat față de cea de la pornire — sau, ca plasă (server fără sha),
 * bundle-ul servit diferă de cel cu care a pornit pagina. Verifică la pornire,
 * apoi la fiecare 45s și când tab-ul redevine vizibil. Întoarce funcția de stop.
 */
export function watchForUpdate(onUpdate: () => void): () => void {
  const bootedBundle = currentBundle()
  let bootedV = ''
  let stopped = false
  let fired = false

  void fetchServerVersion().then((j) => {
    if (j?.v) bootedV = j.v
  })

  const check = async (): Promise<void> => {
    if (stopped || fired) return
    // Calea principală: versiunea deploy-ului de pe server.
    const j = await fetchServerVersion()
    if (j?.v) {
      if (!bootedV) {
        bootedV = j.v // prima citire reușită devine referința
      } else if (j.v !== bootedV) {
        fired = true
        onUpdate()
        return
      }
    }
    // Plasa: numele bundle-ului servit (acoperă serverele fără sha).
    if (!bootedBundle) return
    try {
      const html = await fetch(`/?_v=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text())
      const m = html.match(/index-[A-Za-z0-9_-]+\.js/)
      if (m && m[0] !== bootedBundle) {
        fired = true
        onUpdate()
      }
    } catch {
      /* offline / tranzitoriu — la următoarea bătaie */
    }
  }

  void check()
  const id = window.setInterval(() => void check(), 45_000)
  const onVis = (): void => {
    if (document.visibilityState === 'visible') void check()
  }
  document.addEventListener('visibilitychange', onVis)

  return () => {
    stopped = true
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', onVis)
  }
}
