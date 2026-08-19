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

// ── DECIZIA free/plătit PENTRU HOST-UL CONSTRUCTORULUI (pură, PROBABILĂ) ──────
// Extrasă din ruta /api/constructor/creier-config ca să fie testată pe FIECARE
// combinație (owner, 19 aug: „asigură-te că orice mod de comutare free/plătit,
// identic la creier, funcționează real, inclusiv între ele — aștept dovezile").
// Comportament IDENTIC cu ruta: FREE-FIRST (pornește free), paid e REZERVĂ doar
// când e gata (creier cloud ales + cheie + model); `constructorSursa='platit'`
// forțează paid explicit DACĂ rezerva e gata. Pe Gemini nu există model cloud →
// rămâne free (nu inventează un paid imposibil). Cheia merge întreagă DOAR pe
// canalul autentificat (host); în diagnostic se dă doar coada mascată.
export interface RezervaPlatit {
  sursa: 'platit'
  model: string
  base: string
  cheie: string
  cheieCoada: string
}
export interface ConfigConstructorHost {
  sursa: SursaConstructor // sursa de START a run-ului (free-first, except forțare panou)
  preferred: 'free'
  fallback: RezervaPlatit | null // rezerva paid, dacă e gata (fără a o porni)
  model: string // compat worker vechi: ce folosește DACĂ e pe platit ACUM
  base: string
  cheie: string
  paidDisponibil: boolean // rezerva paid e disponibilă?
}
export function decideConfigConstructor(cfg: ConfigCreier, cheie: string): ConfigConstructorHost {
  const modelCloud = tagModelCloud(cfg.creier2)
  const paidGata = cfg.creier2 !== 'gemini' && !!cheie && !!modelCloud
  const fortatPlatit = cfg.constructorSursa === 'platit' && paidGata
  return {
    sursa: fortatPlatit ? 'platit' : 'free',
    preferred: 'free',
    fallback: paidGata
      ? { sursa: 'platit', model: modelCloud, base: bazaOllamaCloud(), cheie, cheieCoada: cheie.length > 8 ? `…${cheie.slice(-4)}` : 'set' }
      : null,
    model: fortatPlatit ? modelCloud : '',
    base: fortatPlatit ? bazaOllamaCloud() : '',
    cheie: fortatPlatit ? cheie : '',
    paidDisponibil: paidGata,
  }
}

let cacheProba: { la: number; ok: boolean; motiv: string; modele: string[] } | null = null
/** PROBA REALĂ: cheia chiar POATE RULA pe Ollama cloud modelul ales? Măsurat cu o
 *  cerere minimă `POST /v1/chat/completions` (max_tokens 1) — NU `GET /v1/models`,
 *  care e PUBLIC (măsurat 16 aug: răspunde 200 și FĂRĂ cheie, deci nu dovedește
 *  nimic despre cheie). Interpretăm codul HTTP, măsurat, nu presupus:
 *   • 200 → cheia merge ȘI modelul ales rulează pe planul tău.
 *   • 401 → cheia e invalidă (moartă/rotită) — refă cheia pe ollama.com.
 *   • 402 → cheia e bună, dar modelul cere „extra usage" (nu-i inclus în plan;
 *           balanța de extra usage e 0) — ex. kimi-k3 (măsurat 16 aug).
 *  Probăm exact modelul pe care-l alege ownerul la creier 2 (dacă e cloud); dacă
 *  e pe Gemini, probăm un model inclus doar ca să validăm cheia. Cache 5 min. */
export async function probaOllamaCloud(): Promise<{ ok: boolean; motiv: string; modele: string[] }> {
  if (cacheProba && Date.now() - cacheProba.la < PROBA_MS) return cacheProba
  const cheie = await getCheieOllama()
  if (!cheie) {
    cacheProba = { la: Date.now(), ok: false, motiv: 'nicio cheie Ollama pusă', modele: [] }
    return cacheProba
  }
  const cfg = await getConfigCreier()
  const model = tagModelCloud(cfg.creier2) || MODELE_CLOUD['qwen3.5']
  try {
    const r = await fetch(`${bazaOllamaCloud()}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cheie}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(12_000),
    })
    if (r.status === 200) {
      // Modelul pe care Ollama ÎL CONFIRMĂ că a servit (câmpul `model` din răspunsul
      // lui) — dovada că rulează EXACT modelul ales, nu unul „de sub" el (owner, 16
      // aug: „vreau sa vad clar ca daca comut kimi 3 foloseste kimi 3"). Dacă Ollama
      // n-a întors câmpul, cădem pe cel cerut (tot cel ales).
      const j = (await r.json().catch(() => null)) as { model?: string } | null
      const confirmat = String(j?.model || model)
      cacheProba = { la: Date.now(), ok: true, motiv: '', modele: [confirmat] }
      return cacheProba
    }
    if (r.status === 401) {
      cacheProba = { la: Date.now(), ok: false, motiv: 'cheie invalidă (401) — refă cheia pe ollama.com', modele: [] }
      return cacheProba
    }
    if (r.status === 402) {
      cacheProba = { la: Date.now(), ok: false, motiv: `cheia e bună, dar „${model}" cere extra usage (nu-i în plan) — alege un model inclus sau pune bani`, modele: [model] }
      return cacheProba
    }
    const txt = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 140)
    cacheProba = { la: Date.now(), ok: false, motiv: `HTTP ${r.status} de la Ollama cloud: ${txt}`, modele: [] }
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
