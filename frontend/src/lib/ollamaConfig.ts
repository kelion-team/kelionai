// ── CONFIG OLLAMA DIN SERVER (owner, 22 aug 2026: LEGEA ANTI-HARDCODARE) ─────
//
// Numele modelului + digest-ul cerut VIN DIN SERVER (env), nu hardcodate în
// frontend. Frontend-ul fetch-uiește /api/ollama/config la pornire.

export interface OllamaConfig {
  model: string
  digestCerut: string // gol = nu verificăm digest, doar prezență
}

let configCache: OllamaConfig | null = null

/** Configul Ollama de la server (model + digest + gazdă VPS). */
export async function getOllamaConfig(): Promise<OllamaConfig> {
  if (configCache) return configCache
  try {
    const r = await fetch('/api/ollama/config', { cache: 'no-store' })
    if (r.ok) {
      configCache = (await r.json()) as OllamaConfig
      return configCache
    }
  } catch { /* offline — fallback */ }
  // Fallback: nu putem face nimic fără server
  configCache = { model: '', digestCerut: '' }
  return configCache
}
