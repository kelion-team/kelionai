// ── DIAGNOSTICUL AUTONOM AL CONSTRUCTORULUI = DEVIN (owner, 22 aug) ──────────
//
// Owner, 19 aug: „nu are autonomie… sa faca asta" — Kelion măsoară SINGUR de ce
// (nu) construiește și dă verdictul FERM, pe server, fără să depindă de owner.
//
// REscris 22 aug pe ordinul verbatim: „am cerut devin peste tot in constructor"
// + „am cerut sa-i stergi de tot [pe Aider+Ollama]". Toată mașinăria locală
// (proba Aider, proba Ollama, pulsul lucrătorului de pe VPS) A FOST ȘTEARSĂ —
// constructorul e DEVIN, extern: ordin → dispecerul din app → sesiune Devin →
// PR pe master. Diagnosticul măsoară exact lanțul ăsta:
//   1. cheia Devin (fără ea, dispecerul e inert prin design — se spune, roșu);
//   2. ordinele agățate: running FĂRĂ sesiune Devin (dispecerul n-a apucat /
//      a murit între claim și pornire) sau running cu sesiune de prea mult timp;
//   3. pornirile eșuate recent („Devin pornire eșuată" în log — cheie greșită,
//      quota, repo inaccesibil: motivul e în log, NUMIT);
//   4. coada care stă deși nimic nu rulează (bucla de autonomie / tick-ul mort).
// Regula #1 rămâne legea: nicio problemă nu se raportează fără măsurătoarea ei,
// iar coada necitibilă = {error}, nu „sănătos".

export interface ProblemaConstructor {
  cod: string
  severitate: 'critic' | 'atentie'
  ce: string
  recomandare: string
}

export interface OrdinRecentMasurat {
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  brain: string | null
  logTail: string
  ageSec: number
  devinSessionId: string | null
}

export interface DiagnosticConstructor {
  sanatos: boolean
  verdict: string
  probleme: ProblemaConstructor[]
  masuratori: {
    devinActiv: boolean
    inCoada: number
    inLucru: number
    esuate: number
    porniriEsuate: number // eșecuri recente de PORNIRE a sesiunii Devin
    cuPrDeschis: number // ordine done cu PR deschis (așteaptă merge-ul ownerului)
    oldestQueuedSec: number | null
    runningSec: number | null
  }
}

/** Semnătura măsurată a unei porniri Devin eșuate (reportBuildJob din dispecer
 *  scrie exact prefixul ăsta în log — vezi devinConstructor.ts). */
const RE_PORNIRE_ESUATA = /devin pornire e[șs]uat[ăa]|devin_fara_acces_repo/i

export function ordinPornireEsuata(o: OrdinRecentMasurat): boolean {
  return o.status === 'failed' && RE_PORNIRE_ESUATA.test(o.logTail || '')
}

export interface MasuratoriConstructor {
  devinActiv: boolean // config.devinKey e pusă (măsurat, nu presupus)
  ordine: OrdinRecentMasurat[]
}

export function diagnosticConstructor(m: MasuratoriConstructor): DiagnosticConstructor {
  const ordine = Array.isArray(m.ordine) ? m.ordine : []
  const queued = ordine.filter((o) => o.status === 'queued')
  const running = ordine.filter((o) => o.status === 'running')
  const esuate = ordine.filter((o) => o.status === 'failed').length
  const porniriEsuate = ordine.filter(ordinPornireEsuata).length
  const cuPrDeschis = ordine.filter((o) => o.status === 'done').length
  const oldestQueuedSec = queued.length ? Math.max(...queued.map((o) => o.ageSec)) : null
  const runningSec = running.length ? Math.max(...running.map((o) => o.ageSec)) : null

  const probleme: ProblemaConstructor[] = []

  // 1) CHEIA — fără ea, dispecerul e inert prin design: niciun ordin nu pleacă.
  if (!m.devinActiv) {
    probleme.push({
      cod: 'devin_fara_cheie',
      severitate: 'critic',
      ce: 'Cheia Devin NU e pusă pe server — dispecerul e inert, niciun ordin nu pleacă spre constructor.',
      recomandare: 'Pune DEVIN_API_KEY în mediul backend-ului (VPS) și repornește aplicația; ordinele din coadă pleacă singure la următorul tick.',
    })
  }

  // 2a) ORDIN AGĂȚAT FĂRĂ SESIUNE — claimat, dar dispecerul n-a pornit sesiunea
  //     (a murit între claim și pornire / tick-ul nu mai rulează). Watchdog-ul
  //     din db îl repune în coadă la stale, dar starea se SPUNE, nu se așteaptă
  //     în tăcere. Pragul: 5 min (tick-ul buclei e mai des; hardcod-permis:
  //     prag de diagnostic, nu de produs — schimbarea lui nu minte pe nimeni).
  const agatatFaraSesiune = running.filter((o) => !o.devinSessionId && o.ageSec > 5 * 60)
  if (m.devinActiv && agatatFaraSesiune.length) {
    probleme.push({
      cod: 'ordin_fara_sesiune',
      severitate: 'critic',
      ce: `${agatatFaraSesiune.length} ordin(e) stau „în lucru" de peste 5 min FĂRĂ sesiune Devin pornită — dispecerul nu le-a preluat (tick mort sau pornire care crapă tăcut).`,
      recomandare: 'Vezi logul serverului la [devin]; „Reia" ordinul din panou îl repune în coadă pentru următorul tick.',
    })
  }

  // 2b) SESIUNE CARE MACINĂ DE PREA MULT — Devin lucrează, dar de peste 2h pe
  //     același ordin; costul (ACU) crește. Atenționare, nu critic: poate fi
  //     un ordin chiar mare. (hardcod-permis: prag de diagnostic)
  const macinaDeMult = running.filter((o) => !!o.devinSessionId && o.ageSec > 2 * 3600)
  if (macinaDeMult.length) {
    probleme.push({
      cod: 'sesiune_lunga',
      severitate: 'atentie',
      ce: `O sesiune Devin macină de peste ${Math.round((runningSec ?? 0) / 3600)}h pe același ordin — costul (ACU) crește.`,
      recomandare: 'Deschide sesiunea din monitor (linkul ordinului) și vezi dacă a rămas blocată; „Anulează" o scoate din monitor (plafonul ACU ține costul).',
    })
  }

  // 3) PORNIRI EȘUATE — cheia e pusă, dar sesiunile NU pornesc (cheie invalidă,
  //    quota, token de repo). Motivul REAL e în logul ordinului, nu-l ghicim.
  if (m.devinActiv && porniriEsuate >= 2) {
    probleme.push({
      cod: 'devin_porniri_esuate',
      severitate: 'critic',
      ce: `${porniriEsuate} ordine recente au eșuat chiar la PORNIREA sesiunii Devin — cheia/quota/accesul la repo sunt de vină, nu ordinele.`,
      recomandare: 'Deschide un ordin eșuat și citește logul („Devin pornire eșuată: …") — motivul e numit acolo; repară-l, apoi „Reia".',
    })
  }

  // 4) COADA STĂ — cheia pusă, nimic nu rulează, dar ordinele așteaptă de mult:
  //    tick-ul dispecerului (bucla de autonomie + kick-ul din build_software)
  //    nu se mai învârte. (hardcod-permis: prag de diagnostic)
  if (m.devinActiv && !running.length && queued.length > 0 && (oldestQueuedSec ?? 0) > 10 * 60) {
    probleme.push({
      cod: 'coada_sta',
      severitate: 'critic',
      ce: `${queued.length} ordin(e) așteaptă de peste ${Math.round((oldestQueuedSec ?? 0) / 60)} min deși nimic nu rulează — tick-ul dispecerului nu se învârte.`,
      recomandare: 'Verifică pauza de autonomie (tabul Bani) și logul serverului la [devin] — cu pauza pornită, dispecerul stă intenționat.',
    })
  }

  const critice = probleme.filter((p) => p.severitate === 'critic')
  const sanatos = critice.length === 0
  const verdict = sanatos
    ? probleme.length
      ? `Constructorul (DEVIN) funcționează, dar cu ${probleme.length} atenționare(i): ${probleme[0].ce}`
      : m.devinActiv
        ? 'Constructorul DEVIN e sănătos: cheia pusă, dispecerul duce ordinele, nimic agățat.'
        : 'Constructorul DEVIN e oprit (fără cheie) — vezi problema critică.'
    : `Constructorul NU construiește: ${critice[0].ce}`

  return {
    sanatos,
    verdict,
    probleme,
    masuratori: {
      devinActiv: m.devinActiv,
      inCoada: queued.length,
      inLucru: running.length,
      esuate,
      porniriEsuate,
      cuPrDeschis,
      oldestQueuedSec,
      runningSec,
    },
  }
}

// ── GATHERER (server-side): adună măsurătorile reale și dă verdictul. Injectat cu
// dependențe ca să fie testabil și ca să nu existe DOUĂ implementări (ruta admin ȘI
// unealta de chat îl refolosesc — poarta jscpd). Întoarce {error} pe citire picată
// (regula #1: nu raportează „sănătos" peste o citire care a eșuat). ──────────────
export interface DepsDiagnosticConstructor {
  devinActiv: boolean
  listBuildJobs: (n: number) => Promise<Array<{ status: string; brain: string | null; log: string | null; updatedAt: string; devinSessionId: string | null }> | null>
  now: number
}

export async function culegeDiagnosticConstructor(
  deps: DepsDiagnosticConstructor,
): Promise<DiagnosticConstructor | { error: string }> {
  const jobs = await deps.listBuildJobs(16).catch(() => null)
  if (!jobs) return { error: 'coada_necitibila' }
  const ordine: OrdinRecentMasurat[] = jobs.map((j) => ({
    status: (['queued', 'running', 'done', 'failed', 'cancelled'].includes(j.status) ? j.status : 'failed') as OrdinRecentMasurat['status'],
    brain: j.brain ?? null,
    logTail: String(j.log ?? '').slice(-600),
    ageSec: Math.max(0, Math.round((deps.now - new Date(j.updatedAt).getTime()) / 1000)),
    devinSessionId: j.devinSessionId ?? null,
  }))
  return diagnosticConstructor({ devinActiv: deps.devinActiv, ordine })
}

// Wiring-ul REAL (o SINGURĂ implementare — ruta admin ȘI unealta de chat/voce îl
// refolosesc, fără cod duplicat, poarta jscpd). Injectează dependențele vii peste
// gatherer-ul testabil de mai sus.
export async function diagnosticConstructorViu(now: number): Promise<DiagnosticConstructor | { error: string }> {
  const { listBuildJobs } = await import('../db.js')
  const { config } = await import('../config.js')
  return culegeDiagnosticConstructor({
    devinActiv: !!config.devinKey,
    listBuildJobs: (n) => listBuildJobs(n).then((r) => r?.map((j) => ({ status: j.status, brain: j.brain, log: j.log, updatedAt: j.updatedAt, devinSessionId: j.devinSessionId ?? null })) ?? null),
    now,
  })
}
