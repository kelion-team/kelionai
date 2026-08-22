// ── PAZNIC — OCHIUL CARE VEDE DEFECTELE ÎN TIMP REAL ──────────────────────────
// Adrian: „un sistem să monitorizeze tot ce se întâmplă pe aplicație, când vede
// o eroare, când pică ceva, sau când Kelion are o lipsă, vede și face imediat".
//
// Acesta e primul strat: colectează, clasifică, deduplică și expune. Fără
// acțiune automată încă — următorul pas e dispecerul care cheamă selfHeal,
// constructorul sau notificarea admin.
//
// Regula #1: fiecare rând vine dintr-o citire reală; nicio problemă inventată.

import { recentLogs } from './logbuffer.js'
import { problemeGlobaleAcum, type ProblemaKelion } from './autodiagnostic.js'
import { systemHealth } from './health.js'
import { recentClientErrorRows, loadKv, saveKv } from '../db.js'
import { dispecereazaEvenimente } from './dispecerPaznic.js'
import { runSelfHeal } from './selfHeal.js'

export type NivelPaznic = 'critic' | 'atentie' | 'info'
export type ActiunePaznic = 'selfHeal' | 'constructor' | 'notifica' | 'monitorizeaza'

export interface EvenimentPaznic {
  id: string
  la: number
  semnatura: string
  nivel: NivelPaznic
  sursa: string
  mesaj: string
  detalii?: string
  actiune: ActiunePaznic
}

export interface RaportPaznic {
  la: number
  evenimente: EvenimentPaznic[]
}

const DEDUP_MS = 15 * 60_000
const KV_RAPORT = 'paznic:raport'
const KV_SEMNATURI = 'paznic:semnaturi'

let raportCurent: RaportPaznic = { la: 0, evenimente: [] }
let rulareInCurs = false

function semnatura(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h.toString(16).slice(0, 10)
}

function actiuneDinProblema(p: ProblemaKelion): ActiunePaznic {
  if (p.severitate === 'critic') return 'notifica'
  if (p.sursa === 'ordin') return 'constructor'
  return 'selfHeal'
}

function nivelDinSeveritate(s: string): NivelPaznic {
  if (s === 'critic') return 'critic'
  if (s === 'important') return 'atentie'
  return 'info'
}

export interface DepsPaznic {
  problemeGlobale: () => Promise<ProblemaKelion[]>
  clientErrors: (hours: number, limit: number, includePerf: boolean) => Promise<unknown[]>
  health: () => Promise<string>
}

const depsImplicite: DepsPaznic = {
  problemeGlobale: problemeGlobaleAcum,
  clientErrors: recentClientErrorRows as (h: number, l: number, p: boolean) => Promise<unknown[]>,
  health: systemHealth,
}

/** Un singur ciclu: strânge, clasifică, deduplică. */
export async function cicluPaznic(deps: Partial<DepsPaznic> = {}): Promise<RaportPaznic> {
  const d = { ...depsImplicite, ...deps }
  const la = Date.now()
  const evenimente: EvenimentPaznic[] = []

  // 1. Problemele globale (server + constructor) — deja agregate real.
  try {
    for (const p of await d.problemeGlobale()) {
      const semn = semnatura(`global:${p.text}`)
      const actiune = actiuneDinProblema(p)
      const nivel = nivelDinSeveritate(p.severitate)
      if (nivel === 'info') continue
      evenimente.push({
        id: `${semn}:${la}`,
        la,
        semnatura: semn,
        nivel,
        sursa: `global:${p.sursa}`,
        mesaj: p.text,
        detalii: p.ceEste,
        actiune,
      })
    }
  } catch (e) {
    evenimente.push({
      id: `global-err:${la}`,
      la,
      semnatura: 'paznic:global:exceptie',
      nivel: 'critic',
      sursa: 'paznic',
      mesaj: 'problemeGlobaleAcum a aruncat',
      detalii: String(e),
      actiune: 'notifica',
    })
  }

  // 2. Sănătatea sistemului (deploy, GitHub, DB, client errors) — text JSON.
  try {
    const raw = await d.health()
    const h = JSON.parse(raw) as { problems?: { id: string; grav: string; desc: string; reparabil?: string }[] } | undefined
    for (const p of h?.probleme ?? []) {
      const semn = semnatura(`health:${p.id}:${p.desc}`)
      const nivel = ['critic', 'important'].includes(p.grav) ? 'critic' : p.grav === 'mediu' ? 'atentie' : 'info'
      if (nivel === 'info') continue
      evenimente.push({
        id: `${semn}:${la}`,
        la,
        semnatura: semn,
        nivel,
        sursa: 'health',
        mesaj: p.desc,
        detalii: p.reparabil,
        actiune: nivel === 'critic' ? 'notifica' : 'selfHeal',
      })
    }
  } catch (e) {
    evenimente.push({
      id: `health-err:${la}`,
      la,
      semnatura: 'paznic:health:exceptie',
      nivel: 'critic',
      sursa: 'paznic',
      mesaj: 'systemHealth a aruncat sau a întors JSON rupt',
      detalii: String(e),
      actiune: 'notifica',
    })
  }

  // 3. Erori de client (F12) — grupate.
  try {
    const rows = await d.clientErrors(1, 20, false)
    const vazute = new Map<string, number>()
    for (const r of rows) {
      const msg = String((r as { message?: string }).message ?? '').slice(0, 120)
      if (!msg) continue
      const semn = semnatura(`client:${msg}`)
      const count = (vazute.get(semn) || 0) + 1
      vazute.set(semn, count)
      if (count > 5) {
        evenimente.push({
          id: `${semn}:${la}`,
          la,
          semnatura: semn,
          nivel: 'atentie',
          sursa: 'client',
          mesaj: `Eroare F12 repetată (${count}×): ${msg}`,
          actiune: 'notifica',
        })
      }
    }
  } catch (e) {
    evenimente.push({
      id: `client-err:${la}`,
      la,
      semnatura: 'paznic:client:exceptie',
      nivel: 'atentie',
      sursa: 'paznic',
      mesaj: 'recentClientErrorRows a aruncat',
      detalii: String(e),
      actiune: 'notifica',
    })
  }

  // 4. Dedublicare: nu repeta aceeași semnătură în 15 min, doar dacă e critic.
  const vazute = new Map<string, number>()
  try {
    const raw = await loadKv(KV_SEMNATURI)
    if (raw) {
      const istoric = JSON.parse(raw) as { s: string; la: number }[]
      for (const i of istoric) if (la - i.la < DEDUP_MS) vazute.set(i.s, i.la)
    }
  } catch {
    /* kv picat → continuăm cu memorie goală */
  }

  const unice = evenimente.filter((e) => !vazute.has(e.semnatura) || e.nivel === 'critic')
  for (const e of unice) vazute.set(e.semnatura, la)

  // Curățăm semnăturile vechi.
  const nou = [...vazute.entries()]
    .filter(([, t]) => la - t < DEDUP_MS)
    .map(([s, t]) => ({ s, la: t }))

  try {
    await saveKv(KV_SEMNATURI, JSON.stringify(nou).slice(0, 100_000))
  } catch {
    /* ignore */
  }

  raportCurent = { la, evenimente: unice }
  try {
    await saveKv(KV_RAPORT, JSON.stringify(raportCurent).slice(0, 100_000))
  } catch {
    /* ignore */
  }

  return raportCurent
}

/** Pornește bucla de paznic. Fiecare ciclu rulează la fiecare `ms`.
 *  NU pornește două cicliuri simultan. */
export function pornestePaznic(ms = 60_000): () => void {
  const tick = async (): Promise<void> => {
    if (rulareInCurs) return
    rulareInCurs = true
    try {
      const raport = await cicluPaznic()
      if (raport.evenimente.length) {
        const actiuni = await dispecereazaEvenimente(raport.evenimente, { selfHeal: runSelfHeal })
        for (const a of actiuni) if (!a.ok) console.error('[paznic] acțiune eșuată:', a)
      }
    } catch (e) {
      console.error('[paznic] ciclu eșuat:', e)
    } finally {
      rulareInCurs = false
    }
  }
  void tick()
  const id = setInterval(tick, ms)
  return () => clearInterval(id)
}

/** Ultimul raport din memorie (fără re-rulare). */
export function raportPaznicLive(): RaportPaznic {
  return raportCurent
}
