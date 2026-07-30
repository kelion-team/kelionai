import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { getSpeechLang, setSpeechLangPref, getMeserieActiva, saveMessage, getBalance, debitWallet, recordCost, getRecentHistory, saveNote, listNotes, deleteNote, setMeserieActivaPref, getVoicePref, getVoiceprint, saveVoiceprint, vectorDistance, createBuildJob, listBuildJobs, loadKv, saveKv } from '../db.js'
import { grantUnlock, isArmed, hasUnlock } from '../services/adminLock.js'
import { maybeAutoRecharge } from '../services/autorecharge.js'
import { SERPER_USD_PER_CALL, IMAGE_USD_PER_CALL, VOICE_USD_PER_MINUTE } from '../services/cost.js'
import { trackSpeechLang, langLabel } from '../services/lang.js'
import { getMeserie } from '../services/meserii.js'
import { openaiRealtimeAnswer } from '../services/realtime.js'
import { isQuotaError, alertOpenAiQuota } from '../services/openaiAlert.js'
import { runGoogleTool, googleTools, refreshGoogleAccessToken, reverseGeocodeCached } from '../services/google.js'
import { interpretDeviceCommand } from '../services/commands.js'
// §1: BROWSERUL LIVE ȘI PE VOCE (era adormit — 9 capabilități). Serverul rulează
// Chromium ca la scris și întoarce `screen` cu screenshot-ul; clientul îl pune pe
// monitor prin canalul care exista deja (handleControl → monitor).
import {
  browserOpen, browserClick, browserType, browserRead, browserBack,
  browserScroll, browserKey, browserClickAt, browserClose,
} from '../services/browser.js'
import { inferGender, type VoiceFeatures } from './voiceprint.js'
import { generateImage } from '../services/image.js'
import { brainComplete, describeScene } from '../services/brain.js'
// §6 CREIER UNIC: vocea escaladează pe ACELAȘI orchestrator + selecție de model ca scrisul.
import { voiceBrainTurn } from '../services/voiceBrainTurn.js'
import { resolveModel, bestPaidWorkModel, type AnthropicTool } from '../services/openrouter.js'
import { geminiDirectAvailable, GEMINI_DIRECT_PREFIX } from '../services/geminiDirect.js'
// CREIER UNIC §1 („fără duplicare"): definițiile uneltelor de introspecție/
// constructor vin din sursa COMUNĂ, nu mai sunt copiate inline aici.
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
  // CALEA AUTONOMIEI PE VOCE (Adrian, 29 iul: „de la cererea mea până la deploy
  // final, pe toate rutele") — aceleași definiții de unelte ca scrisul (sursă
  // unică, importate, nu duplicate), ca vocea să ajungă și ea până în producție.
  RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL,
  REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL, REQUEST_REPAIR_TOOL,
  PROPOSE_TOOL, SHOW_DOCUMENT_TOOL, PROMO_TOOL,
  SECRET_PUNE_TOOL, SECRET_LISTA_TOOL, SECRET_PUBLICA_TOOL,
  CERINTA_NOUA_TOOL, CERINTE_LISTA_TOOL, CERINTA_PRIORITATE_TOOL,
} from './chat.js'
// Dispatch UNIC al uneltelor admin partajate (chat ∩ voce) — fără duplicare (risc #4).
import { execUserScopedTool, execSharedAdminTool } from '../services/adminTools.js'
import { formatDeviceTime } from '../services/timeContext.js'

// ── VOCE LIVE (OpenAI Realtime) — endpointuri aduse în git ca sursă unică ────
// /api/realtime/session : proxy SDP. Clientul (browser WebRTC) trimite oferta
//   SDP + limba; backendul relayează la OpenAI cu cheia pe server și injectează
//   modelul + o singură voce masculină + persona în limba PERSISTATĂ a userului.
// /api/realtime/transcript : salvează în istoric ce s-a vorbit (pentru memorie
//   și continuitate între sesiuni), la fel ca o tură de chat.
//
// FĂRĂ tier gratuit: vocea cere utilizator logat (Adrian: „se scot minutele de
// test, userii cumpără să probeze"). Vocea de prezentare de pe landing (fără
// login, plătită din contul admin) e tratată separat, în alt endpoint.
// ── §1: BROWSERUL LIVE, EXECUTOR UNIC PENTRU VOCE ────────────────────────────
// Aceleași unelte ca la scris (Chromium pe server). Rezultatul poartă `shotUrl`
// (screenshot servit local, embeddabil) → ruta îl trimite ca `screen`, iar
// clientul îl pune pe monitor prin canalul care exista deja. Un singur loc,
// folosit atât de apelul direct, cât și de creierul escaladat (principiul
// permanent: unic, fără duplicate).
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

      // PAYWALL PE VOCE (25 iul — gaură de bani REALĂ găsită la audit): chatul
      // scris bloca la 0 credite, dar vocea pornea sesiuni nelimitat pe cheile
      // platformei. Aceeași regulă ca în scris: fără credit → fără sesiune
      // (cu ultima șansă de reîncărcare automată); adminul e scutit.
      const isAdminPay = user.email.toLowerCase() === config.adminEmail
      if (
        config.stripe.secretKey &&
        !isAdminPay &&
        (await getBalance(user.email)) <= 0 &&
        !(await maybeAutoRecharge(user.email, user.name)) &&
        (await getBalance(user.email)) <= 0
      ) {
        return reply.code(402).send({ error: 'no_credit' })
      }

      const raw = String(req.body?.sdp ?? '')
      if (!raw.trim()) return reply.code(400).send({ error: 'bad_request: sdp required' })
      // NU trim(): SDP-ul se termină obligatoriu cu \r\n — .trim() îl tăia și
      // parserul OpenAI (pion) dădea „unmarshal SDP: EOF" (cauza „nu mă aude").
      const offer = raw.endsWith('\n') ? raw : raw + '\r\n'

      // LIMBA (Adrian, 24 iul — regulă FINALĂ, obligatorie: „default pornirea
      // engleză; ADMIN = română mereu; restul userilor detectează și menține per
      // user"). ADMINUL (Adrian) vorbește ROMÂNĂ fix — pinăm și transcrierea pe
      // română, ca vorbirea lui să nu mai fie auzită greșit ca rusă (dovadă live:
      // Kelion îi răspundea în rusă). Restul: limba PERSISTATĂ dintr-o
      // interacțiune reală; dacă n-au una → GOL → pornesc în engleză și oglindesc.
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

      // CONTEXT (memorie + ultimele replici) — o SINGURĂ dată, în sesiunea
      // inițială, ca vocea să fie coerentă și să nu piardă firul.
      const [memRecall, recent] = await Promise.all([
        recallMemories(user.email, 'kelion', '').catch(() => ''),
        getRecentHistory(user.email, 20).catch(() => [] as { role: string; content: string }[]),
      ])
      const history = recent
        .filter((m) => m.content && m.content.trim())
        .map((m) => `${m.role === 'assistant' ? 'Kelion' : 'Utilizatorul'}: ${m.content.slice(0, 400)}`)
        .join('\n')
      // GPS DE PE DISPOZITIV ÎN VOCE (Adrian, 25 iul: „nu vede gps de pe
      // dispozitiv"). Chatul scris injecta poziția în context (skill-urile de
      // vreme/hărți/„unde sunt" o foloseau), dar vocea NU o primea niciodată →
      // Kelion vorbea „orb" la locație. Acum clientul trimite coords la pornirea
      // sesiunii; le băgăm în context EXACT ca în scris, plus localitatea (reverse
      // geocode din cache — fără așteptare pe calea audio).
      const c = req.body?.coords
      let gpsBlock = ''
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
        const place = reverseGeocodeCached(c.lat as number, c.lon as number)
        gpsBlock =
          `\n\nLOCAȚIA CURENTĂ A UTILIZATORULUI (GPS live de pe dispozitiv): latitudine ${(c.lat as number).toFixed(5)}, longitudine ${(c.lon as number).toFixed(5)}` +
          (place ? ` (aproximativ ${place})` : '') +
          `. Când spune „aici", „lângă mine", „unde sunt", sau întreabă de vreme/locuri/direcții fără să numească un loc, folosește ACEASTĂ poziție. Pentru vremea locală, pasează exact acești lat/lon la get_weather. Dacă răspunsul depinde de poziția de ACUM și utilizatorul s-ar fi putut mișca între timp, cheamă get_location pentru poziția reală a momentului.`
      } else {
        // FĂRĂ poziție la pornire (normal după regula „GPS doar la nevoie" —
        // nu mai există watcher permanent). Vocea NU refuză întrebările de
        // locație: le rezolvă LA CERERE prin get_location (pana din 26 iul:
        // fără instrucțiunea asta răspundea „nu am acces la GPS").
        gpsBlock =
          `\n\nNU ai încă poziția utilizatorului. Când cere ceva legat de locul lui — „aici", „lângă mine", „unde sunt", vremea locală, locuri din zonă, trasee de aici — cheamă ÎNTÂI get_location (citește GPS-ul real al dispozitivului în acel moment) și folosește coordonatele întoarse. NU spune niciodată că nu ai acces la locație fără să fi încercat get_location.`
      }
      // ANCORA DE TIMP (fix „bună seara" dimineața): vocea primea GPS-ul dar NU
      // ora — creierul de voce ghicea partea zilei. Injectăm data/ora reală a
      // dispozitivului, exact ca scrisul (chat.ts), ca salutul să urmeze ceasul.
      // Formatarea comună (services/timeContext.ts) — aceeași sursă ca scrisul.
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

      // hardLock = adminul (Adrian) — română MEREU, fără comutare pe italiană.
      // VOCEA ALEASĂ DE OMUL ĂSTA, nu una pentru toți (Adrian, 30 iul). Citită
      // per cerere: dacă o schimbă din Setări, următoarea sesiune o folosește,
      // fără repornire și fără să atingă contul altcuiva.
      const vocePref = await getVoicePref(user.email).catch(() => null)
      const res = await openaiRealtimeAnswer(offer, lang, meserieName, isAdmin, contextBlock, vocePref)
      if (!res.ok) {
        // Motivul REAL al refuzului (corpul erorii OpenAI) intră în log — altfel
        // în F12 se vede doar „502" și diagnoza e oarbă (Adrian, 24 iul).
        req.log.warn(
          { upstreamStatus: res.status, upstreamError: res.error, sdpLen: offer.length, sdpHead: offer.slice(0, 40) },
          'realtime upstream refuz',
        )
        // CONT FĂRĂ CREDIT (incident 24 iul: vocea moartă, descoperită abia la
        // test): anunțăm adminul pe email IMEDIAT, nu la următorul test manual.
        if (isQuotaError(res.error)) alertOpenAiQuota()
        const code = res.status === 503 ? 503 : 502
        // CE ANUME A PICAT, nu doar „502" (D7 din RAMAS-DE-FACUT). Clientul
        // afișa `realtime 502` — un număr care nu spune omului nimic și nu-l
        // ajută să decidă dacă merită să reîncerce. `code` e diagnosticul, iar
        // `retryable` spune dacă are rost butonul „încearcă din nou".
        return reply.code(code).send({
          error: 'realtime_upstream',
          status: res.status,
          code: res.code,
          retryable: res.code !== 'realtime_not_configured' && res.code !== 'upstream_refuz',
        })
      }
      // Clientul citește răspunsul ca text (answer SDP) → setRemoteDescription.
      return reply.header('content-type', 'application/sdp').send(res.sdp)
    },
  )

  // EXECUȚIA UNELTELOR DIN VOCE (autonomia vocii — Adrian, 24 iul). Modelul
  // Realtime cere o funcție pe dataChannel; clientul o trimite AICI; serverul o
  // rulează cu cheile lui (aceleași unelte ca chatul scris) și întoarce
  // rezultatul + eventualul screen_url pe care clientul îl pune pe monitor.
  app.post<{ Body: { name?: string; args?: unknown } }>(
    '/api/realtime/tool',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const name = String(req.body?.name ?? '').trim()
      const args = (req.body?.args ?? {}) as Record<string, unknown>
      if (!name) return reply.code(400).send({ error: 'bad_request' })

      // CONTABILITATE PE VOCE (25 iul): fiecare unealtă din voce costă bani REALI
      // (creier, vedere, imagini, căutare) și până azi nu se debita NIMIC —
      // spre deosebire de chatul scris (recordCost + debitWallet pe fiecare tură).
      // settle() se cheamă înaintea fiecărui return care a consumat ceva.
      let toolCostUsd = 0
      const settle = (): void => {
        if (toolCostUsd <= 0) return
        void recordCost(user.email, 'voice', toolCostUsd)
        // TOȚI se debitează, inclusiv adminul (Adrian, 25 iul: „admin nu e
        // scutit de realitate — trebuie să vadă real ce are").
        void debitWallet(user.email, toolCostUsd, `voice:${name}`)
      }

      // Token Google proaspăt (ca în chat) pentru uneltele Gmail/Calendar/etc.
      let token = user.googleAccessToken ?? ''
      if (user.googleRefreshToken && (user.googleTokenExp ?? 0) < Date.now() + 60_000) {
        const refreshed = await refreshGoogleAccessToken(user.googleRefreshToken)
        if (refreshed) token = refreshed.accessToken
      }

      // VEDEREA ÎN VOCE (Adrian: „de ce nu vede?"). Clientul capturează un cadru
      // din cameră și-l trimite în args.image; îl dăm unui model cu vedere și
      // întoarcem o descriere de rostit. Fără cameră/cadru → mesaj clar.
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

      // ESCALADAREA ÎN VOCE: cererile grele merg la CREIER (modelul work). PÂNĂ pe
      // 25 iul asta era o A DOUA persona, hardcodată în română pentru toți userii,
      // fără memorie — divergentă de escaladarea din scris (Adrian: „softul are
      // dubluri de versiuni"). Acum pornește din ACEEAȘI personă (SYSTEM_PROMPT)
      // și limba REALĂ a userului, ca escaladarea din scris.
      if (name === 'ask_brain') {
        const request = String(args.request ?? '').trim()
        if (!request) return reply.send({ output: JSON.stringify({ error: 'empty_request' }) })
        const isAdmin = user.email.toLowerCase() === config.adminEmail
        let lang = isAdmin ? 'ro' : String((await getSpeechLang(user.email)) || '').slice(0, 2).toLowerCase()
        if (!/^[a-z]{2}$/.test(lang)) lang = 'en'
        const prompt =
          `${SYSTEM_PROMPT}\n\n` +
          `VOICE ESCALATION: the fast voice model handed you a request it judged too hard. Answer it fully ` +
          `but CONCISELY, as plain text to be SPOKEN aloud (no markdown, no lists). Speak ONLY in ` +
          `${langLabel(lang)} — never switch, regardless of the language mixed into the request below.\n\n${request}`
        // CU UNELTE (Adrian, 27 iul: „Kelion nu poate vedea tot codul sursă al
        // lui, de ce?"): escaladarea din voce era un creier ORB — fără sursă,
        // fără DB, fără constructor; nega accesul. Acum are aceleași brațe ca
        // scrisul, pe partea de introspecție + construcție (doar admin).
        // ACEEAȘI POARTĂ CA-N SCRIS (audit 28 iul, găsirea #2 — INALT): chatul
        // scris cere, pe lacăt ARMAT, al doilea factor (voce/secret) înainte să
        // dea uneltele de admin (chat.ts, isAdmin cu isArmed/hasUnlock). Vocea
        // le dădea pe SIMPLA potrivire de email — un cookie de admin furat putea
        // rula SQL prin voce. Limba rămâne pe email (Adrian aude română mereu);
        // DOAR uneltele cer deblocarea.
        const adminUnlocked = isAdmin && (!(await isArmed()) || hasUnlock(req, user.email))
        // Aceleași definiții ca scrisul, din sursa COMUNĂ (brainToolDefs) — zero
        // duplicare. Executorul (execIntrospection) rămâne aici, are nevoie de
        // contextul userului (createBuildJob pe email, tokenul etc.).
        // §1: TOATE uneltele Google merg la creierul escaladat, indiferent de
        // rolul userului (sunt gratuite, pe tokenul lui) — plafonul de 31 al
        // sesiunii Realtime nu se aplică aici. Uneltele de admin se adaugă doar
        // pe lacăt deblocat, ca la scris.
        const introspectionTools = [
          ...googleTools,
          // §1: unelte legate de USER (memorie, notificarea lipsurilor) + cele de
          // admin (jurnale, poștă, costuri, update-uri). Poarta de admin o face
          // execUserScopedTool, ca la scris. Nu depind de monitor → merg vorbind.
          LIST_MEMORIES_TOOL, FORGET_MEMORY_TOOL, LOG_GAP_TOOL,
          // §1: BROWSERUL LIVE pe voce. Nu încape în sesiunea Realtime (plafon 31,
          // deja plin), dar creierul escaladat n-are plafon — iar screenshot-ul
          // ajunge pe monitor prin `screen`-ul răspunsului de la ask_brain.
          ...BROWSER_TOOLS,
          // §1: ultimele două care nu cereau nimic din client.
          PROPOSE_TOOL, SHOW_DOCUMENT_TOOL,
          ...(adminUnlocked ? [PROMO_TOOL] : []),
          ...(adminUnlocked ? [LIST_UPDATES_TOOL, READ_INBOX_TOOL, SERVER_LOGS_TOOL, COST_TOOL] : []),
          ...(adminUnlocked
          ? [
              LIST_SOURCE_TOOL, READ_SOURCE_TOOL, SEARCH_SOURCE_TOOL,
              DB_TABLES_TOOL, DB_QUERY_TOOL,
              BUILD_SOFTWARE_TOOL, CONSTRUCTOR_STATUS_TOOL,
              SYSTEM_HEALTH_TOOL,
              // CALEA AUTONOMIEI COMPLETĂ PE VOCE (Adrian: „de la cererea mea până
              // la deploy final, pe toate rutele"): scrie cod → PR → merge (auto-
              // deploy) → ops → verificare, exact ca scrisul. Admin-gated identic.
              REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL,
              RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL,
              REQUEST_REPAIR_TOOL,
              // Setările lui, puse de el — aceleași pe voce ca pe scris.
              SECRET_PUNE_TOOL, SECRET_LISTA_TOOL, SECRET_PUBLICA_TOOL,
              // Cerințele ownerului se prind și când vorbește, nu doar când scrie.
              CERINTA_NOUA_TOOL, CERINTE_LISTA_TOOL, CERINTA_PRIORITATE_TOOL,
            ]
          : []),
        ]
        // Screenshot-ul ultimei pagini deschise de creier în tura asta (dacă a
        // folosit browserul) — pleacă spre client ca `screen`, deci pe monitor.
        let brainScreen: { url: string; title: string } | undefined
        let brainPromo: unknown
        const execIntrospection = async (tname: string, targs: Record<string, unknown>): Promise<string> => {
          // Uneltele admin PARTAJATE (sursă/DB/sănătate/repo/runbook/request_repair):
          // dispatch UNIC, comun cu scrisul (services/adminTools.ts) — fără duplicare.
          const shared = await execSharedAdminTool(tname, targs)
          if (shared !== null) return shared
          // Unelte legate de user (memorie/jurnale/poștă/costuri) — sursă UNICĂ,
          // aceeași cu scrisul; poarta de admin e ÎN executor.
          const scoped = await execUserScopedTool(tname, targs, user.email, isAdmin)
          if (scoped !== null) return scoped
          if (tname === 'prepare_promo_clip') {
            if (!isAdmin) return JSON.stringify({ error: 'unauthorized' })
            const built = await buildPromo(targs)
            if ('error' in built) return JSON.stringify({ error: built.error })
            // Cadrul {promo} armează butonul Rec în client — pleacă odată cu
            // răspunsul escaladării, ca `screen`-ul.
            brainPromo = built.promo
            if (built.monitorUrl) brainScreen = { url: built.monitorUrl, title: `Promo: ${built.promo.subject}` }
            return JSON.stringify({ armed: true, shown: true })
          }
          if (tname === 'show_document') {
            // Documentul ajunge pe monitor prin ACELAȘI canal `screen`: îl servim
            // ca text simplu, într-un data-URL (nu cere nimic în plus în client).
            const title = String(targs.title ?? 'Document')
            const text = String(targs.text ?? '')
            if (!text.trim()) return JSON.stringify({ error: 'empty' })
            brainScreen = { url: `data:text/plain;charset=utf-8,${encodeURIComponent(text.slice(0, 20_000))}`, title }
            return JSON.stringify({ shown: true })
          }
          if (tname.startsWith('browser_')) {
            const r = await runBrowserTool(tname, targs, `https://${req.headers.host ?? 'kelionai.app'}`, user.email)
            const rr = r as { shotUrl?: string; title?: string }
            // Ultimul screenshot al turei → îl trimitem clientului la finalul
            // escaladării, ca pagina să apară pe monitor (ca la scris).
            if (rr.shotUrl) brainScreen = { url: rr.shotUrl, title: rr.title ?? 'browser' }
            return JSON.stringify(r).slice(0, 6000)
          }
          // §1 „CE POATE SCRISUL, POATE ȘI VOCEA" — golul măsurat (29 iul): registrul
          // avea 66 capabilități pe scris, dar doar 31 pe voce, fiindcă sesiunea
          // Realtime e plafonată la 31 de unelte de către OpenAI. Plafonul e REAL,
          // dar se aplică DOAR listei directe a modelului de voce — creierul
          // escaladat (același orchestrator ca scrisul) nu are limita asta. Deci
          // aici îi dăm TOATE uneltele Google, cu ACELAȘI executor ca scrisul, pe
          // tokenul userului: read_email, delete_calendar_event, complete_task,
          // read_drive_file (adormite pe voce până acum) devin accesibile vorbind.
          if (googleTools.some((t) => t.name === tname)) {
            return await runGoogleTool(tname, targs, token)
          }
          // Specifice vocii (efect/formatare diferită de chat):
          if (tname === 'build_software') {
            const order = String(targs.order ?? '').trim()
            if (order.length < 8) return JSON.stringify({ error: 'ordin_prea_scurt' })
            const jobId = await createBuildJob(user.email, order)
            // „Am preluat cerința." DOAR când ordinul chiar E în coadă (audit 28
            // iul, găsirea #19): createBuildJob întoarce 0 pe DB indisponibil sau
            // plafon zilnic atins — a confirma atunci ar fi exact minciuna
            // interzisă de REGULA FAPTEI. Pe eșec, vocea spune sincer că nu a
            // putut prelua și de ce.
            if (!jobId)
              return JSON.stringify({
                ok: false,
                error: 'ordin_nepreluat',
                speak_rule: 'Spune sincer: ordinul NU a putut fi preluat (baza de date indisponibilă sau plafonul zilnic de construcții atins) — nu confirma preluarea.',
              })
            // Aceeași frază scurtă ca în chat (Adrian, 28 iul): doar „Am preluat
            // cerința." — vocea nu ține discursuri despre lucrător/PR/email.
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
          // (sursă/DB/sănătate/repo/runbook/request_repair sunt deja tratate de
          // execSharedAdminTool mai sus — dispatch unic, comun cu scrisul.)
          return JSON.stringify({ error: 'unealtă necunoscută' })
        }
        // ── §6 CREIER UNIC — vocea = urechile și gura ACELUIAȘI creier ────────
        // Escaladarea rulează pe EXACT același orchestrator ca scrisul
        // (runOrchestrator prin voiceBrainTurn), cu aceeași personă (SYSTEM_PROMPT),
        // același model (Gemini direct/resolveModel('work'), ca scrisul) și poarta
        // faptei — NU pe un motor de creier separat (brainCompleteWithTools). Așa
        // dispare dublura: un singur creier gândește și în scris, și în voce.
        // Uneltele de introspecție (sursă/DB/sănătate/constructor) rămân aceleași,
        // admin-gated identic; executorul se adaptează la contractul (name, argsJson).
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
            /* argumente ne-JSON → obiect gol */
          }
          return execIntrospection(tname, targs)
        }
        const brainTools = introspectionTools as unknown as AnthropicTool[]
        // Modelul: ca la scris (§6 creier unic). OWNERUL primește modelul PLĂTIT
        // capabil din catalogul live (regula de fier §14 — nu se cioantă pe free,
        // exact ca pe chat); publicul rămâne pe free (Gemini direct / work). Dacă
        // în catalog nu există model plătit, cade pe free ca înainte.
        const ownerPaid = isAdmin ? await bestPaidWorkModel() : null
        const primaryModel = ownerPaid
          ? ownerPaid
          : geminiDirectAvailable()
            ? `${GEMINI_DIRECT_PREFIX}${config.geminiModel}`
            : await resolveModel('work')
        let answer = ''
        try {
          answer = await voiceBrainTurn(request, {
            model: primaryModel,
            tools: brainTools,
            execTool: execForBrain,
            systemPrompt: brainSystem,
            onCost: (usd) => { toolCostUsd += usd },
          })
          // Gemini direct a picat în cursă (fără text) → o dată pe modelul work,
          // exact ca fallback-ul din scris (chat.ts).
          if (!answer && primaryModel.startsWith(GEMINI_DIRECT_PREFIX)) {
            answer = await voiceBrainTurn(request, {
              model: await resolveModel('work'),
              tools: brainTools,
              execTool: execForBrain,
              systemPrompt: brainSystem,
              onCost: (usd) => { toolCostUsd += usd },
            })
          }
        } catch (e) {
          req.log.warn({ err: String(e).slice(0, 200) }, 'voice ask_brain orchestrator a picat — cad pe creierul simplu')
        }
        // PLASĂ DE SIGURANȚĂ (regresie interzisă): dacă orchestratorul n-a întors
        // nimic (eroare/gol), cădem pe creierul simplu ca vocea să NU rămână mută.
        if (!answer) answer = await brainComplete(prompt, 2000, (usd) => { toolCostUsd += usd })
        settle()
        return reply.send({ output: answer || JSON.stringify({ error: 'brain_unavailable' }), screen: brainScreen, promo: brainPromo })
      }

      // PARITATE VOCE↔CHAT (25 iul): notițe, rol, gesturi — apelabile din voce.
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
      // Gesturile se execută în CLIENT (avatarul e al browserului) — întoarcem
      // valoarea, iar clientul o pune pe frame-ul {gesture}, ca la open_app_view.
      if (name === 'play_avatar_gesture') {
        const gesture = String((args as { gesture?: string }).gesture ?? '').trim()
        return reply.send({ output: JSON.stringify({ gesture }) })
      }
      // UNEALTĂ DINAMICĂ APROBATĂ (auto-extindere) — și în voce.
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
        return reply.send({ output: JSON.stringify({ shown: true, url }), screen: { url, title: 'Imagine' } })
      }

      // Căutările au cost fix (ca în chatul scris); skill-urile Google (Gmail,
      // Calendar...) sunt gratuite — rulează pe tokenul userului, nu pe cheile noastre.
      // BROWSER LIVE PE VOCE (§1): aceleași unelte ca scrisul; rezultatul poartă
      // `shotUrl` (screenshot servit local, embeddabil) → îl trimitem ca `screen`,
      // deci pagina apare pe monitor exact ca atunci când i-o ceri scriind.
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
      // screen_url din rezultat → clientul deschide monitorul (ca în chat).
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
        /* rezultat non-JSON — doar text pentru model */
      }
      return reply.send({ output: out.slice(0, 6000), screen })
    },
  )

  // TAXAREA VOCII PE MINUT (Adrian, 25 iul): cât timp vocea e activă, clientul
  // „pulsează" la ~20s; serverul debitează secundele REAL conectate din credite.
  // Așa userul plătește și timpul de vorbit (cea mai scumpă componentă OpenAI
  // Realtime), nu doar uneltele. Plafon 60s/puls (anti-abuz dacă vine un salt).
  app.post<{ Body: { seconds?: number } }>(
    '/api/realtime/tick',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      // CEAS DE SERVER (audit 29 iul, risc #1 — bani): înainte, taxam secundele
      // RAPORTATE DE CLIENT; un client care le sub-raporta (sau nu pulsa deloc)
      // vorbea aproape gratis pe cheia platformei. Acum taxăm timpul REAL măsurat
      // de server între două pulsuri (marcaj în KV per user), plafon 60s/puls.
      // La PRIMUL puls al sesiunii (sau marcaj vechi >90s: pauză/sesiune nouă) nu
      // avem interval de server → folosim estimarea clientului, tot mărginită la
      // 60s. Clientul nu mai poate sub-raporta cât timp pulsează normal (~20s).
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
      // TOȚI se debitează, inclusiv adminul (regula din 25 iul).
      void debitWallet(user.email, cost, `voice_min:${billSec}s`)
      const bal = await getBalance(user.email)
      // Semnalăm clientului dacă a rămas fără credit → oprește vocea.
      return reply.send({ ok: true, charged: cost, balance: bal, stop: config.stripe.secretKey && user.role !== 'admin' && bal <= 0 })
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

      // COMUTAREA VERBALĂ A CAMEREI/ECRANULUI ÎN VOCE (Adrian, 25 iul: „comutarea
      // verbală a camerelor e funcțională?" — NU era, doar în scris). Chatul scris
      // trece fiecare replică prin interpretDeviceCommand; vocea nu o făcea deloc.
      // Rulăm ACELAȘI interpretor determinist pe transcriptul userului și
      // întoarcem comanda → clientul o execută (handleControl), la fel ca în scris.
      const device = role === 'user' && text ? interpretDeviceCommand(text) : null
      // DETECȚIA LIMBII DIN VOCE (audit 24 iul, P4 — Adrian: „nu depistează
      // limba vorbită"). Chatul scris persista limba prin trackSpeechLang, dar
      // vocea NU o făcea niciodată → sesiunea următoare pornea iar de la zero.
      // Aceeași regulă ca în scris: limba nouă confirmată pe 2 mesaje
      // consecutive → persistată per user; sesiunile viitoare pornesc direct în ea.
      // ADMIN = română MEREU (Adrian, în Italia): NU comităm și NU re-pinăm
      // limba din vorbire — altfel, dacă spune/aude italiană, sesiunea live ar
      // comuta pe italiană („2 voci: ro și italiană"). Rămâne blocat pe română.
      const isAdmin = user.email.toLowerCase() === config.adminEmail
      // TIMBRUL PE VOCEA PRINCIPALĂ (Adrian, 26 iul: „de ce nu e finalizată
      // recunoașterea de timbru?"). Până azi amprenta se verifica DOAR pe calea
      // STT de rezervă — în full-duplex nu rula deloc. Clientul extrage acum
      // amprenta din microfonul sesiunii Realtime și o trimite cu fiecare tură
      // vorbită; aici o comparăm cu referința titularului (ACEEAȘI logică și
      // prag ca în chat.ts). Voce străină → clientul injectează avertisment în
      // sesiune (fără comenzi de owner până la confirmare scrisă).
      let foreignVoice: boolean | undefined
      // LACĂTUL ADMIN (Adrian, 27 iul): amprenta POTRIVITĂ pe o referință deja
      // existentă deschide butonul Admin (cookie semnat) — prima enrolare NU
      // deblochează (fără referință n-avem cu ce compara).
      let adminUnlocked: boolean | undefined
      const vf = req.body?.voiceFeatures
      if (role === 'user' && vf?.vector?.length && vf?.meta) {
        try {
          const stored = await getVoiceprint(user.email)
          const hasRef = !!stored?.features?.length
          const dist = hasRef ? vectorDistance(vf.vector, stored!.features) : Infinity
          const isHolder = dist < 0.38
          // GAURĂ ÎNCHISĂ (auditul de securitate, 27 iul): cu lacătul ARMAT,
          // un cookie de sesiune furat putea să-și ÎNROLEZE propriul vector ca
          // „referință" (fără referință existentă) și, la a doua cerere
          // identică, dist=0 → deblocare. Prima înrolare a REFERINȚEI de admin
          // se acceptă acum DOAR dintr-o sesiune deja deblocată (secretul
          // tastat) sau cu lacătul nearmat; potrivirea pe referință existentă
          // rămâne neschimbată (aia e chiar deblocarea prin voce).
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
            adminUnlocked = true
          }
        } catch {
          /* amprenta nu blochează niciodată transcriptul */
        }
      }
      // ADMIN: ancorăm sesiunea live pe română la FIECARE tură (clientul face
      // session.update) — transcrierea nu mai poate aluneca spre altă limbă.
      if (text && role === 'user' && isAdmin) return reply.send({ ok: true, lang: 'ro', device: device ?? undefined, foreignVoice, adminUnlocked })
      if (text && role === 'user' && !isAdmin) {
        const current = await getSpeechLang(user.email)
        const committed = trackSpeechLang(user.email, text, current)
        if (committed) void setSpeechLangPref(user.email, committed)
        // ANCORAREA LIMBII ÎN SESIUNEA LIVE (Adrian, 24 iul: „limba fără
        // detecție e aleatoare"): fără ancoră, transcrierea ghicește FIECARE
        // frază independent (româna iese spaniolă/franceză la întâmplare) și
        // otrăvește detecția. Întoarcem limba comisă → clientul o fixează PE
        // LOC în sesiunea Realtime (session.update), fără repornire.
        if (committed) return reply.send({ ok: true, lang: committed.slice(0, 2).toLowerCase(), device: device ?? undefined, foreignVoice })
      }
      return reply.send({ ok: true, device: device ?? undefined, foreignVoice })
    },
  )
}
