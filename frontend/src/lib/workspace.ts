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
    if (u.pathname.startsWith('/api/image')) return 'image'
    if (u.pathname.startsWith('/api/route')) return 'map'
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
  // the music when the nav talks.
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = u.searchParams.get('v')
    if (id) return `https://www.youtube.com/embed/${id}?enablejsapi=1`
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1)
    if (id) return `https://www.youtube.com/embed/${id}?enablejsapi=1`
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

// Google's normal pages (www.google.com, maps.google.com) send X-Frame-Options
// and refuse to load in an iframe → a broken "refused to connect" panel. Detect
// those so the UI can show an "open in a new tab" link instead of a dead frame.
export function isEmbeddable(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return true // relative URL (e.g. /api/image/…) — same-origin, safe to frame
  }
  // Only ever frame http(s). Block javascript:, data:, blob:, etc.
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'google.com' || host === 'maps.google.com' || host.endsWith('.google.com')) {
    // Only the keyed Maps Embed API path is frameable.
    return u.pathname.startsWith('/maps/embed')
  }
  return true
}
