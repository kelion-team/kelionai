// ── CREIERUL CLOUD (Ollama) — configul + cheia + proba ───────────────────────
// Owner, 16 aug: „ramine chatul live gemeni… creier 2 → un model cloud puternic
// (Kimi K3 cu comutator Qwen3.5 Max)… constructor = comutator FREE (local pe VPS)
// ↔ PLĂTIT (același model ca creier 2)… un abonament $20/lună acoperă amândouă".
//
// AICI stă starea PE CARE O ALEGE OWNERUL din panou (nu hardcodat): ce model cloud
// e creierul 2, dacă constructorul merge FREE (local) sau PLĂTIT (cloud), și cheia
// Ollama. Totul în kv (admin scrie, bridge/host citește). Proba verifică MĂSURAT
// dacă cheia chiar funcționează pe serverele Ollama — nu „cred că e validă".
import { loadKv, saveKv } from '../db.js'

const KV_CONFIG = 'creier:cloud'
const KV_CHEIE = 'ollama:cheie'
const PROBA_MS = 5 * 60_000

// Modelele cloud oferite în comutator (owner: Kimi K3 ↔ Qwen3.5 Max). Numele =
// tag-ul real de pe Ollama cloud. Suprascriabil din env dacă Ollama redenumește.
export const MODELE_CLOUD = {
  'kimi-k3': process.env.OLLAMA_MODEL_KIMI || 'kimi-k3',
  'qwen3.5': process.env.OLLAMA_MODEL_QWEN || 'qwen3.5:397b',
} as const
export type ModelCreier2 = 'gemini' | keyof typeof MODELE_CLOUD
export type SursaConstructor = 'free' | 'platit'

export interface ConfigCreier {
  creier2: ModelCreier2 // 'gemini' (implicit) sau modelul cloud ales
  constructorSursa: SursaConstructor // 'free' = local pe VPS; 'platit' = același model ca creier2 pe cloud
}

const IMPLICIT: ConfigCreier = { creier2: 'gemini', constructorSursa: 'free' }

/** Baza API a Ollama cloud (suprascriabilă din env dacă diferă). */
export function bazaOllamaCloud(): string {
  return (process.env.OLLAMA_CLOUD_BASE || 'https://ollama.com').replace(/\/+$/, '')
}

export async function getConfigCreier(): Promise<ConfigCreier> {
  try {
    const raw = await loadKv(KV_CONFIG)
    if (!raw) return { ...IMPLICIT }
    const p = JSON.parse(raw) as Partial<ConfigCreier>
    const creier2: ModelCreier2 = p.creier2 === 'kimi-k3' || p.creier2 === 'qwen3.5' ? p.creier2 : 'gemini'
    const constructorSursa: SursaConstructor = p.constructorSursa === 'platit' ? 'platit' : 'free'
    return { creier2, constructorSursa }
  } catch {
    return { ...IMPLICIT }
  }
}

export async function setConfigCreier(c: Partial<ConfigCreier>): Promise<ConfigCreier> {
  const acum = await getConfigCreier()
  const nou: ConfigCreier = {
    creier2: c.creier2 === 'kimi-k3' || c.creier2 === 'qwen3.5' || c.creier2 === 'gemini' ? c.creier2 : acum.creier2,
    constructorSursa: c.constructorSursa === 'platit' || c.constructorSursa === 'free' ? c.constructorSursa : acum.constructorSursa,
  }
  await saveKv(KV_CONFIG, JSON.stringify(nou))
  return nou
}

/** Cheia Ollama a ownerului. Setată din panou (admin), citită de host (bridge). */
export async function getCheieOllama(): Promise<string> {
  return (await loadKv(KV_CHEIE).catch(() => null)) || process.env.OLLAMA_API_KEY || ''
}
export async function setCheieOllama(cheie: string): Promise<void> {
  await saveKv(KV_CHEIE, String(cheie || '').trim())
}

/** Tag-ul de model cloud pentru o alegere de creier2 (gemini → ''). */
export function tagModelCloud(creier2: ModelCreier2): string {
  return creier2 === 'kimi-k3' || creier2 === 'qwen3.5' ? MODELE_CLOUD[creier2] : ''
}

let cacheProba: { la: number; ok: boolean; motiv: string; modele: string[] } | null = null
/** PROBA: cheia chiar merge pe Ollama cloud? Măsurat (GET /v1/models cu Bearer),
 *  nu presupus. Cache 5 min. Fără cheie → ok:false, motiv clar. */
export async function probaOllamaCloud(): Promise<{ ok: boolean; motiv: string; modele: string[] }> {
  if (cacheProba && Date.now() - cacheProba.la < PROBA_MS) return cacheProba
  const cheie = await getCheieOllama()
  if (!cheie) {
    cacheProba = { la: Date.now(), ok: false, motiv: 'nicio cheie Ollama pusă', modele: [] }
    return cacheProba
  }
  try {
    const r = await fetch(`${bazaOllamaCloud()}/v1/models`, {
      headers: { Authorization: `Bearer ${cheie}` },
      signal: AbortSignal.timeout(12_000),
    })
    if (!r.ok) {
      cacheProba = { la: Date.now(), ok: false, motiv: `HTTP ${r.status} de la Ollama cloud`, modele: [] }
      return cacheProba
    }
    const j = (await r.json().catch(() => null)) as { data?: { id?: string }[] } | null
    const modele = Array.isArray(j?.data) ? j!.data.map((m) => String(m?.id ?? '')).filter(Boolean) : []
    cacheProba = { la: Date.now(), ok: true, motiv: '', modele }
    return cacheProba
  } catch (e) {
    cacheProba = { la: Date.now(), ok: false, motiv: String((e as Error)?.message ?? e).slice(0, 180), modele: [] }
    return cacheProba
  }
}

/** Testele nu moștenesc cache-ul probei. */
export function _resetProbaOllamaCloud(): void {
  cacheProba = null
}
