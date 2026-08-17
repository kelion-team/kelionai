// ── PROBA OLLAMA — creierul LOCAL al constructorului, verificat pe VPS (owner,
// 16 aug: „aider pe un model LOCAL pe VPS (Ollama)… verifică dacă nu e deja pus
// pe serverul linux"). Nu ghicim dacă Ollama e pe server — îl întrebăm DIRECT.
//
// FIX 16 aug (becul mincinos „🔴 Ollama LIPSĂ pe VPS (spawn ollama ENOENT)"):
// proba veche rula CLI-ul `ollama list` ÎN CONTAINERUL aplicației, unde binarul
// `ollama` nu e instalat → `spawn ollama ENOENT` → becul striga FALS „Ollama
// LIPSĂ pe VPS", deși Ollama rula pe HOST lângă aider (dovadă: ordinul #370 a
// construit 18 min pe exact acel model local — imposibil dacă Ollama lipsea).
// Exact tiparul interzis de regula #1: o citire PICATĂ prezentată ca fapt.
// Containerul rulează pe `--network host` (așa atinge și Postgres pe 127.0.0.1),
// deci întrebăm Ollama de pe HOST prin API-ul lui HTTP (`/api/tags`, ce listează
// modelele instalate) — MĂSURĂTOARE reală a serverului, nu o presupunere despre
// container. Cache 10 min, ca la proba browserului/Aider.
const PROBA_MS = 10 * 60_000
const BASE = (process.env.OLLAMA_API_BASE || 'http://127.0.0.1:11434').replace(/\/+$/, '')
let cache: { la: number; ok: boolean; modele: string[]; motiv: string } | null = null

export async function probaOllama(): Promise<{ ok: boolean; modele: string[]; motiv: string }> {
  if (cache && Date.now() - cache.la < PROBA_MS) return cache
  try {
    // `/api/tags` = ce modele are Ollama instalate; 200 + JSON dacă serviciul e VIU
    // pe host. (Ajunge la host prin --network host, ca Postgres pe 127.0.0.1.)
    const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(15_000) })
    if (!r.ok) {
      cache = { la: Date.now(), ok: false, modele: [], motiv: `Ollama pe host a răspuns HTTP ${r.status} la ${BASE}/api/tags` }
      return cache
    }
    const j = (await r.json().catch(() => ({}))) as { models?: Array<{ name?: string; model?: string }> }
    const modele = Array.isArray(j?.models)
      ? j.models.map((m) => String(m?.name || m?.model || '').trim()).filter(Boolean)
      : []
    cache = { la: Date.now(), ok: true, modele, motiv: '' }
  } catch (e) {
    cache = { la: Date.now(), ok: false, modele: [], motiv: `Ollama nu răspunde pe host (${BASE}): ${String((e as Error)?.message ?? e).slice(0, 120)}` }
  }
  return cache
}

/** Testele nu moștenesc cache-ul unui alt test (proba are memorie 10 min). */
export function _resetProbaOllama(): void {
  cache = null
}
