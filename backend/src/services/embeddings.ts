// SEMANTIC MEMORY (roadmap item #5; Adrian's order, 12 Jul at night:
// "memories, kelion complete and intelligent"): memories get a meaning vector
// (Gemini text-embedding-004, the same key as the STT proofreading), and
// recall finds facts by MEANING, not just by words — "what car do I have?"
// finds "Adrian drives a BMW" without a single common word.
// Best-effort everywhere: without a key or with the API down, the existing
// full-text memory stays the only one on duty — nothing breaks, nothing
// blocks the chat path (the embedding is written asynchronously, recall has
// a short timeout).

import { config } from '../config.js'

const EMBED_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent'

export function embeddingsEnabled(): boolean {
  return Boolean(config.geminiKey)
}

export async function embedText(text: string): Promise<number[] | null> {
  if (!config.geminiKey) return null
  const t = text.trim().slice(0, 6000)
  if (!t) return null
  try {
    const res = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text: t }] },
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { embedding?: { values?: number[] } }
    const v = j.embedding?.values
    return Array.isArray(v) && v.length > 0 ? v : null
  } catch {
    return null
  }
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
