import type { DovadaUnealta, StareDovadaUnealta } from './poartaFaptelor.js'

export const STARI_SARCINA_OPERATIONALA = [
  'observing',
  'interpreting',
  'planning',
  'awaiting_confirmation',
  'executing',
  'verifying',
  'completed',
  'correcting',
  'failed',
  'blocked',
  'expired',
  'unverified',
] as const

export type StareSarcinaOperationala = typeof STARI_SARCINA_OPERATIONALA[number]
export type StareEvenimentOperational = 'attempted' | 'observed' | StareDovadaUnealta

const TRANZITII_PERMISE: Readonly<Record<StareSarcinaOperationala, readonly StareSarcinaOperationala[]>> = {
  observing: ['interpreting', 'blocked', 'failed', 'expired'],
  interpreting: ['planning', 'awaiting_confirmation', 'executing', 'completed', 'failed', 'blocked', 'expired'],
  planning: ['awaiting_confirmation', 'executing', 'completed', 'failed', 'blocked', 'expired'],
  awaiting_confirmation: ['interpreting', 'planning', 'executing', 'failed', 'blocked', 'expired'],
  executing: ['verifying', 'correcting', 'awaiting_confirmation', 'completed', 'failed', 'blocked', 'unverified'],
  verifying: ['executing', 'completed', 'correcting', 'awaiting_confirmation', 'failed', 'blocked', 'unverified'],
  completed: [],
  correcting: ['planning', 'executing', 'verifying', 'completed', 'failed', 'blocked', 'unverified'],
  failed: ['correcting', 'expired'],
  blocked: ['interpreting', 'planning', 'executing', 'expired'],
  expired: ['interpreting'],
  unverified: ['verifying', 'correcting', 'expired'],
}

export function esteStareSarcinaOperationala(value: unknown): value is StareSarcinaOperationala {
  return typeof value === 'string' && (STARI_SARCINA_OPERATIONALA as readonly string[]).includes(value)
}

/** The journal permits a no-op state update so an event can describe a repeated
 * observation without creating a fictitious state change. */
export function tranzitieOperationalaPermisa(
  from: StareSarcinaOperationala,
  to: StareSarcinaOperationala,
): boolean {
  return from === to || TRANZITII_PERMISE[from].includes(to)
}

const CAMP_SENSIBIL = /(?:^|_)(?:raw_?)?(?:output|result|response|content|prompt|input|token|secret|password|authorization|cookie|audio|image|data)(?:_|$)/i

/** Journal records are evidence about a result, not an archive of prompts,
 * tool payloads, credentials, media, or provider output. */
export function curataTextJurnal(value: unknown, max = 500): string {
  const limit = Math.max(1, Math.min(max, 2_000))
  return String(value ?? '')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[redacted-key]')
    .replace(/\b(bearer|token|api[_ -]?key|password|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-token]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function curataValoareMetadate(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return curataTextJurnal(value, 300)
  if (Array.isArray(value) && depth < 2) {
    return value
      .slice(0, 12)
      .map((item) => curataValoareMetadate(item, depth + 1))
      .filter((item) => item !== undefined)
  }
  if (value && typeof value === 'object' && depth < 2) {
    const rezultat: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 24)) {
      if (CAMP_SENSIBIL.test(key)) continue
      const curatat = curataValoareMetadate(item, depth + 1)
      if (curatat !== undefined) rezultat[curataTextJurnal(key, 80)] = curatat
    }
    return rezultat
  }
  return undefined
}

export function metadateJurnalSigure(value: unknown): Record<string, unknown> {
  const curat = curataValoareMetadate(value, 0)
  return curat && typeof curat === 'object' && !Array.isArray(curat)
    ? curat as Record<string, unknown>
    : {}
}

export interface RezumatFinalSarcinaOperationala {
  stare: StareSarcinaOperationala
  cod: string
}

/** A technical success is intentionally not completion: only independently
 * verified effects complete an action objective. */
export function rezumaStareFinalaSarcinaOperationala(input: {
  cereActiune: boolean
  dovezi: readonly DovadaUnealta[]
  planFaraExecutie: boolean
  ignorata?: boolean
}): RezumatFinalSarcinaOperationala {
  if (input.ignorata) return { stare: 'expired', cod: 'turn_not_addressed' }

  const stari = new Set(input.dovezi.map((dovada) => dovada.stare))
  if (stari.has('awaiting_confirmation')) return { stare: 'awaiting_confirmation', cod: 'confirmation_required' }
  if (stari.has('blocked')) return { stare: 'blocked', cod: 'action_blocked' }
  if (stari.has('failed')) return { stare: 'failed', cod: 'tool_failed' }
  if (stari.has('succeeded') || stari.has('unverified')) return { stare: 'unverified', cod: 'independent_verification_missing' }
  if (stari.has('verified')) return { stare: 'completed', cod: 'effect_verified' }
  if (input.cereActiune) {
    return {
      stare: 'failed',
      cod: input.planFaraExecutie ? 'action_not_executed' : 'action_without_result',
    }
  }
  return { stare: 'completed', cod: 'response_delivered' }
}
