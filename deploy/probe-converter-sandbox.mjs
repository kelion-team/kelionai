import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { readServiceSecret, signServiceRequest } from './lib/service-auth.mjs'

const SOCKET = '/run/kelion-converter-api/converter.sock'
const SECRET = readServiceSecret('/run/secrets/converter-worker-secret')

function call(body, { contentHash = createHash('sha256').update(body).digest('hex'), nonce = randomUUID() } = {}) {
  return new Promise((resolve, reject) => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const path = '/v1/convert'
    const request = http.request({
      socketPath: SOCKET,
      path,
      method: 'POST',
      timeout: 35_000,
      headers: {
        'content-type': 'text/plain',
        'content-length': body.length,
        'x-request-id': randomUUID(),
        'x-filename': 'proba.txt',
        'x-content-sha256': contentHash,
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

const body = Buffer.from('Kelion converter sandbox')
const converted = await call(body)
if (converted.status !== 200 || converted.value?.markdown !== body.toString()) {
  const error = String(converted.value?.error ?? 'unexpected_response').slice(0, 80)
  throw new Error(`conversia validă a picat: status=${converted.status}, error=${error}`)
}

const corrupt = await call(body, { contentHash: '0'.repeat(64) })
if (corrupt.status === 200) throw new Error('hash corupt acceptat')

console.log('probe-converter-sandbox: TRECE')
