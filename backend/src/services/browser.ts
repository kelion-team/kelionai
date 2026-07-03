import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import dns from 'node:dns/promises'
import net from 'node:net'
import { randomUUID } from 'node:crypto'

// Kelion's live browser — a real headless Chromium he can navigate, click and
// type into, so he can actually show/read/survey sites that refuse to embed in
// the monitor iframe (Google, banks, social media…). One session per user
// (shared browser process, one context/page each) so state (login, scroll
// position, current page) persists across a back-and-forth conversation.

// ── screenshot store (mirrors services/image.ts's pattern) ─────────────────
interface Shot {
  mime: string
  buf: Buffer
  ts: number
}
const shots = new Map<string, Shot>()
const MAX_SHOTS = 40
function putShot(buf: Buffer): string {
  const id = randomUUID()
  shots.set(id, { mime: 'image/jpeg', buf, ts: Date.now() })
  while (shots.size > MAX_SHOTS) {
    const oldest = shots.keys().next().value
    if (oldest === undefined) break
    shots.delete(oldest)
  }
  return id
}
export function getShot(id: string): Shot | null {
  return shots.get(id) ?? null
}

// ── SSRF guard — never let the browser reach internal/private addresses ────
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true
  const [a, b] = parts
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  return false
}
function isPrivateIPv6(ip: string): boolean {
  const low = ip.toLowerCase()
  return low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80')
}
async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('unsupported_protocol')
  if (u.hostname === 'localhost') throw new Error('blocked_host')
  const kind = net.isIP(u.hostname)
  const addresses = kind
    ? [{ address: u.hostname, family: kind }]
    : await dns.lookup(u.hostname, { all: true })
  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateIPv4(address)) throw new Error('blocked_address')
    if (family === 6 && isPrivateIPv6(address)) throw new Error('blocked_address')
  }
  return u
}

// ── session pool ─────────────────────────────────────────────────────────
interface Session {
  context: BrowserContext
  page: Page
  lastUsed: number
}
const sessions = new Map<string, Session>()
const MAX_SESSIONS = 8
const IDLE_MS = 10 * 60_000

let sharedBrowser: Browser | null = null
async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser
  sharedBrowser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  return sharedBrowser
}

async function closeSession(email: string): Promise<void> {
  const s = sessions.get(email)
  if (!s) return
  sessions.delete(email)
  try {
    await s.context.close()
  } catch {
    /* already gone */
  }
}

// Idle reaper — a forgotten browser session must not sit open forever.
setInterval(() => {
  const now = Date.now()
  for (const [email, s] of sessions) {
    if (now - s.lastUsed > IDLE_MS) void closeSession(email)
  }
}, 60_000).unref()

async function ensureSession(email: string): Promise<Session> {
  const existing = sessions.get(email)
  if (existing) {
    existing.lastUsed = Date.now()
    return existing
  }
  if (sessions.size >= MAX_SESSIONS) {
    let oldestKey = ''
    let oldestTs = Infinity
    for (const [k, v] of sessions) {
      if (v.lastUsed < oldestTs) {
        oldestTs = v.lastUsed
        oldestKey = k
      }
    }
    if (oldestKey) await closeSession(oldestKey)
  }
  const browser = await getBrowser()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 KelionaiBot',
  })
  const page = await context.newPage()
  const session: Session = { context, page, lastUsed: Date.now() }
  sessions.set(email, session)
  return session
}

// ── page snapshot: what Kelion "reads" after every action ──────────────────
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
}
export type BrowserResult = BrowserSnapshot | { error: string }

// Tags each visible interactive element with data-kelion-idx so a later click/
// type by index hits exactly what was just read — a stable, reliable handle
// without needing pixel-coordinate guessing. Passed as a STRING to evaluate()
// (not a typed function) since this Node project has no "dom" lib in tsconfig.
const COLLECT_SCRIPT = `() => {
  const sel = 'a[href], button, input, textarea, select, [role="button"], [onclick]'
  const nodes = Array.from(document.querySelectorAll(sel))
  const out = []
  let i = 0
  for (const el of nodes) {
    if (i >= 40) break
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    const style = window.getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    el.setAttribute('data-kelion-idx', String(i))
    const tag = el.tagName.toLowerCase()
    let label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('alt') || el.innerText || el.value || el.getAttribute('title') || '').toString().trim().replace(/\\s+/g, ' ').slice(0, 70)
    const href = tag === 'a' ? (el.getAttribute('href') || '') : ''
    out.push({ index: i, tag, label, href })
    i++
  }
  return out
}`
const TEXT_SCRIPT = `() => document.body ? document.body.innerText : ''`

async function snapshot(page: Page, baseUrl: string): Promise<BrowserSnapshot> {
  const title = await page.title()
  const url = page.url()
  const elements = (await page.evaluate(COLLECT_SCRIPT)) as BrowserElement[]
  const text = ((await page.evaluate(TEXT_SCRIPT)) as string).trim().slice(0, 3000)
  const buf = await page.screenshot({ type: 'jpeg', quality: 60 })
  const id = putShot(buf)
  return { url, title, text, elements, shotUrl: `${baseUrl}/api/browser/shot/${id}` }
}

// ── public actions ───────────────────────────────────────────────────────
export async function browserOpen(
  email: string,
  baseUrl: string,
  rawUrl: string,
): Promise<BrowserResult> {
  let u: URL
  try {
    u = await assertPublicUrl(rawUrl)
  } catch {
    return { error: 'blocked_url' }
  }
  const session = await ensureSession(email)
  try {
    await session.page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 15000 })
    await session.page.waitForTimeout(500)
  } catch {
    return { error: 'navigation_failed' }
  }
  return snapshot(session.page, baseUrl)
}

export async function browserClick(
  email: string,
  baseUrl: string,
  index: number,
): Promise<BrowserResult> {
  const session = sessions.get(email)
  if (!session) return { error: 'no_session' }
  session.lastUsed = Date.now()
  try {
    await session.page.click(`[data-kelion-idx="${index}"]`, { timeout: 5000 })
  } catch {
    return { error: 'element_not_found' }
  }
  await session.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
  await session.page.waitForTimeout(300)
  return snapshot(session.page, baseUrl)
}

export async function browserType(
  email: string,
  baseUrl: string,
  index: number,
  text: string,
  submit: boolean,
): Promise<BrowserResult> {
  const session = sessions.get(email)
  if (!session) return { error: 'no_session' }
  session.lastUsed = Date.now()
  const sel = `[data-kelion-idx="${index}"]`
  try {
    await session.page.fill(sel, text, { timeout: 5000 })
    if (submit) await session.page.press(sel, 'Enter')
  } catch {
    return { error: 'element_not_found' }
  }
  await session.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
  await session.page.waitForTimeout(300)
  return snapshot(session.page, baseUrl)
}

export async function browserRead(email: string, baseUrl: string): Promise<BrowserResult> {
  const session = sessions.get(email)
  if (!session) return { error: 'no_session' }
  session.lastUsed = Date.now()
  return snapshot(session.page, baseUrl)
}

export async function browserBack(email: string, baseUrl: string): Promise<BrowserResult> {
  const session = sessions.get(email)
  if (!session) return { error: 'no_session' }
  session.lastUsed = Date.now()
  try {
    await session.page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 })
  } catch {
    /* nothing to go back to — still return the current page */
  }
  return snapshot(session.page, baseUrl)
}

export async function browserScroll(
  email: string,
  baseUrl: string,
  direction: 'up' | 'down',
): Promise<BrowserResult> {
  const session = sessions.get(email)
  if (!session) return { error: 'no_session' }
  session.lastUsed = Date.now()
  const dy = direction === 'down' ? 700 : -700
  await session.page.evaluate(`() => window.scrollBy(0, ${dy})`).catch(() => {})
  await session.page.waitForTimeout(200)
  return snapshot(session.page, baseUrl)
}

export async function browserClose(email: string): Promise<void> {
  await closeSession(email)
}
