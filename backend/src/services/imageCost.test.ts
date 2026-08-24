import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubEnv('OPENAI_API_KEY', 'sk-proj-test-openai-key')
vi.stubEnv('OPENAI_IMAGE_MODEL', 'gpt-image-2')
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const mediaRows = vi.hoisted(() => new Map<string, { owner: string; mime: string; data: Buffer }>())
vi.mock('../db.js', () => ({
  saveGeneratedMedia: vi.fn(async (input: { id: string; ownerEmail: string; mime: string; data: Buffer }) => {
    mediaRows.set(input.id, { owner: input.ownerEmail, mime: input.mime, data: input.data })
  }),
  loadGeneratedMedia: vi.fn(async (id: string, owner: string) => {
    const row = mediaRows.get(id)
    return row?.owner === owner ? { mime: row.mime, data: row.data } : null
  }),
}))

const { generateImage, getImage } = await import('./image.js')

beforeEach(() => { fetchMock.mockReset(); mediaRows.clear() })

describe('image.ts — OpenAI Images', () => {
  it('persistă octeții b64_json și păstrează contractul id/mime/cost', async () => {
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('fakepng')])
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: png.toString('base64') }],
    }), { status: 200 }))
    const result = await generateImage('un castel pe un deal', 'owner@example.com')
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.id).toBeTruthy()
      expect(result.mime).toBe('image/png')
      expect(result.costUsd).toBe(0)
      expect(await getImage(result.id, 'someone-else@example.com')).toBeNull()
      expect(await getImage(result.id, 'owner@example.com')).toMatchObject({ mime: 'image/png' })
    }
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/images/generations')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.model).toBe('gpt-image-2')
    expect(body.prompt).toBe('un castel pe un deal')
  })

  it('propagă eroarea providerului fără succes inventat', async () => {
    fetchMock.mockResolvedValue(new Response('quota', { status: 429 }))
    await expect(generateImage('ceva', 'owner@example.com')).resolves.toEqual({ error: 'image_429: quota' })
  })
})
