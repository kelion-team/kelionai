/**
 * Endpoints used by the orchestrator and container probes.  They must stay
 * reachable without a browser session: a failed session-store lookup must not
 * turn a healthy candidate into an authentication failure.
 */
const HEALTH_PATHS = new Set(['/health', '/livez', '/readyz', '/api/health', '/api/release-proof'])

export function isOperationalHealthRequest(method: string, url: string | undefined): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false
  return HEALTH_PATHS.has((url ?? '').split('?', 1)[0])
}
