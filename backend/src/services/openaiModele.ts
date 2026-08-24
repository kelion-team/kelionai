import { config } from '../config.js'
import { OPENAI_BASE } from './openaiChat.js'

export type TreaptaOpenAI = 'luna' | 'medium' | 'heavy' | 'max'

export interface RangModelOpenAI {
  generatie: number
  talie: number
}

export interface ScaraModeleOpenAI {
  luna: string
  medium: string
  heavy: string
  max: string
}

interface CacheCatalogOpenAI {
  iduri: string[]
  expiraLa: number
  eroare: string
}

// hardcod-permis: TTL-ul implicit ține catalogul proaspăt fără rețea la fiecare tură;
// operatorul îl poate regla prin OPENAI_CATALOG_TTL_MS.
const TTL_CATALOG_IMPLICIT_MS = 5 * 60_000
const TTL_ESEC_IMPLICIT_MS = 15_000
let cache: CacheCatalogOpenAI | null = null
let incarcare: Promise<string[]> | null = null

function ttlCatalog(): number {
  const ttl = Number(process.env.OPENAI_CATALOG_TTL_MS)
  return Number.isFinite(ttl) && ttl > 0 ? ttl : TTL_CATALOG_IMPLICIT_MS
}

function scrieEroare(motiv: string, ttl: number): string[] {
  console.error(`[OpenAI] nu pot verifica catalogul OpenAI: ${motiv}`)
  cache = { iduri: [], expiraLa: Date.now() + ttl, eroare: motiv }
  return []
}

async function citesteCatalog(): Promise<string[]> {
  if (!config.openai?.key) return scrieEroare('cheia OpenAI lipsește', TTL_ESEC_IMPLICIT_MS)
  try {
    const raspuns = await fetch(`${OPENAI_BASE}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.openai.key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!raspuns.ok) return scrieEroare(`API-ul a răspuns HTTP ${raspuns.status}`, TTL_ESEC_IMPLICIT_MS)
    const corp = await raspuns.json() as { data?: unknown }
    if (!Array.isArray(corp.data)) return scrieEroare('răspunsul API nu conține lista de modele', TTL_ESEC_IMPLICIT_MS)
    if (corp.data.some((model) => !model || typeof model !== 'object' || typeof (model as { id?: unknown }).id !== 'string' || !(model as { id: string }).id.trim())) {
      return scrieEroare('răspunsul API conține modele fără ID valid', TTL_ESEC_IMPLICIT_MS)
    }
    const iduri = corp.data
      .map((model) => (model && typeof model === 'object' ? (model as { id?: unknown }).id : null))
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      .map((id) => id.trim())
    cache = { iduri, expiraLa: Date.now() + ttlCatalog(), eroare: '' }
    return iduri
  } catch (eroare) {
    const motiv = eroare instanceof Error ? eroare.message : String(eroare)
    return scrieEroare(motiv || 'eroare necunoscută', TTL_ESEC_IMPLICIT_MS)
  }
}

function pornesteCitirea(): Promise<string[]> {
  if (incarcare) return incarcare
  const cerere = citesteCatalog().catch((eroare) => {
    const motiv = eroare instanceof Error ? eroare.message : String(eroare)
    return scrieEroare(motiv || 'eroare necunoscută', TTL_ESEC_IMPLICIT_MS)
  })
  incarcare = cerere
  void cerere.finally(() => {
    if (incarcare === cerere) incarcare = null
  }).catch(() => {})
  return cerere
}

/**
 * Citește catalogul servit de cheia OpenAI și îl ține în cache.
 * Un catalog necitibil nu este înlocuit cu un model ghicit.
 */
export async function catalogOpenAI(): Promise<string[]> {
  if (cache) {
    if (Date.now() < cache.expiraLa) return cache.iduri
    if (cache.iduri.length > 0) {
      const catalogVechi = cache.iduri
      void pornesteCitirea()
      return catalogVechi
    }
  }
  return pornesteCitirea()
}

/** Motivul ultimei citiri eșuate, fără o nouă cerere de rețea. */
export function motivCatalogOpenAI(): string {
  return cache?.eroare ?? ''
}

export function esteModelChatOpenAI(id: string): boolean {
  const cod = String(id || '').trim().toLowerCase()
  if (!/^(?:gpt-\d+(?:\.\d+)?|o\d+(?:\.\d+)?|chatgpt-)/i.test(cod)) return false
  return !/(?:embedding|tts|whisper|transcrib|audio|realtime|image|dall[-_]e|moderation|video|guardrail|search|index|type|rerank|safety)/i.test(cod)
}

export function rangModelOpenAI(id: string): RangModelOpenAI {
  const cod = String(id || '').toLowerCase()
  const numeric = cod.match(/\d+(?:\.\d+)?/)
  const generatie = numeric ? Number(numeric[0]) : 0
  const talie = /(?:^|[-_])nano(?:$|[-_])/i.test(cod)
    ? 1
    : /(?:^|[-_])mini(?:$|[-_])/i.test(cod)
      ? 2
      : /(?:^|[-_])(?:pro|max|ultra)(?:$|[-_])/i.test(cod)
        ? (/ultra/i.test(cod) ? 6 : /max/i.test(cod) ? 5 : 4)
        : 3
  return { generatie, talie }
}

function candidatiCatalog(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(esteModelChatOpenAI)))
    .sort((a, b) => {
      const rangA = rangModelOpenAI(a)
      const rangB = rangModelOpenAI(b)
      return rangB.generatie - rangA.generatie || rangB.talie - rangA.talie || a.localeCompare(b)
    })
}

/**
 * Alege patru trepte din cea mai nouă generație disponibilă.
 * Dacă sunt mai puține de patru talii, treptele se strâng pe rândurile existente;
 * aceeași regulă și ordinea lexicografică fac alegerea deterministă.
 */
export function clasificaCatalogOpenAI(ids: string[]): ScaraModeleOpenAI {
  const candidati = candidatiCatalog(ids)
  if (!candidati.length) return { luna: '', medium: '', heavy: '', max: '' }
  const generatieNoua = rangModelOpenAI(candidati[0]).generatie
  const peTalie = new Map<number, string>()
  for (const id of candidati.filter((cod) => rangModelOpenAI(cod).generatie === generatieNoua)) {
    const rang = rangModelOpenAI(id)
    if (!peTalie.has(rang.talie) || id.localeCompare(peTalie.get(rang.talie) ?? '') < 0) peTalie.set(rang.talie, id)
  }
  const rungs = Array.from(peTalie.entries()).sort(([a], [b]) => a - b).map(([, id]) => id)
  const index = (fraction: number): number => Math.round((rungs.length - 1) * fraction)
  return {
    luna: rungs[0] ?? '',
    medium: rungs[index(1 / 3)] ?? rungs[0] ?? '',
    heavy: rungs[index(2 / 3)] ?? rungs[0] ?? '',
    max: rungs[rungs.length - 1] ?? '',
  }
}

export async function modelOpenAI(treapta: TreaptaOpenAI): Promise<string> {
  const ids = await catalogOpenAI()
  const scara = clasificaCatalogOpenAI(ids)
  const override = config.openai?.override?.[treapta]?.trim() ?? ''
  if (override) {
    const gasit = ids.some((id) => id === override)
    if (gasit) return override
    console.error(`[OpenAI] suprascrierea pentru ${treapta} nu există în catalog; folosesc alegerea live`)
  }
  return scara[treapta]
}

export async function scaraOpenAI(): Promise<string[]> {
  const scara = await catalogOpenAI().then(clasificaCatalogOpenAI)
  return [scara.luna, scara.medium, scara.heavy, scara.max].filter(
    (id, index, toate): id is string => Boolean(id) && toate.indexOf(id) === index,
  )
}

export async function modelOpenAIExista(id: string): Promise<boolean> {
  const curat = String(id || '').trim().replace(/^openai\//i, '')
  if (!curat) return false
  return (await catalogOpenAI()).includes(curat)
}

export function reseteazaCatalogOpenAI(): void {
  cache = null
  incarcare = null
}
