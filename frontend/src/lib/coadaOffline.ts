// ── COZILE OFFLINE: SYNC + CERERI AMÂNATE (mod companion, faza 3) ────────────
// Owner: „la găsirea de semnal să se reconecteze automat, să-și trimită tot pe
// server să se reactualizeze; dacă are întrebări pe care nu le-a onorat, să
// anunțe că le-a salvat și, când va avea net, le rezolvă; când le-a rezolvat,
// să anunțe civilizat: «îți pot comunica răspunsul la ce ai întrebat când ai
// întrebat x»."
//
// Două cozi, persistente pe dispozitiv (localStorage, cu try/catch — text mic):
//  • SYNC   — tot ce s-a întâmplat offline (chat + locație/oră) → trimis pe server
//             la revenire, ca memoria serverului să se actualizeze.
//  • AMÂNATE — întrebările care CEREAU net și n-au putut fi onorate offline →
//             rezolvate la revenire, apoi anunțate civilizat.
// Regula #1: cozile țin DOAR ce s-a întâmplat, nu inventează nimic.

import type { Lang } from './i18n'
import { strings } from './i18n'

const CHEIE_SYNC = 'kelion.offline.sync'
const CHEIE_AMANATE = 'kelion.offline.amanate'
const MAX = 200 // plafon prudent per coadă (text mic; nu umplem discul)

export interface TuraOffline {
  rol: 'user' | 'assistant'
  text: string
  t: number // timestamp ms
  lat?: number
  lon?: number
}

export interface CerereAmanata {
  id: string
  intrebare: string
  t: number
  lat?: number
  lon?: number
}

function citesteBruta<T>(cheie: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(cheie) ?? '[]')
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}
function scrieBruta<T>(cheie: string, v: T[]): void {
  try {
    localStorage.setItem(cheie, JSON.stringify(v.slice(-MAX)))
  } catch {
    /* stocare plină/indisponibilă — coada nu supraviețuiește, dar nu crăpăm */
  }
}

// ── SYNC ────────────────────────────────────────────────────────────────────
export function adaugaTuraSync(t: TuraOffline): void {
  const q = citesteBruta<TuraOffline>(CHEIE_SYNC)
  q.push(t)
  scrieBruta(CHEIE_SYNC, q)
}
export function citesteSync(): TuraOffline[] {
  return citesteBruta<TuraOffline>(CHEIE_SYNC)
}
export function golesteSync(): void {
  scrieBruta<TuraOffline>(CHEIE_SYNC, [])
}

// ── AMÂNATE ───────────────────────────────────────────────────────────────────
export function adaugaAmanata(c: { intrebare: string; t: number; lat?: number; lon?: number }): CerereAmanata {
  const cerere: CerereAmanata = { id: `${c.t}-${Math.floor(c.t % 100000)}-${c.intrebare.length}`, ...c }
  const q = citesteBruta<CerereAmanata>(CHEIE_AMANATE)
  q.push(cerere)
  scrieBruta(CHEIE_AMANATE, q)
  return cerere
}
export function citesteAmanate(): CerereAmanata[] {
  return citesteBruta<CerereAmanata>(CHEIE_AMANATE)
}
export function stergeAmanata(id: string): void {
  scrieBruta(
    CHEIE_AMANATE,
    citesteBruta<CerereAmanata>(CHEIE_AMANATE).filter((c) => c.id !== id),
  )
}

// ── PUR: cine are nevoie de net + anunțul civilizat ──────────────────────────

/** Cere cererea asta NET ca s-o onorezi? Euristică best-effort pe intenție —
 *  căutare/vreme/hărți/știri/email/rezervări/date live. PURĂ (testabilă). Dacă
 *  ghicește greșit, cel mai rău e că re-întreabă la net — nu pierde nimic. */
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

/** Anunțul CIVILIZAT la rezolvarea unei cereri amânate (owner: „îți pot comunica
 *  răspunsul la ce ai întrebat când ai întrebat x"). PUR, multilingv. */
export function anuntAmanat(intrebare: string, raspuns: string, lang: Lang): string {
  const intro = strings(lang).raspunsAmanat
  const q = intrebare.trim().slice(0, 160)
  return `${intro} („${q}"):\n${raspuns.trim()}`
}
