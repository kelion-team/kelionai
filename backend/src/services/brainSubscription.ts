import { loadKv, saveKv } from '../db.js'
import { DEFAULT_CLAUDE_MODEL } from './anthropicDirect.js'

// ── CREIERUL DE ABONAMENT (Adrian, 28 iul) ───────────────────────────────────
// Un COMUTATOR admin-only între două creiere:
//   • FREE        — creierul de acum (modele :free + Gemini direct, $0). Userii
//                   plătitori rămân MEREU pe ăsta; comutatorul NU-i atinge.
//   • ABONAMENT   — pe turele GRELE ale ADMINULUI (raționament/acțiune), creierul
//                   urcă pe un model puternic CLAUDE, plătit DIRECT din CHEIA
//                   PROPRIE a ownerului de la consola Anthropic (sk-ant-…, cu
//                   creditul lui) — „mai multă putere unde e nevoie", fără punga
//                   centrală și fără OpenRouter (Adrian, 28 iul: „la ab trebuie
//                   de la cloude nu openrouter"; cheia lui era respinsă de
//                   OpenRouter cu 401). Apelul merge la api.anthropic.com direct.
// Cheia trăiește DOAR pe server (kv_state), admin-only; nu se întoarce niciodată
// întreagă spre client — UI-ul primește doar prezența + ultimele 4 cifre + dacă
// e validă (Anthropic n-are un endpoint public de sold rămas ca OpenRouter).

const KV_KEY = 'brain_subscription'

export interface BrainSub {
  mode: 'free' | 'subscription'
  /** Model CLAUDE (id API Anthropic, ex. claude-sonnet-5) pe turele grele. */
  model: string
  /** Cheia Anthropic proprie a ownerului (sk-ant-…). Server-side, admin-only. */
  key: string
  // VOCEA PE ABONAMENT (28 iul, Adrian: „pune vocea pe abonament"). Conversația
  // LIVE (full-duplex) rulează pe OpenAI Realtime, un provider DIFERIT de
  // Anthropic — cheia Claude de mai sus nu poate plăti acea parte (altă
  // companie, altă factură). Cheie SEPARATĂ, opțională, pentru EXACT asta: dacă e
  // completată ȘI modul e „abonament", sesiunea de voce live pornește pe cheia
  // OpenAI proprie a ownerului, nu pe punga centrală. Fără ea, vocea rămâne pe
  // punga centrală (degradare firească, nu eroare).
  voiceKey: string
}

// Model implicit până când ownerul alege unul din lista Claude (dropdown-ul din
// Setări → Creier abonament). Un model Claude cu vedere + unelte; alegerea reală
// se face din listă, deci implicitul e doar sămânța.
const DEFAULT_SUB_MODEL = (process.env.BRAIN_SUB_MODEL ?? DEFAULT_CLAUDE_MODEL).trim()

export function parseBrainSub(raw: string | null | undefined): BrainSub {
  const fallback: BrainSub = { mode: 'free', model: DEFAULT_SUB_MODEL, key: '', voiceKey: '' }
  if (!raw) return fallback
  try {
    const p = JSON.parse(raw) as Partial<BrainSub>
    return {
      mode: p.mode === 'subscription' ? 'subscription' : 'free',
      model: typeof p.model === 'string' && p.model.trim() ? p.model.trim() : DEFAULT_SUB_MODEL,
      key: typeof p.key === 'string' ? p.key.trim() : '',
      voiceKey: typeof p.voiceKey === 'string' ? p.voiceKey.trim() : '',
    }
  } catch {
    return fallback
  }
}

// Cache scurt DOAR pentru rutele admin (GET/POST). Calea de chat citește KV-ul
// proaspăt în Promise.all-ul turei (via parseBrainSub), ca o comutare să fie
// vizibilă din prima replică următoare — fără cache agățat.
let cache: { at: number; val: BrainSub } | null = null
const TTL_MS = 15_000

export async function loadBrainSub(force = false): Promise<BrainSub> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.val
  const val = parseBrainSub(await loadKv(KV_KEY).catch(() => null))
  cache = { at: Date.now(), val }
  return val
}

export async function saveBrainSub(patch: Partial<BrainSub>): Promise<BrainSub> {
  const cur = await loadBrainSub(true)
  const next: BrainSub = {
    mode: patch.mode === 'subscription' || patch.mode === 'free' ? patch.mode : cur.mode,
    model: typeof patch.model === 'string' && patch.model.trim() ? patch.model.trim() : cur.model,
    // key/voiceKey: undefined → păstrează; '' → șterge explicit; string → setează.
    key: patch.key === undefined ? cur.key : String(patch.key).trim(),
    voiceKey: patch.voiceKey === undefined ? cur.voiceKey : String(patch.voiceKey).trim(),
  }
  await saveKv(KV_KEY, JSON.stringify(next))
  cache = { at: Date.now(), val: next }
  return next
}

/**
 * Creierul de abonament e ACTIV pentru tura curentă doar dacă: modul e
 * „abonament", există o cheie, ȘI cel care întreabă e ADMINUL. Userii plătitori
 * nu ating niciodată cheia/creditul ownerului.
 */
export function subActive(sub: BrainSub, isAdmin: boolean): boolean {
  return isAdmin && sub.mode === 'subscription' && sub.key.length > 0 && sub.model.length > 0
}

/**
 * Vocea pe abonament (28 iul): la fel ca subActive, dar pentru cheia OpenAI
 * separată — conversația live pornește pe cheia proprie a ownerului DOAR dacă
 * modul e „abonament" ȘI cheia OpenAI a fost completată. Fără ea, degradare
 * firească pe punga centrală (nu eroare).
 */
export function voiceSubActive(sub: BrainSub, isAdmin: boolean): boolean {
  return isAdmin && sub.mode === 'subscription' && sub.voiceKey.length > 0
}
