import http from 'node:http'
import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServiceVerifier, readServiceSecret, requireRequestId } from './lib/service-auth.mjs'
import { validateHttpProxyInSubnet } from './lib/network-config.mjs'
import { parsePublicUrl } from './lib/public-target.mjs'

const API_SOCKET = '/run/kelion-browser-api/browser.sock'
const FETCH_SOCKET = '/run/kelion-browser-egress/fetch.sock'
const SECRET_FILE = '/run/secrets/browser-worker-secret'
const PROXY_URL = validateHttpProxyInSubnet(process.env.BROWSER_PROXY_URL, process.env.BROWSER_INTERNAL_SUBNET)
const MAX_SESSIONS = 8
const IDLE_MS = 10 * 60_000
const MAX_REQUEST_BYTES = 16 * 1024
const MAX_SCREENSHOT_BYTES = 1024 * 1024
const SESSION_RE = /^[A-Za-z0-9_-]{32,128}$/
const KEY_RE = /^([A-Za-z0-9]+|(Control|Shift|Alt|Meta)(\+(Control|Shift|Alt|Meta))*\+[A-Za-z0-9]+|Enter|Tab|Escape|Backspace|Delete|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right)|Space)$/

let browser = null
const sessions = new Map()

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' })
  res.end(body)
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const announced = Number(req.headers['content-length'] ?? -1)
    if (!Number.isSafeInteger(announced) || announced < 2 || announced > MAX_REQUEST_BYTES) return reject(new Error('body_size'))
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > MAX_REQUEST_BYTES) {
        reject(new Error('body_size'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => total === announced ? resolve(Buffer.concat(chunks)) : reject(new Error('body_size')))
    req.on('error', reject)
  })
}

async function getBrowser() {
  if (browser?.isConnected()) return browser
  browser = await chromium.launch({
    headless: true,
    proxy: { server: PROXY_URL, bypass: '<-loopback>' },
    args: [
      '--disable-dev-shm-usage',
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--proxy-bypass-list=<-loopback>',
    ],
  })
  return browser
}

async function closeSession(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) return
  sessions.delete(sessionId)
  await session.context.close().catch(() => {})
}

async function ensureSession(sessionId) {
  const existing = sessions.get(sessionId)
  if (existing) {
    existing.lastUsed = Date.now()
    return existing
  }
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]
    if (oldest) await closeSession(oldest[0])
  }
  const instance = await getBrowser()
  const context = await instance.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 Chrome/124 Safari/537.36 KelionaiBot',
  })
  await context.route('**/*', async (route) => {
    try {
      const protocol = new URL(route.request().url()).protocol
      if (!['http:', 'https:', 'data:', 'blob:', 'about:'].includes(protocol)) throw new Error('protocol')
      await route.continue()
    } catch {
      await route.abort('blockedbyclient')
    }
  })
  const page = await context.newPage()
  const session = { context, page, lastUsed: Date.now() }
  sessions.set(sessionId, session)
  return session
}

const COLLECT_SCRIPT = `(() => {
  const nodes = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[onclick]'))
  const out = []
  for (const el of nodes) {
    if (out.length >= 40) break
    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') continue
    const index = out.length
    el.setAttribute('data-kelion-idx', String(index))
    out.push({
      index,
      tag: el.tagName.toLowerCase(),
      label: String(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('alt') || el.innerText || el.value || el.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 70),
      href: el.tagName.toLowerCase() === 'a' ? String(el.getAttribute('href') || '').slice(0, 2048) : '',
    })
  }
  return out
})()`

function maskSensitiveDigits(text) {
  return text.replace(/\b(?:\d[ -]?){12,19}\b/g, (value) => `«${value.replace(/\D/g, '').length} cifre ascunse»`)
}

async function screenshot(page) {
  for (const quality of [60, 45, 30]) {
    const shot = await page.screenshot({ type: 'jpeg', quality })
    if (shot.length <= MAX_SCREENSHOT_BYTES) return shot.toString('base64')
  }
  return undefined
}

async function snapshot(session, discreet) {
  const page = session.page
  const [title, elements, bodyText] = await Promise.all([
    page.title(),
    page.evaluate(COLLECT_SCRIPT),
    page.evaluate(`(() => document.body ? document.body.innerText : '')()`),
  ])
  let text = String(bodyText ?? '').trim().slice(0, 3000)
  if (discreet) text = maskSensitiveDigits(text)
  const result = { url: page.url(), title: String(title).slice(0, 300), text, elements }
  if (!discreet) result.screenshotBase64 = await screenshot(page)
  return result
}

async function settle(page, timeout = 5000) {
  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {})
  await page.waitForTimeout(250)
}

async function browserAction(input) {
  if (!input || !SESSION_RE.test(String(input.sessionId ?? '')) || typeof input.discreet !== 'boolean') throw new Error('bad_request')
  requireRequestId(input.requestId)
  const action = input.action
  if (!action || typeof action.type !== 'string') throw new Error('bad_request')
  if (action.type === 'close') {
    await closeSession(input.sessionId)
    return { ok: true }
  }
  const session = await ensureSession(input.sessionId)
  session.lastUsed = Date.now()
  const page = session.page
  try {
    if (action.type === 'open') {
      if (typeof action.url !== 'string' || action.url.length > 2048) throw new Error('blocked_url')
      parsePublicUrl(action.url)
      await proxyFetch({ url: action.url, mode: 'embed_headers', maxBytes: 1024 })
      await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      await settle(page)
    } else if (action.type === 'click') {
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= 40) throw new Error('bad_action')
      await page.click(`[data-kelion-idx="${action.index}"]`, { timeout: 5000 })
      await settle(page)
    } else if (action.type === 'type') {
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= 40 || typeof action.text !== 'string' || action.text.length > 4000 || typeof action.submit !== 'boolean') throw new Error('bad_action')
      const selector = `[data-kelion-idx="${action.index}"]`
      await page.fill(selector, action.text, { timeout: 5000 })
      if (action.submit) await page.press(selector, 'Enter')
      await settle(page)
    } else if (action.type === 'read') {
      // Snapshot only.
    } else if (action.type === 'back') {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {})
      await settle(page)
    } else if (action.type === 'scroll') {
      if (!['up', 'down'].includes(action.direction)) throw new Error('bad_action')
      await page.evaluate(`window.scrollBy(0, ${action.direction === 'down' ? 700 : -700})`)
      await page.waitForTimeout(200)
    } else if (action.type === 'key') {
      if (typeof action.key !== 'string' || !KEY_RE.test(action.key)) throw new Error('bad_action')
      await page.keyboard.press(action.key)
      await settle(page)
    } else if (action.type === 'clickAt') {
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y) || action.x < 0 || action.x > 1280 || action.y < 0 || action.y > 800) throw new Error('bad_action')
      await page.mouse.click(Math.round(action.x), Math.round(action.y))
      await settle(page)
    } else throw new Error('bad_action')
    return { ok: true, snapshot: await snapshot(session, input.discreet) }
  } catch (error) {
    const message = String(error?.message ?? error)
    const known = ['blocked_url', 'bad_action']
    return { ok: false, error: known.includes(message) ? message : action.type === 'open' ? 'navigation_failed' : 'action_failed' }
  }
}

function proxyFetch(input) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(input))
    const request = http.request({ socketPath: FETCH_SOCKET, path: '/internal/fetch', method: 'POST', timeout: 12_000, headers: { 'content-type': 'application/json', 'content-length': body.length } }, (response) => {
      const chunks = []
      let total = 0
      response.on('data', (chunk) => {
        total += chunk.length
        if (total > 3 * 1024 * 1024) response.destroy(new Error('fetch_response_too_large'))
        else chunks.push(chunk)
      })
      response.on('end', () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (response.statusCode !== 200) reject(new Error('fetch_rejected'))
        else resolve(parsed)
      })
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('fetch_timeout')))
    request.on('error', reject)
    request.end(body)
  })
}

async function readableText(body, contentType) {
  if (/text\/plain/i.test(contentType)) return { title: '', text: body.toString('utf8').slice(0, 120_000) }
  const instance = await getBrowser()
  const context = await instance.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' })
  await context.route('**/*', (route) => route.abort('blockedbyclient'))
  try {
    const page = await context.newPage()
    await page.setContent(body.toString('utf8'), { waitUntil: 'domcontentloaded', timeout: 5000 })
    const title = String(await page.title()).slice(0, 300)
    const text = String(await page.locator('body').innerText({ timeout: 5000 })).trim().slice(0, 120_000)
    return { title, text }
  } finally {
    await context.close().catch(() => {})
  }
}

async function safeFetch(input) {
  requireRequestId(input?.requestId)
  if (!['embed_headers', 'readable'].includes(input?.mode) || typeof input.url !== 'string' || input.url.length > 2048) throw new Error('bad_request')
  const maxBytes = Number(input.maxBytes)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024) throw new Error('bad_request')
  const result = await proxyFetch({ url: input.url, mode: input.mode, maxBytes })
  if (input.mode === 'embed_headers') return { ok: true, status: result.status, finalUrl: result.finalUrl, headers: result.headers }
  const contentType = String(result.headers?.['content-type'] ?? '').toLowerCase()
  if (!/^(text\/html|text\/plain|application\/xhtml\+xml)(?:;|$)/.test(contentType)) return { ok: false, error: 'content_type_rejected' }
  const body = Buffer.from(String(result.bodyBase64 ?? ''), 'base64')
  const readable = await readableText(body, contentType)
  return { ok: true, status: result.status, finalUrl: result.finalUrl, contentType, ...readable }
}

export function createBrowserWorker(secret) {
  const verify = createServiceVerifier(secret)
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      try { await getBrowser(); return json(res, 200, { ok: true }) } catch { return json(res, 503, { ok: false }) }
    }
    if (req.method !== 'POST' || !['/v1/browser/action', '/v1/fetch'].includes(req.url)) return json(res, 404, { error: 'not_found' })
    try {
      const raw = await collectBody(req)
      verify({ timestamp: req.headers['x-kelion-timestamp'], nonce: req.headers['x-kelion-nonce'], signature: req.headers['x-kelion-signature'], method: req.method, path: req.url, body: raw })
      const input = JSON.parse(raw.toString('utf8'))
      const result = req.url === '/v1/browser/action' ? await browserAction(input) : await safeFetch(input)
      json(res, result.ok === false ? 422 : 200, result)
    } catch (error) {
      const message = String(error?.message ?? error)
      json(res, message.startsWith('service_auth') ? 401 : message === 'body_size' ? 413 : 422, { ok: false, error: message.startsWith('service_auth') ? 'unauthorized' : 'request_rejected' })
    }
  })
}

setInterval(() => {
  const now = Date.now()
  for (const [id, session] of sessions) if (now - session.lastUsed > IDLE_MS) void closeSession(id)
}, 60_000).unref()

if (process.argv.includes('--self-test')) {
  if (!PROXY_URL.startsWith('http://') || !KEY_RE.test('Control+A') || KEY_RE.test('bad key')) process.exit(1)
  console.log('browser-worker-self-test: TRECE')
} else {
  const server = createBrowserWorker(readServiceSecret(SECRET_FILE))
  if (existsSync(API_SOCKET)) unlinkSync(API_SOCKET)
  server.listen(API_SOCKET, () => chmodSync(API_SOCKET, 0o660))
  const close = async () => {
    server.close()
    for (const id of sessions.keys()) await closeSession(id)
    await browser?.close().catch(() => {})
    process.exit(0)
  }
  process.on('SIGTERM', close)
  process.on('SIGINT', close)
}
