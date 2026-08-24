import { ScopedSensorBuffer } from './scopedSensorBuffer.js'

export const TIPURI_SUNET = ['zgomot_brusc', 'conversatie_posibila', 'muzica_posibila', 'liniste'] as const
export type TipSunet = typeof TIPURI_SUNET[number]

export interface EvenimentSonorStocat {
  ts: number
  tip: TipSunet
  intensitate: number
  durataMs: number
  frecventaDominanta: number
}

const CAP_MAXIM = 30 // hardcod-permis: limită tehnică anti-abuz per utilizator
const MAX_UTILIZATORI = 1_000 // hardcod-permis: limită tehnică globală
const EXPIRA_MS = 10 * 60_000 // hardcod-permis: fereastră efemeră
const AVANS_TS_MS = 60_000 // hardcod-permis: toleranță ceas client
const evenimente = new ScopedSensorBuffer<EvenimentSonorStocat>(CAP_MAXIM, MAX_UTILIZATORI, EXPIRA_MS)

export type ValidareSunet = { ok: true; valoare: EvenimentSonorStocat } | { ok: false; error: string }

export function valideazaEvenimentSonor(input: unknown, acum = Date.now()): ValidareSunet {
  if (!input || typeof input !== 'object') return { ok: false, error: 'corp_invalid' }
  const corp = input as Record<string, unknown>
  if (typeof corp.tip !== 'string' || !(TIPURI_SUNET as readonly string[]).includes(corp.tip)) return { ok: false, error: 'tip_invalid' }
  const ts = corp.ts == null ? acum : Number(corp.ts)
  if (!Number.isFinite(ts) || ts < acum - EXPIRA_MS || ts > acum + AVANS_TS_MS) return { ok: false, error: 'timestamp_invalid' }
  const intensitate = Number(corp.intensitate ?? 0)
  const durataMs = Number(corp.durataMs ?? 0)
  const frecventaDominanta = Number(corp.frecventaDominanta ?? 0)
  if (![intensitate, durataMs, frecventaDominanta].every(Number.isFinite)) return { ok: false, error: 'valori_invalide' }
  return {
    ok: true,
    valoare: {
      ts,
      tip: corp.tip as TipSunet,
      intensitate: Math.min(100, Math.max(0, intensitate)),
      durataMs: Math.min(EXPIRA_MS, Math.max(0, durataMs)),
      frecventaDominanta: Math.min(24_000, Math.max(0, frecventaDominanta)),
    },
  }
}

export function adaugaEvenimentSonor(email: string, ev: EvenimentSonorStocat): void {
  evenimente.push(email, ev)
}

export function evenimenteSonoreRecente(email: string): EvenimentSonorStocat[] {
  return evenimente.list(email)
}

/** FFT-ul oferă doar un indiciu grosier; nu identifică alarme, plâns sau spargeri. */
export function evenimenteNeobisnuite(email: string): EvenimentSonorStocat[] {
  return evenimente.list(email).filter((e) => e.tip === 'zgomot_brusc')
}
