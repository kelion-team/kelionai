import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readOpenAIAdminSnapshot } from './services/openaiAdmin.js'

const ADMIN_KEY = ['sk', 'admin', 'fixture-only-123456'].join('-')
const PROJECT_ID = 'proj_kelion_fixture'
const NOW = Date.UTC(2026, 7, 30, 12, 0, 0)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function options(fetchImpl: typeof fetch) {
  return {
    key: ADMIN_KEY,
    projectId: PROJECT_ID,
    apiBaseUrl: 'https://api.openai.com/v1',
    fetchImpl,
    now: () => NOW,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('OpenAI organization Costs/Usage boundary', () => {
  it('without the Admin key reports unavailable and never calls a provider', async () => {
    const provider = vi.fn<typeof fetch>()
    const result = await readOpenAIAdminSnapshot({ ...options(provider), key: '' })

    expect(provider).not.toHaveBeenCalled()
    expect(result.configured).toBe(false)
    expect(result.costs).toEqual({ checked: false, available: false, status: null, class: 'not_configured' })
    expect(result.usage).toEqual({ checked: false, available: false, status: null, class: 'not_configured' })
    expect(result.costs).not.toHaveProperty('monthUsd')
    expect(result.usage).not.toHaveProperty('requests')
  })

  it('never sends a project-scoped inference key to organization Admin endpoints', async () => {
    const provider = vi.fn<typeof fetch>()
    const projectKey = ['sk', 'proj', 'fixture-only'].join('-')
    const result = await readOpenAIAdminSnapshot({ ...options(provider), key: projectKey })
    expect(provider).not.toHaveBeenCalled()
    expect(result.configured).toBe(false)
    expect(result.costs.class).toBe('not_configured')
  })

  it('uses only official GET admin endpoints, scopes both reads to Kelion and parses measured values', async () => {
    const seen: { url: URL; init?: RequestInit }[] = []
    const provider = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input))
      seen.push({ url, init })
      if (url.pathname.endsWith('/organization/costs')) {
        return jsonResponse({
          data: [{ object: 'bucket', results: [{ object: 'organization.costs.result', amount: { currency: 'usd', value: 12.25 } }] }],
          has_more: false,
          next_page: null,
        })
      }
      return jsonResponse({
        data: [{
          object: 'bucket',
          results: [{
            object: 'organization.usage.completions.result',
            num_model_requests: 8,
            input_tokens: 1200,
            output_tokens: 340,
          }],
        }],
        has_more: false,
        next_page: null,
      })
    })

    const result = await readOpenAIAdminSnapshot(options(provider))

    expect(seen).toHaveLength(2)
    expect(seen.map(({ url }) => url.pathname).sort()).toEqual([
      '/v1/organization/costs',
      '/v1/organization/usage/completions',
    ])
    for (const { url, init } of seen) {
      if (!init) throw new Error('request_init_missing')
      expect(init.method).toBe('GET')
      expect(init.redirect).toBe('error')
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${ADMIN_KEY}`)
      expect(url.searchParams.getAll('project_ids')).toEqual([PROJECT_ID])
      expect(url.searchParams.get('bucket_width')).toBe('1d')
      expect(url.searchParams.get('limit')).toBe('31')
      expect(Number(url.searchParams.get('start_time'))).toBe(Date.UTC(2026, 7, 1) / 1000)
    }
    expect(result).toMatchObject({
      configured: true,
      scope: 'project',
      costs: { checked: true, available: true, status: 200, class: 'ok', monthUsd: 12.25, currency: 'usd' },
      usage: { checked: true, available: true, status: 200, class: 'ok', requests: 8, inputTokens: 1200, outputTokens: 340 },
    })
  })

  it('accepts a real measured zero only after successful provider parsing', async () => {
    const provider = vi.fn<typeof fetch>(async (input) => String(input).includes('/organization/costs')
      ? jsonResponse({ data: [], has_more: false, next_page: null })
      : jsonResponse({ data: [], has_more: false, next_page: null }))
    const result = await readOpenAIAdminSnapshot(options(provider))
    expect(result.costs).toMatchObject({ available: true, monthUsd: 0 })
    expect(result.usage).toMatchObject({ available: true, requests: 0, inputTokens: 0, outputTokens: 0 })
  })

  it('follows bounded provider cursors before declaring a total measured', async () => {
    const provider = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      const first = !url.searchParams.has('page')
      if (url.pathname.endsWith('/organization/costs')) {
        return first
          ? jsonResponse({
              data: [{ results: [{ object: 'organization.costs.result', amount: { currency: 'usd', value: 2 } }] }],
              has_more: true,
              next_page: 'cost-page-2',
            })
          : jsonResponse({
              data: [{ results: [{ object: 'organization.costs.result', amount: { currency: 'usd', value: 3 } }] }],
              has_more: false,
              next_page: null,
            })
      }
      return first
        ? jsonResponse({ data: [], has_more: true, next_page: 'usage-page-2' })
        : jsonResponse({ data: [], has_more: false, next_page: null })
    })

    const result = await readOpenAIAdminSnapshot(options(provider))
    expect(provider).toHaveBeenCalledTimes(4)
    expect(result.costs).toMatchObject({ available: true, monthUsd: 5 })
    expect(result.usage).toMatchObject({ available: true, requests: 0 })
  })

  it('refuses a continuation signal without a safe cursor instead of under-reporting', async () => {
    const provider = vi.fn<typeof fetch>(async () => jsonResponse({ data: [], has_more: true }))
    const result = await readOpenAIAdminSnapshot(options(provider))
    expect(result.costs).toEqual({ checked: true, available: false, status: 200, class: 'invalid_response' })
    expect(result.usage).toEqual({ checked: true, available: false, status: 200, class: 'invalid_response' })
  })

  it('refuses a success body without an explicit terminal pagination signal', async () => {
    const provider = vi.fn<typeof fetch>(async () => jsonResponse({ data: [] }))
    const result = await readOpenAIAdminSnapshot(options(provider))
    expect(result.costs).toEqual({ checked: true, available: false, status: 200, class: 'invalid_response' })
    expect(result.usage).toEqual({ checked: true, available: false, status: 200, class: 'invalid_response' })
  })

  it('keeps failures unavailable without inventing numeric zero or changing the other measurement', async () => {
    const provider = vi.fn<typeof fetch>(async (input) => String(input).includes('/organization/costs')
      ? jsonResponse({ error: { message: 'private provider text' } }, 401)
      : jsonResponse({ data: [{ object: 'bucket', results: [] }], has_more: false, next_page: null }))
    const result = await readOpenAIAdminSnapshot(options(provider))

    expect(result.costs).toEqual({ checked: true, available: false, status: 401, class: 'invalid_key' })
    expect(result.costs).not.toHaveProperty('monthUsd')
    expect(JSON.stringify(result)).not.toContain('private provider text')
    expect(result.usage).toMatchObject({ available: true, requests: 0 })
  })

  it('rejects malformed or oversized success bodies as unavailable', async () => {
    const malformed = vi.fn<typeof fetch>(async () => jsonResponse({
      data: [{ results: [{}] }],
      has_more: false,
      next_page: null,
    }))
    const malformedResult = await readOpenAIAdminSnapshot(options(malformed))
    expect(malformedResult.costs).toEqual({ checked: true, available: false, status: 200, class: 'invalid_response' })
    expect(malformedResult.usage).toEqual({ checked: true, available: false, status: 200, class: 'invalid_response' })

    const oversized = vi.fn<typeof fetch>(async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': '1048577' },
    }))
    const oversizedResult = await readOpenAIAdminSnapshot(options(oversized))
    expect(oversizedResult.costs.class).toBe('invalid_response')
    expect(oversizedResult.usage.class).toBe('invalid_response')
  })

  it('never imports the Admin key into inference, Realtime, media or Constructor modules', () => {
    const source = (relative: string): string => readFileSync(
      fileURLToPath(new URL(relative, import.meta.url)),
      'utf8',
    )
    for (const relative of [
      './services/openaiResponses.ts',
      './services/openaiModele.ts',
      './services/vocalLive.ts',
      './services/tts.ts',
      './services/openaiCallTranscription.ts',
    ]) {
      expect(source(relative), relative).not.toMatch(/OPENAI_ADMIN_KEY|openaiAdmin\.key/)
    }
    for (const relative of [
      '../../deploy/codex-worker.mjs',
      '../../deploy/constructor-publisher.mjs',
      '../../deploy/constructor-release.mjs',
    ]) {
      expect(source(relative), relative).not.toMatch(
        /process\.env\.OPENAI_ADMIN_KEY|OPENAI_ADMIN_KEY_FILE|openai-admin-key|config\.openaiAdmin/,
      )
    }
  })
})
