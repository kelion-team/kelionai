// SEMANTIC MEMORY (roadmap item #5; Adrian's order, 12 Jul at night:
// "memories, kelion complete and intelligent"): memories get a meaning vector
// (OpenAI text-embedding-3-small), and
// recall finds facts by MEANING, not just by words — "what car do I have?"
// finds "Adrian drives a BMW" without a single common word.
// Best-effort everywhere: without a key or with the API down, the existing
// full-text memory stays the only one on duty — nothing breaks, nothing
// blocks the chat path (the embedding is written asynchronously, recall has
// a short timeout).

import { config } from '../config.js'

const EMBED_URL = 'https://api.openai.com/v1/embeddings'
const EMBED_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'

export function embeddingsEnabled(): boolean {
  return Boolean(config.openai.key)
}

export async function embedText(text: string): Promise<number[] | null> {
  if (!config.openai.key) return null
  const t = text.trim().slice(0, 6000)
  if (!t) return null
  try {
    const res = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openai.key}` },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: t,
        encoding_format: 'float',
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { data?: Array<{ embedding?: number[] }> }
    const v = j.data?.[0]?.embedding
    return Array.isArray(v) && v.length > 0 ? v : null
  } catch {
    return null
  }
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  // Vectors from the retired embedding model can remain in old rows. Mixed
  // dimensions are not comparable; return no match until those rows are
  // re-embedded instead of producing a plausible but meaningless score.
  if (a.length === 0 || a.length !== b.length) return 0
  const n = a.length
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
