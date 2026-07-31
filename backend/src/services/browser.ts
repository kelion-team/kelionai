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
  // IPv4 MAPAT ÎN IPv6 (audit securitate 27 iul): `::ffff:169.254.169.254`
  // trecea de filtre — net.isIP îl vede ca IPv6, dar e o adresă IPv4 privată
  // deghizată. O despachetăm și o judecăm cu regulile IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(low)
  if (mapped) return isPrivateIPv4(mapped[1])
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
const COLLECT_SCRIPT = `(() => {
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
})()`
const TEXT_SCRIPT = `(() => document.body ? document.body.innerText : '')()`

// Heavy Google SPAs (Play Console etc.) keep redirecting via JS well after
// "domcontentloaded" — if evaluate()/screenshot() lands mid-navigation, the
// old execution context is torn down and Playwright throws a navigation
// error, not a real page-content error. Recognize that class of error so we
// can wait it out and retry once, instead of surfacing a misleading
// snapshot_failed for a page that would have worked a moment later.
function isNavigationRace(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    msg.includes('context was destroyed') ||
    msg.includes('Execution context') ||
    msg.includes('Target closed') ||
    msg.includes('Cannot find context')
  )
}

// ── MODUL DISCRET: pagina în care se scrie un card nu ajunge NICĂIERI ────────
//
// Adrian, 31 iul: „să opereze pentru mine când îi cer doar eu, folosind
// sistemul de recunoaștere vocală, ca securitate sporită."
//
// Amprenta vocală rezolvă CINE are voie. Rămâne însă scurgerea: browserul face
// o captură la fiecare pas (care ajunge pe monitor) și întoarce textul paginii
// către model. Pe o pagină de plată, amândouă ar căra numărul cardului — în
// imagini, în jurnalul turei, în istoricul conversației.
//
// Cât timp sesiunea e „discretă": ZERO capturi, iar din textul paginii se
// maschează orice șir de 12-19 cifre. Nu e o politețe — e diferența dintre „a
// pus cardul" și „a lăsat cardul prin trei locuri".
const discret = new Set<string>()
export function setModDiscret(email: string, pornit: boolean): void {
  if (pornit) discret.add(email)
  else discret.delete(email)
}
/** Maschează șirurile lungi de cifre (card, IBAN) dintr-un text. */
export function mascheazaCifre(text: string): string {
  return text.replace(/\b(?:\d[ -]?){12,19}\b/g, (m) => `«${m.replace(/\D/g, '').length} cifre ascunse»`)
}

async function takeSnapshot(page: Page, baseUrl: string, email = ''): Promise<BrowserSnapshot> {
  const title = await page.title()
  const url = page.url()
  const elements = ((await page.evaluate(COLLECT_SCRIPT)) as BrowserElement[]) ?? []
  let text = String((await page.evaluate(TEXT_SCRIPT)) ?? '').trim().slice(0, 3000)
  if (email && discret.has(email)) {
    // Fără captură (n-ar avea ce ajunge pe monitor) și fără cifre în text.
    return { url, title, text: mascheazaCifre(text), elements, shotUrl: '' }
  }
  const buf = await page.screenshot({ type: 'jpeg', quality: 60 })
  const id = putShot(buf)
  return { url, title, text, elements, shotUrl: `${baseUrl}/api/browser/shot/${id}` }
}

async function snapshot(page: Page, baseUrl: string, email = ''): Promise<BrowserSnapshot> {
  try {
    return await takeSnapshot(page, baseUrl, email)
  } catch (e) {
    if (!isNavigationRace(e)) throw e
    // Give the SPA's redirect cascade a moment to settle, then retry once —
    // a single retry is enough since a real content/navigation failure will
    // fail the same way again and should propagate as before.
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(500)
    return await takeSnapshot(page, baseUrl, email)
  }
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
  let session: Session
  try {
    session = await ensureSession(email)
  } catch (e) {
    // Launch failures (missing Chromium, missing libs) must be visible in the
    // server logs — this is the difference between diagnosable and blind.
    console.error('[browser] chromium launch failed:', e instanceof Error ? e.message : e)
    return { error: `launch_failed: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}` }
  }
  try {
    await session.page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 15000 })
    // Heavy SPAs (e.g. Google Play Console) keep firing JS redirects after
    // domcontentloaded; give them a chance to reach 'load' before the fixed
    // settle wait, so the first snapshot isn't taken mid-redirect-cascade.
    await session.page.waitForLoadState('load', { timeout: 5000 }).catch(() => {})
    await session.page.waitForTimeout(500)
  } catch (e) {
    console.error('[browser] navigation failed:', e instanceof Error ? e.message.slice(0, 300) : e)
    return { error: 'navigation_failed' }
  }
  try {
    return await snapshot(session.page, baseUrl, email)
  } catch (e) {
    console.error('[browser] snapshot failed:', e instanceof Error ? e.message.slice(0, 300) : e)
    return { error: 'snapshot_failed' }
  }
}

// Rutinele care ACȚIONEAZĂ pe pagină (click/type) au același schelet: sesiune
// validă → acțiunea în try/catch (element_not_found) → așteaptă încărcarea +
// 300ms → snapshot. Doar `act` diferă. Sursă unică (unic, fără duplicate).
async function withPageAction(
  email: string,
  baseUrl: string,
  act: (page: Page) => Promise<void>,
): Promise<BrowserResult> {
  const session = sessions.get(email)
  if (!session) return { error: 'no_session' }
  session.lastUsed = Date.now()
  try {
    await act(session.page)
  } catch {
    return { error: 'element_not_found' }
  }
  await session.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
  await session.page.waitForTimeout(300)
  return snapshot(session.page, baseUrl, email)
}

export async function browserClick(
  email: string,
  baseUrl: string,
  index: number,
): Promise<BrowserResult> {
  return withPageAction(email, baseUrl, (page) => page.click(`[data-kelion-idx="${index}"]`, { timeout: 5000 }))
}

export async function browserType(
  email: string,
  baseUrl: string,
  index: number,
  text: string,
  submit: boolean,
): Promise<BrowserResult> {
  const sel = `[data-kelion-idx="${index}"]`
  return withPageAction(email, baseUrl, async (page) => {
    await page.fill(sel, text, { timeout: 5000 })
    if (submit) await page.press(sel, 'Enter')
  })
}

export async function browserRead(email: string, baseUrl: string): Promise<BrowserResult> {
  const session = sessions.get(email)
  if (!session) return { error: 'no_session' }
  session.lastUsed = Date.now()
  return snapshot(session.page, baseUrl, email)
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
  return snapshot(session.page, baseUrl, email)
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
  await session.page.evaluate(`window.scrollBy(0, ${dy})`).catch(() => {})
  await session.page.waitForTimeout(200)
  return snapshot(session.page, baseUrl, email)
}

// COMPUTER-USE COMPLET (Adrian, 13 iul): pe lângă click/type/scroll pe elemente
// indexate, Kelion poate apăsa TASTE (Tab/Escape/săgeți/Enter/combinații) și
// poate da click pe COORDONATE (x,y) — pentru widget-uri care nu sunt în DOM-ul
// indexabil (canvas, hărți, meniuri custom). Astea închid golul față de
// „computer use" real, păstrând aceeași sesiune/screenshot.

// Apasă o tastă sau o combinație pe pagina curentă. Formatul Playwright:
// 'Enter', 'Tab', 'Escape', 'ArrowDown', 'Control+A', 'Shift+Tab' etc.
export async function browserKey(email: string, baseUrl: string, key: string): Promise<BrowserResult> {
  const session = sessions.get(email)
  if (!session) return { error: 'no_session' }
  session.lastUsed = Date.now()
  // Bariera de siguranță: doar taste/combinații cu forma așteptată (nume de
  // taste + modificatori), nu text arbitrar injectat.
  if (!/^([A-Za-z0-9]+|(Control|Shift|Alt|Meta)(\+(Control|Shift|Alt|Meta))*\+[A-Za-z0-9]+|Enter|Tab|Escape|Backspace|Delete|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right)|Space)$/.test(key)) {
    return { error: 'bad_key' }
  }
  try {
    await session.page.keyboard.press(key)
  } catch {
    return { error: 'key_failed' }
  }
  await session.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
  await session.page.waitForTimeout(250)
  return snapshot(session.page, baseUrl, email)
}

// Click pe coordonate (x,y) în viewport (1280×800). Pentru elemente pe care
// selectorul indexat nu le prinde (canvas, hărți, UI custom).
export async function browserClickAt(email: string, baseUrl: string, x: number, y: number): Promise<BrowserResult> {
  // Avea scheletul copiat de mână (sesiune → acțiune → așteptare → snapshot),
  // deși `withPageAction` există exact pentru asta. Aici e o singură sursă.
  const cx = Math.max(0, Math.min(1280, Math.round(x)))
  const cy = Math.max(0, Math.min(800, Math.round(y)))
  return withPageAction(email, baseUrl, (page) => page.mouse.click(cx, cy))
}

export async function browserClose(email: string): Promise<void> {
  await closeSession(email)
}
