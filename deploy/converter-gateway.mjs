import http from 'node:http'
import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServiceVerifier, readServiceSecret, requireRequestId } from './lib/service-auth.mjs'

const PUBLIC_SOCKET = '/run/kelion-converter-api/converter.sock'
const PARSER_SOCKET = '/run/kelion-converter-private/parser.sock'
const SECRET_FILE = '/run/secrets/converter-worker-secret'
const MAX_BODY_BYTES = 20 * 1024 * 1024
const CACHE_LIMIT = 8
const cache = new Map()

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' })
  res.end(body)
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const announced = Number(req.headers['content-length'] ?? -1)
    if (!Number.isSafeInteger(announced) || announced < 1 || announced > MAX_BODY_BYTES) return reject(new Error('body_size'))
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        reject(new Error('body_size'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => total === announced ? resolve(Buffer.concat(chunks)) : reject(new Error('body_size')))
    req.on('error', reject)
  })
}

function forwardToParser(body, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      socketPath: PARSER_SOCKET,
      path: '/v1/convert',
      method: 'POST',
      timeout: 32_000,
      headers: {
        'content-type': headers['content-type'] ?? 'application/octet-stream',
        'content-length': body.length,
        'x-request-id': headers['x-request-id'],
        'x-filename': headers['x-filename'],
        'x-content-sha256': headers['x-content-sha256'],
      },
    }, (response) => {
      const chunks = []
      let total = 0
      response.on('data', (chunk) => {
        total += chunk.length
        if (total > 2_100_000) {
          response.destroy(new Error('parser_response_too_large'))
        } else chunks.push(chunk)
      })
      response.on('end', () => resolve({ status: response.statusCode ?? 502, body: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('parser_timeout')))
    request.on('error', reject)
    request.end(body)
  })
}

function parserIsHealthy() {
  return new Promise((resolve) => {
    const request = http.get({ socketPath: PARSER_SOCKET, path: '/healthz', timeout: 2000 }, (response) => {
      response.resume()
      resolve(response.statusCode === 200)
    })
    request.on('timeout', () => { request.destroy(); resolve(false) })
    request.on('error', () => resolve(false))
  })
}

export function createConverterGateway(secret) {
  const verify = createServiceVerifier(secret)
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      const ok = await parserIsHealthy()
      return json(res, ok ? 200 : 503, { ok })
    }
    if (req.method !== 'POST' || req.url !== '/v1/convert') return json(res, 404, { error: 'not_found' })
    try {
      const body = await collectBody(req)
      const requestId = requireRequestId(req.headers['x-request-id'])
      verify({
        timestamp: req.headers['x-kelion-timestamp'],
        nonce: req.headers['x-kelion-nonce'],
        signature: req.headers['x-kelion-signature'],
        method: req.method,
        path: req.url,
        body,
      })
      const announcedHash = String(req.headers['x-content-sha256'] ?? '').toLowerCase()
      const actualHash = createHash('sha256').update(body).digest('hex')
      if (announcedHash !== actualHash) throw new Error('content_hash')
      const cacheKey = `${requestId}:${actualHash}`
      const cached = cache.get(cacheKey)
      if (cached) {
        res.writeHead(cached.status, { 'content-type': 'application/json; charset=utf-8', 'content-length': cached.body.length, 'cache-control': 'no-store' })
        return res.end(cached.body)
      }
      const parsed = await forwardToParser(body, req.headers)
      if (parsed.status === 200) {
        cache.set(cacheKey, parsed)
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
      }
      res.writeHead(parsed.status, { 'content-type': 'application/json; charset=utf-8', 'content-length': parsed.body.length, 'cache-control': 'no-store' })
      res.end(parsed.body)
    } catch (error) {
      const message = String(error?.message ?? error)
      const authError = message.startsWith('service_auth')
      json(res, authError ? 401 : message === 'body_size' ? 413 : 422, { error: authError ? 'unauthorized' : 'convert_rejected' })
    }
  })
}

if (process.argv.includes('--self-test')) {
  if (!PUBLIC_SOCKET.endsWith('.sock') || !PARSER_SOCKET.endsWith('.sock') || MAX_BODY_BYTES !== 20 * 1024 * 1024) process.exit(1)
  console.log('converter-gateway-self-test: TRECE')
} else {
  const server = createConverterGateway(readServiceSecret(SECRET_FILE))
  if (existsSync(PUBLIC_SOCKET)) unlinkSync(PUBLIC_SOCKET)
  server.listen(PUBLIC_SOCKET, () => chmodSync(PUBLIC_SOCKET, 0o660))
  const close = () => server.close(() => process.exit(0))
  process.on('SIGTERM', close)
  process.on('SIGINT', close)
}
