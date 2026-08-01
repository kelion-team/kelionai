import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { getSpeechLang, setSpeechLangPref, getMeserieActiva, saveMessage, getBalance, debitWallet, recordCost, getRecentHistory, saveNote, listNotes, deleteNote, setMeserieActivaPref, getVoicePref, getVoiceprint, saveVoiceprint, vectorDistance, createBuildJob, listBuildJobs, loadKv, saveKv, getHistory } from '../db.js'
import { grantUnlock, isArmed, hasUnlock, marcheazaVoce } from '../services/adminLock.js'
import { SERPER_USD_PER_CALL, IMAGE_USD_PER_CALL, VOICE_USD_PER_MINUTE } from '../services/cost.js'
import { trackSpeechLang, langLabel } from '../services/lang.js'
import { getMeserie } from '../services/meserii.js'
import { openaiRealtimeAnswer } from '../services/realtime.js'
import { isQuotaError, alertOpenAiQuota } from '../services/openaiAlert.js'
import { runGoogleTool, googleTools, refreshGoogleAccessToken, reverseGeocodeCached } from '../services/google.js'
import { interpretDeviceCommand } from '../services/commands.js'
// §1: THE LIVE BROWSER ON VOICE TOO (it was dormant — 9 capabilities). The server
// runs Chromium as in writing and returns `screen` with the screenshot; the
// client puts it on the monitor through the channel that already existed
// (handleControl → monitor).
import {
  browserOpen, browserClick, browserType, browserRead, browserBack,
  browserScroll, browserKey, browserClickAt, browserClose,
} from '../services/browser.js'
import { inferGender, type VoiceFeatures } from './voiceprint.js'
import { generateImage } from '../services/image.js'
import { brainComplete, describeScene } from '../services/brain.js'
// §6 SINGLE BRAIN: voice escalates through the SAME orchestrator + model selection as writing.
import { voiceBrainTurn } from '../services/voiceBrainTurn.js'
import { resolveModel, type AnthropicTool } from '../services/openrouter.js'
import { geminiDirectAvailable, GEMINI_DIRECT_PREFIX } from '../services/geminiDirect.js'
// SINGLE BRAIN §1 ("no duplication"): the introspection/builder tool definitions
// come from the SHARED source, no longer copied inline here.
import {
  BROWSER_TOOLS,
  COST_TOOL, LIST_UPDATES_TOOL, SERVER_LOGS_TOOL, READ_INBOX_TOOL,
  LOG_GAP_TOOL, LIST_MEMORIES_TOOL, FORGET_MEMORY_TOOL,
  LIST_SOURCE_TOOL, READ_SOURCE_TOOL, SEARCH_SOURCE_TOOL,
  DB_TABLES_TOOL, DB_QUERY_TOOL, SYSTEM_HEALTH_TOOL,
  BUILD_SOFTWARE_TOOL, CONSTRUCTOR_STATUS_TOOL,
} from '../services/brainToolDefs.js'
import { recallMemories } from '../services/agents.js'
import { dynamicToolNames, runDynamicTool } from '../services/dynamicTools.js'
import { buildPromo } from '../services/promo.js'
import {
  SYSTEM_PROMPT,
  // THE AUTONOMY PATH ON VOICE (Adrian, Jul 29: "from my request to the final
  // deploy, on all routes") — the same tool definitions as writing (single
  // source, imported, not duplicated), so voice too can reach production.
  RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL,
  REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL, REQUEST_REPAIR_TOOL,
  PROPOSE_TOOL, SHOW_DOCUMENT_TOOL, PROMO_TOOL,
  SECRET_PUNE_TOOL, SECRET_LISTA_TOOL, SECRET_PUBLICA_TOOL,
  CERINTA_NOUA_TOOL, CERINTE_LISTA_TOOL, CERINTA_PRIORITATE_TOOL,
} from './chat.js'
// SINGLE dispatch of the shared admin tools (chat ∩ voice) — no duplication (risk #4).
import { execUserScopedTool, execSharedAdminTool } from '../services/adminTools.js'
import { formatDeviceTime } from '../services/timeContext.js'

// ── LIVE VOICE (OpenAI Realtime) — endpoints brought into git as single source ─
// /api/realtime/session : SDP proxy. The client (browser WebRTC) sends the SDP
//   offer + language; the backend relays to OpenAI with the key on the server and
//   injects the model + a single male voice + the persona in the user's
//   PERSISTED language.
// /api/realtime/transcript : saves what was spoken into the history (for memory
//   and continuity between sessions), just like a chat turn.
//
// NO free tier: voice requires a logged-in user (Adrian: "remove the test
// minutes, users buy to try it"). The demo voice on the landing (no login, paid
// from the admin account) is handled separately, in another endpoint.
// ── §1: THE LIVE BROWSER, SINGLE EXECUTOR FOR VOICE ───────────────────────────
// The same tools as in writing (Chromium on the server). The result carries
// `shotUrl` (locally served, embeddable screenshot) → the route sends it as
// `screen`, and the client puts it on the monitor through the channel that
// already existed. One single place, used by both the direct call and the
// escalated brain (the permanent principle: single, no duplicates).
async function runBrowserTool(
  name: string,
  args: Record<string, unknown>,
  base: string,
  email: string,
): Promise<unknown> {
  const idx = Number(args.index ?? 0)
  switch (name) {
    case 'browser_open': return browserOpen(email, base, String(args.url ?? ''))
    case 'browser_click': return browserClick(email, base, idx)
    case 'browser_type': return browserType(email, base, idx, String(args.text ?? ''), Boolean(args.submit))
    case 'browser_read': return browserRead(email, base)
    case 'browser_back': return browserBack(email, base)
    case 'browser_scroll': return browserScroll(email, base, String(args.direction ?? 'down') as 'up' | 'down')
    case 'browser_key': return browserKey(email, base, String(args.key ?? ''))
    case 'browser_click_at': return browserClickAt(email, base, Number(args.x ?? 0), Number(args.y ?? 0))
    case 'browser_close': { await browserClose(email); return { closed: true } }
    default: return { error: 'unealtă de browser necunoscută' }
  }
}

export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { sdp?: string; language?: string; coords?: { lat?: number; lon?: number }; now?: string; tz?: string } }>(
    '/api/realtime/session',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })

      // VOICE PAYWALL (Jul 25 — a REAL money hole found at audit): the written
      // chat blocked at 0 credits, but voice started sessions without limit on
      // the platform's keys. The same rule as in writing: no credit → no
      // session; the admin is exempt. Without a configured payment link, the app
      // is free.
      const isAdminPay = user.email.toLowerCase() === config.adminEmail
      if (
        config.revolut.payLink &&
        !isAdminPay &&
        (await getBalance(user.email)) <= 0
      ) {
        return reply.code(402).send({ error: 'no_credit' })
      }

      const raw = String(req.body?.sdp ?? '')
      if (!raw.trim()) return reply.code(400).send({ error: 'bad_request: sdp required' })
      // NO trim(): the SDP must end with \r\n — .trim() cut it and OpenAI's
      // parser (pion) gave "unmarshal SDP: EOF" (the cause of "it can't hear me").
      const offer = raw.endsWith('\n') ? raw : raw + '\r\n'

      // LANGUAGE (Adrian, Jul 24 — FINAL, mandatory rule: "default startup
      // English; ADMIN = Romanian always; the rest of the users: detect and keep
      // per user"). THE ADMIN (Adrian) speaks fixed ROMANIAN — we pin the
      // transcription to Romanian too, so his speech is no longer misheard as
      // Russian (live proof: Kelion answered him in Russian). The rest: the
      // PERSISTED language from a real interaction; if they don't have one →
      // EMPTY → they start in English and mirror.
      const isAdmin = user.email.toLowerCase() === config.adminEmail
      let lang: string
      if (isAdmin) {
        lang = 'ro'
      } else {
        lang = String((await getSpeechLang(user.email)) || '').slice(0, 2).toLowerCase()
        if (!/^[a-z]{2}$/.test(lang)) lang = ''
      }

      let meserieName: string | null = null
      const meserieId = await getMeserieActiva(user.email)
      if (meserieId != null) meserieName = getMeserie(meserieId)?.nume ?? null

      // CONTEXT (memory + the latest replies) — ONE single time, in the initial
      // session, so the voice is coherent and doesn't lose the thread.
      const [memRecall, recent] = await Promise.all([
        recallMemories(user.email, 'kelion', '').catch(() => ''),
        getRecentHistory(user.email, 20).catch(() => [] as { role: string; content: string }[]),
      ])
      const history = recent
        .filter((m) => m.content && m.content.trim())
        .map((m) => `${m.role === 'assistant' ? 'Kelion' : 'Utilizatorul'}: ${m.content.slice(0, 400)}`)
        .join('\n')
      // DEVICE GPS IN VOICE (Adrian, Jul 25: "it doesn't see the device GPS").
      // The written chat injected the position into the context (the
      // weather/maps/"where am I" skills used it), but voice NEVER received it →
      // Kelion talked "blind" about location. Now the client sends coords at
      // session start; we put them in the context EXACTLY as in writing, plus
      // the locality (cached reverse geocode — no waiting on the audio path).
      const c = req.body?.coords
      let gpsBlock = ''
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
        const place = reverseGeocodeCached(c.lat as number, c.lon as number)
        gpsBlock =
          `\n\nLOCAȚIA CURENTĂ A UTILIZATORULUI (GPS live de pe dispozitiv): latitudine ${(c.lat as number).toFixed(5)}, longitudine ${(c.lon as number).toFixed(5)}` +
          (place ? ` (aproximativ ${place})` : '') +
          `. Când spune „aici", „lângă mine", „unde sunt", sau întreabă de vreme/locuri/direcții fără să numească un loc, folosește ACEASTĂ poziție. Pentru vremea locală, pasează exact acești lat/lon la get_weather. Dacă răspunsul depinde de poziția de ACUM și utilizatorul s-ar fi putut mișca între timp, cheamă get_location pentru poziția reală a momentului.`
      } else {
        // NO position at startup (normal after the "GPS only when needed" rule —
        // there's no permanent watcher anymore). Voice does NOT refuse location
        // questions: it resolves them ON REQUEST through get_location (the Jul 26
        // outage: without this instruction it answered "I don't have GPS access").
        gpsBlock =
          `\n\nNU ai încă poziția utilizatorului. Când cere ceva legat de locul lui — „aici", „lângă mine", „unde sunt", vremea locală, locuri din zonă, trasee de aici — cheamă ÎNTÂI get_location (citește GPS-ul real al dispozitivului în acel moment) și folosește coordonatele întoarse. NU spune niciodată că nu ai acces la locație fără să fi încercat get_location.`
      }
      // THE TIME ANCHOR (the "good evening" in the morning fix): voice got the
      // GPS but NOT the time — the voice brain guessed the part of day. We inject
      // the device's real date/time, exactly like writing (chat.ts), so the
      // greeting follows the clock.
      // Shared formatting (services/timeContext.ts) — the same source as writing.
      let timeBlock = ''
      const nowCtx = formatDeviceTime(req.body?.now, req.body?.tz)
      if (nowCtx) {
        timeBlock =
          `\n\nDATA ȘI ORA CURENTĂ (reală, de pe dispozitivul utilizatorului): acum este ${nowCtx.human} (fus orar ${nowCtx.tzName}). ` +
          `ȘTII MEREU data și ora exactă. Salutul și ORICE referire la partea zilei (bună dimineața/ziua/seara) urmează ACEASTĂ oră — NICIODATĂ ghicită. ` +
          `Când te întreabă cât e ceasul sau ce zi e, răspunzi cu această valoare, ora scrisă numeric (ex. „15:04").`
      }
      const contextBlock =
        timeBlock +
        (memRecall || '') +
        (history
          ? `\n\nCONVERSAȚIA DE PÂNĂ ACUM (continu-o firesc, ține minte ce s-a spus):\n${history}`
          : '') +
        gpsBlock

      // hardLock = the admin (Adrian) — Romanian ALWAYS, no switching to Italian.
      // THE VOICE CHOSEN BY THIS PERSON, not one for everyone (Adrian, Jul 30).
      // Read per request: if they change it in Settings, the next session uses
      // it, with no restart and without touching anyone else's account.
      const vocePref = await getVoicePref(user.email).catch(() => null)
      const res = await openaiRealtimeAnswer(offer, lang, meserieName, isAdmin, contextBlock, vocePref)
      if (!res.ok) {
        // The REAL reason for the refusal (OpenAI's error body) goes into the
        // log — otherwise F12 shows only "502" and the diagnosis is blind
        // (Adrian, Jul 24).
        req.log.warn(
          { upstreamStatus: res.status, upstreamError: res.error, sdpLen: offer.length, sdpHead: offer.slice(0, 40) },
          'realtime upstream refusal',
        )
        // ACCOUNT WITHOUT CREDIT (Jul 24 incident: dead voice, discovered only at
        // testing): we notify the admin by email IMMEDIATELY, not at the next
        // manual test.
        if (isQuotaError(res.error)) alertOpenAiQuota()
        const code = res.status === 503 ? 503 : 502
        // WHAT EXACTLY FAILED, not just "502" (D7 from LEFT-TO-DO). The client
        // showed `realtime 502` — a number that tells the person nothing and
        // doesn't help them decide whether retrying is worth it. `code` is the
        // diagnosis, and `retryable` says whether the "try again" button has a point.
        return reply.code(code).send({
          error: 'realtime_upstream',
          status: res.status,
          code: res.code,
          retryable: res.code !== 'realtime_not_configured' && res.code !== 'upstream_refuz',
        })
      }
      // The client reads the response as text (SDP answer) → setRemoteDescription.
      return reply.header('content-type', 'application/sdp').send(res.sdp)
    },
  )

  // EXECUTING VOICE TOOLS (the voice's autonomy — Adrian, Jul 24). The Realtime
  // model requests a function on the dataChannel; the client sends it HERE; the
  // server runs it with its keys (the same tools as the written chat) and
  // returns the result + the optional screen_url the client puts on the monitor.
  app.post<{ Body: { name?: string; args?: unknown } }>(
    '/api/realtime/tool',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const name = String(req.body?.name ?? '').trim()
      const args = (req.body?.args ?? {}) as Record<string, unknown>
      if (!name) return reply.code(400).send({ error: 'bad_request' })

      // VOICE ACCOUNTING (Jul 25): every tool from voice costs REAL money
      // (brain, vision, images, search) and until today NOTHING was debited —
      // unlike the written chat (recordCost + debitWallet on every turn).
      // settle() is called before every return that consumed something.
      let toolCostUsd = 0
      const settle = (): void => {
        if (toolCostUsd <= 0) return
        void recordCost(user.email, 'voice', toolCostUsd)
        // EVERYONE gets debited, including the admin (Adrian, Jul 25: "admin is
        // not exempt from reality — he must see for real what he has").
        void debitWallet(user.email, toolCostUsd, `voice:${name}`)
      }

      // Fresh Google token (as in chat) for the Gmail/Calendar/etc. tools.
      let token = user.googleAccessToken ?? ''
      if (user.googleRefreshToken && (user.googleTokenExp ?? 0) < Date.now() + 60_000) {
        const refreshed = await refreshGoogleAccessToken(user.googleRefreshToken)
        if (refreshed) token = refreshed.accessToken
      }

      // VISION IN VOICE (Adrian: "why doesn't it see?"). The client captures a
      // camera frame and sends it in args.image; we give it to a model with
      // vision and return a description to speak. No camera/frame → clear message.
      if (name === 'look' || name === 'see') {
        const image = String((args as { image?: string }).image ?? '')
        const question = String(args.question ?? args.request ?? '').trim()
        if (!image.startsWith('data:image/')) {
          return reply.send({ output: JSON.stringify({ error: 'no_camera', hint: 'camera closed' }) })
        }
        const seen = await describeScene(image, question, (usd) => { toolCostUsd += usd })
        settle()
        return reply.send({ output: seen || JSON.stringify({ error: 'vision_unavailable' }) })
      }

      // ESCALATION IN VOICE: heavy requests go to the BRAIN (the work model).
      // UNTIL Jul 25 this was a SECOND persona, hardcoded in Romanian for all
      // users, without memory — divergent from the writing escalation (Adrian:
      // "the software has version duplicates"). Now it starts from the SAME
      // persona (SYSTEM_PROMPT) and the user's REAL language, like the writing
      // escalation.
      if (name === 'ask_brain') {
        const request = String(args.request ?? '').trim()
        if (!request) return reply.send({ output: JSON.stringify({ error: 'empty_request' }) })
        const isAdmin = user.email.toLowerCase() === config.adminEmail
        let lang = isAdmin ? 'ro' : String((await getSpeechLang(user.email)) || '').slice(0, 2).toLowerCase()
        if (!/^[a-z]{2}$/.test(lang)) lang = 'en'
        // ── WHAT'S WRITTEN IN CHAT REACHES VOICE TOO ──────────────────────
        // Adrian, Jul 31: "it has technical limitations on voice, Kelion doesn't
        // see what's written in chat." He was right, and it's worse than the
        // tool ceiling: the escalation received ONLY the phrase just spoken.
        // You'd write something to it, then ask it by voice about that — and it
        // wouldn't know what you were talking about. It's not one Kelion, it's
        // two with mutual amnesia.
        //
        // The latest chat exchanges now go into the escalated order. Few (the
        // context window isn't infinite) and text only — but enough for a
        // conversation started in writing to continue by speaking.
        const ultimele = await getHistory(user.email, 400)
          .then((h) =>
            h
              .slice(-12)
              .map((m) => `${m.role === 'user' ? 'EL' : 'TU'}: ${String(m.content).slice(0, 600)}`)
              .join('\n'),
          )
          .catch(() => '')
        const prompt =
          `${SYSTEM_PROMPT}\n\n` +
          (ultimele
            ? `CE V-AȚI SCRIS ÎN CHAT ÎNAINTE (cel mai nou la urmă) — e ACEEAȘI conversație, ` +
              `continuă din ea, nu o lua de la capăt:\n${ultimele}\n\n`
            : '') +
          `VOICE ESCALATION: the fast voice model handed you a request it judged too hard. Answer it fully ` +
          `but CONCISELY, as plain text to be SPOKEN aloud (no markdown, no lists). Speak ONLY in ` +
          `${langLabel(lang)} — never switch, regardless of the language mixed into the request below.\n\n${request}`
        // WITH TOOLS (Adrian, Jul 27: "Kelion can't see all of its own source
        // code, why?"): the voice escalation was a BLIND brain — no source, no
        // DB, no constructor; it denied access. Now it has the same arms as
        // writing, on the introspection + construction side (admin only).
        // THE SAME GATE AS IN WRITING (Jul 28 audit, finding #2 — HIGH): the
        // written chat requires, on the ARMED padlock, the second factor
        // (voice/secret) before handing out the admin tools (chat.ts, isAdmin
        // with isArmed/hasUnlock). Voice gave them on the SIMPLE email match — a
        // stolen admin cookie could run SQL through voice. The language stays on
        // email (Adrian always hears Romanian); ONLY the tools require the unlock.
        const adminUnlocked = isAdmin && (!(await isArmed()) || hasUnlock(req, user.email))
        // The same definitions as writing, from the SHARED source
        // (brainToolDefs) — zero duplication. The executor (execIntrospection)
        // stays here, it needs the user's context (createBuildJob on email, the
        // token etc.).
        // §1: ALL Google tools go to the escalated brain, regardless of the
        // user's role (they're free, on their token) — the Realtime session's
        // ceiling of 31 doesn't apply here. The admin tools are added only on
        // the unlocked padlock, as in writing.
        const introspectionTools = [
          ...googleTools,
          // §1: USER-bound tools (memory, gap notification) + the admin ones
          // (logs, mail, costs, updates). The admin gate is done by
          // execUserScopedTool, as in writing. They don't depend on the monitor →
          // they work while speaking.
          LIST_MEMORIES_TOOL, FORGET_MEMORY_TOOL, LOG_GAP_TOOL,
          // §1: THE LIVE BROWSER on voice. It doesn't fit in the Realtime session
          // (ceiling 31, already full), but the escalated brain has no ceiling —
          // and the screenshot reaches the monitor through the ask_brain
          // response's `screen`.
          ...BROWSER_TOOLS,
          // §1: the last two that required nothing from the client.
          PROPOSE_TOOL, SHOW_DOCUMENT_TOOL,
          ...(adminUnlocked ? [PROMO_TOOL] : []),
          ...(adminUnlocked ? [LIST_UPDATES_TOOL, READ_INBOX_TOOL, SERVER_LOGS_TOOL, COST_TOOL] : []),
          ...(adminUnlocked
          ? [
              LIST_SOURCE_TOOL, READ_SOURCE_TOOL, SEARCH_SOURCE_TOOL,
              DB_TABLES_TOOL, DB_QUERY_TOOL,
              BUILD_SOFTWARE_TOOL, CONSTRUCTOR_STATUS_TOOL,
              SYSTEM_HEALTH_TOOL,
              // THE COMPLETE AUTONOMY PATH ON VOICE (Adrian: "from my request to
              // the final deploy, on all routes"): writes code → PR → merge
              // (auto-deploy) → ops → verification, exactly like writing.
              // Admin-gated identically.
              REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL,
              RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL,
              REQUEST_REPAIR_TOOL,
              // His settings, set by him — the same on voice as in writing.
              SECRET_PUNE_TOOL, SECRET_LISTA_TOOL, SECRET_PUBLICA_TOOL,
              // The owner's requirements get captured when he speaks too, not
              // only when he writes.
              CERINTA_NOUA_TOOL, CERINTE_LISTA_TOOL, CERINTA_PRIORITATE_TOOL,
            ]
          : []),
        ]
        // The screenshot of the last page opened by the brain in this turn (if
        // it used the browser) — leaves for the client as `screen`, so on the monitor.
        let brainScreen: { url: string; title: string } | undefined
        let brainPromo: unknown
        const execIntrospection = async (tname: string, targs: Record<string, unknown>): Promise<string> => {
          // The SHARED admin tools (source/DB/health/repo/runbook/request_repair):
          // SINGLE dispatch, shared with writing (services/adminTools.ts) — no duplication.
          const shared = await execSharedAdminTool(tname, targs)
          if (shared !== null) return shared
          // User-bound tools (memory/logs/mail/costs) — SINGLE source, the same
          // as writing; the admin gate is IN the executor.
          const scoped = await execUserScopedTool(tname, targs, user.email, isAdmin)
          if (scoped !== null) return scoped
          if (tname === 'prepare_promo_clip') {
            if (!isAdmin) return JSON.stringify({ error: 'unauthorized' })
            const built = await buildPromo(targs)
            if ('error' in built) return JSON.stringify({ error: built.error })
            // The {promo} frame arms the Rec button in the client — it leaves
            // with the escalation's response, like `screen`.
            brainPromo = built.promo
            if (built.monitorUrl) brainScreen = { url: built.monitorUrl, title: `Promo: ${built.promo.subject}` }
            return JSON.stringify({ armed: true, shown: true })
          }
          if (tname === 'show_document') {
            // The document reaches the monitor through the SAME `screen` channel:
            // we serve it as plain text, in a data URL (requires nothing extra in
            // the client).
            const title = String(targs.title ?? 'Document')
            const text = String(targs.text ?? '')
            if (!text.trim()) return JSON.stringify({ error: 'empty' })
            brainScreen = { url: `data:text/plain;charset=utf-8,${encodeURIComponent(text.slice(0, 20_000))}`, title }
            return JSON.stringify({ shown: true })
          }
          if (tname.startsWith('browser_')) {
            const r = await runBrowserTool(tname, targs, `https://${req.headers.host ?? 'kelionai.app'}`, user.email)
            const rr = r as { shotUrl?: string; title?: string }
            // The turn's last screenshot → we send it to the client at the end
            // of the escalation, so the page appears on the monitor (as in writing).
            if (rr.shotUrl) brainScreen = { url: rr.shotUrl, title: rr.title ?? 'browser' }
            return JSON.stringify(r).slice(0, 6000)
          }
          // §1 "WHAT WRITING CAN DO, VOICE CAN DO TOO" — the measured gap
          // (Jul 29): the registry had 66 capabilities in writing, but only 31 in
          // voice, because the Realtime session is capped at 31 tools by OpenAI.
          // The ceiling is REAL, but it applies ONLY to the voice model's direct
          // list — the escalated brain (the same orchestrator as writing) doesn't
          // have this limit. So here we give it ALL the Google tools, with the
          // SAME executor as writing, on the user's token: read_email,
          // delete_calendar_event, complete_task, read_drive_file (dormant on
          // voice until now) become accessible by speaking.
          if (googleTools.some((t) => t.name === tname)) {
            return await runGoogleTool(tname, targs, token)
          }
          // Voice-specific (different effect/formatting from chat):
          if (tname === 'build_software') {
            const order = String(targs.order ?? '').trim()
            if (order.length < 8) return JSON.stringify({ error: 'ordin_prea_scurt' })
            const jobId = await createBuildJob(user.email, order)
            // "Order taken." ONLY when the order really IS in the queue
            // (Jul 28 audit, finding #19): createBuildJob returns 0 on unavailable
            // DB or reached daily ceiling — confirming then would be exactly the
            // lie forbidden by THE DEED RULE. On failure, voice honestly says it
            // couldn't take the order, and why.
            if (!jobId)
              return JSON.stringify({
                ok: false,
                error: 'ordin_nepreluat',
                speak_rule: 'Spune sincer: ordinul NU a putut fi preluat (baza de date indisponibilă sau plafonul zilnic de construcții atins) — nu confirma preluarea.',
              })
            // The same short phrase as in chat (Adrian, Jul 28): just "Order
            // taken." — voice doesn't hold speeches about the worker/PR/email.
            return JSON.stringify({
              ok: true,
              job: jobId,
              speak_rule: 'Spune EXACT: „Am preluat cerința." — nimic în plus.',
            })
          }
          if (tname === 'constructor_status') {
            const jobs = await listBuildJobs(8)
            return JSON.stringify({ jobs: jobs.map((j) => ({ id: j.id, status: j.status, progress: j.progress, ci: j.ci, pr: j.prUrl })) })
          }
          // (source/DB/health/repo/runbook/request_repair are already handled by
          // execSharedAdminTool above — single dispatch, shared with writing.)
          return JSON.stringify({ error: 'unealtă necunoscută' })
        }
        // ── §6 SINGLE BRAIN — voice = the ears and mouth of the SAME brain ────
        // The escalation runs on EXACTLY the same orchestrator as writing
        // (runOrchestrator through voiceBrainTurn), with the same persona
        // (SYSTEM_PROMPT), a fast model (Gemini direct / the chat tier — voice
        // runs on a different clock) and the deed gate — NOT on a separate brain
        // engine (brainCompleteWithTools). That's how the duplicate disappears:
        // one single brain thinks both in writing and in voice.
        // The introspection tools (source/DB/health/constructor) stay the same,
        // admin-gated identically; the executor adapts to the (name, argsJson)
        // contract.
        const brainSystem =
          `${SYSTEM_PROMPT}\n\n` +
          `VOICE ESCALATION: the fast voice model handed you a request it judged too hard. Answer it fully ` +
          `but CONCISELY, as plain text to be SPOKEN aloud (no markdown, no lists). Speak ONLY in ` +
          `${langLabel(lang)} — never switch, regardless of the language mixed into the request.`
        const execForBrain = async (tname: string, argsJson: string): Promise<string> => {
          let targs: Record<string, unknown> = {}
          try {
            const p = JSON.parse(argsJson || '{}')
            if (p && typeof p === 'object') targs = p as Record<string, unknown>
          } catch {
            /* non-JSON arguments → empty object */
          }
          return execIntrospection(tname, targs)
        }
        const brainTools = introspectionTools as unknown as AnthropicTool[]
        // ── VOICE RUNS ON A DIFFERENT CLOCK THAN WRITING (Adrian, Jul 31) ─────
        //
        // An hour ago I routed voice through the writing brain, at his order
        // ("modify everything that needs to be him"). Ten minutes after it went
        // live: "it can't sustain audio chat". I broke it.
        //
        // THE CAUSE, and it's a physical limit, not a setting: the writing brain
        // is Nemotron Ultra — 550 billion parameters, with internal reasoning,
        // on the free tier with 20 requests per minute. In writing, a few
        // seconds of thinking are good: the answer comes out smarter. In a
        // spoken conversation, the same seconds are a pause in which the person
        // thinks the line died. Voice has a sub-second budget to the first word
        // — that is NOT negotiable with a 550B model.
        //
        // So: WRITING on the most capable brain, VOICE on the fastest one.
        // They're not "two brains" in the sense §6 fixed — there the problem was
        // that voice had a different PERSONA, different tools and different
        // memory. Those stay identical. Only the speed differs, because the job
        // differs.
        //
        // `chatDefault` (gemma-4-26b) is made for this: 26B total of which only
        // 4B active, sees, knows tools, free. When voice needs heavy thinking,
        // it escalates to the big brain through `ask_brain` — there the person
        // KNOWS they're waiting, because they asked for something heavy.
        const primaryModel = geminiDirectAvailable()
          ? `${GEMINI_DIRECT_PREFIX}${config.geminiModel}`
          : await resolveModel('chat')
        let answer = ''
        try {
          answer = await voiceBrainTurn(request, {
            model: primaryModel,
            tools: brainTools,
            execTool: execForBrain,
            systemPrompt: brainSystem,
            onCost: (usd) => { toolCostUsd += usd },
          })
          // Gemini direct failed mid-race (no text) → once on the chat tier, a
          // DIFFERENT provider (OpenRouter, not Google), so an outage at one is
          // not an outage at both.
          // The fallback used to be on the 'work' tier — that is, on the big
          // brain. In a spoken conversation, a slow fallback is just as broken
          // as a slow main path: the person waits either way. The voice fallback
          // must be fast too. (See the long comment at the model choice.)
          if (!answer && primaryModel.startsWith(GEMINI_DIRECT_PREFIX)) {
            answer = await voiceBrainTurn(request, {
              model: await resolveModel('chat'),
              tools: brainTools,
              execTool: execForBrain,
              systemPrompt: brainSystem,
              onCost: (usd) => { toolCostUsd += usd },
            })
          }
        } catch (e) {
          req.log.warn({ err: String(e).slice(0, 200) }, 'voice ask_brain orchestrator failed — falling back to the simple brain')
        }
        // SAFETY NET (regression forbidden): if the orchestrator returned nothing
        // (error/empty), we fall back to the simple brain so voice is NOT left mute.
        if (!answer) answer = await brainComplete(prompt, 2000, (usd) => { toolCostUsd += usd })
        settle()
        return reply.send({ output: answer || JSON.stringify({ error: 'brain_unavailable' }), screen: brainScreen, promo: brainPromo })
      }

      // VOICE↔CHAT PARITY (Jul 25): notes, role, gestures — callable from voice.
      if (name === 'save_note') {
        const text = String(args.text ?? '').trim()
        if (!text) return reply.send({ output: JSON.stringify({ error: 'empty' }) })
        const id = await saveNote(user.email, text)
        return reply.send({ output: JSON.stringify({ saved: true, id }) })
      }
      if (name === 'list_notes') {
        const notes = await listNotes(user.email, 50)
        return reply.send({ output: JSON.stringify({ notes }) })
      }
      if (name === 'delete_note') {
        const id = Number((args as { id?: number }).id ?? 0)
        const ok = await deleteNote(user.email, id)
        return reply.send({ output: JSON.stringify({ deleted: ok }) })
      }
      if (name === 'set_active_role') {
        const id = Number((args as { id?: number }).id ?? 0)
        await setMeserieActivaPref(user.email, id > 0 ? id : null)
        return reply.send({ output: JSON.stringify({ role: id > 0 ? getMeserie(id)?.nume ?? null : null }) })
      }
      // Gestures execute in the CLIENT (the avatar is the browser's) — we return
      // the value, and the client puts it on the {gesture} frame, as with open_app_view.
      if (name === 'play_avatar_gesture') {
        const gesture = String((args as { gesture?: string }).gesture ?? '').trim()
        return reply.send({ output: JSON.stringify({ gesture }) })
      }
      // APPROVED DYNAMIC TOOL (auto-extension) — in voice too.
      if ((await dynamicToolNames().catch(() => new Set<string>())).has(name)) {
        const out = await runDynamicTool(name, args as Record<string, unknown>)
        return reply.send({ output: out })
      }

      if (name === 'generate_image') {
        const prompt = String(args.prompt ?? '')
        if (!prompt) return reply.send({ output: JSON.stringify({ error: 'no_prompt' }) })
        const r = await generateImage(prompt)
        if ('error' in r) return reply.send({ output: JSON.stringify({ error: r.error }) })
        toolCostUsd += IMAGE_USD_PER_CALL
        settle()
        const url = `https://${req.headers.host ?? 'kelionai.app'}/api/image/${r.id}`
        return reply.send({ output: JSON.stringify({ shown: true, url }), screen: { url, title: 'Image' } })
      }

      // Searches have a fixed cost (as in the written chat); the Google skills
      // (Gmail, Calendar...) are free — they run on the user's token, not on our keys.
      // LIVE BROWSER ON VOICE (§1): the same tools as writing; the result carries
      // `shotUrl` (locally served, embeddable screenshot) → we send it as
      // `screen`, so the page appears on the monitor exactly as when you ask in writing.
      if (name.startsWith('browser_')) {
        const r = await runBrowserTool(name, args, `https://${req.headers.host ?? 'kelionai.app'}`, user.email)
        settle()
        const res = r as { shotUrl?: string; title?: string }
        return reply.send({
          output: JSON.stringify(r).slice(0, 6000),
          screen: res.shotUrl ? { url: res.shotUrl, title: res.title ?? 'browser' } : undefined,
        })
      }
      if (name === 'web_search' || name === 'youtube_search') toolCostUsd += SERPER_USD_PER_CALL
      const out = await runGoogleTool(name, args, token)
      settle()
      // screen_url from the result → the client opens the monitor (as in chat).
      let screen: { url: string; title: string } | undefined
      try {
        const j = JSON.parse(out) as { screen_url?: string }
        if (j.screen_url) {
          const url = /^https?:/i.test(j.screen_url)
            ? j.screen_url
            : `https://${req.headers.host ?? 'kelionai.app'}${j.screen_url}`
          screen = { url, title: name.replace(/_/g, ' ') }
        }
      } catch {
        /* non-JSON result — just text for the model */
      }
      return reply.send({ output: out.slice(0, 6000), screen })
    },
  )

  // VOICE BILLING BY THE MINUTE (Adrian, Jul 25): while voice is active, the
  // client "pulses" every ~20s; the server debits the REALLY connected seconds
  // from the credits. This way the user pays for talking time too (the most
  // expensive OpenAI Realtime component), not just the tools. 60s/pulse ceiling
  // (anti-abuse if a jump comes in).
  app.post<{ Body: { seconds?: number } }>(
    '/api/realtime/tick',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      // SERVER CLOCK (Jul 29 audit, risk #1 — money): before, we billed the
      // seconds REPORTED BY THE CLIENT; a client that under-reported them (or
      // didn't pulse at all) talked nearly free on the platform key. Now we bill
      // the REAL time measured by the server between two pulses (mark in KV per
      // user), 60s/pulse ceiling. On the session's FIRST pulse (or a mark older
      // than 90s: pause/new session) we have no server interval → we use the
      // client's estimate, also capped at 60s. The client can no longer
      // under-report as long as it pulses normally (~20s).
      const now = Date.now()
      const KEY = `voice_tick:${user.email}`
      const last = Number(await loadKv(KEY).catch(() => null)) || 0
      void saveKv(KEY, String(now)).catch(() => {})
      const serverGap = now - last
      const billSec =
        last > 0 && serverGap > 0 && serverGap <= 90_000
          ? Math.min(60, Math.round(serverGap / 1000))
          : Math.max(0, Math.min(60, Number(req.body?.seconds ?? 0)))
      if (billSec <= 0) return reply.send({ ok: true, charged: 0, balance: await getBalance(user.email) })
      const cost = (billSec / 60) * VOICE_USD_PER_MINUTE
      void recordCost(user.email, 'voice_minutes', cost)
      // EVERYONE gets debited, including the admin (the Jul 25 rule).
      void debitWallet(user.email, cost, `voice_min:${billSec}s`)
      const bal = await getBalance(user.email)
      // We signal the client if it ran out of credit → it stops the voice.
      return reply.send({ ok: true, charged: cost, balance: bal, stop: Boolean(config.revolut.payLink) && user.role !== 'admin' && bal <= 0 })
    },
  )

  app.post<{ Body: { role?: string; text?: string; voiceFeatures?: VoiceFeatures } }>(
    '/api/realtime/transcript',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const text = String(req.body?.text ?? '').trim()
      const role = req.body?.role === 'assistant' ? 'assistant' : 'user'
      if (text) await saveMessage(user.email, role, text)

      // VERBAL CAMERA/SCREEN SWITCHING IN VOICE (Adrian, Jul 25: "is verbal
      // camera switching functional?" — it WASN'T, only in writing). The written
      // chat passes every reply through interpretDeviceCommand; voice never did.
      // We run the SAME deterministic interpreter on the user's transcript and
      // return the command → the client executes it (handleControl), just as in writing.
      const device = role === 'user' && text ? interpretDeviceCommand(text) : null
      // LANGUAGE DETECTION FROM VOICE (Jul 24 audit, P4 — Adrian: "it doesn't
      // detect the spoken language"). The written chat persisted the language
      // through trackSpeechLang, but voice NEVER did → the next session started
      // from zero again. The same rule as in writing: a new language confirmed on
      // 2 consecutive messages → persisted per user; future sessions start
      // directly in it.
      // ADMIN = Romanian ALWAYS (Adrian, in Italy): we do NOT commit and do NOT
      // re-pin the language from speech — otherwise, if he says/hears Italian,
      // the live session would switch to Italian ("2 voices: ro and Italian"). It
      // stays locked on Romanian.
      const isAdmin = user.email.toLowerCase() === config.adminEmail
      // VOICEPRINT ON THE MAIN VOICE (Adrian, Jul 26: "why isn't voiceprint
      // recognition finished?"). Until today the print was verified ONLY on the
      // fallback STT path — in full-duplex it didn't run at all. The client now
      // extracts the print from the Realtime session's microphone and sends it
      // with every spoken turn; here we compare it with the holder's reference
      // (the SAME logic and threshold as in chat.ts). Foreign voice → the client
      // injects a warning into the session (no owner commands until written
      // confirmation).
      let foreignVoice: boolean | undefined
      // THE ADMIN PADLOCK (Adrian, Jul 27): a MATCHING print on an already
      // existing reference opens the Admin button (signed cookie) — the first
      // enrolment does NOT unlock (without a reference we have nothing to compare against).
      let adminUnlocked: boolean | undefined
      const vf = req.body?.voiceFeatures
      if (role === 'user' && vf?.vector?.length && vf?.meta) {
        try {
          const stored = await getVoiceprint(user.email)
          const hasRef = !!stored?.features?.length
          const dist = hasRef ? vectorDistance(vf.vector, stored!.features) : Infinity
          const isHolder = dist < 0.38
          // HOLE CLOSED (the security audit, Jul 27): with the padlock ARMED, a
          // stolen session cookie could ENROL its own vector as the "reference"
          // (with no existing reference) and, on the second identical request,
          // dist=0 → unlock. The first enrolment of the admin REFERENCE is now
          // accepted ONLY from an already unlocked session (typed secret) or with
          // the padlock unarmed; matching on an existing reference stays
          // unchanged (that IS the unlock by voice).
          const enrolAllowed = !isAdmin || !(await isArmed()) || hasUnlock(req, user.email)
          if ((!hasRef && enrolAllowed) || (hasRef && isHolder)) {
            void saveVoiceprint({
              email: user.email,
              name: user.name || stored?.name || user.email.split('@')[0],
              gender: inferGender(vf.meta.pitchMean),
              isAdmin,
              features: vf.vector,
              featureMeta: vf.meta,
              audioClip: '',
            })
          }
          foreignVoice = hasRef && !isHolder ? true : undefined
          if (isAdmin && hasRef && isHolder) {
            grantUnlock(reply, user.email, 'voce')
            // AND ON THE SERVER, for the tools that don't have the request at
            // hand: from here starts the 15-minute window in which he can touch
            // the card (Adrian, Jul 31: "so it operates only when I ask it, by voice").
            marcheazaVoce(user.email)
            adminUnlocked = true
          }
        } catch {
          /* the voiceprint never blocks the transcript */
        }
      }
      // ADMIN: we anchor the live session on Romanian at EVERY turn (the client
      // does session.update) — the transcription can no longer drift to another language.
      if (text && role === 'user' && isAdmin) return reply.send({ ok: true, lang: 'ro', device: device ?? undefined, foreignVoice, adminUnlocked })
      if (text && role === 'user' && !isAdmin) {
        const current = await getSpeechLang(user.email)
        const committed = trackSpeechLang(user.email, text, current)
        if (committed) void setSpeechLangPref(user.email, committed)
        // ANCHORING THE LANGUAGE IN THE LIVE SESSION (Adrian, Jul 24: "the
        // language without detection is random"): without an anchor, the
        // transcription guesses EVERY phrase independently (Romanian comes out
        // Spanish/French at random) and poisons the detection. We return the
        // committed language → the client pins it ON THE SPOT in the Realtime
        // session (session.update), without a restart.
        if (committed) return reply.send({ ok: true, lang: committed.slice(0, 2).toLowerCase(), device: device ?? undefined, foreignVoice })
      }
      return reply.send({ ok: true, device: device ?? undefined, foreignVoice })
    },
  )
}
