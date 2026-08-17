// FREE-FIRST + PAID DOAR REZERVĂ (owner 17 aug)
// Default: free local. Paid se aprinde DOAR în același run, pe eșec real,
// dacă există cheie+model cloud. Fără abonament „pornit degeaba”.
// Aceeași LEGE pe constructor ȘI pe creier (chat/work): free/preferred first,
// paid = fallback la eșec măsurat — nu drum principal.

export type MotivEscaladare =
  | 'free_indisponibil'
  | 'timeout_throttle'
  | 'no_change'
  | 'calitate'
  | ''

export interface DecizieEscaladareIn {
  /** Deja pe free în run-ul curent. */
  peFree: boolean
  /** Există model cloud + cheie pentru rezervă. */
  paidDisponibil: boolean
  /** Free a eșuat cu motiv clasificat sau text brut. */
  motivFree: MotivEscaladare | string
}

export interface DecizieEscaladareOut {
  escaladeaza: boolean
  sursaUrmatoare: 'free' | 'platit'
  motiv: string
  brainRaport: 'free_local' | 'paid_cloud'
}

const MOTIVE_OK = new Set<string>([
  'free_indisponibil',
  'timeout_throttle',
  'no_change',
  'calitate',
  'context_overflow',
  'no_edit',
  'throttled',
  'openrouter_auth',
])

/** Clasifică textul de eșec free → motiv scurt (pentru jurnal + decizie). */
export function clasificaEsecFree(text: string): MotivEscaladare {
  const t = String(text || '')
  if (/creier local|ollama.*indispon|aider.*lips|enoent|econnrefused.*11434/i.test(t)) {
    return 'free_indisponibil'
  }
  if (/429|rate.?limit|timeout|throttl|sugrumat|RESOURCE_?EXHAUSTED|overload|econnreset/i.test(t)) {
    return 'timeout_throttle'
  }
  if (/no_edit|n-a modificat|no-change|no change|context_overflow|token limit/i.test(t)) {
    return 'no_change'
  }
  if (/failed|eșuat|esuat|build.*picat|teste.*roș|poart/i.test(t)) {
    return 'calitate'
  }
  return ''
}

function normalizeazaMotiv(raw: string): string {
  const m = String(raw || '').trim()
  if (!m) return ''
  if (MOTIVE_OK.has(m)) return m
  return clasificaEsecFree(m)
}

/**
 * Decizie PURĂ: sărim pe paid în același run?
 * - doar dacă suntem pe free
 * - doar dacă paid e disponibil (cheie+model)
 * - doar pe motive reale (nu „mi se pare greu”)
 */
export function decideEscaladareConstructor(i: DecizieEscaladareIn): DecizieEscaladareOut {
  if (!i.peFree) {
    return { escaladeaza: false, sursaUrmatoare: 'platit', motiv: 'deja_platit', brainRaport: 'paid_cloud' }
  }
  if (!i.paidDisponibil) {
    return { escaladeaza: false, sursaUrmatoare: 'free', motiv: 'paid_indisponibil', brainRaport: 'free_local' }
  }
  const motiv = normalizeazaMotiv(i.motivFree)
  if (!motiv) {
    return { escaladeaza: false, sursaUrmatoare: 'free', motiv: 'motiv_insuficient', brainRaport: 'free_local' }
  }
  return {
    escaladeaza: true,
    sursaUrmatoare: 'platit',
    motiv,
    brainRaport: 'paid_cloud',
  }
}

/** Normalizare motiv pentru API/agent. */
export function motivEscaladareDinEsec(text: string): MotivEscaladare {
  return clasificaEsecFree(text)
}
