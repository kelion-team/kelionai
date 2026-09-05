import { config } from '../config.js'
import { requestInternalService } from './internalServiceRequest.js'
import type { ConstructorHostSnapshot } from '../shared/constructorMonitor.js'

import { validateConstructorHostSnapshot } from './constructorMonitorPolicy.js'

export function parseConstructorHostSnapshot(value: unknown, now = Date.now()): ConstructorHostSnapshot {
  return validateConstructorHostSnapshot(value, now, 15_000)
}

/** Authenticated fixed Unix-socket observation, independent of worker writes.
 * No shell, credentials, paths or model selection reach the public caller. */
export async function readConstructorHostSnapshot(): Promise<ConstructorHostSnapshot> {
  const control = config.constructorModelControl
  if (!control.enabled || !control.socket.startsWith('/') || !control.socket.endsWith('.sock')
    || control.secret.length < 32) throw new Error('constructor_host_unavailable')
  try {
    const response = await requestInternalService({
      socketPath: control.socket, secret: control.secret, path: '/v1/worker/state',
      body: Buffer.from('{}', 'utf8'), headers: { 'content-type': 'application/json' },
      timeoutMs: 5_000, maxResponseBytes: 2048,
    })
    if (response.status !== 200) throw new Error('constructor_host_unavailable')
    return parseConstructorHostSnapshot(JSON.parse(response.body.toString('utf8')))
  } catch {
    throw new Error('constructor_host_unavailable')
  }
}
