// ── Shared non-component helpers for admin tabs ─────────────────────────────
// Kept separate from shared.tsx so that shared.tsx only exports React
// components (required for React Fast Refresh).

import type { HistoryRow } from '../../lib/admin'

/** Human-readable duration from seconds: 45s / 7m / 2h 13m. */
export function fmtDur(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const AI_LABELS: Record<string, string> = {
  openai: 'Creier (OpenAI)',
  chat: 'Creier (istoric)',
  correct: 'OpenAI (verificare)',
  image: 'Imagini (OpenAI)',
  image_est: 'Images (estimare internă)',
  video: 'Video (cost reconciliat)',
  asr: 'Hearing (STT)',
  search: 'Căutare web',
  memory: 'Memorie',
  memory_est: 'Memorie (estimare internă)',
  voice_minutes: 'Minute voce',
}

export function aiLabel(k: string): string {
  if (AI_LABELS[k]) return AI_LABELS[k]
  if (k.startsWith('tts:')) return `Voice (TTS ${k.slice(4)})`
  return k
}

export function dayHeader(d: Date): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = new Date(d)
  day.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (diff === 0) return 'Astăzi'
  if (diff === 1) return 'Ieri'
  return d.toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function groupByDay<T extends { created_at: string }>(
  rows: T[],
): { header: string; rows: T[] }[] {
  const sorted = [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const groups: { header: string; rows: T[] }[] = []
  for (const r of sorted) {
    const header = dayHeader(new Date(r.created_at))
    const last = groups.at(-1)
    if (!last || last.header !== header) groups.push({ header, rows: [r] })
    else last.rows.push(r)
  }
  return groups
}

// ── Auto-verification interfaces ────────────────────────────────────────────

export type VerdictFunctie = 'merge' | 'stricat' | 'nu_pot_verifica'
export interface VerificareFunctie {
  functie: string
  categorie: string
  face: string
  tip: 'citire' | 'efect'
  verdict: VerdictFunctie
  deCe: string
  recomandare: string
  dovada: string
}
export interface RaportAutoverificare {
  total: number
  merg: number
  stricate: number
  nepotverifica: number
  functii: VerificareFunctie[]
}
export function rangVerdict(v: VerdictFunctie): number {
  return v === 'stricat' ? 0 : v === 'nu_pot_verifica' ? 1 : 2
}

// ── Recovery row interface ──────────────────────────────────────────────────

export interface RecoveryRow {
  tag: string
  sha: string
  date: string
  note: string
}

// Re-export HistoryRow for convenience
export type { HistoryRow }
