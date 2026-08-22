// THE VERSION ROUTINE (Adrian's order, Jul 10): "on EVERY new deploy it
// updates the watermark, the browser restarts clean like at first login —
// memories and the rest are not lost (they live on the server), but everything
// returns to default." We track the server's DEPLOY VERSION (/api/version — it
// changes on every publish, even if the interface wasn't touched), not just
// the bundle name. When it changes → automatic hard reset.

import { isCalm } from './activity'

export interface ServerVersion {
  v: string
  at: string
  // Versiunea AUTO (owner, 13 aug): urcă +0.1 la fiecare publicare (V1.0, V1.1…).
  // Vine de pe server (sursă unică live → aceeași pe web/.exe/apk), nu din build.
  ver?: string
}

// Injectate la build (vezi vite.config.ts).
declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string

// THE VERSION LABEL — ONE SINGLE SOURCE (Adrian, Jul 10: "under each QR code
// the number from the watermark, THE SAME as in the browser; don't duplicate
// the code"). Used both by the App.tsx watermark and under the QR codes in
// Landing.tsx. The `deploy … UTC` part comes from /api/version, so it changes
// AUTOMATICALLY on every publish — just like the installed apps (the same web
// noile date singure.
function deployStamp(srv: ServerVersion | null): string {
  if (!srv?.at) return ''
  // LONDON TIME EVERYWHERE IN PRODUCTION (Adrian, Jul 11): every system stamp
  // (the version under the QR, the watermark) shows London time, with automatic
  // summer/winter switching. The time shown TO THE USER stays the user's (the client sends
  // `now`/`tz` on every turn — untouched here).
  const d = new Date(srv.at)
  const stamp = Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .format(d)
        .replace(',', '')
    : srv.at.slice(0, 16).replace('T', ' ')
  // Owner (13 aug): „versiunea și data/ora, atât" — fără SHA-ul de deploy, fără
  // eticheta „London". Rămâne doar data/ora (ora Londrei, comutare vară/iarnă auto).
  return stamp
}
export function versionLabel(srv: ServerVersion | null): string {
  // „V1.0 · data/ora deploy" (owner, 13 aug). Data/ora = momentul deploy-ului
  // (srv.at, se schimbă la ORICE publicare); cade pe data build-ului dacă serverul
  // n-a răspuns încă la prima citire.
  const dt = deployStamp(srv)
  // Numărul vine AUTO de pe server (urcă la fiecare publicare); până răspunde el,
  // cade pe versiunea din build (sursa unică tauri.conf.json) — nu pe gol.
  const nr = srv?.ver || __APP_VERSION__
  return `V${nr} · ${dt || __BUILD_DATE__}`
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

// HARD RESET TO THE LATEST VERSION: empties EVERYTHING (caches, service worker,
// localStorage, sessionStorage) and reloads anti-cache — the browser starts
// clean, like at first login (the session cookie REMAINS — it doesn't log you out;
// memories and history live on the server and come back by themselves).
let resetting = false
export async function hardResetToLatest(): Promise<void> {
  if (resetting) return
  // Reload ANTI-LOOP (survives the reload): if we reset within the
  // last 30s, we do NOT reload again — a reload loop would make
  // the app unusable.
  //
  // BUG (owner, 13 aug: „nu pot trece de actualizare / bagi update la foc
  // continuu"): `resetting = true` era pus ÎNAINTE de garda asta, iar pe ramura
  // de ieșire (reset <30s în urmă) NU se mai elibera → zăvor pe veci. După o
  // singură blocare, `if (resetting) return` de sus omora TOATE apelurile
  // următoare: butonul „Actualizează" și auto-aplicarea („se aplică în 0s")
  // deveneau moarte, omul rămânea prins pe fereastră. FIX: verificăm garda
  // ÎNAINTE de a pune zăvorul, deci o încercare blocată nu mai înțepenește
  // mecanismul — după fereastra de 30s, un click sau următoarea verificare
  // pornește resetarea normal.
  try {
    const last = Number(sessionStorage.getItem('kelion_last_reset') || 0)
    if (Date.now() - last < 30_000) return
  } catch {
    /* storage unavailable — we continue with the reset */
  }
  resetting = true
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      // NU șterge modelul offline (owner 20 aug: „nu descarcă nimic pentru offline").
      // WebLLM ține creierul local (~5,2 GB, gemma-2-9b) în Cache Storage sub `webllm/*`. Hard-reset-ul
      // rula la FIECARE publicare („update la foc continuu") și golea TOT → offline-ul
      // nu ajungea niciodată „gata". Păstrăm cheile webllm/*, ștergem restul.
      // + 'transformers-cache' (kitul offline, 22 aug): urechea Whisper
      // (~564 MB) stă în Cache API sub cheia asta — un update nu are voie s-o
      // radă, ca și creierul. (Gura Piper stă în OPFS — resetul de cache n-o
      // atinge; consemnat ca să RĂMÂNĂ așa.)
      await Promise.all(keys.filter((k) => !k.startsWith('webllm/') && k !== 'transformers-cache').map((k) => caches.delete(k)))
    }
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      reg?.active?.postMessage('kelion-clear-caches')
      // DEZÎNREGISTRĂM service worker-ul, nu doar îi cerem să golească (owner,
      // 13 aug: „update la foc continuu"). Dacă SW-ul servește bundle-ul VECHI
      // din cache, `?_v=` de mai jos nu ajută — reîncărcarea aterizează pe
      // același bundle → fereastra „versiune nouă" revine la infinit. Scos din
      // cale, browserul ia HTML+bundle proaspăt de la server; SW-ul se
      // reînregistrează singur la boot-ul următor.
      try {
        await reg?.unregister()
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* best-effort — we reload anyway */
  }
  // "All default": local state is emptied COMPLETELY (no chat restoration on
  // the page — history comes back from the server on load, like at first login).
  // EXCEPTIONS: the voiceprint (kelion.voiceprint). BUG found Jul 10 (Adrian:
  // "the microphone doesn't open automatically to say yes" — in fact its calibration
  // was erased on EVERY publish by this reset, so it kept asking for re-enrollment).
  // It's not "session state" — it's a hardware/voice calibration that must
  // survive every publish, just like the memories on the server.
  // And the COMPOSER DRAFT (kelion.draft, Aug 1): the reset now applies by
  // itself (the auto-update countdown), so what you were typing is kept too —
  // the composer restores it on boot.
  try {
    const voiceprint = localStorage.getItem('kelion.voiceprint')
    const draft = localStorage.getItem('kelion.draft')
    localStorage.clear()
    if (voiceprint) localStorage.setItem('kelion.voiceprint', voiceprint)
    if (draft) localStorage.setItem('kelion.draft', draft)
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
 * Calls `onUpdate` when a NEW deploy appears: the server version (/api/version)
 * changed since startup — or, as a safety net (server without sha),
 * the served bundle differs from the one the page started with. Checks at startup,
 * then every 45s and when the tab becomes visible again. Returns the stop function.
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
    // NEVER over live work (activity.ts, owner Aug 1): the update applies by
    // itself, but if a voice session/request/draft is open we skip THIS beat
    // and try again in 45s — without marking `fired`, so it fires the moment
    // things go calm. A hard reset mid-word is exactly what this avoids.
    if (!isCalm()) return
    // The main path: the server's deploy version.
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
    // The safety net: the served bundle name (covers servers without sha).
    if (!bootedBundle) return
    try {
      const html = await fetch(`/?_v=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text())
      const m = html.match(/index-[A-Za-z0-9_-]+\.js/)
      if (m && m[0] !== bootedBundle) {
        fired = true
        onUpdate()
      }
    } catch {
      /* offline / transient — on the next beat */
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

/** Preia bundle-ul nou ÎNAINTE de reset, cu progres real (Content-Length).
 *  Nu înlocuiește hard-reset: cache-ul e golit tot la reload, dar userul vede
 *  cât s-a descărcat înainte să pice pagina. */
export function downloadLatestBundle(onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', `/?_v=${Date.now()}`)
    xhr.onerror = () => reject(new Error('nu pot citi noul index'))
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return
      if (xhr.status !== 200) { reject(new Error(`index ${xhr.status}`)); return }
      const m = xhr.responseText.match(/index-[A-Za-z0-9_-]+\.js/)
      if (!m) { reject(new Error('nu găsesc index.js în noul HTML')); return }
      const js = `/assets/${m[0]}?_v=${Date.now()}`
      const xhr2 = new XMLHttpRequest()
      xhr2.open('GET', js)
      onProgress(0)
      let last = 0
      xhr2.onprogress = (e) => {
        if (e.lengthComputable) {
          const p = Math.max(0, Math.min(1, e.loaded / e.total))
          if (p > last) { last = p; onProgress(p) }
        }
      }
      xhr2.onload = () => { onProgress(1); resolve() }
      xhr2.onerror = () => reject(new Error('nu pot descărca bundle-ul nou'))
      xhr2.send()
    }
    xhr.send()
  })
}
