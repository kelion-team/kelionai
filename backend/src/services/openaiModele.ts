import { config } from '../config.js'
import { isSubscriptionMode } from './chatgptSubscription.js'

export type TreaptaOpenAI = 'luna' | 'medium' | 'heavy'

interface CacheCatalogOpenAI {
  iduri: string[]
  expiraLa: number
  eroare: string
  sursa: string
}

// hardcod-permis: TTL-ul implicit evită o cerere /models la fiecare tură.
const TTL_CATALOG_IMPLICIT_MS = 5 * 60_000
const TTL_ESEC_IMPLICIT_MS = 15_000
let cache: CacheCatalogOpenAI | null = null
let incarcare: Promise<string[]> | null = null

function ttlCatalog(): number {
  const ttl = Number(process.env.OPENAI_CATALOG_TTL_MS)
  return Number.isFinite(ttl) && ttl > 0 ? ttl : TTL_CATALOG_IMPLICIT_MS
}

function idConfigurat(treapta: TreaptaOpenAI): string {
  return String(config.openai[treapta] || '').trim()
}

function sursaCatalog(): string {
  return `${config.openai.apiBaseUrl}\n${config.openai.key}`
}

function scrieEroare(motiv: string, sursa: string): string[] {
  console.error(`[OpenAI] nu pot verifica catalogul OpenAI: ${motiv}`)
  // O reîmprospătare eșuată nu șterge ultimul catalog verificat. Astfel o
  // întrerupere scurtă a /models nu oprește chatul, iar adminul vede eroarea.
  const iduri = cache?.sursa === sursa && cache.iduri.length ? cache.iduri : []
  cache = { iduri, expiraLa: Date.now() + TTL_ESEC_IMPLICIT_MS, eroare: motiv, sursa }
  return iduri
}

async function citesteCatalog(): Promise<string[]> {
  const apiBaseUrl = config.openai.apiBaseUrl
  const key = config.openai.key
  const sursa = `${apiBaseUrl}\n${key}`
  if (!key) return scrieEroare('cheia OpenAI lipsește', sursa)
  try {
    const raspuns = await fetch(`${apiBaseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!raspuns.ok) return scrieEroare(`API-ul a răspuns HTTP ${raspuns.status}`, sursa)
    const corp = await raspuns.json() as { data?: unknown }
    if (!Array.isArray(corp.data)) return scrieEroare('răspunsul API nu conține lista de modele', sursa)
    if (corp.data.some((model) => !model
      || typeof model !== 'object'
      || typeof (model as { id?: unknown }).id !== 'string'
      || !(model as { id: string }).id.trim())) {
      return scrieEroare('răspunsul API conține modele fără ID valid', sursa)
    }
    const iduri = Array.from(new Set(corp.data.map((model) => (
      model as { id: string }
    ).id.trim())))
    cache = { iduri, expiraLa: Date.now() + ttlCatalog(), eroare: '', sursa }
    return iduri
  } catch (eroare) {
    const motiv = eroare instanceof Error ? eroare.message : String(eroare)
    return scrieEroare(motiv || 'eroare necunoscută', sursa)
  }
}

function pornesteCitirea(): Promise<string[]> {
  if (incarcare) return incarcare
  const cerere = citesteCatalog().catch((eroare) => {
    const motiv = eroare instanceof Error ? eroare.message : String(eroare)
    return scrieEroare(motiv || 'eroare necunoscută', sursaCatalog())
  })
  incarcare = cerere
  void cerere.finally(() => {
    if (incarcare === cerere) incarcare = null
  }).catch(() => {})
  return cerere
}

/**
 * Citește catalogul servit cheii proiectului și îl ține în cache.
 * Un catalog necitibil nu este înlocuit cu un model ghicit.
 */
export async function catalogOpenAI(): Promise<string[]> {
  if (cache?.sursa !== sursaCatalog()) cache = null
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

/** Forțează o citire live; cererile concurente împart aceeași încărcare. */
export async function reimprospateazaCatalogOpenAI(): Promise<string[]> {
  return pornesteCitirea()
}

/** Motivul ultimei citiri eșuate, fără o nouă cerere de rețea. */
export function motivCatalogOpenAI(): string {
  return cache?.eroare ?? ''
}

/** Modelul configurat pentru rol este folosit numai dacă cheia îl servește.
 *  În modul abonament (fără cheie API), catalogul nu se poate verifica prin
 *  /models, deci trustăm modelele configurate din .env. */
export async function modelOpenAI(treapta: TreaptaOpenAI): Promise<string> {
  const model = idConfigurat(treapta)
  if (!model) return ''
  // Modul abonament: fără catalog /models, trustăm config-ul
  if (isSubscriptionMode()) return model
  const exista = (await catalogOpenAI()).includes(model)
  if (!exista) console.error(`[OpenAI] modelul configurat pentru ${treapta} nu există în catalog`)
  return exista ? model : ''
}

/** Scara stabilă Luna → Terra → Sol, filtrată prin catalogul live.
 *  În modul abonament, trustăm config-ul (fără verificare catalog). */
export async function scaraOpenAI(): Promise<string[]> {
  const configurate = ([idConfigurat('luna'), idConfigurat('medium'), idConfigurat('heavy')])
    .filter((id, index, toate): id is string => Boolean(id)
      && toate.indexOf(id) === index)
  if (isSubscriptionMode()) return configurate
  const iduri = await catalogOpenAI()
  return configurate.filter((id) => iduri.includes(id))
}

export async function modelOpenAIExista(id: string): Promise<boolean> {
  const curat = String(id || '').trim().replace(/^openai\//i, '')
  if (!curat) return false
  // Modul abonament: trustăm config-ul
  if (isSubscriptionMode()) return true
  return (await catalogOpenAI()).includes(curat)
}
