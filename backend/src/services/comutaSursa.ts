// ── COMUTAREA SURSEI din CHAT (owner, 19 aug) ────────────────────────────────
// „vreau să-i cer în chat vorbit sau scris lui Kelion să comute pe free creier și
//  free constructor sau combinații, sau când eu nu sunt să decidă autonom."
//
// Până acum comutarea creier2 (gemini/kimi/qwen) + constructor (free↔plătit) se
// scria DOAR din panou. Creierul din chat n-avea nicio unealtă — deci nici din
// scris, nici din voce nu putea face „comută pe free". Aici stă NUCLEUL PUR al
// comutării: traduce cererea omului în config + decide autonom când ownerul
// lipsește (cost-safe: free-first, nu ardem bani fără el). Scrierea reală și
// prezența ownerului vin ca dependențe injectate (testabil, fără kv/WS în teste).

import type { ConfigCreier, ModelCreier2, SursaConstructor } from './creierCloud.js'

/** Cererea de comutare, așa cum o dă creierul din unealtă (natural, tolerant). */
export interface CerereComutare {
  creier?: string // 'free'|'gemini'|'kimi-k3'|'qwen3.5' (sinonime tolerate)
  constructor?: string // 'free'|'platit' (sinonime tolerate)
}

/** „free"/„gemeni"/gol → gemini (creierul FREE, implicit). Cloud: kimi-k3 / qwen3.5. */
export function normalizeazaCreier(x: string | undefined): ModelCreier2 | undefined {
  if (x == null) return undefined
  const s = String(x).toLowerCase().trim()
  if (!s) return undefined
  if (/free|gemi?ni|gemeni|gratis|implicit|default/.test(s)) return 'gemini'
  if (/kimi/.test(s)) return 'kimi-k3'
  if (/qwen/.test(s)) return 'qwen3.5'
  return undefined // necunoscut → nu schimbăm orbește (regula #1)
}

/** „platit"/„plată"/„cloud"/„pro" → platit; „free"/„local"/„gratis" → free. */
export function normalizeazaConstructor(x: string | undefined): SursaConstructor | undefined {
  if (x == null) return undefined
  const s = String(x).toLowerCase().trim()
  if (!s) return undefined
  if (/pl[ăa]tit|plata|pl[ăa]t|cloud|pro|bani|contra.?cost/.test(s)) return 'platit'
  if (/free|local|gratis|vps|gratuit/.test(s)) return 'free'
  return undefined
}

/** Cererea → schimbarea de config (doar câmpurile cerute; restul rămân). */
export function interpreteazaComutare(cerere: CerereComutare): Partial<ConfigCreier> {
  const out: Partial<ConfigCreier> = {}
  const creier2 = normalizeazaCreier(cerere.creier)
  const constructorSursa = normalizeazaConstructor(cerere.constructor)
  if (creier2) out.creier2 = creier2
  if (constructorSursa) out.constructorSursa = constructorSursa
  return out
}

export interface DecizieAutonoma {
  config: Partial<ConfigCreier>
  deCe: string
  recomandare: string
}

/**
 * DECIDE AUTONOM când ownerul NU e prezent (owner, 19 aug: „când eu nu sunt să
 * decidă autonom"). Politica e cost-safe și pe placul lui măsurat („nu comut,
 * aștept free să repare"): ownerul lipsește → FREE pe amândouă, ca să NU ardem
 * bani fără el; escaladarea la plătit rămâne DOAR pe job, la nevoie reală
 * (remediereEsec / decideEscaladareFreeFirst), nu o comutare persistentă orbește.
 * Ownerul prezent → NU suprascriem alegerea lui explicită.
 */
export function decideSursaAutonoma(intrare: {
  ownerPrezent: boolean
  acum: ConfigCreier
  paidDisponibil: boolean
}): DecizieAutonoma {
  if (intrare.ownerPrezent)
    return {
      config: {},
      deCe: 'ownerul e prezent — respect alegerea lui explicită, nu comut autonom peste ea',
      recomandare: 'FĂRĂ schimbare autonomă (owner online).',
    }
  return {
    config: { creier2: 'gemini', constructorSursa: 'free' },
    deCe: intrare.paidDisponibil
      ? 'ownerul lipsește — FREE pe amândouă ca să nu ard bani fără el; plătitul e gata ca rezervă, dar se pornește doar la nevoie reală, pe job'
      : 'ownerul lipsește — FREE pe amândouă (plătitul oricum nu e gata: fără creier cloud ales / cheie)',
    recomandare: 'FERM: FREE creier + FREE constructor cât timp ești plecat; escaladez la plătit doar dacă un ordin chiar pică pe free.',
  }
}

/** Confirmarea MĂSURATĂ (regula #1): ce e ACUM + dacă plătitul chiar e gata. */
export function rezumaComutare(config: ConfigCreier, paidDisponibil: boolean): string {
  const creierEt = config.creier2 === 'gemini' ? 'FREE (Gemini)' : `PLĂTIT (${config.creier2})`
  const constrEt = config.constructorSursa === 'platit' ? 'PLĂTIT (cloud)' : 'FREE (local pe VPS)'
  const avertisment =
    config.constructorSursa === 'platit' && !paidDisponibil
      ? ' ⚠ Constructorul e pus pe PLĂTIT, dar rezerva plătită NU e gata (fără creier cloud ales sau fără cheie validă) — la rulare pornește tot pe FREE până pui cheia.'
      : ''
  return `Creier: ${creierEt}. Constructor: ${constrEt}.${avertisment}`
}
