// Skill "monitor / workspace" mode store. When a skill needs a large surface,
// it calls openWorkspace(): the avatar shrinks + slides to the top-right corner
// (picture-in-picture) and the background becomes a workspace that can render
// content. closeWorkspace() reverses the animation. A tiny external store so any
// component (Stage avatar, ChatPanel, a skill handler) can drive it.
//
// Subscribe from React with useSyncExternalStore(subscribeWorkspace, getWorkspace).

export interface WorkspaceState {
  readonly open: boolean
  readonly title: string
  readonly url: string // optional content to render (sandboxed iframe)
}

let state: WorkspaceState = { open: false, title: '', url: '' }
const subscribers = new Set<() => void>()

function emit(): void {
  for (const fn of subscribers) fn()
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

export function openWorkspace(title: string, url = ''): void {
  state = { open: true, title, url }
  emit()
}

export function closeWorkspace(): void {
  if (!state.open) return
  state = { ...state, open: false }
  emit()
}

export function toggleWorkspace(title: string, url = ''): void {
  if (state.open) closeWorkspace()
  else openWorkspace(title, url)
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

  // YouTube → /embed/<id>
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = u.searchParams.get('v')
    if (id) return `https://www.youtube.com/embed/${id}`
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1)
    if (id) return `https://www.youtube.com/embed/${id}`
  }

  // Google Maps → output=embed (renders in an iframe with no API key)
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
