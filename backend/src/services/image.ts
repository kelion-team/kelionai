import { randomUUID } from 'node:crypto'
import { saveGeneratedMedia, loadGeneratedMedia } from '../db.js'
import { config } from '../config.js'
import type { OrImage } from './brainContract.js'
import { readResponseTextLimited } from './httpBody.js'
import {
  MEDIA_LIMITS,
  mediaIdValid,
  normalizeMediaOwner,
} from './mediaPolicy.js'

interface StoredImage {
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
  buf: Buffer
}

async function put(ownerEmail: string, mime: StoredImage['mime'], buf: Buffer): Promise<string> {
  const owner = normalizeMediaOwner(ownerEmail)
  if (!owner) throw new Error('media_owner_invalid')
  const id = randomUUID()
  await saveGeneratedMedia({ id, ownerEmail: owner, kind: 'image', mime, data: buf })
  return id
}

export async function getImage(id: string, ownerEmail: string): Promise<StoredImage | null> {
  const owner = normalizeMediaOwner(ownerEmail)
  if (!owner || !mediaIdValid(id)) return null
  const row = await loadGeneratedMedia(id, owner, 'image')
  if (!row || !['image/png', 'image/jpeg', 'image/webp'].includes(row.mime)) return null
  return { mime: row.mime as StoredImage['mime'], buf: row.data }
}

export type ImageResult = { id: string; mime: string; costUsd: number } | { error: string }

function pngBytesValid(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
}

export async function openaiImage(prompt: string): Promise<OrImage> {
  if (!config.openai.key || !config.openai.image) return { error: 'image_not_configured' }
  const model = config.openai.image
  let response: Response
  try {
    response = await fetch(`${config.openai.apiBaseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openai.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, prompt, size: '1024x1024', quality: 'medium', output_format: 'png' }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (error) {
    return { error: `image_network: ${String(error).slice(0, 160)}` }
  }

  let body: string
  try {
    body = await readResponseTextLimited(
      response,
      response.ok ? MEDIA_LIMITS.imageResponseBytes : MEDIA_LIMITS.providerJsonBytes,
    )
  } catch (error) {
    return { error: `image_response_${error instanceof Error ? error.message : 'invalid'}` }
  }
  if (!response.ok) return { error: `image_${response.status}: ${body.slice(0, 200)}` }

  let encoded = ''
  try {
    const json = JSON.parse(body) as { data?: Array<{ b64_json?: string }> }
    encoded = json.data?.[0]?.b64_json ?? ''
  } catch {
    return { error: 'image_invalid_json' }
  }
  const maxEncoded = Math.ceil(MEDIA_LIMITS.imageBytes / 3) * 4 + 4
  if (!encoded || encoded.length > maxEncoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return { error: 'image_invalid_base64' }
  }
  const buf = Buffer.from(encoded, 'base64')
  if (!pngBytesValid(buf) || buf.length > MEDIA_LIMITS.imageBytes) return { error: 'image_invalid_bytes' }
  return { mime: 'image/png', buf, costUsd: 0 }
}

export async function generateImage(prompt: string, ownerEmail: string): Promise<ImageResult> {
  const p = prompt.trim()
  if (!p) return { error: 'empty_prompt' }
  if (p.length > MEDIA_LIMITS.promptChars) return { error: 'prompt_too_large' }
  const r = await openaiImage(p)
  if ('error' in r) return { error: r.error }
  try {
    return { id: await put(ownerEmail, r.mime as StoredImage['mime'], r.buf), mime: r.mime, costUsd: r.costUsd }
  } catch (error) {
    return { error: `image_store: ${error instanceof Error ? error.message : 'unavailable'}` }
  }
}
