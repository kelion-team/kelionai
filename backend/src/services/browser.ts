import { createHmac, randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { callBrowserWorker } from './browserWorker.js'

interface Shot {
  mime: 'image/jpeg'
  buf: Buffer
  ts: number
  owner: string
}

export interface BrowserElement {
  index: number
  tag: string
  label: string
  href: string
}

export interface BrowserSnapshot {
  url: string
  title: string
  text: string
  elements: BrowserElement[]
  shotUrl: string
  /** Image shown to the OpenAI brain for this action. Empty in discreet mode. */
  shotB64: string
}

export type BrowserResult = BrowserSnapshot | { error: string }

const MAX_SHOTS = 40
const SHOT_TTL_MS = 10 * 60_000
const MAX_SCREENSHOT_BYTES = 1024 * 1024
const shots = new Map<string, Shot>()
const discreetSessions = new Set<string>()

function ownerKey(email: string): string {
  return String(email ?? '').trim().toLowerCase()
}

function sessionId(email: string): string {
  const owner = ownerKey(email)
  if (!owner || !config.sessionSecret) throw new Error('browser_session_invalid')
  return createHmac('sha256', config.sessionSecret).update(`browser-session\n${owner}`).digest('base64url')
}

function pruneShots(now = Date.now()): void {
  for (const [id, shot] of shots) {
    if (now - shot.ts > SHOT_TTL_MS) shots.delete(id)
  }
  while (shots.size > MAX_SHOTS) {
    const oldest = shots.keys().next().value as string | undefined
    if (!oldest) break
    shots.delete(oldest)
  }
}

function putShot(email: string, buf: Buffer): string {
  pruneShots()
  const id = randomUUID()
  shots.set(id, { mime: 'image/jpeg', buf, ts: Date.now(), owner: ownerKey(email) })
  pruneShots()
  return id
}

export function getShot(id: string, email: string): Shot | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null
  pruneShots()
  const shot = shots.get(id)
  return shot && shot.owner === ownerKey(email) ? shot : null
}

function publicOrigin(baseUrl: string): string {
  const configured = config.publicOrigin.trim()
  for (const candidate of [configured, baseUrl]) {
    try {
      const parsed = new URL(candidate)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.origin
    } catch {
      // Try the next server-owned candidate.
    }
  }
  return ''
}

function screenshotBytes(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 + 4) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null
  const buf = Buffer.from(value, 'base64')
  if (!buf.length || buf.length > MAX_SCREENSHOT_BYTES || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null
  return buf
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function normalizeSnapshot(value: unknown, email: string, baseUrl: string): BrowserResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'invalid_snapshot' }
  const source = value as Record<string, unknown>
  const elements = Array.isArray(source.elements)
    ? source.elements.slice(0, 40).flatMap((item): BrowserElement[] => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const row = item as Record<string, unknown>
        const index = Number(row.index)
        if (!Number.isInteger(index) || index < 0 || index >= 40) return []
        return [{
          index,
          tag: text(row.tag, 40),
          label: text(row.label, 70),
          href: text(row.href, 2_048),
        }]
      })
    : []
  const rawShot = typeof source.screenshotBase64 === 'string' ? source.screenshotBase64 : ''
  const buf = rawShot ? screenshotBytes(rawShot) : null
  if (rawShot && !buf) return { error: 'invalid_screenshot' }
  const id = buf ? putShot(email, buf) : ''
  const origin = publicOrigin(baseUrl)
  return {
    url: text(source.url, 2_048),
    title: text(source.title, 300),
    text: text(source.text, 3_000),
    elements,
    shotUrl: id ? `${origin}/api/browser/shot/${id}` : '',
    shotB64: buf ? buf.toString('base64') : '',
  }
}

function workerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'browser_worker_not_configured') return 'browser_unavailable'
  if (message.startsWith('browser_worker_')) return message.slice('browser_worker_'.length, 100)
  return 'browser_unavailable'
}

type BrowserAction =
  | { type: 'open'; url: string }
  | { type: 'click'; index: number }
  | { type: 'type'; index: number; text: string; submit: boolean }
  | { type: 'read' }
  | { type: 'back' }
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'key'; key: string }
  | { type: 'clickAt'; x: number; y: number }
  | { type: 'close' }

async function perform(email: string, baseUrl: string, action: BrowserAction): Promise<BrowserResult> {
  let id: string
  try {
    id = sessionId(email)
  } catch {
    return { error: 'browser_session_invalid' }
  }
  if (action.type === 'open') discreetSessions.delete(id)
  if (action.type === 'type' && /\b(?:\d[ -]?){12,19}\b/.test(action.text)) discreetSessions.add(id)
  try {
    const response = await callBrowserWorker('/v1/browser/action', {
      sessionId: id,
      discreet: discreetSessions.has(id),
      action,
    })
    if (action.type === 'close') return { error: 'closed' }
    return normalizeSnapshot(response.snapshot, email, baseUrl)
  } catch (error) {
    return { error: workerError(error) }
  }
}

let healthCache: { at: number; value: { ok: boolean; motiv: string } } | null = null
export async function probaBrowserulMainilor(): Promise<{ ok: boolean; motiv: string }> {
  if (healthCache && Date.now() - healthCache.at < 10 * 60_000) return healthCache.value
  const probeId = `health_${randomUUID().replaceAll('-', '')}`
  try {
    await callBrowserWorker('/v1/browser/action', {
      sessionId: probeId,
      discreet: true,
      action: { type: 'read' },
    })
    void callBrowserWorker('/v1/browser/action', {
      sessionId: probeId,
      discreet: true,
      action: { type: 'close' },
    }).catch(() => undefined)
    healthCache = { at: Date.now(), value: { ok: true, motiv: '' } }
  } catch (error) {
    healthCache = { at: Date.now(), value: { ok: false, motiv: workerError(error) } }
  }
  return healthCache.value
}

export async function browserOpen(email: string, baseUrl: string, url: string): Promise<BrowserResult> {
  if (url.length > 2_048) return { error: 'blocked_url' }
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return { error: 'blocked_url' }
  } catch {
    return { error: 'blocked_url' }
  }
  return perform(email, baseUrl, { type: 'open', url })
}

export const browserClick = (email: string, baseUrl: string, index: number): Promise<BrowserResult> =>
  perform(email, baseUrl, { type: 'click', index })

export const browserType = (email: string, baseUrl: string, index: number, value: string, submit: boolean): Promise<BrowserResult> =>
  perform(email, baseUrl, { type: 'type', index, text: value.slice(0, 4_001), submit })

export const browserRead = (email: string, baseUrl: string): Promise<BrowserResult> =>
  perform(email, baseUrl, { type: 'read' })

export const browserBack = (email: string, baseUrl: string): Promise<BrowserResult> =>
  perform(email, baseUrl, { type: 'back' })

export const browserScroll = (email: string, baseUrl: string, direction: 'up' | 'down'): Promise<BrowserResult> =>
  perform(email, baseUrl, { type: 'scroll', direction })

export const browserKey = (email: string, baseUrl: string, key: string): Promise<BrowserResult> =>
  perform(email, baseUrl, { type: 'key', key })

export const browserClickAt = (email: string, baseUrl: string, x: number, y: number): Promise<BrowserResult> =>
  perform(email, baseUrl, { type: 'clickAt', x, y })

export async function browserClose(email: string): Promise<{ closed: true } | { error: string }> {
  let id: string
  try {
    id = sessionId(email)
  } catch {
    return { error: 'browser_session_invalid' }
  }
  discreetSessions.delete(id)
  try {
    await callBrowserWorker('/v1/browser/action', {
      sessionId: id,
      discreet: false,
      action: { type: 'close' },
    })
    return { closed: true }
  } catch (error) {
    return { error: workerError(error) }
  }
}
