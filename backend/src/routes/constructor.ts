import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser, adminSiId } from '../session.js'
import { createBuildJob, claimNextBuildJob, reportBuildJob, listBuildJobs, updateBuildJobProgress, listMonitorBuildJobs, deleteBuildJob, deleteBuildJobsByScope, retryBuildJob, cancelBuildJob, recordCost } from '../db.js'
import type { OrMessage } from '../services/brainContract.js'
import { uneltePentruCreier2, raspunsCreier2 } from '../services/creier2Constructor.js'
import { isOpsPaused } from '../services/runbooks.js'
import { autonomActiv } from '../services/autonomActiv.js'
import { sendMail } from '../services/mail.js'
import { uneltele } from '../services/autonomie.js'
import { procentDinProgres } from '../services/progresOrdin.js'
import { evalueazaOrdin, AI_CONSTRUCTORI, type BecCredit } from '../services/evalOrdinConstructor.js'
import { crediteAI, beculCredit } from '../services/creditAI.js'
import { UNELTE_CONSTRUCTOR } from '../services/brainToolDefs.js'
import { notifyAdmin } from '../services/adminNotification.js'

// ── THE CONSTRUCTOR — the "order → code → PR" pipeline (Adrian, Jul 27:
// "Kelion must be able to create any software the admin asks for, any change,
// any improvement") ──────────────────────────────────────────────────────────
// The order enters here (from chat/voice through the build_software tool or
// from the Admin→Constructor panel); the EXECUTION is on the VPS:
// deploy/constructor-worker.sh (cron every 2 min, flock, short jobs with
// timeouts — NOT permanent daemons, the lesson of the old ecosystem that
// burned the subscription) calls deploy/constructor-agent.mjs — the agentic
// loop on the Gemini API (the owner's key, hard caps), which works in a
// separate clone (the workshop), runs build + tests and opens the PR. THE
// MERGE STAYS WITH ADRIAN (his rule, Jul 27: "me doing the merge is ok").
// ── ALARMA DE CREIER CĂZUT ÎN LANȚ (owner, 14 aug: „constructorul blocat… nu
// știu cum raportezi funcțional" + „trebuie rezolvată definitiv partea cu
// eșuatul ordinelor"). Un ordin al cărui creier pică NU moare — se reia
// („amânabil") — dar până azi cicla ÎN TĂCERE: 5% pe panou ore întregi, niciun
// semn către owner, iar motivul EXACT (cheie invalidă, credit terminat) murea
// în log. De-acum: la 3 eșecuri CONSECUTIVE ale rutei de creier, notificare
// TARE în panou cu motivul măsurat — cel mult una la 30 min (semnal, nu spam).
// Orice succes (oricare creier) resetează numărătoarea.
let esecuriCreierLaRand = 0
let ultimaAlarmaCreierLa = 0
function creierApicat(motiv: string): void {
  esecuriCreierLaRand++
  const acum = Date.now()
  if (esecuriCreierLaRand >= 3 && acum - ultimaAlarmaCreierLa > 30 * 60_000) {
    ultimaAlarmaCreierLa = acum
    void notifyAdmin(
      'scris',
      'Creierul constructorului pică în lanț — ordinele NU avansează',
      `${esecuriCreierLaRand} cereri de creier picate la rând. Motivul măsurat: „${motiv.slice(0, 300)}". ` +
        'Ordinele se reiau singure când creierul își revine — dar până atunci stau pe loc. ' +
        'De verificat: creditul Gemini și cheia ANTHROPIC_API_KEY (becul Fable 5 arată proba reală).',
      { esecuri: esecuriCreierLaRand, motiv: motiv.slice(0, 300) },
    ).catch(() => 0)
  }
}

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
    const id = await createBuildJob(user.email, order)
    if (!id) return reply.code(500).send({ error: 'db_indisponibil' })
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
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' }) // sesiune moartă ≠ „nu ești admin" (9 aug)
    if (user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    // AUDIT ADMIN (3 aug): coada necitibilă (DB picat) → 500, nu 200 cu [] —
    // panoul scria „Niciun ordin încă" fără nicio măsurătoare reușită.
    const raw = await listBuildJobs(40)
    if (!raw) return reply.code(500).send({ error: 'db_unreadable' })
    // BARA 0–100% (Adrian, 3 aug): `pct` e harta etapei REALE raportate de
    // lucrător (progresOrdin.ts) — bara din panou o afișează lângă textul
    // etapei, ca cifra să poată fi confruntată oricând cu sursa ei.
    const jobs = raw.map((j) => ({
      ...j,
      pct: procentDinProgres(j.status, j.progress),
    }))
    // `paused` (auditul admin, 3 aug): pauza de autonomie oprea și lucrătorul
    // (/api/constructor/next nu predă nimic), dar Constructorul n-o arăta
    // nicăieri — ordinul stătea „în coadă · 0%" la nesfârșit după promisiunea
    // „max. 2 minute". Panoul afișează bannerul și corectează promisiunea.
    return reply.send({ jobs, paused: await isOpsPaused().catch(() => false) })
  })

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
    return reply.send({ ok: true, job })
  })

  // SURSA UNICĂ DE UNELTE pentru lucrător (Adrian, 10 aug: „dă-i TOT"). Worker-ul
  // le cere la pornire și le lipește peste uneltele lui locale de fișiere. Așa
  // constructorul are automat aceleași unelte de dev/ops ca creierul de chat,
  // fără să le mai țină cineva la zi de mână. x-bridge-secret, ca /next.
  app.get('/api/constructor/tool-defs', async (req, reply) => {
    if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
      return reply.code(401).send({ error: 'unauthorized' })
    // Formatul OpenAI (function) — exact ce așteaptă agentul (Gemini/DeepSeek).
    const tools = UNELTE_CONSTRUCTOR.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }))
    return reply.send({ tools })
  })

  // ── The VPS worker's endpoint (x-bridge-secret auth, like ops/pulse) ─────
  // Adrian's "autonomy pause" stops the constructor too: while paused, no
  // orders are handed to the worker (queued ones wait, they aren't lost).
  //
  // AMBELE COMUTATOARE OPRESC LUCRĂTORUL (owner, 13 aug, incident VPS 1000%):
  // erau DOUĂ butoane diferite — „pauză autonomie" (isOpsPaused / kelion_ops_paused)
  // ȘI „motoare autonome" (autonomActiv / autonom:activ). Lucrătorul asculta DOAR
  // primul. Owner-ul a apăsat al doilea („motoare autonome OFF") ca să oprească
  // totul — dar lucrătorul a continuat să ceară ordine și să construiască, până a
  // sufocat VPS-ul. Exact regula #1: butonul spunea „oprit", iar lucrătorul nu se
  // uita la el. Acum ORICARE dintre comutatoare oprește lucrătorul.
  app.get('/api/constructor/next', async (req, reply) => {
    if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
      return reply.code(401).send({ error: 'unauthorized' })
    if ((await isOpsPaused()) || !(await autonomActiv().catch(() => true)))
      return reply.send({ job: null, paused: true })
    const job = await claimNextBuildJob()
    return reply.send({ job })
  })

  // ── CREIERUL CONSTRUCTORULUI, PRIN APP: GEMINI (principal) → FABLE 5 (rezervă) ─
  // Owner, 13 aug: „creierul 2 nu e legat la constructor… supervizează 24/7" →
  // legătura asta. Owner, 14 aug: „schimbă-mi constructorul cu gemeni ultra… când
  // nu merge repara să cadă pe fable 5, înlocuiește peste tot" → Gemini devine
  // PRINCIPALUL (nu doar plasa), iar rezerva e Fable 5. Constructorul cere creierul
  // DOAR pe ruta asta (gardată cu x-bridge-secret) — cheile Gemini ȘI Anthropic stau
  // AICI, în app, NU în constructor (regula: constructorul nu ține chei de furnizor
  // și nu cheamă direct API-uri externe). Formatul e OpenAI, identic cu ce aștepta
  // constructorul, deci bucla lui nu știe pe ce creier merge. Cheltuiala Gemini se
  // ÎNREGISTREAZĂ (recordCost) ca banii să apară în panoul Bani, nu pe ascuns.
  // ESCALADARE+REVENIRE: Gemini întâi; dacă nu poate → Fable 5; iar fiindcă FIECARE
  // pas reintră pe rută, se revine SINGUR pe Gemini când acesta își revine. Dacă
  // pică ambele → eroare, iar constructorul o clasifică „amânabil" și reia.
  app.post<{ Body: { messages?: OrMessage[]; tools?: unknown[]; model?: string } }>(
    '/api/constructor/creier',
    async (req, reply) => {
      if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
        return reply.code(401).send({ error: 'unauthorized' })
      const messages = Array.isArray(req.body?.messages) ? (req.body.messages as OrMessage[]) : []
      if (!messages.length) return reply.code(400).send({ error: 'fara_mesaje' })
      const rawTools = Array.isArray(req.body?.tools) ? req.body.tools : []
      // ── PRINCIPAL: GEMINI „ULTRA" (owner, 14 aug: „ultra ca al doilea creier,
      // da? primul e blocat") = constructorGeminiModel (gemini-pro-latest — mereu
      // cel mai puternic Pro; NU modelul unic al chatului, care e sigilat pe flash
      // pentru viteză. Constructorul lucrează în fundal — puterea bate viteza).
      // Până azi ruta folosea geminiModelGreu crezând că e Pro; din 7 aug modelul
      // unic e flash, deci constructorul moștenise flash. Reparat: treaptă proprie.
      const { geminiDirectAvailable, geminiDirectChat } = await import('../services/geminiDirect.js')
      let gemeniEsec = ''
      if (geminiDirectAvailable()) {
        // Uneltele constructorului (OpenAI function) → formatul geminiDirectChat;
        // răspunsul → înapoi în format OpenAI. Punțile sunt în creier2Constructor.ts.
        const tools = uneltePentruCreier2(rawTools)
        const candidateModels = [
          String(req.body?.model ?? '').trim() || config.constructorGeminiModel,
          config.geminiModelGreu,
          config.geminiModel,
        ].filter((m, idx, arr) => m && arr.indexOf(m) === idx)

        for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
          const m = candidateModels[mIdx]
          const isPrimary = mIdx === 0
          const maxIncercariGemini = isPrimary ? 2 : 1
          // Timeout generos pentru raționament complex / fișiere mari:
          // Gemini Pro cu reasoning high are nevoie de până la 90s pe prompturi dense.
          const modelTimeoutMs = isPrimary ? 95_000 : 65_000
          const reasoningLevel = isPrimary ? 'high' : 'medium'

          for (let incercare = 1; incercare <= maxIncercariGemini; incercare++) {
            try {
              const r = await geminiDirectChat(m, messages, tools, {
                reasoning: reasoningLevel,
                toolChoice: 'required',
                timeoutMs: modelTimeoutMs,
              })
              if (r.costUsd > 0) void recordCost('kelion-constructor', 'gemini', r.costUsd)
              esecuriCreierLaRand = 0 // creierul a servit — lanțul de eșecuri s-a rupt
              return reply.send(raspunsCreier2(r))
            } catch (e) {
              const errStr = (e as Error).message || ''
              gemeniEsec = errStr.slice(0, 200)
              const isTimeout = /timeout|aborted/i.test(errStr)
              const isTransient = isTimeout || /503|502|504|500|429|overload|unavailable|resource_exhausted|high demand|econnreset/i.test(errStr)
              // La timeout pe modelul curent, trecem direct la următorul model candidat
              if (isTimeout) break
              if (incercare < maxIncercariGemini && isTransient) {
                await new Promise((resolve) => setTimeout(resolve, incercare * 1000))
                continue
              }
              break
            }
          }
        }
      } else {
        gemeniEsec = 'gemini_indisponibil (cheie lipsă)'
      }
      // ── REZERVĂ: FABLE 5 (owner, 14 aug: „când nu merge repara vreau să cadă pe
      // fable 5"). Tot PRIN APP (cheia Anthropic stă aici, nu în constructor);
      // mesajele+uneltele sunt convertite conform endpoint-ului Anthropic (/v1/messages).
      // REVENIRE: fiecare pas nou reîncepe cu Gemini (mai sus), deci
      // se revine SINGUR pe principal când Gemini își revine — nu rămâne pe rezervă.
      const { fable5Disponibil, fable5Chat } = await import('../services/fable5Constructor.js')
      if (fable5Disponibil()) {
        try {
          const rasp = await fable5Chat(messages, rawTools)
          esecuriCreierLaRand = 0 // rezerva a servit — lanțul de eșecuri s-a rupt
          return reply.send(rasp)
        } catch (e) {
          const motiv = `creier_esec: gemini(${gemeniEsec}) → fable5(${(e as Error).message.slice(0, 160)})`
          creierApicat(motiv) // AMBELE creiere jos — la 3 la rând, alarmă în panou
          return reply.code(502).send({ error: motiv })
        }
      }
      // Nici Gemini, nici rezerva Fable 5 (fără ANTHROPIC_API_KEY în app) — onest.
      const motiv = `creier_esec: gemini(${gemeniEsec}); rezerva Fable 5 INACTIVĂ (pune ANTHROPIC_API_KEY în app)`
      creierApicat(motiv)
      return reply.code(gemeniEsec.includes('indisponibil') ? 503 : 502).send({ error: motiv })
    },
  )

  app.post<{
    Body: { id?: number; status?: string; branch?: string; prUrl?: string; tokens?: number; log?: string; ci?: string; brain?: string; costUsd?: number }
  }>('/api/constructor/report', async (req, reply) => {
    if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
      return reply.code(401).send({ error: 'unauthorized' })
    const id = Number(req.body?.id ?? 0)
    const status = req.body?.status === 'done' ? 'done' : 'failed'
    if (!id) return reply.code(400).send({ error: 'id_lipsa' })
    // THE INDEPENDENT VERIFICATION VERDICT (Stage 6): 'verde' = CI re-ran
    // build+tests on a clean machine and it passed; 'roșu' = it failed;
    // 'în curs' = it couldn't be confirmed within the worker's budget (the
    // workshop had passed anyway).
    const ci = ['verde', 'roșu', 'în curs'].includes(String(req.body?.ci)) ? String(req.body?.ci) : undefined
    // THE BRAIN USED (Adrian, Aug 2: "Everything FREE. The admin can EXPRESSLY
    // request the paid Fable 5 brain for the CONSTRUCTOR only"): only two
    // honest labels are accepted — 'fable-5' (paid, expressly marked in the
    // order — istoric; agentul e Gemini-only din 3 aug) or 'free'. The cost is
    // the one MEASURED by the worker from the provider's usage; anything
    // non-numeric/negative is dropped, so the Money views never show a
    // fabricated figure. Marcajul 'fable-5' rămâne ACCEPTAT în API (un worker
    // vechi nu trebuie să pice pe raport), dar UI-ul nu-l mai oferă.
    const brain = ['fable-5', 'free'].includes(String(req.body?.brain)) ? String(req.body?.brain) : undefined
    const costRaw = Number(req.body?.costUsd)
    const costUsd = Number.isFinite(costRaw) && costRaw >= 0 ? costRaw : undefined
    await reportBuildJob(id, {
      status,
      branch: req.body?.branch,
      prUrl: req.body?.prUrl,
      tokens: Number(req.body?.tokens ?? 0),
      log: req.body?.log,
      ci,
      brain,
      costUsd,
    })
    // ANUNȚ DE ESCALADARE (K10, Adrian: „când creierul nu poate, să te anunțe
    // «bifează creier superior»"). Dacă ordinul a picat fiindcă MODELUL nu a dus
    // sarcina (nu o poartă roșie de cod), pun o notificare în panou cu ce e de
    // făcut — nu doar un email care se pierde. Distins prin semnătura din log.
    if (status === 'failed') {
      const motiv = String(req.body?.log ?? '')
      const creierNuPoate =
        /creier|brain|r[ăa]spuns gol|indisponibil|f[ăa]r[ăa] nicio modificare|nu ai scris nimic|\b(401|403)\b|model (invalid|refuzat|nu)/i.test(
          motiv,
        )
      if (creierNuPoate) {
        void notifyAdmin(
          'scris',
          `Ordin #${id}: creierul constructorului nu a putut`,
          `Ordinul de build #${id} a eșuat fiindcă modelul constructorului nu a dus sarcina (nu din cauza unei porți roșii de cod). Escaladează la un creier superior: pune CONSTRUCTOR_MODEL pe un model plătit + CONSTRUCTOR_ALLOW_PAID=1, apoi reia ordinul (constructor_manage retry). Motiv: „${motiv.slice(0, 200)}".`,
          { jobId: id, motiv: motiv.slice(0, 300) },
        ).catch(() => 0)
      }
    }
    // The report to Adrian — by email, with the PR to press (the merge is his).
    const dovadaCI =
      ci === 'verde'
        ? 'Verificare INDEPENDENTĂ: CI verde pe o mașină curată (build + teste re-rulate). ✅'
        : ci === 'în curs'
          ? 'Verificare independentă (CI): încă rulează pe PR — atelierul trecuse deja build + teste.'
          : 'Build + teste verificate în atelier.'
    const subject =
      status === 'done'
        ? `[Kelion] Constructorul a terminat ordinul #${id} — PR gata de merge`
        : `[Kelion] Constructorul a EȘUAT la ordinul #${id}`
    // The brain is stated in the email too (Aug 2 rule: the model choice must
    // be VISIBLE everywhere the order is reported). A Fable order says what it
    // cost — measured, or honestly "not reported by the provider".
    const linieCreier =
      brain === 'fable-5'
        ? `Creier: Fable 5 (marcaj istoric — agentul e Gemini-only) — ${costUsd != null ? `cost măsurat: $${costUsd.toFixed(4)}` : 'cost neraportat de furnizor'}.\n\n`
        : brain === 'free'
          ? `Creier: gratuit (:free).\n\n`
          : ''
    const body =
      status === 'done'
        ? `Ordinul #${id} e construit. ${dovadaCI}\n\n${linieCreier}PR: ${req.body?.prUrl ?? '(lipsă)'}\n\nDai merge → auto-publicarea îl duce live singură în ~3 minute.`
        : ci === 'roșu'
          ? `Ordinul #${id}: verificarea INDEPENDENTĂ (CI) a picat pe PR, deși atelierul trecuse.\n\nPR: ${req.body?.prUrl ?? '(lipsă)'}\n\nUltimele rânduri din jurnal:\n${String(req.body?.log ?? '').slice(-1500)}\n\nNU da merge până nu e verde — ordinul rămâne în panou.`
          : `Ordinul #${id} nu a putut fi finalizat.\n\nUltimele rânduri din jurnal:\n${String(req.body?.log ?? '').slice(-1500)}\n\nOrdinul rămâne în panou (Admin→Constructor); poți să-l repui cu alt enunț.`
    void sendMail({ to: config.adminEmail, subject, html: body.replace(/\n/g, '<br>'), text: body }).catch(() => {})
    return reply.send({ ok: true })
  })

  // ── LIVE PROGRESS (autonomy Stage 4, Jul 29) ─────────────────────────────
  // The VPS worker sends its current step HERE (cloned → editing X → build →
  // opening PR...) as it works — the mirror of /report, same x-bridge-secret
  // auth. It does NOT change the terminal status (updateBuildJobProgress only
  // writes on `running` jobs). That way the state is no longer a black box
  // between "Picked up" and "Done": the monitor can show it, and Kelion can
  // NARRATE it.
  app.post<{ Body: { id?: number; progress?: string } }>('/api/constructor/progress', async (req, reply) => {
    if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
      return reply.code(401).send({ error: 'unauthorized' })
    const id = Number(req.body?.id ?? 0)
    const progress = String(req.body?.progress ?? '').trim()
    if (!id || !progress) return reply.code(400).send({ error: 'bad_request' })
    await updateBuildJobProgress(id, progress)
    return reply.send({ ok: true })
  })

  // ── THE HEAVY TOOLS, IN THE CONSTRUCTOR'S HAND (Adrian, Jul 30: "I asked
  // for fully equipped agents and you gave them only trinkets") ──────────────
  // He was right. The constructor had 7 tools — ls/grep/read/write/edit/run/
  // finish — so it could write code, but it couldn't open a site and couldn't
  // set a key. An order asking for a portal was impossible for it, and it
  // would have failed three times on the owner's money.
  //
  // Here it gets the browser (the 9 real tools, Playwright in-process) and the
  // secrets (secret_pune/lista/publica). The dispatch is THE SAME as the
  // autonomous loop's — a single implementation, imported, not copied.
  //
  // The gate: `x-bridge-secret`, like the rest of the worker endpoint. Beyond
  // it sit tools that touch the internet and the keys — so no other access
  // path.
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
      jobs: jobs.map((j) => ({ id: j.id, status: j.status, order: j.orderText.slice(0, 120), progress: j.progress, pct: procentDinProgres(j.status, j.progress), ci: j.ci, prUrl: j.prUrl, attempts: j.attempts, updatedAt: j.updatedAt })),
    })
  })
}
