import http from 'node:http'
import { createHash, createHmac, randomUUID } from 'node:crypto'

export interface InternalServiceRequest {
  socketPath: string
  secret: string
  path: string
  body: Buffer
  headers?: Record<string, string>
  timeoutMs: number
  maxResponseBytes: number
}

export interface InternalServiceResponse {
  status: number
  body: Buffer
}

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex')
}

/**
 * Narrow, replay-resistant request transport for local Unix-socket workers.
 * The worker secret never becomes a bearer token and is never written to logs.
 */
export function requestInternalService(input: InternalServiceRequest): Promise<InternalServiceResponse> {
  if (!input.socketPath || !input.path.startsWith('/') || input.secret.length < 32) {
    return Promise.reject(new Error('internal_service_not_configured'))
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1_000 ||
      !Number.isSafeInteger(input.maxResponseBytes) || input.maxResponseBytes < 1) {
    return Promise.reject(new Error('internal_service_limits_invalid'))
  }

  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomUUID()
  const bodyHash = sha256(input.body)
  const canonical = `${timestamp}\n${nonce}\nPOST\n${input.path}\n${bodyHash}`
  const signature = `v1=${createHmac('sha256', input.secret).update(canonical).digest('hex')}`

  return new Promise((resolve, reject) => {
    let settled = false
    const finishError = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const request = http.request({
      socketPath: input.socketPath,
      path: input.path,
      method: 'POST',
      timeout: input.timeoutMs,
      headers: {
        'content-length': input.body.length,
        'x-kelion-timestamp': timestamp,
        'x-kelion-nonce': nonce,
        'x-kelion-signature': signature,
        ...input.headers,
      },
    }, (response) => {
      const chunks: Buffer[] = []
      let total = 0
      response.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > input.maxResponseBytes) {
          response.destroy(new Error('internal_service_response_too_large'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        if (settled) return
        settled = true
        resolve({ status: response.statusCode ?? 502, body: Buffer.concat(chunks) })
      })
      response.on('error', finishError)
    })
    request.on('timeout', () => request.destroy(new Error('internal_service_timeout')))
    request.on('error', finishError)
    request.end(input.body)
  })
}
