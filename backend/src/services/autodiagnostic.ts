// ── AUTODIAGNOSTIC: KELION ÎȘI CUNOAȘTE SINGUR DEFECTELE ──────────────────────
// Adrian, 12 aug: „Kelion nu știe by default că are probleme… nu are sisteme
// să-i zică automat ce probleme are". Serviciul ăsta strânge, dintr-un singur
// loc, defectele REALE ale aplicației ACUM — erori de server (jurnalul pino),
// ordine de build eșuate, probleme Constructor (worker/publisher/release),
// capabilități stricate din autoverificare, chei lipsă — fiecare cu explicația
// „ce este" (din `explicaEroare`).
//
// Se injectează în creierul lui Kelion (chat.ts) ca, întrebat „ce probleme ai?",
// să răspundă din CUNOAȘTERE, nu „încearcă din nou". Și ca să ȘTIE ce să trimită
// la doctor (diagnostic) sau la constructor, fără să fie întrebat.
//
// LATENȚĂ (chatul <1s): partea async NU se așteaptă în calea fierbinte.
// `problemeGlobaleCache()` întoarce SINCRON ultima poză cunoscută și pornește
// o reîmprospătare în FUNDAL dacă e veche.
//
// Regula #1: fiecare rând vine dintr-o citire reală; nimic inventat.

import { explicaEroare, rangSeveritate, type Severitate } from './explicaEroare.js'
import { recentLogs } from './logbuffer.js'
import { listBuildJobs } from '../db.js'
import { config } from '../config.js'

export interface ProblemaKelion {
  sursa: 'server' | 'ordin' | 'constructor' | 'autoverificare' | 'config'
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
  return computeaza(true)
}

/** Reconstruiește poza defectelor din surse reale. */
async function computeaza(requireReadableQueue = false): Promise<ProblemaKelion[]> {
  const out: ProblemaKelion[] = []
  // 1. Erori de server: nivel error+ (50) din jurnalul pino in-memory.
  for (const e of recentLogs(50, 15)) {
    const t = String(e.msg ?? '').slice(0, 220).trim()
    if (!t) continue
    out.push({ sursa: 'server', text: t, ...explicaEroare(t) })
  }

  // 2. Constructor: ordine eșuate + diagnosticul lanțului (worker/publisher/release)
  const jobsRead = await listBuildJobs(15).catch(() => null)
  if (requireReadableQueue && jobsRead === null) {
    throw new Error('constructor_queue_unreadable')
  }
  const jobs = jobsRead ?? []
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
  // Diagnosticul lanțului Constructor (worker/publisher/release offline)
  try {
    const { diagnosticConstructorViu } = await import('./diagnosticConstructor.js')
    const diag = await diagnosticConstructorViu(Date.now())
    if (diag && !('error' in diag) && !diag.sanatos) {
      for (const p of diag.probleme) {
        out.push({
          sursa: 'constructor',
          text: `${p.cod}: ${p.ce.slice(0, 120)}`,
          ceEste: p.recomandare.slice(0, 200),
          severitate: p.severitate === 'critic' ? 'critic' : 'important',
          categorie: 'Constructor',
        })
      }
    }
  } catch { /* diagnostic indisponibil — nu inventăm */ }

  // 3. Config: chei lipsă care blochează funcții întregi
  if (!config.openai.key) {
    out.push({
      sursa: 'config',
      text: 'OPENAI_API_KEY lipsește',
      ceEste: 'Creierul nu funcționează fără cheia OpenAI. Nimic nu merge: chat, voce, imagini, video — toate depind de ea.',
      severitate: 'critic',
      categorie: 'Config',
    })
  }
  if (!config.google.clientId || !config.google.clientSecret) {
    out.push({
      sursa: 'config',
      text: 'Google OAuth client lipsă/șters',
      ceEste: 'Login-ul Google nu funcționează. Adminul nu se poate autentifica prin OAuth — trebuie recreat clientul în Google Cloud Console.',
      severitate: 'critic',
      categorie: 'Config',
    })
  }
  if (!config.serperKey) {
    out.push({
      sursa: 'config',
      text: 'SERPER_API_KEY lipsește',
      ceEste: 'Căutările web și YouTube nu funcționează fără cheia Serper.',
      severitate: 'important',
      categorie: 'Config',
    })
  }

  // 4. Autoverificare: capabilități stricate (din cache-ul ultimei rulări)
  try {
    const { loadKv } = await import('../db.js')
    const raw = await loadKv('autoverificare:ultima')
    if (raw) {
      const j = JSON.parse(raw) as { raport?: { functii?: { functie: string; verdict: string; deCe: string }[] } }
      const stricate = (j.raport?.functii ?? []).filter((f) => f.verdict === 'stricat')
      for (const f of stricate) {
        out.push({
          sursa: 'autoverificare',
          text: `capabilitate stricată: ${f.functie}`,
          ceEste: f.deCe.slice(0, 200),
          severitate: 'important',
          categorie: 'Autoverificare',
        })
      }
    }
  } catch { /* cache indisponibil — nu inventăm */ }

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
