// MEMORIA SEMANTICĂ (foaia de parcurs #5; ordinul lui Adrian, 12 iul noaptea:
// „memorii, kelion complet și inteligent"): amintirile primesc un vector de
// înțeles (Gemini text-embedding-004, aceeași cheie ca la corectarea STT), iar
// recall-ul găsește faptele după SENS, nu doar după cuvinte — „ce mașină am?"
// găsește „Adrian conduce un BMW" fără niciun cuvânt comun.
// Best-effort peste tot: fără cheie sau cu API-ul căzut, memoria full-text
// existentă rămâne singură la datorie — nimic nu se strică, nimic nu blochează
// calea chatului (embedding-ul se scrie asincron, recall-ul are timeout scurt).

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
