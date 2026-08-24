import http from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { readServiceSecret, signServiceRequest } from './lib/service-auth.mjs'

const SOCKET = '/run/kelion-browser-api/browser.sock'
const SECRET = readServiceSecret('/run/secrets/browser-worker-secret')

function call(path, value) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(value))
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = randomUUID()
    const request = http.request({
      socketPath: SOCKET,
      path,
      method: 'POST',
      timeout: 25_000,
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-kelion-timestamp': timestamp,
        'x-kelion-nonce': nonce,
        'x-kelion-signature': signServiceRequest(SECRET, timestamp, nonce, 'POST', path, body),
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('probe_timeout')))
    request.on('error', reject)
    request.end(body)
  })
}

async function expectBlocked(url, label) {
  const response = await call('/v1/fetch', { requestId: randomUUID(), url, mode: 'embed_headers', maxBytes: 1024 })
  if (response.status === 200 && response.value?.ok !== false) throw new Error(`SSRF permis: ${label}`)
}

const targets = [
  ['http://127.0.0.1/', 'loopback IPv4'],
  ['http://[::1]/', 'loopback IPv6'],
  ['http://10.0.0.1/', 'RFC1918'],
  ['http://169.254.169.254/latest/meta-data/', 'metadata'],
  ['http://example.com:22/', 'port intern'],
  ['http://127.0.0.1.nip.io/', 'DNS către loopback'],
  ['https://httpbin.org/redirect-to?url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F', 'redirect către metadata'],
]
for (const [url, label] of targets) await expectBlocked(url, label)

const publicResult = await call('/v1/fetch', { requestId: randomUUID(), url: 'https://example.com/', mode: 'embed_headers', maxBytes: 1024 })
if (publicResult.status !== 200 || publicResult.value?.ok !== true || publicResult.value?.status !== 200) throw new Error('fetch public indisponibil')

const sessionId = randomBytes(32).toString('base64url')
const browserBlocked = await call('/v1/browser/action', {
  requestId: randomUUID(), sessionId, discreet: false, action: { type: 'open', url: 'http://127.0.0.1/' },
})
if (browserBlocked.status === 200 && browserBlocked.value?.ok !== false) throw new Error('browser loopback permis')

console.log('probe-browser-ssrf: TRECE')
