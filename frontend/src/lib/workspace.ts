// Skill "monitor / workspace" mode store. When a skill needs a large surface,
// it calls openWorkspace(): the avatar shrinks + slides to the top-right corner
// (picture-in-picture) and the background becomes a workspace that can render
// content. closeWorkspace() reverses the animation. A tiny external store so any
// component (Stage avatar, ChatPanel, a skill handler) can drive it.
//
// Subscribe from React with useSyncExternalStore(subscribeWorkspace, getWorkspace).

import type { SkillCard } from './chat'

// One open surface on the monitor. Several can be open at once (a map, a YouTube
// video, the weather…) and the user switches between them like tabs — one voice
// throughout, Kelion works inside whichever task is active.
export interface WorkspaceTask {
  readonly id: string
  readonly kind: string // 'map' | 'youtube' | 'weather' | 'image' | 'web' | 'doc' | 'app' | card.type
  readonly title: string
  readonly url: string
  readonly card: SkillCard | null
  readonly text?: string // a readable text deliverable (agent result), rendered as a panel
  readonly html?: string // a complete web page Kelion WROTE, run live in a sandboxed frame ('app')
  // THE REAL RENDER STATE (Adrian, Jul 27: "Kelion must natively see for real
  // what the monitor actually displays, and fix it before what he says appears").
  // 'loading' = started, not yet confirmed; 'ok' = it really rendered;
  // 'error' = it failed (inaccessible file, site refusing embedding…).
  // The renderer in Stage sets it from onLoad/onError; get_monitor reads it, so
  // Kelion FACTUALLY sees what's on screen, not just what he asked for.
  readonly status?: 'loading' | 'ok' | 'error'
}

export interface WorkspaceState {
  readonly open: boolean
  readonly tasks: readonly WorkspaceTask[]
  readonly activeId: string
  // Derived from the active task, so the renderer reads the shown surface directly.
  readonly kind: string
  readonly title: string
  readonly url: string
  readonly card: SkillCard | null
  readonly text?: string
  readonly html?: string
  readonly status?: 'loading' | 'ok' | 'error'
}

const EMPTY: WorkspaceState = { open: false, tasks: [], activeId: '', kind: '', title: '', url: '', card: null }
let state: WorkspaceState = EMPTY
const subscribers = new Set<() => void>()

function emit(): void {
  for (const fn of subscribers) fn()
}

function setTasks(tasks: WorkspaceTask[], activeId: string): void {
  const active = tasks.find((t) => t.id === activeId) ?? tasks[tasks.length - 1]
  state = {
    open: tasks.length > 0,
    tasks,
    activeId: active ? active.id : '',
    kind: active ? active.kind : '',
    title: active ? active.title : '',
    url: active ? active.url : '',
    card: active ? active.card : null,
    text: active ? active.text : undefined,
    html: active ? active.html : undefined,
    status: active ? active.status : undefined,
  }
  emit()
}

// The renderer (Stage) confirms a surface's REAL state after onLoad/onError.
export function setTaskStatus(id: string, status: 'loading' | 'ok' | 'error'): void {
  const tasks = state.tasks.map((t) => (t.id === id ? { ...t, status } : t))
  setTasks(tasks, state.activeId)
}

export function getWorkspace(): WorkspaceState {
  return state
}

// CE E FAPTIC PE MONITOR (10 aug, ownerul: „nu are acces la ce se afișează pe
// monitor"): conținutul REAL al tabului activ, mărginit — chatul îl trimite
// creierului (body.monitorContent), iar unealta get_monitor îl întoarce.
// Doc/text și app/HTML au conținut de citit; harta/imaginea/pagina au doar
// URL+titlu (nu text). Cardul se rezumă în titlu.

let mouseX = 0;
let mouseY = 0;
let mouseElementIndicator = 'nothing';

if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    try {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) {
        const text = el.textContent?.trim().slice(0, 100) || '';
        const id = el.id ? `#${el.id}` : '';
        const className = el.className && typeof el.className === 'string' ? `.${el.className.split(' ').join('.')}` : '';
        const tag = el.tagName.toLowerCase();
        mouseElementIndicator = `${tag}${id}${className}${text ? ` containing "${text}"` : ''}`;
      } else {
        mouseElementIndicator = 'nothing';
      }
    } catch {
      mouseElementIndicator = 'error reading element';
    }
  });
}

export function getMonitorContent(): { kind: string; title: string; url?: string; text?: string; mouse?: { x: number; y: number; indicator: string } } | null {
  const a = state.tasks.find((t) => t.id === state.activeId)
  if (!a) return null
  const out: { kind: string; title: string; url?: string; text?: string; mouse?: { x: number; y: number; indicator: string } } = { kind: a.kind, title: a.title }
  // `!= null`, nu truthy: un doc GOL („Doc Gol", text='') e un tab care există
  // și e gol — text:'' spune exact asta; undefined ar minți că nu e nimic textual.
  if (a.text != null) out.text = a.text.slice(0, 8000)
  else if (a.html) out.text = a.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000)
  else if (a.card) out.text = JSON.stringify(a.card).slice(0, 4000)
  if (a.url) out.url = a.url
  out.mouse = { x: mouseX, y: mouseY, indicator: mouseElementIndicator }
  return out
}

// ── STAREA VIE A CENTRULUI DE TRANZACȚIONARE (10 aug, ownerul: chatul REAL
// trebuie să fie „conștient" de pagina de trading) ───────────────────────────
// Pagina din iframe își raportează starea (postMessage {kelion:
// 'tranzactii-stare'}); chatul o trimite creierului ca ANCORĂ a clipei.
// Punctul EXACT de sub cursor pe graficul de trading (ownerul, 10 aug: „kelion
// trebuie să vadă când pun mouse-ul exact peste orice poziție din grafic").
// Vine din iframe-ul graficului (singurul care vede lumânarea, nu doar <iframe>).
export interface PunctGrafic {
  t: number | string
  o: number
  h: number
  l: number
  c: number
  vol: number | null
  ma20: number | null
  ema50: number | null
}
export interface StareTranzactii {
  simbol: string
  pret: number | null
  interval: string
  sursa: string
  peste?: PunctGrafic | null
  la: number
}
let stareTranzactii: StareTranzactii | null = null
export function setStareTranzactii(s: StareTranzactii): void {
  stareTranzactii = s
}
export function getStareTranzactii(): StareTranzactii | null {
  // Stătută (>30s) sau cu tabul închis = nu mai e „pe ecran" — nu ancorăm pe ea.
  if (!stareTranzactii) return null
  if (Date.now() - stareTranzactii.la > 30_000) return null
  if (!state.tasks.some((t) => t.kind === 'tranzactii')) return null
  return stareTranzactii
}

// ── EXECUȚIA PAS CU PAS PE MONITOR (owner, 14 aug: „să arate fiecare pas pe
// monitor pe care îl întreprinde, cu bara de evoluție de la 0 la 100%
// actualizată live dinamic, bara… făcută de grupuri de punctulețe de 5x5…
// 0,5% până la 100%") ────────────────────────────────────────────────────────
// Serverul emite frame-uri {executie} la FIECARE unealtă chemată pe o tură de
// execuție; aici se ține starea vie (pași reali + procent), iar suprafața
// 'executie' de pe monitor o desenează: lista pașilor + bara din 200 de
// punctulețe a câte 0,5%, grupate 5×5. 100% vine DOAR la închiderea reală a
// turei (interceptorul de end de pe server) — bara nu minte „gata".
export interface PasExecutie {
  readonly la: number
  readonly text: string
}
export interface StareExecutie {
  readonly pasi: readonly PasExecutie[]
  readonly procent: number
  readonly gata: boolean
}
let stareExecutie: StareExecutie | null = null
export function adaugaPasExecutie(pas: string, procent: number, gata: boolean): void {
  // O tură NOUĂ de execuție (primul pas după un „gata") pornește listă proaspătă.
  const veche = stareExecutie && !stareExecutie.gata ? stareExecutie : null
  const pasi = gata && !pas ? (veche?.pasi ?? []) : [...(veche?.pasi ?? []), { la: Date.now(), text: pas }]
  stareExecutie = {
    pasi,
    procent: Math.max(0, Math.min(100, procent)),
    gata,
  }
  emit()
}
export function getStareExecutie(): StareExecutie | null {
  return stareExecutie
}

// Suprafața de execuție pe monitor — un singur tab (dedup pe kind), fără
// url/text: corpul se desenează în Stage din starea vie de mai sus.
export function openWorkspaceExecutie(title: string): void {
  upsert({ id: 'executie', kind: 'executie', title, url: '', card: null, status: 'ok' })
}

export function subscribeWorkspace(fn: () => void): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

// MONITOR BUSY — separate from surfaces: true while the Linux brain is EXECUTING
// live (the "execuție în direct" console is showing its steps). Adrian's rule:
// while the monitor is working, the chat must collapse to the slim black bar
// above the composer (only what's spoken), never bubbles that cover the monitor.
// Stage drives it; ChatPanel reads it via subscribeWorkspace.
let working = false
export function setMonitorWorking(b: boolean): void {
  if (working !== b) {
    working = b
    emit()
  }
}
export function isMonitorWorking(): boolean {
  return working
}

// Classify a URL/data into a task kind so the monitor RENDERS ANY DATA TYPE
// natively (Adrian, Jul 27: "on the monitor you must be able to open absolutely
// any data type — xls, pdf, youtube, code, archives, anything"). Each type has
// its renderer in Stage: image→<img>, pdf→viewer, video→<video>, audio→
// <audio>, office(xls/doc/ppt)→vizor Office online, cod/text/json/csv→text,
// markdown→rendered doc, .html→sandboxed frame, archives/binaries→download
// panel. Same kind = same tab (a new pdf replaces the old one).
const EXT_KIND: Record<string, string> = {
  // imagini
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', avif: 'image', ico: 'image',
  // documente
  pdf: 'pdf',
  // video
  mp4: 'video', webm: 'video', mov: 'video', ogv: 'video', mkv: 'video', avi: 'video', m4v: 'video',
  // audio
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio', opus: 'audio',
  // office
  xls: 'office', xlsx: 'office', doc: 'office', docx: 'office', ppt: 'office', pptx: 'office', ods: 'office', odt: 'office', odp: 'office',
  // PAGINI HTML salvate (Aug 2): they run sandboxed like the playground 'app',
  // not framed as external sites (a raw .html in an <iframe src> can fight the
  // app's own session through allow-same-origin).
  html: 'htmlfile', htm: 'htmlfile',
  // MARKDOWN (Aug 2): rendered formatted, not shown as raw text.
  md: 'markdown',
  // cod / text / date
  txt: 'textfile', json: 'textfile', csv: 'textfile', tsv: 'textfile', xml: 'textfile', yml: 'textfile', yaml: 'textfile', log: 'textfile',
  js: 'textfile', ts: 'textfile', tsx: 'textfile', jsx: 'textfile', py: 'textfile', java: 'textfile', c: 'textfile', cpp: 'textfile', h: 'textfile',
  go: 'textfile', rs: 'textfile', rb: 'textfile', php: 'textfile', sh: 'textfile', sql: 'textfile', css: 'textfile', ini: 'textfile', conf: 'textfile',
  // arhive
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive', tgz: 'archive',
  // BINARE fără vizor în browser (Aug 2): honest download panel instead of a
  // dead iframe — epub/exe/apk/dmg/iso/fonts can't render in a page.
  epub: 'file', exe: 'file', msi: 'file', apk: 'file', ipa: 'file', dmg: 'file', iso: 'file', bin: 'file', woff: 'file', woff2: 'file', ttf: 'file', otf: 'file',
}

function kindForUrl(raw: string): string {
  const s = String(raw ?? '').trim()
  // data: URI → we classify by the MIME in the header itself.
  if (s.startsWith('data:')) {
    const mime = (s.slice(5).match(/^[^;,]*/)?.[0] ?? '').toLowerCase()
    if (mime.startsWith('image/')) return 'image'
    if (mime === 'application/pdf') return 'pdf'
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('audio/')) return 'audio'
    // text/html runs sandboxed like the playground ('app') — a dead "this page
    // cannot be displayed here" panel was the old outcome (isEmbeddable refused data:).
    if (mime === 'text/html') return 'htmlfile'
    if (mime.startsWith('text/markdown') || mime === 'text/x-markdown') return 'markdown'
    if (mime.startsWith('text/') || mime.includes('json') || mime.includes('csv')) return 'textfile'
    return 'web'
  }
  try {
    const u = new URL(s, typeof location !== 'undefined' ? location.origin : 'http://x')
    const host = u.hostname.replace(/^www\./, '')
    if (host.includes('youtube') || host === 'youtu.be') return 'youtube'
    if (host.includes('windy') || u.pathname.includes('weather')) return 'weather'
    if (host === 'embed.waze.com') return 'map'
    if (u.pathname.startsWith('/api/image')) return 'image'
    if (u.pathname.startsWith('/api/route')) return 'map'
    // Centrul de Tranzacționare are FELUL lui (9 aug, ownerul: „un tab care se
    // comută din bază… buton de închidere"): butonul din bară îl deschide/închide
    // pe felul ăsta, fără să atingă alte suprafețe 'web' deschise pe monitor.
    if (u.pathname.startsWith('/api/deploy')) return 'deploy'
    if (u.pathname.startsWith('/api/tranzactii')) return 'tranzactii'
    if (host.includes('openstreetmap') || u.pathname.includes('/maps')) return 'map'
    // By file extension (works even with a ?query after it).
    const ext = (u.pathname.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
    if (ext && EXT_KIND[ext]) return EXT_KIND[ext]
  } catch {
    /* relative or malformed — fall through */
  }
  return 'web'
}

// Add/replace a task (dedup by kind) and make it the active surface.
function upsert(task: WorkspaceTask): void {
  const rest = state.tasks.filter((t) => t.id !== task.id)
  setTasks([...rest, task], task.id)
}

export function openWorkspace(title: string, url = ''): void {
  const kind = kindForUrl(url)
  // Archives and raw binaries render a download panel (always ok); the rest
  // start 'loading' and confirm from onLoad/onError — so Kelion factually
  // sees if it appeared.
  const status = kind === 'archive' || kind === 'file' ? 'ok' : 'loading'
  upsert({ id: kind, kind, title, url, card: null, status })
}

// Open the workspace showing a structured skill card (no iframe).
export function openWorkspaceCard(title: string, card: SkillCard): void {
  const kind = card.type || 'card'
  upsert({ id: kind, kind, title, url: '', card, status: 'ok' })
}

// Open the workspace showing a readable text deliverable (an agent's written
// result — an email, a translation, findings) that the user can read and copy.
export function openWorkspaceDoc(title: string, text: string): void {
  upsert({ id: 'doc', kind: 'doc', title, url: '', card: null, text, status: 'ok' })
}

// CODE PLAYGROUND (Adrian, Jul 25: "Kelion must test the written software in
// the browser, be able to save it"). Kelion writes a COMPLETE web page (HTML +
// CSS + inline JS) and RUNS it live on the monitor, in an isolated iframe (srcdoc,
// sandbox), with no external host — so no X-Frame-Options and no "this page
// cannot be displayed here". The user sees it running and can save it (button on the monitor).
export function openWorkspaceApp(title: string, html: string): void {
  upsert({ id: 'app', kind: 'app', title, url: '', card: null, html, status: 'ok' })
}

// THE CONSTRUCTOR PANEL (Stage 4b, Adrian: "monitor display of requirement
// resolution"). A separate surface (kind 'build') with NO url/text/html — it's
// rendered with its own poller in Stage, subscribed to /api/constructor/live, and
// shows each order: Taken→current step→Done/Failed. Dedup on kind: a single
// tab de constructor, mereu cel curent.
export function openWorkspaceBuild(title = 'Constructor'): void {
  upsert({ id: 'build', kind: 'build', title, url: '', card: null, status: 'ok' })
}

// Close the ACTIVE task (back-compat for the single-close / voice-command paths).
export function closeWorkspace(): void {
  if (state.open) closeTask(state.activeId)
}

export function closeTask(id: string): void {
  const tasks = state.tasks.filter((t) => t.id !== id)
  setTasks(tasks, tasks.length ? tasks[tasks.length - 1].id : '')
}

export function closeTasksByKind(kind: string): boolean {
  const tasks = state.tasks.filter((t) => t.kind !== kind)
  if (tasks.length === state.tasks.length) return false
  setTasks(tasks, tasks.length ? tasks[tasks.length - 1].id : '')
  return true
}

export function closeAllTasks(): void {
  if (state.open) setTasks([], '')
}

export function switchToId(id: string): void {
  if (state.tasks.some((t) => t.id === id)) setTasks([...state.tasks], id)
}

// Switch the monitor to an already-open task of this kind. Returns false when no
// such task is open (so the caller can let Kelion open it instead).
export function switchToKind(kind: string): boolean {
  const t = state.tasks.find((x) => x.kind === kind)
  if (!t) return false
  setTasks([...state.tasks], t.id)
  return true
}

// Most sites refuse to load in an <iframe> (X-Frame-Options / CSP
// frame-ancestors) — notably the normal Google Maps and OpenStreetMap pages and
// YouTube watch URLs, which is why the monitor showed a "refused to connect"
// page. Rewrite the common ones to their embeddable equivalents so the surface
// actually renders. Anything else is returned unchanged (the header keeps an
// "open in a new tab" link as the universal fallback).
export function normalizeEmbedUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return raw
  }
  const host = u.hostname.replace(/^www\./, '')

  // YouTube → /embed/<id>. enablejsapi=1 lets us duck its volume (postMessage)
  // while Kelion speaks, so his voice sits in front — like a car radio dropping
  // the music when the nav talks. autoplay=1: clipul pornește SINGUR pe monitor
  // (owner, 27 iul: „play doesn't work" — playerul se deschidea OPRIT).
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = u.searchParams.get('v')
    if (id) return `https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1`
    // /shorts/XXX și /live/XXX — formate pe care normalizeEmbedUrl vechi le rata
    const shorts = u.pathname.match(/^\/(?:shorts|live)\/([\w-]{6,})/)
    if (shorts) return `https://www.youtube.com/embed/${shorts[1]}?autoplay=1&enablejsapi=1`
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1)
    if (id) return `https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1`
  }
  // YouTube Music — host e music.youtube.com, nu trece de verificarea de sus
  if (host === 'music.youtube.com') {
    const id = u.searchParams.get('v')
    if (id) return `https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1`
  }

  // Google Maps Embed API URLs (/maps/embed/…) are already embeddable — leave them.
  if (u.pathname.startsWith('/maps/embed')) return raw
  // Other Google Maps → output=embed (renders in an iframe with no API key)
  if ((host === 'google.com' || host.endsWith('.google.com')) && u.pathname.startsWith('/maps')) {
    u.searchParams.set('output', 'embed')
    return u.toString()
  }

  // OpenStreetMap → export/embed.html with a marker + bbox around the point
  if (host === 'openstreetmap.org' && !u.pathname.startsWith('/export')) {
    const lat = Number.parseFloat(u.searchParams.get('mlat') ?? '')
    const lon = Number.parseFloat(u.searchParams.get('mlon') ?? '')
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const d = 0.02
      const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`
      return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`
    }
  }

  return raw
}

export interface EmbedPolicy {
  readonly src: string
  readonly sandbox: string
  readonly allow: string
}

export interface DocumentFramePolicy {
  readonly src: string
  readonly sandbox: string
}

const PLAYGROUND_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "navigate-to 'none'",
].join('; ')

/** Adaugă CSP-ul înaintea oricărui script din pagina generată. JS/CSS inline
 * rămân funcționale local, dar fetch/WebSocket/form/pop-up/asset extern sunt
 * blocate; iframe-ul rămâne oricum origin opac prin lipsa allow-same-origin. */
export function izoleazaHtmlPlayground(raw: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PLAYGROUND_CSP}">`
  // Împachetăm documentul întreg, nu căutăm primul <head>: un input ostil ar
  // putea pune <script> înaintea lui și ar rula înainte ca CSP-ul să fie citit.
  const continut = raw.replace(/<!doctype[^>]*>/gi, '')
  return `<!doctype html><html><head>${meta}</head><body>${continut}</body></html>`
}

/** Documentele nu deschid o a doua portiță de iframe arbitrar. PDF-ul poate fi
 * afișat direct numai din aplicația curentă (ori data/blob local), într-un
 * sandbox fără scripturi. Documentele Office rămân descărcări locale: trimiterea
 * URL-ului lor către un viewer terț ar divulga documentul fără consimțământ. */
export function documentFramePolicy(
  raw: string,
  kind: 'pdf' | 'office',
  base = typeof location !== 'undefined' ? location.origin : 'https://kelion.invalid',
): DocumentFramePolicy | null {
  const value = String(raw ?? '').trim()
  if (kind === 'pdf' && /^data:application\/pdf(?:;[^,]*)?,/i.test(value)) {
    return { src: value, sandbox: '' }
  }
  let u: URL
  try {
    u = new URL(value, base)
  } catch {
    return null
  }
  if (u.username || u.password) return null
  if (u.protocol === 'blob:') {
    return kind === 'pdf' && u.origin === new URL(base).origin
      ? { src: value, sandbox: '' }
      : null
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.origin !== new URL(base).origin) return null

  const ext = (u.pathname.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  if (kind === 'pdf') {
    if (ext !== 'pdf') return null
    return {
      src: value.startsWith('/') ? `${u.pathname}${u.search}${u.hash}` : u.toString(),
      sandbox: '',
    }
  }
  if (!['xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx', 'ods', 'odt', 'odp'].includes(ext)) return null
  return null
}

// Strict iframe allowlist. Arbitrary model/tool URLs are never framed: Stage
// renders them through the server-side reader or offers an external link.
export function embedPolicy(raw: string, kind: string): EmbedPolicy | null {
  const normalized = normalizeEmbedUrl(String(raw ?? '').trim())
  const base = typeof location !== 'undefined' ? location.origin : 'https://kelion.invalid'
  let u: URL
  try {
    u = new URL(normalized, base)
  } catch {
    return null
  }
  if (u.username || u.password || (u.protocol !== 'http:' && u.protocol !== 'https:')) return null

  const sameOrigin = u.origin === base
  if (sameOrigin) {
    const rutaHarta = kind === 'map' && u.pathname === '/api/route'
    const rutaTranzactii = kind === 'tranzactii' && u.pathname === '/api/tranzactii'
    if (!rutaHarta && !rutaTranzactii) return null
    return {
      src: `${u.pathname}${u.search}`,
      // These two routes are fixed, application-owned surfaces. No arbitrary
      // same-origin URL receives this capability pair.
      sandbox: 'allow-scripts allow-same-origin allow-forms',
      allow: rutaHarta ? 'geolocation' : '',
    }
  }

  const host = u.hostname.toLowerCase()
  const externalSandbox = 'allow-scripts allow-same-origin allow-forms allow-popups'
  if (
    kind === 'youtube' &&
    host === 'www.youtube.com' &&
    /^\/embed\/[\w-]{6,}$/.test(u.pathname)
  ) {
    return {
      src: u.toString(),
      sandbox: externalSandbox,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    }
  }
  if (kind === 'map' && host === 'embed.waze.com' && u.pathname === '/iframe') {
    return { src: u.toString(), sandbox: externalSandbox, allow: 'geolocation' }
  }
  if (
    kind === 'map' &&
    (host === 'openstreetmap.org' || host === 'www.openstreetmap.org') &&
    u.pathname === '/export/embed.html'
  ) {
    return { src: u.toString(), sandbox: externalSandbox, allow: 'geolocation' }
  }
  if (
    kind === 'map' &&
    (host === 'www.google.com' || host === 'maps.google.com') &&
    u.pathname.startsWith('/maps/embed')
  ) {
    return { src: u.toString(), sandbox: externalSandbox, allow: 'geolocation' }
  }
  if (kind === 'weather' && host === 'embed.windy.com' && u.pathname === '/embed2.html') {
    return { src: u.toString(), sandbox: externalSandbox, allow: 'geolocation' }
  }
  return null
}
