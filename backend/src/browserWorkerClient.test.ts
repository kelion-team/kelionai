import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestInternalService } = vi.hoisted(() => ({ requestInternalService: vi.fn() }))
vi.mock('./config.js', () => ({
  config: {
    browserWorker: {
      socket: '/run/kelion-browser-api/browser.sock',
      secret: 'b'.repeat(32),
    },
  },
}))
vi.mock('./services/internalServiceRequest.js', () => ({ requestInternalService }))

const { callBrowserWorker } = await import('./services/browserWorker.js')

describe('browser worker client', () => {
  beforeEach(() => requestInternalService.mockReset())

  it('uses the signed Unix-socket transport with a fresh request id', async () => {
    requestInternalService.mockResolvedValue({ status: 200, body: Buffer.from('{"ok":true}') })
    await expect(callBrowserWorker('/v1/browser/action', {
      sessionId: 'x'.repeat(32),
      discreet: true,
      action: { type: 'read' },
    })).resolves.toMatchObject({ ok: true })
    expect(requestInternalService).toHaveBeenCalledWith(expect.objectContaining({
      socketPath: '/run/kelion-browser-api/browser.sock',
      secret: 'b'.repeat(32),
      path: '/v1/browser/action',
      headers: { 'content-type': 'application/json' },
    }))
    const body = requestInternalService.mock.calls[0][0].body as Buffer
    expect(JSON.parse(body.toString('utf8')).requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects worker refusal and malformed output instead of inventing success', async () => {
    requestInternalService.mockResolvedValueOnce({ status: 422, body: Buffer.from('{"ok":false,"error":"navigation_failed"}') })
    await expect(callBrowserWorker('/v1/browser/action', {})).rejects.toThrow('browser_worker_navigation_failed')
    requestInternalService.mockResolvedValueOnce({ status: 200, body: Buffer.from('not-json') })
    await expect(callBrowserWorker('/v1/fetch', {})).rejects.toThrow('browser_worker_response_invalid')
  })
})
