import { apiFetch } from './transport'
import { verificaConexiuneReala } from './conexiune'
import { redactDiagnostic } from '../../../backend/src/shared/diagnosticRedaction'

// Browser errors are sent in bounded, redacted batches only after connectivity
// is verified. Offline batches remain in memory until a verified reconnect.

const queue: string[] = []
let timer: number | null = null
let onlineListenerArmed = false
let flushing = false
const seen = new Map<string, number>()
const RESEND_AFTER_MS = 5 * 60_000
// Stiva completă a unei excepții nu încape în 400 de caractere — fără ea,
// `/api/client-errors` primea DOAR mesajul („Cannot read properties of null"),
// adică simptomul fără locul faptei. Plafonul rămâne mărginit (redactarea taie
// oricum secretele) dar suficient pentru primele cadre ale stivei.
const MAX_CARACTERE_RAPORT = 1200

function reportClientError(msg: string): void {
  const m = redactDiagnostic(msg, MAX_CARACTERE_RAPORT)
  if (!m) return
  const now = Date.now()
  const last = seen.get(m)
  if (last !== undefined && now - last < RESEND_AFTER_MS) return
  seen.set(m, now)
  if (seen.size > 200) seen.clear() // resetăm dedupul, nu memoria
  queue.push(m)
  if (queue.length > 100) queue.splice(0, queue.length - 100)
  if (timer == null) timer = window.setTimeout(() => void flush(), 3000)
}

function armVerifiedReconnect(): void {
  if (onlineListenerArmed || typeof window === 'undefined') return
  onlineListenerArmed = true
  window.addEventListener('online', onOnline, { once: true })
}

function onOnline(): void {
  onlineListenerArmed = false
  if (timer == null) timer = window.setTimeout(() => void flush(), 0)
}

async function flush(): Promise<void> {
  timer = null
  if (flushing || queue.length === 0) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    armVerifiedReconnect()
    return
  }
  flushing = true
  try {
    if (!(await verificaConexiuneReala())) {
      armVerifiedReconnect()
      return
    }
    const errors = queue.slice(0, 10)
    const response = await apiFetch('/api/client-errors', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ errors }),
    })
    if (!response.ok) throw new Error(`client_errors_${response.status}`)
    queue.splice(0, errors.length)
  } catch {
    // Păstrăm lotul pentru reconnect; nu îl marcăm trimis pe un răspuns ambiguu.
  } finally {
    flushing = false
  }
  if (queue.length > 0 && timer == null) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) armVerifiedReconnect()
    else timer = window.setTimeout(() => void flush(), 5000)
  }
}

/** ULTIMA SUFLARE: lotul pleacă ACUM, fără pingul de 4s la /health și fără
 *  cronometrul de 3s — pagina tocmai se închide/reîncarcă și, fără asta, exact
 *  eroarea FATALĂ (ultima dinaintea plecării) se pierdea în coadă. `keepalive`
 *  ține cererea vie după ce documentul moare. */
function trimiteUltimaSuflare(): void {
  if (queue.length === 0) return
  // `slice`, nu `splice`: cererea `keepalive` poate pica (offline, sesiune
  // expirată), iar un `pagehide` de bfcache nu este o moarte — pagina poate
  // reveni și trebuie să-și găsească erorile. În plus, un `flush()` în zbor
  // deține deja primele zece: dacă le-am scoate aici, `splice`-ul lui de la
  // răspuns ar șterge intrările următoare, netrimise niciodată. Serverul
  // deduplică mesajele identice, deci retrimiterea e inofensivă.
  const errors = queue.slice(0, 10)
  try {
    void apiFetch('/api/client-errors', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ errors }),
    }).catch(() => {})
  } catch {
    /* pagina moare oricum — nu mai avem unde raporta */
  }
}

// ── CUTIA NEAGRĂ A TABULUI (diagnostic „aplicația se reîncarcă singură") ─────
//
// De ce: în jurnalul serverului se vedea `POST /api/client-errors` urmat imediat
// de `GET /` — adică pagina PLEACĂ, dar nu se știa DACĂ pleacă pentru că o
// cheamă codul nostru (reload/redirect) sau pentru că procesul de randare a
// MURIT (OOM / crash / TWA repornit). Diferența e decisivă și se măsoară exact
// cu o urmă: `pagehide` se dă la orice plecare NORMALĂ (reload, navigare,
// închidere) și NU se dă la un crash de randare. Deci:
//   · urmă cu `motivPlecare` → plecare curată, cu motivul ei;
//   · urmă FĂRĂ `motivPlecare` → tabul a murit fără să apuce `pagehide`.
// Urma stă în `sessionStorage` (per tab, se pierde la închiderea tabului) și e
// citită o singură dată, la pornirea următoare.

const CHEIE_URMA = 'kelion_urma_tab'

export interface UrmaTab {
  v: 1
  /** performance.now()-ul absolut (Date.now) al ultimei bătăi. */
  at: number
  /** Ce făcea aplicația atunci (ex. 'voce:gata'). */
  faza: string
  /** Setat DOAR la o plecare curată: 'pagehide', 'reload:sw', 'logout'… */
  motivPlecare?: string
  /** Heap-ul JS în MB, dacă browserul îl expune (Chromium). */
  heapMb?: number
}

/** VERDICTUL, funcție PURĂ (probată în teste, fără browser): ce s-a întâmplat
 *  cu pagina precedentă din acest tab? `null` = prima încărcare, nimic de spus. */
export function raportPostMortem(
  urma: UrmaTab | null,
  tipNavigare: string,
  acum: number,
): string | null {
  if (!urma || urma.v !== 1) return null
  const tacere = Math.max(0, Math.round((acum - urma.at) / 1000))
  const heap = typeof urma.heapMb === 'number' ? `, heap=${urma.heapMb}MB` : ''
  const coada = `faza=${urma.faza}, nav=${tipNavigare}${heap}, dupa ${tacere}s`
  if (urma.motivPlecare) {
    return `[POST-MORTEM] pagina precedenta a plecat CURAT (motiv=${urma.motivPlecare}, ${coada})`
  }
  return `[POST-MORTEM] pagina precedenta a MURIT fara pagehide (${coada}) — crash de randare / OOM / proces oprit, NU un reload din cod`
}

function citesteUrma(): UrmaTab | null {
  try {
    const brut = sessionStorage.getItem(CHEIE_URMA)
    if (!brut) return null
    const parsat = JSON.parse(brut) as UrmaTab
    return parsat && parsat.v === 1 && typeof parsat.at === 'number' ? parsat : null
  } catch {
    return null
  }
}

let urmaCurenta: UrmaTab = { v: 1, at: Date.now(), faza: 'boot' }

function scrieUrma(): void {
  try {
    sessionStorage.setItem(CHEIE_URMA, JSON.stringify(urmaCurenta))
  } catch {
    /* storage plin/blocat — diagnosticul nu are voie să rupă aplicația */
  }
}

function heapMb(): number | undefined {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
  const octeti = mem?.usedJSHeapSize
  return typeof octeti === 'number' ? Math.round(octeti / 1_048_576) : undefined
}

/** Ce face aplicația ACUM — apelat din calea vocală, ca post-mortemul de la
 *  următoarea pornire să spună în ce fază a murit tabul. */
export function marcheazaFaza(faza: string): void {
  // `motivPlecare` NU se propagă: pagina restaurată din bfcache nu reevaluează
  // modulul, deci un `pagehide` de la o simplă comutare de aplicație ar rămâne
  // lipit și ar face ca un crash ulterior să fie raportat drept plecare curată —
  // exact inversul verdictului. Orice activitate nouă înseamnă că pagina trăiește.
  const { motivPlecare: _plecat, ...vie } = urmaCurenta
  urmaCurenta = { ...vie, at: Date.now(), faza, heapMb: heapMb() }
  scrieUrma()
}

/** O plecare INTENȚIONATĂ a paginii (reload din cod, logout, redirect). Se
 *  cheamă ÎNAINTE de `location.*`, ca post-mortemul să nu o confunde cu un crash. */
export function marcheazaPlecarea(motiv: string): void {
  urmaCurenta = { ...urmaCurenta, at: Date.now(), motivPlecare: motiv, heapMb: heapMb() }
  scrieUrma()
  trimiteUltimaSuflare()
}

function tipNavigare(): string {
  try {
    const intrare = performance.getEntriesByType('navigation')[0] as { type?: string } | undefined
    return intrare?.type ?? 'necunoscut'
  } catch {
    return 'necunoscut'
  }
}

function pornesteCutiaNeagra(): void {
  const verdict = raportPostMortem(citesteUrma(), tipNavigare(), Date.now())
  if (verdict) reportClientError(verdict)
  marcheazaFaza('boot')
  // Bătaia ține `at` și `heapMb` proaspete: la un crash, ultima valoare scrisă
  // arată cât heap folosea tabul cu câteva secunde înainte să moară.
  window.setInterval(() => {
    urmaCurenta = { ...urmaCurenta, at: Date.now(), heapMb: heapMb() }
    scrieUrma()
  }, 5_000)
  // Plecarea normală se marchează aici; dacă o cheamă codul nostru,
  // `marcheazaPlecarea` a pus deja un motiv mai precis.
  window.addEventListener('pagehide', () => {
    if (!urmaCurenta.motivPlecare) marcheazaPlecarea('pagehide')
    else trimiteUltimaSuflare()
  })
  // Pagina restaurată din bfcache nu reevaluează modulul, deci motivul plecării
  // ar rămâne lipit peste o sesiune care de fapt trăiește mai departe. Fără asta,
  // un crash de după o simplă comutare de aplicație ar fi raportat drept plecare
  // curată, adică fix pe dos.
  window.addEventListener('pageshow', () => {
    if (urmaCurenta.motivPlecare) marcheazaFaza(urmaCurenta.faza)
  })
}

// Simptomele de performanță folosesc același canal redacted și bounded.
export function raporteazaSimptom(msg: string): void {
  reportClientError(msg)
}

/** Primele cadre ale stivei, pe o singură linie — locul faptei, nu doar
 *  simptomul. Mărginit: redactarea taie oricum la MAX_CARACTERE_RAPORT. */
function stiva(valoare: unknown): string {
  const s = (valoare as { stack?: unknown } | null | undefined)?.stack
  if (typeof s !== 'string' || !s) return ''
  return ` | ${s.split('\n').slice(0, 6).map((l) => l.trim()).join(' ← ')}`
}

export function startErrorReporting(): void {
  window.addEventListener('error', (e) => {
    const src = (e.filename ?? '').split('/').pop()
    reportClientError(`${e.message}${src ? ` @${src}:${e.lineno}:${e.colno}` : ''}${stiva(e.error)}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const motiv = e.reason
    const text = motiv instanceof Error ? `${motiv.name}: ${motiv.message}` : String(motiv).slice(0, 300)
    reportClientError(`unhandledrejection: ${text}${stiva(motiv)}`)
  })
  // console.error is the channel through which our own code also reports
  // symptoms (e.g. voice connection refusal) — we catch them without breaking the console.
  const orig = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    try {
      reportClientError(
        args
          .map((a) =>
            typeof a === 'string'
              ? a
              : a instanceof Error
                ? `${a.name}: ${a.message}${stiva(a)}`
                : JSON.stringify(a),
          )
          .join(' '),
      )
    } catch {
      /* reporting must never throw */
    }
    orig(...args)
  }
  pornesteCutiaNeagra()
}
