import { randomUUID } from 'node:crypto'
import { saveGeneratedImage, loadGeneratedImage } from '../db.js'
import { openrouterImage } from './openrouter.js'

// Generated images — persisted in the DB, with a level-1 cache in memory.
// Generation goes through OpenRouter (the same key as the brain), not through
// Gemini direct: "2 keys, period" (Adrian). See services/openrouter.ts
// openrouterImage.
interface StoredImage {
  mime: string
  buf: Buffer
  ts: number
}

const cache = new Map<string, StoredImage>()
const MAX_CACHE = 60

async function put(mime: string, buf: Buffer): Promise<string> {
  // UNGUESSABLE ID (the all-routes audit, 29 Jul). `/api/image/:id` is
  // PUBLIC — whoever knows the id sees the image. The old id was the clock
  // (predictable) plus 6 Math.random characters, which is NOT cryptographic:
  // knowing roughly when it was generated, the search space became small.
  // The screenshots (browser.ts) already used randomUUID; now the same
  // everywhere — one principle, not two standards for the same risk.
  const id = randomUUID()
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

export type ImageResult = { id: string; mime: string; costUsd: number } | { error: string }

export async function generateImage(prompt: string): Promise<ImageResult> {
  const p = prompt.trim()
  if (!p) return { error: 'empty_prompt' }
  const r = await openrouterImage(p)
  if ('error' in r) return { error: r.error }
  // The REAL cost of the generation travels WITH the image (OpenRouter's own
  // usage.cost) — the caller books exactly this, not a hand-typed flat rate.
  return { id: await put(r.mime, r.buf), mime: r.mime, costUsd: r.costUsd }
}
