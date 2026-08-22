import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser, adminSiId, cerAdmin } from '../session.js'
import { createBuildJob, listBuildJobs, listMonitorBuildJobs, deleteBuildJob, deleteBuildJobsByScope, retryBuildJob, cancelBuildJob } from '../db.js'
import { isOpsPaused } from '../services/runbooks.js'
import { numeleOrdinului, cineACerut } from '../services/numeOrdin.js'
import { uneltele } from '../services/autonomie.js'
import { procentDinProgres } from '../services/progresOrdin.js'
import { evalueazaOrdin, AI_CONSTRUCTORI, type BecCredit } from '../services/evalOrdinConstructor.js'
import { crediteAI, beculCredit } from '../services/creditAI.js'

// ── THE CONSTRUCTOR — the "order → code → PR" pipeline (Adrian, Jul 27:
// "Kelion must be able to create any software the admin asks for, any change,
// any improvement") ──────────────────────────────────────────────────────────
// The order enters here (from chat/voice through the build_software tool or
// from the Admin→Constructor panel); the EXECUTION is DEVIN, external (owner,
// 22 aug, verbatim: „am cerut devin peste tot in constructor… sa-i stergi de
// tot [pe Aider+Ollama]"): the in-app dispatcher (tickDispecerDevin) claims the
// queued order, opens a Devin session, polls its progress, and the result is a
// PR. THE MERGE STAYS WITH ADRIAN (his rule, Jul 27: "me doing the merge is ok").
// Becul LIVE per AI-constructor, cheiat pe subșirul stabil (becFurnizor):
// creditAI dă numele complet al furnizorului, îl potrivim cu `includes`. Un AI
// fără rând de credit rămâne necunoscut (fără cheie), nu „verde" inventat.
async function hartaCreditConstructor(): Promise<Record<string, BecCredit>> {
  const rows = await crediteAI()
  const m: Record<string, BecCredit> = {}
  for (const ai of AI_CONSTRUCTORI) {
    if (!ai.becFurnizor) continue
    const row = rows.find((r) => r.furnizor.includes(ai.becFurnizor))
    if (row) m[ai.becFurnizor] = beculCredit(row)
  }
  return m
}

export async function constructorRoutes(app: FastifyInstance): Promise<void> {
  // The admin (or Kelion through a tool) queues an order.
  app.post<{ Body: { order?: string } }>('/api/admin/constructor', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' }) // sesiune moartă ≠ „nu ești admin" (9 aug)
    if (user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const order = String(req.body?.order ?? '').trim()
    // POARTA DE CALITATE (owner, 13 aug: „să treacă orice ordin?" — NU). Ordinele
    // goale/vagi/în-afara-scopului sunt oprite AICI, cu motiv, înainte să intre în
    // coadă și să ardă credit. Poarta nu depinde de credit (doar de cerință), deci
    // rămâne rapidă — fără apel de rețea pe fiecare trimitere.
    const ev = evalueazaOrdin(order)
    if (!ev.trece) return reply.code(400).send({ error: 'ordin_respins', motiv: ev.motiv })
    // Creierul gândește MAI ÎNTÂI pentru Devin — planul se anexează ordinului.
    const { planificaOrdinConstructor } = await import('../services/devinConstructor.js')
    const orderCuPlan = await planificaOrdinConstructor(order)
    const id = await createBuildJob(user.email, orderCuPlan)
    if (!id) return reply.code(500).send({ error: 'db_indisponibil' })
    // PORNIRE IMEDIATĂ (owner, 22 aug: ordinul din PANOU nu pornea dispecerul —
    // doar cel din chat o făcea, iar ordinul aștepta bucla lentă de autonomie).
    // Un ordin EXPLICIT al ownerului pornește Devin ACUM, în fundal (idempotent:
    // UN job pe rând, claimNextBuildJob e atomic). Inert fără cheia Devin.
    if (config.devinKey) {
      void import('../services/devinConstructor.js')
        .then(({ tickDispecerDevin }) => tickDispecerDevin())
        .catch((e) => app.log.warn(`[devin] tick imediat (panou): ${String(e).slice(0, 160)}`))
    }
    return reply.send({ ok: true, id })
  })

  // Evaluarea unei cerințe ÎNAINTE de trimitere (owner, 13 aug: „ordinul X →
  // cerința evaluată → se oferă AI-urile potrivite"). Întoarce poarta de calitate
  // + AI-urile potrivite pe capacitate, cu creditul LIVE din becuri. Doar citire.
  app.post<{ Body: { order?: string } }>('/api/admin/constructor/evalueaza', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const order = String(req.body?.order ?? '')
    // Creditul live e „nice to have": dacă becurile nu se pot citi, evaluăm doar pe
    // capacitate (fără să inventăm verde/roșu).
    const credit = await hartaCreditConstructor().catch(() => undefined)
    return reply.send({ ...evalueazaOrdin(order, credit), aiuri: AI_CONSTRUCTORI })
  })

  app.get('/api/admin/constructor', async (req, reply) => {
    // P9: poarta prin cerAdmin (sursa unică) — aceleași 401/403 pentru oameni,
    // plus legitimația internă a lui Kelion (admin 2), ca `admin_vezi ordine`
    // să meargă și pe voce și în bucla autonomă, nu doar cu cookie-ul ownerului.
    const user = cerAdmin(req, reply)
    if (!user) return
    // AUDIT ADMIN (3 aug): coada necitibilă (DB picat) → 500, nu 200 cu [] —
    // panoul scria „Niciun ordin încă" fără nicio măsurătoare reușită.
    const raw = await listBuildJobs(40)
    if (!raw) return reply.code(500).send({ error: 'db_unreadable' })
    // BARA 0–100% (Adrian, 3 aug): `pct` e harta etapei REALE raportate de
    // lucrător (progresOrdin.ts) — bara din panou o afișează lângă textul
    // etapei, ca cifra să poată fi confruntată oricând cu sursa ei.
    const jobs = raw.map((j) => ({
      ...j,
      // Job Devin → bară INDETERMINATĂ (pct null), nu un procent înghețat/mințit
      // (vezi nota de la /api/constructor/live).
      pct: j.devinSessionId ? null : procentDinProgres(j.status, j.progress),
      // P8 (owner, 15 aug: „trebuie sa fie foarte clar ce executa"): numele
      // rândului = FAPTA extrasă din ordin, nu ambalajul promptului.
      nume: numeleOrdinului(j.orderText),
      // 16 aug: și AUTORUL, pe față — „cine e acolo?" nu se mai întreabă.
      cerutDe: cineACerut(j.orderedBy),
    }))
    // `paused` (auditul admin, 3 aug): pauza de autonomie oprește dispecerul,
    // dar Constructorul n-o arăta nicăieri — ordinul stătea „în coadă · 0%" la
    // nesfârșit fără explicație. Panoul afișează bannerul.
    // (Probele locale au fost ȘTERSE cu toată mașinăria locală: owner, 22 aug,
    // „am cerut devin peste tot in constructor… sa-i stergi de tot".)
    return reply.send({
      jobs,
      paused: await isOpsPaused().catch(() => false),
      // CINE E CONSTRUCTORUL — MĂSURAT din config, nu scris de mână în panou
      // (owner, 22 aug: panoul afișa „Ollama local free" HARDCODAT, fără nicio
      // măsurătoare, deci nu putea răspunde la „de ce nu e Devin?"). Cu cheia
      // pusă, dispecerul duce ordinele în sesiuni Devin (→ PR pe master); fără
      // cheie NU construiește nimeni — se spune, roșu, cu numele variabilei.
      constructor: config.devinKey
        ? { cine: 'devin' as const, motiv: 'cheia Devin e pusă — dispecerul duce ordinele în sesiuni Devin (rezultatul: PR pe master)' }
        : { cine: 'local' as const, motiv: 'cheia Devin NU e pusă pe server — dispecerul e inert și niciun ordin nu pleacă; pune DEVIN_API_KEY în mediul backend-ului' },
    })
  })

  // ── DIAGNOSTICUL AUTONOM AL CONSTRUCTORULUI (owner, 19 aug: „nu are autonomie…
  // sa faca asta") ─────────────────────────────────────────────────────────────
  // Kelion măsoară SINGUR de ce (nu) construiește DEVIN — cheia, ordinele agățate
  // fără sesiune, pornirile eșuate, coada care stă — și dă verdictul FERM. Pe
  // server (acces real), fără să depindă de owner. Aceeași sursă unică
  // (culegeDiagnosticConstructor) ca unealta de chat/voce. Doar citire, admin.
  app.get('/api/admin/constructor/diagnostic', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const { diagnosticConstructorViu } = await import('../services/diagnosticConstructor.js')
    const diagnostic = await diagnosticConstructorViu(Date.now())
    if ('error' in diagnostic) return reply.code(500).send(diagnostic)
    return reply.send(diagnostic)
  })

  // (Istoric, pe scurt: comutatorul „creier 2 cloud" + sursa plătită au fost
  // scoase pe 20 aug; comutatorul „Fable 5 forțat" pe 16 aug; iar pe 22 aug
  // ÎNTREAGA mașinărie locală a fost ștearsă — constructorul e DEVIN, extern.
  // Vezi AI-HANDOFF.md.)

  // ── ȘTERGE / CURĂȚĂ / REIA din PANOU (Adrian, 3 aug: „aici nu apar butoane de
  // ștergere" + „scoate 30/31 dacă nu le poate face, ai funcțiile făcute") ─────
  // Funcțiile existau demult în db.ts (deleteBuildJob / deleteBuildJobsByScope /
  // retryBuildJob) și erau folosite DOAR de unealta `constructor_manage` a lui
  // Kelion din chat. Panoul n-avea nicio rută spre ele → niciun buton. Le expun
  // aici, admin-only ca restul panoului. Ștergerea nu atinge un ordin 'running'
  // decât la scope='all' — un ordin viu nu piere din greșeală.
  app.delete<{ Params: { id: string } }>('/api/admin/constructor/:id', async (req, reply) => {
    const id = adminSiId(req, reply, req.params.id)
    if (id === null) return
    const sters = await deleteBuildJob(id)
    return reply.send({ ok: sters })
  })

  // Ștergere în GRUP: scope=failed|done|failed_done|all (implicit failed_done —
  // curăță istoricul „eșuat/GATA", lasă cele vii). Întoarce câte a șters.
  app.post<{ Body: { scope?: string } }>('/api/admin/constructor/curata', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' }) // sesiune moartă ≠ „nu ești admin" (9 aug)
    if (user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const scope = ['failed', 'done', 'failed_done', 'all'].includes(String(req.body?.scope))
      ? (String(req.body?.scope) as 'failed' | 'done' | 'failed_done' | 'all')
      : 'failed_done'
    // AUDIT ADMIN (3 aug): eroarea de DB devenea „Curățat: 0 ordine șterse."
    // — zero fals. null = eșec → 500 („Nu s-a putut curăța." în panou);
    // 0 rămâne posibil doar ca număr real.
    const sterse = await deleteBuildJobsByScope(scope)
    if (sterse === null) return reply.code(500).send({ error: 'db_unreadable' })
    return reply.send({ ok: true, sterse })
  })

  // ANULAREA unui ordin viu (auditul admin, 3 aug): cancelBuildJob exista în
  // db.ts din 3 aug, dar era legat DOAR de unealta constructor_manage din chat
  // — un ordin 'running' nu putea fi oprit din panou (✕ e ascuns pe running).
  // Aici e ruta pe care o cheamă butonul „oprește" de pe rândurile în curs.
  app.post<{ Params: { id: string } }>('/api/admin/constructor/:id/anuleaza', async (req, reply) => {
    const id = adminSiId(req, reply, req.params.id)
    if (id === null) return
    const oprit = await cancelBuildJob(id)
    return reply.send({ ok: oprit })
  })

  // Reia un ordin (îl repune în coadă, attempts=0), opțional cu textul reformulat.
  app.post<{ Params: { id: string }; Body: { order?: string } }>('/api/admin/constructor/:id/reia', async (req, reply) => {
    const id = adminSiId(req, reply, req.params.id)
    if (id === null) return
    const job = await retryBuildJob(id, req.body?.order)
    if (!job) return reply.code(409).send({ error: 'nu_se_poate_relua' })
    // „Reia" = ordin explicit → pornește Devin ACUM (la fel ca ordinul nou).
    if (config.devinKey) {
      void import('../services/devinConstructor.js')
        .then(({ tickDispecerDevin }) => tickDispecerDevin())
        .catch((e) => app.log.warn(`[devin] tick imediat (reia): ${String(e).slice(0, 160)}`))
    }
    return reply.send({ ok: true, job })
  })

  // ── LUCRĂTORUL LOCAL A FOST ȘTERS DE TOT (owner, 22 aug, verbatim: „am cerut
  // devin peste tot in constructor") ─────────────────────────────────────────
  // Rutele lui de bridge (tool-defs / next / ajutor / context / report /
  // progress, toate pe x-bridge-secret) serveau exclusiv workerul local —
  // mașinăria aia nu mai există: constructorul e DEVIN, extern, iar drumul
  // ordinului e build_software → coadă → dispecerul din app (tickDispecerDevin)
  // → sesiune Devin → PR pe master. Cronul vechi de pe VPS primește 404 aici —
  // semnalul lui de moarte; deploy.sh îl scoate din crontab la publicare.

  // ── UNELTELE CASEI PENTRU SCRIPTURILE DE PE GAZDĂ (NU e a lucrătorului!) ──
  // deploy/auto-publicare.sh cheamă build_software prin ruta asta (TOOL_URL)
  // ca să depună ordine de reparație când publicarea pică — rămâne, pe
  // x-bridge-secret, exact ca /api/ops/pulse. (Inventarul din 22 aug era s-o
  // șteargă cu restul — auto-publicarea ar fi rămas fără mâini.)
  app.post<{ Body: { name?: string; args?: Record<string, unknown> } }>('/api/constructor/tool', async (req, reply) => {
    if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
      return reply.code(401).send({ error: 'unauthorized' })
    const name = String(req.body?.name ?? '')
    if (!name) return reply.code(400).send({ error: 'bad_request' })
    const rezultat = await uneltele(name, req.body?.args ?? {}).catch((e: Error) =>
      JSON.stringify({ error: e.message }),
    )
    return reply.send({ rezultat })
  })

  // The jobs to show on the monitor (active + recently finished) + their
  // current step — for the live panel in the frontend (admin session; Stage
  // 4b). Also includes `done`/`failed` from the last minutes, so the panel
  // shows the ENDING (Done/Failed), not just the road to it.
  app.get('/api/constructor/live', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' }) // sesiune moartă ≠ „nu ești admin" (9 aug)
    if (user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const jobs = await listMonitorBuildJobs()
    return reply.send({
      // P8: `order` devine FAPTA (numeleOrdinului), nu primele litere ale
      // promptului — monitorul arată „ce execută", cum a cerut ownerul.
      // 16 aug 05:47 (ownerul, pe #330: „aici nu esti tu" / „cine e acolo?"):
      // cardul spune de-acum CINE a cerut ordinul — omul, sau o buclă automată
      // pe nume. Un ordin fără autor vizibil arată ca o fantomă.
      // BARA ONESTĂ PE DEVIN (owner 20 aug: „bara reală"): un job rulat de Devin
      // NU are procent fin — `procentDinProgres` n-ar recunoaște textul lui și ar
      // întoarce un 5% ÎNGHEȚAT, adică un procent MINȚIT. Trimitem `pct: null` →
      // frontend-ul ascunde bara determinată și arată doar textul + rotița
      // (indeterminat = „lucrează"), exact legea măsurătorii.
      jobs: jobs.map((j) => ({ id: j.id, status: j.status, order: numeleOrdinului(j.orderText), cerutDe: cineACerut(j.orderedBy), progress: j.progress, pct: j.devinSessionId ? null : procentDinProgres(j.status, j.progress), ci: j.ci, prUrl: j.prUrl, attempts: j.attempts, updatedAt: j.updatedAt })),
    })
  })
}
