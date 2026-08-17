// ── AUTODIAGNOSTIC: KELION ÎȘI CUNOAȘTE SINGUR DEFECTELE ──────────────────────
// Adrian, 12 aug: „Kelion nu știe by default că are probleme… nu are sisteme
// să-i zică automat ce probleme are". Serviciul ăsta strânge, dintr-un singur
// loc, defectele REALE ale aplicației ACUM — erori de server (jurnalul pino) și
// ordine de build eșuate — fiecare cu explicația „ce este" (din `explicaEroare`).
// Se injectează în creierul lui Kelion (chat.ts) ca, întrebat „ce probleme ai?",
// să răspundă din CUNOAȘTERE, nu „încearcă din nou".
//
// LATENȚĂ (chatul <1s): partea async (ordinele din DB) NU se așteaptă în calea
// fierbinte. `problemeGlobaleCache()` întoarce SINCRON ultima poză cunoscută și
// pornește o reîmprospătare în FUNDAL dacă e veche — exact tiparul lookup-urilor
// GPS din chat.ts („run in the background and are ready for the next turn").
//
// Regula #1: fiecare rând vine dintr-o citire reală; nimic inventat.

import { explicaEroare, rangSeveritate, type Severitate } from './explicaEroare.js'
import { recentLogs } from './logbuffer.js'
import { listBuildJobs } from '../db.js'

export interface ProblemaKelion {
  sursa: 'server' | 'ordin'
  /** Semnătura scurtă (linia de log / descrierea ordinului). */
  text: string
  /** Explicația „ce este", în clar. */
  ceEste: string
  severitate: Severitate
  categorie: string
}

let cache: { la: number; val: ProblemaKelion[] } | null = null
let reimprospatareInCurs = false
const TTL_MS = 45_000

/** Poza SINCRONĂ a defectelor (non-blocantă). Dacă e veche, pornește o
 *  reîmprospătare în fundal și întoarce ultima poză cunoscută — gata pentru tura
 *  următoare, fără să adauge latență turei curente. Pentru creier (chat.ts). */
export function problemeGlobaleCache(): ProblemaKelion[] {
  if (!cache || Date.now() - cache.la > TTL_MS) {
    if (!reimprospatareInCurs) {
      reimprospatareInCurs = true
      void computeaza().finally(() => {
        reimprospatareInCurs = false
      })
    }
  }
  return cache?.val ?? []
}

/** Poza PROASPĂTĂ (așteaptă citirea) — pentru panoul de admin, unde ownerul vrea
 *  starea de ACUM, nu una veche de cache. Actualizează și cache-ul. */
export async function problemeGlobaleAcum(): Promise<ProblemaKelion[]> {
  return computeaza()
}

/** Reconstruiește poza defectelor din surse reale. */
async function computeaza(): Promise<ProblemaKelion[]> {
  const out: ProblemaKelion[] = []
  // Erori de server: nivel error+ (50) din jurnalul pino in-memory.
  for (const e of recentLogs(50, 15)) {
    const t = String(e.msg ?? '').slice(0, 220).trim()
    if (!t) continue
    out.push({ sursa: 'server', text: t, ...explicaEroare(t) })
  }
  // Ordine de build eșuate (constructorul) — best-effort, nu blochează restul.
  const jobs = await listBuildJobs(15)
    .then((j) => j ?? [])
    .catch(() => [])
  for (const j of jobs.filter((x) => x.status === 'failed')) {
    out.push({
      sursa: 'ordin',
      text: `ordinul de build #${j.id}: „${String(j.orderText ?? '').slice(0, 100)}"`,
      ceEste:
        'Un ordin de construcție a eșuat definitiv. Cauza e în jurnalul constructorului (creier indisponibil, o poartă roșie, sau un pas care n-a mers) — se poate reanaliza și repune.',
      severitate: 'important',
      categorie: 'Constructor',
    })
  }
  out.sort((a, b) => rangSeveritate(a.severitate) - rangSeveritate(b.severitate))
  cache = { la: Date.now(), val: out }
  return out
}

/** Bloc compact pentru promptul creierului. Listă goală → șir gol (nimic de spus). */
export function formateazaProbleme(list: ProblemaKelion[], max = 8): string {
  if (!list.length) return ''
  return list
    .slice(0, max)
    .map((p) => `• [${p.severitate}] ${p.text} → ${p.ceEste}`)
    .join('\n')
}
