import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'

const SOCKET = '/run/kelion-converter-private/parser.sock'
const body = Buffer.from('Kelion converter parser sandbox')

const result = await new Promise((resolve, reject) => {
  const request = http.request({
    socketPath: SOCKET,
    path: '/v1/convert',
    method: 'POST',
    timeout: 35_000,
    headers: {
      'content-type': 'text/plain',
      'content-length': body.length,
      'x-request-id': randomUUID(),
      'x-filename': 'proba.txt',
      'x-content-sha256': createHash('sha256').update(body).digest('hex'),
    },
  }, (response) => {
    const chunks = []
    response.on('data', (chunk) => chunks.push(chunk))
    response.on('end', () => resolve({
      status: response.statusCode,
      value: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }))
    response.on('error', reject)
  })
  request.on('timeout', () => request.destroy(new Error('probe_timeout')))
  request.on('error', reject)
  request.end(body)
})

if (result.status !== 200 || result.value?.markdown !== body.toString()) {
  const error = String(result.value?.error ?? 'unexpected_response').slice(0, 80)
  throw new Error(`parser invalid: status=${result.status}, error=${error}`)
}

console.log('probe-converter-parser: TRECE')
