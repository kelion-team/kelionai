import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./lib/transport', () => ({ apiFetch: request }))
import { markNotificareCitit } from './lib/admin'

describe('Admin notification acknowledgement and failure feedback', () => {
  beforeEach(() => request.mockReset())
  it('accepts only an explicit successful acknowledgement', async () => {
    for (const body of [{ ok: false }, { ok: 'true' }, {}, null]) {
      request.mockResolvedValueOnce(new Response(JSON.stringify(body)))
      await expect(markNotificareCitit(7)).resolves.toBe(false)
    }
    request.mockResolvedValueOnce(new Response('{"ok":true}'))
    await expect(markNotificareCitit(7)).resolves.toBe(true)
  })
  it('never reports 401/403/404/503 or transport failure as marked read', async () => {
    for (const status of [401, 403, 404, 503]) {
      request.mockResolvedValueOnce(new Response('{"error":"notificare_nemarcata"}', { status }))
      await expect(markNotificareCitit(7)).resolves.toBe(false)
    }
    request.mockRejectedValueOnce(new Error('offline'))
    await expect(markNotificareCitit(7)).resolves.toBe(false)
  })
  it('retains visible failure feedback and prevents duplicate in-flight clicks', () => {
    const panel = readFileSync(new URL('./components/admin/AdminComunicare.tsx', import.meta.url), 'utf8')
    expect(panel).toContain('if (markingRef.current.has(id)) return')
    expect(panel).toContain('Marcarea ca citită nu a putut fi confirmată')
    expect(panel).toContain('role="alert">{markErrors[n.id]}')
    expect(panel).toContain('disabled={marking.has(n.id)}')
  })
})
