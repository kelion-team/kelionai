import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { callBrowserWorker } from '../services/browserWorker.js'

type PaginaCitita =
  | { ok: true; titlu: string; text: string; urlFinal: string }
  | { ok: false; status: 422 | 503; motiv: string }

const MAX_URL_CHARS = 2_048
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const CACHE_MS = 10 * 60_000
const cache = new Map<string, { value: PaginaCitita; at: number }>()
const inFlight = new Map<string, Promise<PaginaCitita>>()

function parseTarget(raw: unknown): URL | null {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_URL_CHARS) return null
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    return url
  } catch {
    return null
  }
}

function workerUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message === 'browser_worker_not_configured'
    || message.startsWith('internal_service_')
    || /(?:ENOENT|ECONNREFUSED|socket|timeout)/i.test(message)
}

async function readReal(target: URL): Promise<PaginaCitita> {
  try {
    const response = await callBrowserWorker('/v1/fetch', {
      url: target.href,
      mode: 'readable',
      maxBytes: MAX_PAGE_BYTES,
    }, { timeoutMs: 20_000, maxResponseBytes: 256 * 1024 })
    const status = Number(response.status)
    const finalUrl = typeof response.finalUrl === 'string' ? response.finalUrl.slice(0, MAX_URL_CHARS) : ''
    const title = typeof response.title === 'string' ? response.title.slice(0, 300) : ''
    const text = typeof response.text === 'string' ? response.text.trim().slice(0, 120_000) : ''
    if (!Number.isInteger(status) || status < 200 || status >= 300) {
      return { ok: false, status: 422, motiv: 'pagina nu a răspuns cu succes' }
    }
    if (!finalUrl || !parseTarget(finalUrl) || !text) {
      return { ok: false, status: 422, motiv: 'pagina nu a produs text lizibil' }
    }
    return { ok: true, titlu: title || new URL(finalUrl).hostname, text, urlFinal: finalUrl }
  } catch (error) {
    return workerUnavailable(error)
      ? { ok: false, status: 503, motiv: 'cititorul izolat nu este disponibil' }
      : { ok: false, status: 422, motiv: 'pagina a fost refuzată de poarta de rețea' }
  }
}

/** Reads a public page only through the isolated browser worker and its
 * DNS-pinning egress proxy. The application process never fetches the URL. */
export async function citestePagina(raw: unknown): Promise<PaginaCitita> {
  const target = parseTarget(raw)
  if (!target) return { ok: false, status: 422, motiv: 'URL invalid sau neacceptat' }
  const key = target.href
  const cacheable = !target.search
  const existing = cacheable ? cache.get(key) : undefined
  if (existing && Date.now() - existing.at < CACHE_MS) return existing.value
  const current = inFlight.get(key)
  if (current) return current
  const request = readReal(target)
    .then((value) => {
      if (cacheable) {
        if (cache.size >= 200) cache.clear()
        cache.set(key, { value, at: Date.now() })
      }
      return value
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

export async function embedCheckRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { url?: unknown } }>(
    '/api/citeste-pagina',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const result = await citestePagina(req.body?.url)
      reply.header('Cache-Control', 'no-store')
      if (!result.ok) return reply.code(result.status).send({ error: 'necitibil', motiv: result.motiv })
      return reply.send(result)
    },
  )
}
