import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { isPublicAddress, parsePublicUrl, resolvePinnedTarget } from './lib/public-target.mjs'

const PROXY_HOST = '0.0.0.0'
const PROXY_PORT = 3128
const FETCH_SOCKET = '/run/kelion-browser-egress/fetch.sock'
const MAX_OUTBOUND_BODY = 2 * 1024 * 1024
const MAX_FETCH_BODY = 2 * 1024 * 1024
const MAX_TUNNELS = 64
const tunnels = new Set()

function filteredHeaders(headers, host) {
  const blocked = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
    'x-kelion-signature', 'x-kelion-nonce', 'x-kelion-timestamp',
  ])
  const result = { host }
  for (const [name, value] of Object.entries(headers)) {
    if (!blocked.has(name.toLowerCase()) && value !== undefined) result[name] = value
  }
  return result
}

async function pinnedRequest(url, { method = 'GET', headers = {}, body, timeoutMs = 10_000 } = {}) {
  const { url: parsed, port } = parsePublicUrl(url)
  const target = await resolvePinnedTarget(parsed.hostname)
  const client = parsed.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const request = client.request({
      host: target.address,
      family: target.family,
      port,
      method,
      path: `${parsed.pathname}${parsed.search}`,
      headers: filteredHeaders(headers, parsed.host),
      servername: parsed.hostname,
      rejectUnauthorized: true,
      timeout: timeoutMs,
      agent: false,
    }, resolve)
    request.on('timeout', () => request.destroy(new Error('target_timeout')))
    request.on('error', reject)
    if (body) request.end(body)
    else request.end()
  })
}

async function readBounded(response, limit) {
  const announced = Number(response.headers['content-length'] ?? 0)
  if (announced > limit) {
    response.destroy()
    throw new Error('target_body_too_large')
  }
  const chunks = []
  let total = 0
  for await (const chunk of response) {
    total += chunk.length
    if (total > limit) {
      response.destroy()
      throw new Error('target_body_too_large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function selectedHeaders(response) {
  const pick = (name) => {
    const value = response.headers[name]
    return Array.isArray(value) ? value.join(', ') : String(value ?? '').slice(0, 4096)
  }
  return {
    'content-type': pick('content-type'),
    'x-frame-options': pick('x-frame-options'),
    'content-security-policy': pick('content-security-policy'),
  }
}

async function safeFetch(input) {
  if (!input || !['embed_headers', 'readable'].includes(input.mode)) throw new Error('fetch_mode')
  if (typeof input.url !== 'string' || input.url.length > 2048) throw new Error('fetch_url')
  const maxBytes = Number(input.maxBytes)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_FETCH_BODY) throw new Error('fetch_limit')
  let current = parsePublicUrl(input.url).url
  for (let redirects = 0; redirects <= 5; redirects++) {
    let method = input.mode === 'embed_headers' ? 'HEAD' : 'GET'
    let response = await pinnedRequest(current, { method })
    if (input.mode === 'embed_headers' && [405, 501].includes(response.statusCode ?? 0)) {
      response.destroy()
      method = 'GET'
      response = await pinnedRequest(current, { method })
    }
    const status = response.statusCode ?? 502
    if (status >= 300 && status < 400) {
      const location = response.headers.location
      response.destroy()
      if (!location || redirects === 5) throw new Error('fetch_redirect')
      current = parsePublicUrl(new URL(location, current).href).url
      continue
    }
    const headers = selectedHeaders(response)
    if (input.mode === 'embed_headers') {
      response.destroy()
      return { status, finalUrl: current.href, headers }
    }
    const body = await readBounded(response, maxBytes)
    return { status, finalUrl: current.href, headers, bodyBase64: body.toString('base64') }
  }
  throw new Error('fetch_redirect')
}

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length, 'cache-control': 'no-store' })
  res.end(body)
}

function createFetchServer() {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') return json(res, 200, { ok: true })
    if (req.method !== 'POST' || req.url !== '/internal/fetch') return json(res, 404, { error: 'not_found' })
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > 8192) req.destroy()
      else chunks.push(chunk)
    })
    req.on('end', async () => {
      try {
        const result = await safeFetch(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        json(res, 200, result)
      } catch (error) {
        const code = String(error?.message ?? error)
        json(res, code === 'target_body_too_large' ? 413 : 422, { error: 'fetch_rejected' })
      }
    })
  })
}

function rejectSocket(socket, status = '403 Forbidden') {
  if (socket.writable) socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
}

function parseAuthority(authority) {
  const match = authority.startsWith('[')
    ? /^\[([^\]]+)\]:(80|443)$/.exec(authority)
    : /^([^:]+):(80|443)$/.exec(authority)
  if (!match) throw new Error('target_port_blocked')
  return { hostname: match[1], port: Number(match[2]) }
}

function createProxyServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const announced = Number(req.headers['content-length'] ?? 0)
      if (!Number.isSafeInteger(announced) || announced > MAX_OUTBOUND_BODY) throw new Error('outbound_body_too_large')
      const parsed = parsePublicUrl(req.url)
      const target = await resolvePinnedTarget(parsed.url.hostname)
      const client = parsed.url.protocol === 'https:' ? https : http
      const upstream = client.request({
        host: target.address,
        family: target.family,
        port: parsed.port,
        method: req.method,
        path: `${parsed.url.pathname}${parsed.url.search}`,
        headers: filteredHeaders(req.headers, parsed.url.host),
        servername: parsed.url.hostname,
        rejectUnauthorized: true,
        agent: false,
      }, (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(res)
      })
      upstream.setTimeout(30_000, () => upstream.destroy(new Error('target_timeout')))
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502)
        res.end()
      })
      req.pipe(upstream)
    } catch {
      res.writeHead(403, { connection: 'close' })
      res.end()
    }
  })

  server.on('connect', async (req, client, head) => {
    if (tunnels.size >= MAX_TUNNELS) return rejectSocket(client, '429 Too Many Requests')
    try {
      const authority = parseAuthority(req.url)
      const target = await resolvePinnedTarget(authority.hostname)
      const upstream = net.connect({ host: target.address, family: target.family, port: authority.port })
      tunnels.add(client)
      const cleanup = () => tunnels.delete(client)
      client.once('close', cleanup)
      client.setTimeout(300_000, () => client.destroy())
      upstream.setTimeout(300_000, () => upstream.destroy())
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        upstream.pipe(client)
        client.pipe(upstream)
      })
      upstream.once('error', () => rejectSocket(client, '502 Bad Gateway'))
      client.once('error', () => upstream.destroy())
    } catch {
      rejectSocket(client)
    }
  })

  server.on('upgrade', async (req, client, head) => {
    try {
      const parsed = parsePublicUrl(req.url, { allowWebSocket: true })
      if (parsed.url.protocol !== 'ws:') throw new Error('websocket_protocol')
      const target = await resolvePinnedTarget(parsed.url.hostname)
      const upstream = net.connect({ host: target.address, family: target.family, port: parsed.port })
      upstream.once('connect', () => {
        const headers = filteredHeaders(req.headers, parsed.url.host)
        const lines = [`${req.method} ${parsed.url.pathname}${parsed.url.search} HTTP/${req.httpVersion}`]
        for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
        lines.push('connection: Upgrade', `upgrade: ${req.headers.upgrade ?? 'websocket'}`, '', '')
        upstream.write(lines.join('\r\n'))
        if (head.length) upstream.write(head)
        upstream.pipe(client)
        client.pipe(upstream)
      })
      upstream.once('error', () => rejectSocket(client, '502 Bad Gateway'))
      client.once('error', () => upstream.destroy())
    } catch {
      rejectSocket(client)
    }
  })
  return server
}

if (process.argv.includes('--self-test')) {
  if (isPublicAddress('127.0.0.1') || isPublicAddress('169.254.169.254') || !isPublicAddress('1.1.1.1')) process.exit(1) // hardcod-permis: adresă publică tehnică folosită exclusiv de autotestul clasificatorului
  try { parsePublicUrl('http://example.com:22/'); process.exit(1) } catch { /* expected */ }
  console.log('browser-egress-proxy-self-test: TRECE')
} else {
  const fetchServer = createFetchServer()
  const proxyServer = createProxyServer()
  if (existsSync(FETCH_SOCKET)) unlinkSync(FETCH_SOCKET)
  fetchServer.listen(FETCH_SOCKET, () => chmodSync(FETCH_SOCKET, 0o660))
  proxyServer.listen(PROXY_PORT, PROXY_HOST)
  const close = () => {
    for (const socket of tunnels) socket.destroy()
    fetchServer.close()
    proxyServer.close(() => process.exit(0))
  }
  process.on('SIGTERM', close)
  process.on('SIGINT', close)
}
