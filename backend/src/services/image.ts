import { randomUUID } from 'node:crypto'
import { saveGeneratedImage, loadGeneratedImage } from '../db.js'
import { geminiImage } from './geminiDirect.js'

// Generated images — persisted in the DB, with a level-1 cache in memory.
// Generation runs on the owner's Gemini key (Adrian, 3 aug: OpenRouter removed
// entirely) — Imagen, then the Gemini image model. See services/geminiDirect.ts
// geminiImage.
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
  const r = await geminiImage(p)
  if ('error' in r) return { error: r.error }
  // The cost travels WITH the image (geminiImage reports 0 — Google's key
  // meters no per-call cost here). The caller books exactly this figure, never
  // a hand-typed flat rate.
  return { id: await put(r.mime, r.buf), mime: r.mime, costUsd: r.costUsd }
}
