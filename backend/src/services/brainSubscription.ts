import { loadKv, saveKv } from '../db.js'

// ── CREIERUL DE ABONAMENT (Adrian, 28 iul) ───────────────────────────────────
// Un COMUTATOR admin-only între două creiere:
//   • FREE        — creierul de acum (modele :free + Gemini direct, $0). Userii
//                   plătitori rămân MEREU pe ăsta; comutatorul NU-i atinge.
//   • ABONAMENT   — pe turele GRELE ale ADMINULUI (raționament/acțiune), creierul
//                   urcă pe un model puternic (Claude/GPT) plătit din CHEIA
//                   PROPRIE a ownerului (o cheie OpenRouter, cu creditul lui) —
//                   „mai multă putere unde e nevoie", fără să treacă prin punga
//                   centrală și fără să îmbogățească pe altcineva.
// Cheia trăiește DOAR pe server (kv_state), admin-only; nu se întoarce niciodată
// întreagă spre client — UI-ul primește doar prezența + ultimele 4 cifre + soldul
// (exact ca punga OpenRouter, fiindcă ESTE o cheie OpenRouter).

const KV_KEY = 'brain_subscription'

export interface BrainSub {
  mode: 'free' | 'subscription'
  /** Model OpenRouter folosit pe turele grele când modul e „abonament". */
  model: string
  /** Cheia OpenRouter proprie a ownerului (sk-or-…). Server-side, admin-only. */
  key: string
  // VOCEA PE ABONAMENT (28 iul, Adrian: „pune vocea pe abonament"). Conversația
  // LIVE (full-duplex) rulează pe OpenAI Realtime, un provider DIFERIT de
  // OpenRouter — cheia de mai sus nu poate plăti acea parte (altă companie,
  // altă factură). Cheie SEPARATĂ, opțională, pentru EXACT asta: dacă e
  // completată ȘI modul e „abonament", sesiunea de voce live pornește pe cheia
  // OpenAI proprie a ownerului, nu pe punga centrală. Fără ea, vocea rămâne pe
  // punga centrală (degradare firească, nu eroare).
  voiceKey: string
}

// Model implicit până când ownerul alege unul din catalogul live (dropdown-ul
// din Setări → Model AI). Un model puternic cu vedere + unelte; alegerea reală
// se face din listă, deci implicitul e doar sămânța.
const DEFAULT_SUB_MODEL = (process.env.BRAIN_SUB_MODEL ?? 'anthropic/claude-sonnet-5').trim()

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
