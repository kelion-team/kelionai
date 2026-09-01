import { describe, expect, it } from 'vitest'
import { readResponseBufferLimited } from './services/httpBody.js'
import { mediaIdValid, mediaMimeAllowed, normalizeMediaOwner } from './services/mediaPolicy.js'

describe('generated media policy', () => {
  it('accepts only typed media and UUIDv4 object ids', () => {
    expect(mediaMimeAllowed('image', 'image/png')).toBe(true)
    expect(mediaMimeAllowed('image', 'video/mp4')).toBe(false)
    expect(mediaMimeAllowed('video', 'image/png')).toBe(false)
    expect(mediaIdValid('123e4567-e89b-42d3-a456-426614174000')).toBe(true)
    expect(mediaIdValid('../etc/passwd')).toBe(false)
  })

  it('normalizes a real account owner and rejects synthetic scope keys', () => {
    expect(normalizeMediaOwner(' Owner@Example.COM ')).toBe('owner@example.com')
    expect(normalizeMediaOwner('')).toBe('')
    expect(normalizeMediaOwner('legacy-owner')).toBe('')
  })

  it('stops reading when actual bytes exceed the cap', async () => {
    const response = new Response(new Uint8Array(17))
    await expect(readResponseBufferLimited(response, 16)).rejects.toThrow('response_too_large')
  })

  it('rejects an oversized declared body before consuming it', async () => {
    const response = new Response('small', { headers: { 'content-length': '999' } })
    await expect(readResponseBufferLimited(response, 16)).rejects.toThrow('response_too_large')
  })
})
