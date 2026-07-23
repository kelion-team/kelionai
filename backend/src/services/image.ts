import { saveGeneratedImage, loadGeneratedImage } from '../db.js'
import { openrouterImage } from './openrouter.js'

// Imagini generate — persistente în DB, cu un cache de nivel 1 în memorie.
// Generarea trece prin OpenRouter (aceeași cheie ca creierul), nu prin Gemini
// direct: „2 chei, punct" (Adrian). Vezi services/openrouter.ts openrouterImage.
interface StoredImage {
  mime: string
  buf: Buffer
  ts: number
}

const cache = new Map<string, StoredImage>()
const MAX_CACHE = 60

async function put(mime: string, buf: Buffer): Promise<string> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  await saveGeneratedImage(id, mime, buf)
  cache.set(id, { mime, buf, ts: Date.now() })
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return id
}

export async function getImage(id: string): Promise<StoredImage | null> {
  const hit = cache.get(id)
  if (hit) return hit
  const row = await loadGeneratedImage(id)
  if (row) {
    const img = { mime: row.mime, buf: row.data, ts: Date.now() }
    cache.set(id, img)
    return img
  }
  return null
}

export type ImageResult = { id: string; mime: string } | { error: string }

export async function generateImage(prompt: string): Promise<ImageResult> {
  const p = prompt.trim()
  if (!p) return { error: 'empty_prompt' }
  const r = await openrouterImage(p)
  if ('error' in r) return { error: r.error }
  return { id: await put(r.mime, r.buf), mime: r.mime }
}
