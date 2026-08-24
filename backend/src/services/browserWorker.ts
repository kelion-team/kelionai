import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { requestInternalService } from './internalServiceRequest.js'

export type BrowserWorkerPath = '/v1/browser/action' | '/v1/fetch'

export interface BrowserWorkerEnvelope {
  ok?: boolean
  error?: string
  [key: string]: unknown
}

/**
 * The web process has no browser and no unrestricted outbound fetch path.
 * Every browser/read request crosses this authenticated Unix-socket boundary;
 * the isolated worker then reaches the network only through its pinning proxy.
 */
export async function callBrowserWorker(
  path: BrowserWorkerPath,
  payload: Record<string, unknown>,
  options: { timeoutMs?: number; maxResponseBytes?: number } = {},
): Promise<BrowserWorkerEnvelope> {
  if (!config.browserWorker.socket || config.browserWorker.secret.length < 32) {
    throw new Error('browser_worker_not_configured')
  }
  const body = Buffer.from(JSON.stringify({ requestId: randomUUID(), ...payload }), 'utf8')
  if (body.length > 16 * 1024) throw new Error('browser_worker_request_too_large')
  const response = await requestInternalService({
    socketPath: config.browserWorker.socket,
    secret: config.browserWorker.secret,
    path,
    body,
    headers: { 'content-type': 'application/json' },
    timeoutMs: options.timeoutMs ?? 25_000,
    maxResponseBytes: options.maxResponseBytes ?? 2 * 1024 * 1024,
  })
  let parsed: BrowserWorkerEnvelope
  try {
    parsed = JSON.parse(response.body.toString('utf8')) as BrowserWorkerEnvelope
  } catch {
    throw new Error('browser_worker_response_invalid')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('browser_worker_response_invalid')
  }
  if (response.status !== 200 || parsed.ok === false) {
    const code = typeof parsed.error === 'string' ? parsed.error : 'request_rejected'
    throw new Error(`browser_worker_${code.slice(0, 80)}`)
  }
  return parsed
}
