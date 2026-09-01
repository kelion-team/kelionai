import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestInternalService } = vi.hoisted(() => ({
  requestInternalService: vi.fn(),
}))

vi.mock('../config.js', () => ({
  config: {
    converterWorker: {
      socket: '/run/kelion-converter-api/converter.sock',
      secret: 'x'.repeat(32),
    },
  },
}))
vi.mock('./internalServiceRequest.js', () => ({ requestInternalService }))

const { documentToMarkdown } = await import('./markitdown.js')
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000'

describe('document conversion boundary', () => {
  beforeEach(() => {
    requestInternalService.mockReset()
    requestInternalService.mockResolvedValue({
      status: 200,
      body: Buffer.from(JSON.stringify({ markdown: '# CV\nText' })),
    })
  })

  it('sends PDF bytes only to the signed local worker with a bounded response', async () => {
    const bytes = Buffer.from('%PDF-1.7\ncontent')
    await expect(documentToMarkdown(bytes, 'candidate.pdf', REQUEST_ID)).resolves.toBe('# CV\nText')
    expect(requestInternalService).toHaveBeenCalledWith(expect.objectContaining({
      socketPath: '/run/kelion-converter-api/converter.sock',
      path: '/v1/convert',
      body: bytes,
      headers: expect.objectContaining({
        'content-type': 'application/pdf',
        'x-request-id': REQUEST_ID,
        'x-filename': 'candidate.pdf',
        'x-content-sha256': expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    }))
  })

  it('rejects HTML, image and malformed request ids before any worker call', async () => {
    await expect(documentToMarkdown(Buffer.from('<html>'), 'page.html', REQUEST_ID)).rejects.toThrow('converter_type_rejected')
    await expect(documentToMarkdown(Buffer.from('jpeg'), 'scan.jpg', REQUEST_ID)).rejects.toThrow('converter_type_rejected')
    await expect(documentToMarkdown(Buffer.from('%PDF-'), 'cv.pdf', 'not-a-uuid')).rejects.toThrow('converter_request_id_invalid')
    expect(requestInternalService).not.toHaveBeenCalled()
  })

  it('fails closed on worker rejection or malformed output', async () => {
    requestInternalService.mockResolvedValueOnce({ status: 422, body: Buffer.from('{"error":"convert_rejected"}') })
    await expect(documentToMarkdown(Buffer.from('%PDF-'), 'cv.pdf', REQUEST_ID)).rejects.toThrow('converter_rejected:422')
    requestInternalService.mockResolvedValueOnce({ status: 200, body: Buffer.from('{"markdown":1}') })
    await expect(documentToMarkdown(Buffer.from('%PDF-'), 'cv.pdf', REQUEST_ID)).rejects.toThrow('converter_response_invalid')
  })
})
