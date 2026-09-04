import { createHash } from 'node:crypto'
import { canonicalJson, fail } from './constructor-service-client.mjs'

export function validateRepository(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) fail('Repository GitHub invalid')
  return repository
}

export async function githubRequest(token, repository, path, method = 'GET', body = undefined) {
  validateRepository(repository)
  if (token.length < 32 || /[\r\n]/.test(token)) fail('Credentială GitHub invalidă')
  const prefix = `/repos/${repository}`
  // Preflightul publisherului interogheaza si radacina repository-ului
  // (/repos/owner/repo), fara slash final. Ramanem strict la acelasi
  // repository, dar acceptam si calea exacta, nu doar sub-caile ei.
  const requested = path.split('?')[0]
  if ((requested !== prefix && !requested.startsWith(`${prefix}/`))
    || /(?:^|\/)\.{1,2}(?:\/|$)/.test(requested)) fail('Cale GitHub nepermisă')
  const response = await fetch(new URL(path, 'https://api.github.com'), {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: canonicalJson(body) }),
    signal: AbortSignal.timeout(20_000),
  })
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) fail(`GitHub ${method} ${path.slice(prefix.length)}: HTTP ${response.status}`)
  return payload
}

/** UUID determinist cu biții RFC 4122 setați. Același release poate fi reluat
 * după crash fără a crea o a doua cerere GitHub Actions. */
export function deterministicUuid(namespace) {
  const bytes = createHash('sha256').update(namespace).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
