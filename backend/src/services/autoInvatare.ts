import { recentTimings, saveKv, memoriePune, type TimingRow } from '../db.js'

// AUTO-ÎNVĂȚARE ÎN SPATE (Adrian, 3 aug: „soluții auto dezvoltare pentru a reduce
// acei timpi în urma logurilor, tot automatizat fără să fie afișate deloc, doar
// în zona din spate, ca creierul să învețe și să nu repete greșeli").
//
// NU afișează nimic userului. Citește registrul `task_timings` (evidența reală a
// timpilor de rezolvare), agregă pe tip de sarcină, scoate lecții din tipare
// (eșecuri repetate, pași lenți) și le scrie:
//   • `kv_state['invatare:performanta']` — sumarul măsurabil, în spate;
//   • memoria cu cheie a creierului `invatare:timpi` — ca să învețe și să nu
//     repete greșelile, oferind ulterior timpi cât mai mici.
// Agregarea + lecțiile sunt funcții PURE, testate (lacat: bătute în cuie).

const INTERVAL_MS = 30 * 60 * 1000 // la fiecare 30 min
const PRIMA_TRECERE_MS = 5 * 60 * 1000 // prima după 5 min (să existe date)
const MIN_ESANTION = 5 // sub atâtea măsurători pe tip nu tragem concluzii

export interface KindStat {
  kind: string
  n: number
  avgMs: number
  p90Ms: number
  failRate: number
  failN: number
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[i]
}

/** Agregă timpii pe tip de sarcină: medie, p90, rată de eșec. Pură. */
export function agregaTimpi(rows: TimingRow[]): KindStat[] {
  const byKind = new Map<string, { ms: number[]; fail: number }>()
  for (const r of rows) {
    const e = byKind.get(r.kind) ?? { ms: [], fail: 0 }
    e.ms.push(r.ms)
    if (!r.ok) e.fail++
    byKind.set(r.kind, e)
  }
  const stats: KindStat[] = []
  for (const [kind, e] of byKind) {
    const s = [...e.ms].sort((a, b) => a - b)
    const avg = Math.round(s.reduce((a, b) => a + b, 0) / s.length)
    stats.push({ kind, n: s.length, avgMs: avg, p90Ms: pct(s, 90), failRate: e.fail / s.length, failN: e.fail })
  }
  // Cele mai lente tipuri primele — acolo e câștigul de timp cel mai mare.
  return stats.sort((a, b) => b.avgMs - a.avgMs)
}

/** Scoate lecții acționabile din tipare (eșecuri repetate / pași lenți). Pură. */
export function lectiiDin(stats: KindStat[]): string[] {
  const l: string[] = []
  for (const s of stats) {
    if (s.n < MIN_ESANTION) continue
    if (s.failRate >= 0.2) {
      l.push(
        `«${s.kind}»: ${Math.round(s.failRate * 100)}% eșecuri din ${s.n} — nu relua orbește, verifică pasul care pică.`,
      )
    } else if (s.avgMs >= 8000) {
      l.push(
        `«${s.kind}»: lent (medie ${(s.avgMs / 1000).toFixed(1)}s, p90 ${(s.p90Ms / 1000).toFixed(1)}s) — caută pasul lent și scurtează-l.`,
      )
    }
  }
  return l
}

/** O trecere: citește registrul, agregă, scrie sumarul + lecțiile în spate. */
export async function ruleazaInvatare(): Promise<{ stats: KindStat[]; lectii: string[] } | null> {
  const rows = await recentTimings(2000)
  if (!rows.length) return null
  const stats = agregaTimpi(rows)
  const lectii = lectiiDin(stats)
  lectiiCache = lectii // bucla închisă: creierul le citește din cache (chat.ts)
  await saveKv('invatare:performanta', JSON.stringify({ at: new Date().toISOString(), stats })).catch(() => {})
  if (lectii.length) {
    // Memoria cu cheie a creierului — invizibilă userului, dar la îndemâna
    // creierului ca să nu repete greșelile.
    await memoriePune('invatare:timpi', lectii.join('\n')).catch(() => {})
  }
  console.log(`[INVATARE] ${rows.length} timpi, ${stats.length} tipuri, ${lectii.length} lecții`)
  return { stats, lectii }
}

// BUCLA ÎNCHISĂ (Adrian, 3 aug, aprobat: „închide bucla — creierul aplică
// lecțiile automat"). Lecțiile curente stau într-un cache în memorie (actualizat
// la fiecare trecere), ca `chat.ts` să le bage în contextul creierului admin FĂRĂ
// o citire din DB la fiecare tură (latență zero pe drumul cald).
let lectiiCache: string[] = []
export function lectiiCurente(): string[] {
  return lectiiCache
}

let timer: ReturnType<typeof setInterval> | null = null

/** Pornește bucla din spate (idempotent). Fără DB nu face nimic (recentTimings=[]). */
export function startAutoInvatare(): void {
  if (timer) return
  setTimeout(() => {
    void ruleazaInvatare().catch(() => {})
  }, PRIMA_TRECERE_MS)
  timer = setInterval(() => {
    void ruleazaInvatare().catch(() => {})
  }, INTERVAL_MS)
}
