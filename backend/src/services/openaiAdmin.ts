import { config } from '../config.js'
import type {
  OpenAIAdminMeasurement,
  OpenAIAdminSnapshot,
  OpenAIAdminStatusClass,
} from '../shared/api-types.js'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface ReadOpenAIAdminOptions {
  key: string
  projectId: string
  apiBaseUrl: string
  fetchImpl?: FetchLike
  now?: () => number
}

type CostsMeasurement = OpenAIAdminSnapshot['costs']
type UsageMeasurement = OpenAIAdminSnapshot['usage']

const CACHE_TTL_MS = 5 * 60_000
const MAX_RESPONSE_BYTES = 1_048_576
const REQUEST_TIMEOUT_MS = 12_000

function unavailable(className: OpenAIAdminStatusClass, status: number | null): OpenAIAdminMeasurement {
  return {
    checked: status !== null,
    available: false,
    status,
    class: className,
  }
}

function classifyStatus(status: number): OpenAIAdminStatusClass {
  if (status === 401) return 'invalid_key'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'provider_5xx'
  return 'invalid_response'
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('response_too_large')
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('response_too_large')
  return JSON.parse(text) as unknown
}

async function adminGet(
  url: URL,
  key: string,
  fetchImpl: FetchLike,
): Promise<
  | { ok: true; status: number; payload: unknown }
  | { ok: false; measurement: OpenAIAdminMeasurement }
> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return { ok: false, measurement: unavailable('transport', null) }
  }
  if (!response.ok) {
    return { ok: false, measurement: unavailable(classifyStatus(response.status), response.status) }
  }
  try {
    return { ok: true, status: response.status, payload: await boundedJson(response) }
  } catch {
    return { ok: false, measurement: unavailable('invalid_response', response.status) }
  }
}

async function adminGetAllPages(
  initialUrl: URL,
  key: string,
  fetchImpl: FetchLike,
): Promise<
  | { ok: true; status: number; payload: { data: unknown[] } }
  | { ok: false; measurement: OpenAIAdminMeasurement }
> {
  const data: unknown[] = []
  const seenCursors = new Set<string>()
  let url = initialUrl
  let status = 200
  for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
    const page = await adminGet(url, key, fetchImpl)
    if (!page.ok) return page
    status = page.status
    const body = record(page.payload)
    if (!body || !Array.isArray(body.data)) {
      return { ok: false, measurement: unavailable('invalid_response', status) }
    }
    data.push(...body.data)

    const hasMore = body.has_more
    const rawCursor = body.next_page
    if (hasMore === false) {
      if (rawCursor !== undefined && rawCursor !== null) {
        return { ok: false, measurement: unavailable('invalid_response', status) }
      }
      return { ok: true, status, payload: { data } }
    }
    const cursor = typeof rawCursor === 'string' ? rawCursor : ''
    if (hasMore !== true || !cursor || cursor.length > 512 || seenCursors.has(cursor)) {
      return { ok: false, measurement: unavailable('invalid_response', status) }
    }
    seenCursors.add(cursor)
    url = new URL(url)
    url.searchParams.set('page', cursor)
  }
  return { ok: false, measurement: unavailable('invalid_response', status) }
}

function parseCosts(payload: unknown): { monthUsd: number; currency: 'usd' } | null {
  const body = record(payload)
  if (!body || !Array.isArray(body.data)) return null
  let monthUsd = 0
  for (const bucketValue of body.data) {
    const bucket = record(bucketValue)
    if (!bucket || !Array.isArray(bucket.results)) return null
    for (const resultValue of bucket.results) {
      const result = record(resultValue)
      const amount = record(result?.amount)
      const value = nonNegativeNumber(amount?.value)
      if (
        !result
        || result.object !== 'organization.costs.result'
        || !amount
        || amount.currency !== 'usd'
        || value === null
      ) return null
      monthUsd += value
      if (!Number.isFinite(monthUsd) || monthUsd < 0) return null
    }
  }
  return { monthUsd, currency: 'usd' }
}

function parseUsage(payload: unknown): {
  requests: number
  inputTokens: number
  outputTokens: number
} | null {
  const body = record(payload)
  if (!body || !Array.isArray(body.data)) return null
  let requests = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const bucketValue of body.data) {
    const bucket = record(bucketValue)
    if (!bucket || !Array.isArray(bucket.results)) return null
    for (const resultValue of bucket.results) {
      const result = record(resultValue)
      if (!result || result.object !== 'organization.usage.completions.result') return null
      const rowRequests = nonNegativeSafeInteger(result.num_model_requests)
      const rowInput = nonNegativeSafeInteger(result.input_tokens)
      const rowOutput = nonNegativeSafeInteger(result.output_tokens)
      if (rowRequests === null || rowInput === null || rowOutput === null) return null
      requests += rowRequests
      inputTokens += rowInput
      outputTokens += rowOutput
      if (![requests, inputTokens, outputTokens].every(Number.isSafeInteger)) return null
    }
  }
  return { requests, inputTokens, outputTokens }
}

function officialAdminBase(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.origin !== 'https://api.openai.com' || url.pathname.replace(/\/$/, '') !== '/v1') return null
    if (url.username || url.password || url.search || url.hash) return null
    return url
  } catch {
    return null
  }
}

/** Reads only the official OpenAI organization Costs/Usage GET endpoints.
 * The Admin credential never reaches inference and provider bodies never leave
 * this module. A successful provider-reported zero remains a measured zero;
 * any failed/unknown read omits all numeric values. */
export async function readOpenAIAdminSnapshot(
  options: ReadOpenAIAdminOptions,
): Promise<OpenAIAdminSnapshot> {
  const nowMs = options.now?.() ?? Date.now()
  const startMs = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), 1)
  const startSeconds = Math.floor(startMs / 1000)
  const endSeconds = Math.max(startSeconds + 1, Math.floor(nowMs / 1000) + 1)
  const scope = options.projectId ? 'project' as const : 'organization' as const
  const period = {
    start: new Date(startSeconds * 1000).toISOString(),
    end: new Date(endSeconds * 1000).toISOString(),
  }
  if (!/^sk-admin-[A-Za-z0-9_-]{16,}$/.test(options.key)) {
    const missing = unavailable('not_configured', null)
    return { configured: false, scope, period, costs: missing, usage: missing }
  }

  const base = officialAdminBase(options.apiBaseUrl)
  if (!base) {
    const invalid = unavailable('invalid_response', null)
    return { configured: true, scope, period, costs: invalid, usage: invalid }
  }

  const query = (path: string): URL => {
    const url = new URL(`${base.toString().replace(/\/$/, '')}${path}`)
    url.searchParams.set('start_time', String(startSeconds))
    url.searchParams.set('end_time', String(endSeconds))
    url.searchParams.set('bucket_width', '1d')
    url.searchParams.set('limit', '31')
    if (options.projectId) url.searchParams.append('project_ids', options.projectId)
    return url
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const [costResponse, usageResponse] = await Promise.all([
    adminGetAllPages(query('/organization/costs'), options.key, fetchImpl),
    adminGetAllPages(query('/organization/usage/completions'), options.key, fetchImpl),
  ])

  let costs: CostsMeasurement
  if (!costResponse.ok) {
    costs = costResponse.measurement
  } else {
    const parsed = parseCosts(costResponse.payload)
    costs = parsed
      ? { checked: true, available: true, status: costResponse.status, class: 'ok', ...parsed }
      : unavailable('invalid_response', costResponse.status)
  }

  let usage: UsageMeasurement
  if (!usageResponse.ok) {
    usage = usageResponse.measurement
  } else {
    const parsed = parseUsage(usageResponse.payload)
    usage = parsed
      ? { checked: true, available: true, status: usageResponse.status, class: 'ok', ...parsed }
      : unavailable('invalid_response', usageResponse.status)
  }

  return { configured: true, scope, period, costs, usage }
}

let cached: { at: number; snapshot: OpenAIAdminSnapshot } | null = null
let inFlight: Promise<OpenAIAdminSnapshot> | null = null

/** Shared 5-minute cache for the 15s/30s Admin pollers. */
export async function openaiAdminSnapshot(force = false): Promise<OpenAIAdminSnapshot> {
  const now = Date.now()
  if (!force && cached && now - cached.at < CACHE_TTL_MS) return cached.snapshot
  if (!force && inFlight) return inFlight
  const current = readOpenAIAdminSnapshot({
    key: config.openaiAdmin.key,
    projectId: config.openaiAdmin.projectId,
    apiBaseUrl: config.openaiAdmin.apiBaseUrl,
  }).then((snapshot) => {
    cached = { at: Date.now(), snapshot }
    return snapshot
  }).finally(() => {
    if (inFlight === current) inFlight = null
  })
  inFlight = current
  return current
}
