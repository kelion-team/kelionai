// Cozile sunt izolate prin UUID-ul opac al contului. Nu persistă coordonate.

import type { Lang } from './i18n'
import { strings } from './i18n'
import { activeClientScope } from './clientState'
import { retryChatEsteNesigur } from './chatReplayPolicy'
import {
  applyTerminalSync,
  deleteDeferred,
  markDeferredNotified,
  readDeferred,
  readHistory,
  readOutbox,
  readRejected,
  writeLocal,
  type StoredDeferredRequest,
  type StoredRejectedTurn,
  type StoredTurn,
} from './offlineStore'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type TuraOffline = StoredTurn
export type TuraOfflineRespinsa = StoredRejectedTurn
export type CerereAmanata = StoredDeferredRequest

export interface CitireSyncDurabila {
  ok: boolean
  ture: TuraOffline[]
  error?: 'storage_unavailable'
}

type TuraNoua = Omit<TuraOffline, 'id'> & { id?: string }
type CerereNoua = { intrebare: string; t: number; id?: string }

function scopeActiv(): string | null {
  return activeClientScope()
}

/** Scrie istoric + outbox + cerere amânată într-o singură tranzacție IDB. */
export async function salveazaTureLocale(
  ture: readonly TuraNoua[],
  options: { sincronizeaza: boolean; amanata?: CerereNoua | null },
): Promise<{ ture: TuraOffline[]; amanata: CerereAmanata | null } | null> {
  const scope = scopeActiv()
  if (!scope) return null
  const result = await writeLocal(scope, {
    turns: ture,
    queueForSync: options.sincronizeaza,
    deferred: options.amanata,
  })
  return result ? { ture: result.turns, amanata: result.deferred } : null
}

// ── SYNC / ISTORIC ─────────────────────────────────────────────────────────────────────────
export async function adaugaTureSync(ture: readonly Omit<TuraOffline, 'id'>[]): Promise<TuraOffline[] | null> {
  return (await salveazaTureLocale(ture, { sincronizeaza: true }))?.ture ?? null
}

/** Istoricul online rămâne local pentru următoarea pornire în avion, fără outbox. */
export async function adaugaIstoricLocal(
  ture: readonly Omit<TuraOffline, 'id'>[],
): Promise<TuraOffline[] | null> {
  return (await salveazaTureLocale(ture, { sincronizeaza: false }))?.ture ?? null
}

export async function citesteSyncDurabil(): Promise<CitireSyncDurabila> {
  const scope = scopeActiv()
  if (!scope) return { ok: false, ture: [], error: 'storage_unavailable' }
  try {
    return { ok: true, ture: await readOutbox(scope) }
  } catch {
    return { ok: false, ture: [], error: 'storage_unavailable' }
  }
}

export async function citesteIstoricLocal(): Promise<TuraOffline[]> {
  const scope = scopeActiv()
  if (!scope) return []
  try {
    return await readHistory(scope)
  } catch {
    return []
  }
}

export async function aplicaRezultatSync(
  body: unknown,
  sent: readonly TuraOffline[],
  expectedScope: string,
): Promise<{ ok: boolean; acked: number; quarantined: number }> {
  if (!body || typeof body !== 'object') return { ok: false, acked: 0, quarantined: 0 }
  const response = body as { ok?: unknown; clientStorageId?: unknown; ackedIds?: unknown; rejected?: unknown }
  if (response.ok !== true || response.clientStorageId !== expectedScope ||
    !Array.isArray(response.ackedIds) || !Array.isArray(response.rejected)) {
    return { ok: false, acked: 0, quarantined: 0 }
  }
  const expected = new Set(sent.map((turn) => turn.id.toLowerCase()))
  const acknowledged = new Set<string>()
  for (const raw of response.ackedIds) {
    if (typeof raw !== 'string' || !UUID_RE.test(raw) || !expected.has(raw.toLowerCase())) {
      return { ok: false, acked: 0, quarantined: 0 }
    }
    acknowledged.add(raw.toLowerCase())
  }
  const rejected: TuraOfflineRespinsa[] = []
  for (const raw of response.rejected) {
    if (!raw || typeof raw !== 'object') return { ok: false, acked: 0, quarantined: 0 }
    const item = raw as { id?: unknown; code?: unknown; retryable?: unknown }
    if (typeof item.id !== 'string' || !UUID_RE.test(item.id) || !expected.has(item.id.toLowerCase()) ||
      typeof item.code !== 'string' || !item.code || item.retryable !== false ||
      acknowledged.has(item.id.toLowerCase())) {
      return { ok: false, acked: 0, quarantined: 0 }
    }
    const rejectedId = item.id.toLowerCase()
    const source = sent.find((turn) => turn.id.toLowerCase() === rejectedId)
    if (!source) return { ok: false, acked: 0, quarantined: 0 }
    rejected.push({ ...source, id: rejectedId, code: item.code, rejectedAt: Date.now() })
  }
  const terminal = new Set([...acknowledged, ...rejected.map((item) => item.id)])
  if (terminal.size !== expected.size) return { ok: false, acked: 0, quarantined: 0 }
  if (activeClientScope() !== expectedScope ||
    !(await applyTerminalSync(expectedScope, [...terminal], rejected)) ||
    activeClientScope() !== expectedScope) {
    return { ok: false, acked: 0, quarantined: 0 }
  }
  return { ok: true, acked: acknowledged.size, quarantined: rejected.length }
}

export async function citesteTureRespinse(): Promise<TuraOfflineRespinsa[]> {
  const scope = scopeActiv()
  if (!scope) return []
  try {
    return await readRejected(scope)
  } catch {
    return []
  }
}

// ── AMÂNATE ──────────────────────────────────────────────────────────────────────────────
export async function citesteAmanate(): Promise<CerereAmanata[]> {
  const scope = scopeActiv()
  if (!scope) return []
  try {
    return await readDeferred(scope)
  } catch {
    return []
  }
}

export async function stergeAmanata(id: string): Promise<boolean> {
  const scope = scopeActiv()
  return Boolean(scope && await deleteDeferred(scope, id))
}

export async function marcheazaAmanataNotificata(id: string): Promise<boolean> {
  const scope = scopeActiv()
  return Boolean(scope && await markDeferredNotified(scope, id))
}

/** Stops background replay once the server can no longer prove whether an
 * external action already ran. Safe pre-execution failures remain queued. */
export async function finalizeazaAmanataAmbigua(id: string, errorCode: string): Promise<boolean> {
  if (!retryChatEsteNesigur(errorCode)) return false
  return stergeAmanata(id)
}

// ── PUR: cine are nevoie de net + anunțul civilizat ──────────────────────────────────────────

/** Cere cererea asta NET ca s-o onorezi? Euristică best-effort pe intenție. */
export function necesitaNet(text: string): boolean {
  const s = (text || '').toLowerCase()
  if (!s.trim()) return false
  return [
    /\b(caut[ăa]?|search|g[ăa]se[șs]te|find|google|pe net|online)\b/,
    /\b(vreme|vremea|weather|temperatur)/,
    /\b(hart[ăa]|map|rut[ăa]|route|drum|direc[țt]i|naviga)/,
    /\b([șs]tir|news|nout[ăa][țt])/,
    /\b(email|e-?mail|mesaj|trimite|send|whatsapp|sms)\b/,
    /\b(rezerv|book|comand|order|cump[ăa]r|buy|pl[ăa]t)/,
    /\b(valutar|curs\b|pre[țt]|sto?ck|burs[ăa]|bitcoin|acum online|live)\b/,
    /\b(sun[ăa]|call|apeleaz)/,
  ].some((re) => re.test(s))
}

/** Acțiunile externe cer o confirmare nouă după revenirea semnalului. */
export function cerereNetAreEfect(text: string): boolean {
  const s = (text || '').toLowerCase()
  return [
    /\b(email|e-?mail|whatsapp|sms|trimite|send)\b/,
    /\b(rezerv|book|comand|order|cump[ăa]r|buy|pl[ăa]t|pay)\b/,
    /\b(sun[ăa]|call|apeleaz)\b/,
  ].some((pattern) => pattern.test(s))
}

export function anuntAmanat(intrebare: string, raspuns: string, lang: Lang): string {
  const intro = strings(lang).raspunsAmanat
  const q = intrebare.trim().slice(0, 160)
  return `${intro} („${q}"):\n${raspuns.trim()}`
}
