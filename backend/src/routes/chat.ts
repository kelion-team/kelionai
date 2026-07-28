import type { FastifyInstance } from 'fastify'
import { config, roleFor } from '../config.js'
import type {
  Tool,
  Message,
  MessageParam,
  ToolResultBlockParam,
  TextBlock,
  ToolUseBlock,
} from '../services/brain-types.js'
import { getSessionUser, setSession, type SessionUser } from '../session.js'
import {
  googleTools,
  runGoogleTool,
  refreshGoogleAccessToken,
  reverseGeocodeCached,
  promoSceneUrl,
  geminiVision,
} from '../services/google.js'
import {
  saveMessage,
  recordCost,
  getCostSummary,
  getBalance,
  debitWallet,
  logCapabilityGap,
  getSpeechLang,
  setSpeechLangPref,
  getMeserieActiva,
  setMeserieActivaPref,
  getDisabledGestures,
  saveNote,
  listNotes,
  deleteNote,
  getRecentHistory,
  getMemories,
  deleteMemory,
  getVoiceprint,
  saveVoiceprint,
  vectorDistance,
  getFaceprint,
  saveFaceprint,
  faceDistance,
  loadKv,
  proposeKelionTool,
  decideKelionTool,
  createBuildJob,
  buildJobsToday,
  listBuildJobs,
  cancelBuildJobs,
  cancelAllPendingBuildJobs,
  dbTablesOverview,
  dbQuery,
} from '../db.js'
import { getMeserie } from '../services/meserii.js'
import { resolveModel, brainModelHasVision, taskDifficulty, ESCALATE_AT, ESCALATE_TOP_AT, hasActionIntent, type OrMessage, type AnthropicTool } from '../services/openrouter.js'
import { runOrchestrator } from '../services/orchestrator.js'
import { GEMINI_DIRECT_PREFIX, geminiDirectAvailable, isGeminiQuotaError } from '../services/geminiDirect.js'
import { parseBrainSub, subActive, type BrainSub } from '../services/brainSubscription.js'
import { brainComplete } from '../services/brain.js'
import { dynamicToolDefs, dynamicToolNames, runDynamicTool } from '../services/dynamicTools.js'
import { maybeAutoRecharge } from '../services/autorecharge.js'
import { SERPER_USD_PER_CALL, IMAGE_USD_PER_CALL } from '../services/cost.js'
import { recallMemories, learnFromTurn } from '../services/agents.js'
import { generateImage } from '../services/image.js'
import { checkLang, detectLang, trackSpeechLang } from '../services/lang.js'
import { interpretDeviceCommand, deviceAck, interpretGestureCommand, gestureAck, type GestureLabel } from '../services/commands.js'
import { geoLookupCached } from './demo.js'
import { synthesize } from '../services/tts.js'
import { splitForSpeech } from '../services/speech-chunk.js'
import {
  browserOpen,
  browserClick,
  browserType,
  browserRead,
  browserBack,
  browserScroll,
  browserKey,
  browserClickAt,
  browserClose,
  crawlSite,
  screenshotUrl,
} from '../services/browser.js'
import { startTurn, appendTurn, finishTurn, readTurnFrom, heartbeatSSE } from '../services/sseReplay.js'
import { recentLogs } from '../services/logbuffer.js'
import { isArmed, hasUnlock } from '../services/adminLock.js'
import { randomUUID } from 'node:crypto'
import { inferGender, type VoiceFeatures } from './voiceprint.js'
import { recentClientErrors } from './clientErrors.js'
import { listSource, readSource, searchSource } from '../services/sourceCode.js'
import { systemHealth } from '../services/health.js'
import { updatesList, latestUpdateSummary } from '../services/updates.js'
import { runRunbook, requestRepair, runbookStatus, runbookLog } from '../services/runbooks.js'
import { repoWrite, repoOpenPR, repoMergePR } from '../services/github.js'

// CREIERUL — 100% OpenRouter (0 Kimi, 0 GLM — Adrian, definitiv). Modelul de chat
// selectabil e citit din KV (aceeași sursă ca /api/models/selection): modelul ALES
// de user, altfel implicitul tier-ului chat (GPT). Întoarce NULL doar dacă lipsește
// cheia OpenRouter → creierul nu poate porni (mesaj onest, nicio plasă Kimi/GLM).
async function selectedBrainModel(
  email: string,
  text: string,
  kvRaw?: string | null,
  needsVision = false,
  sub?: BrainSub,
  isAdmin = false,
): Promise<{ model: string; heavy: boolean; useSubKey: boolean } | null> {
  if (!config.openrouter.key) return null
  let sel: { chat?: string; work?: string } = {}
  try {
    // FLUENȚĂ (A5): kv-ul vine pre-citit din Promise.all-ul turei (fără încă
    // un drum DB serial aici); fallback la citire doar pentru apelanții vechi.
    const raw = kvRaw !== undefined ? kvRaw : await loadKv(`model_choice:${email}`)
    if (raw) sel = JSON.parse(raw) as { chat?: string; work?: string }
  } catch {
    sel = {}
  }
  // ESCALADARE automată CHAT → CREIER, pe DOUĂ căi (Adrian, 25 iul: „să
  // gândească la fiecare cerință = raționament adevărat", nu doar regex):
  // (1) pre-rutare rapidă: euristica taskDifficulty prinde cererile evident
  //     grele și pornește direct pe modelul work, cu raționament intern;
  // (2) judecata MODELULUI: pe treapta chat, modelul primește unealta
  //     `ask_brain` (aceeași ca vocea) și escaladează SINGUR ce judecă el greu
  //     — acoperă exact cererile scurte-dar-grele pe care regexul le rata.
  // Persona/voce/limbă/memorie/unelte sunt IDENTICE — se schimbă DOAR modelul.
  // ESCALADARE ECONOMICĂ (25 iul — corectat după ce forțarea creierului mare pe
  // FIECARE tură de admin a ars $23+/oră chiar și pe conversație obișnuită;
  // Adrian: „pentru o comandă să repare animația gurii, e enorm"). Regula
  // corectă: cel mai ieftin model capabil implicit; escaladează DOAR pe
  // cereri de acțiune reală a proprietarului (hasActionIntent — „repară",
  // „rulează", „publică", „scrie cod"...); revine SINGUR la treapta ieftină
  // la următoarea replică obișnuită (heavy se calculează per-tură din textul
  // curent, nu rămâne agățat).
  // COMPATIBILITATE MODEL↔FUNCȚIE (Adrian, 25 iul: „modelele selectate să fie
  // compatibile cu toate funcțiile aplicației"): implicitul ieftin de chat
  // (`openai/gpt-oss-20b:free`) NU are vedere (catalogul îl marchează
  // vision:false) — un cadru de cameră trimis către el ar fi ignorat/ar pica.
  // Când tura ACTUAL trimite o imagine (poză atașată sau cadru de cameră pe
  // „ce vezi?"), escaladăm forțat la treapta work — TOATE modelele work
  // candidate (Fable 5, Sonnet 5, GPT-5, Haiku 4.5) au vision:true confirmat.
  // LADDER PE 3 TREPTE (Adrian, 25 iul: „la creier gpt-5-mini până la Fable"):
  // gratuit (chat) → ieftin-capabil (work, implicit gpt-5-mini) → Fable 5
  // (top) DOAR pe dificultate cu adevărat extremă (ESCALATE_TOP_AT). Vederea și
  // acțiunea de admin urcă la treapta MIJLOCIE (work), nu direct la vârf.
  const difficulty = taskDifficulty(text)
  // SPLIT ECONOMIC ȘI CINSTIT (Adrian, 27 iul: „pe chat de 2 lei ok, dar unde
  // necesită răspuns gândit trimiți prin creier"): vorba simplă → model ieftin
  // (rapid, aproape gratis); CÂND e nevoie de gândit SAU de o ACȚIUNE (owner
  // cere „repară/publică/arată/deschide/construiește...") → creierul care chiar
  // EXECUTĂ, nu narează. „Mereu Fable 5" a fost scos: ardea creditul (OpenRouter
  // ajuns la minus pe 27 iul) și nu asta a cerut. Vârful doar pe dificultate
  // extremă.
  const heavy = needsVision || difficulty >= ESCALATE_AT || (roleFor(email) === 'admin' && hasActionIntent(text))
  // CREIERUL FULL FREE (Adrian, 27 iul): treapta top (nemotron-ultra-550b:free)
  // NU are vedere — o tură cu imagine, oricât de grea, rămâne pe nucleul omni
  // (work), care VEDE. Altfel poza s-ar pierde în drum spre „geniul orb".
  const top = difficulty >= ESCALATE_TOP_AT && !needsVision
  // GEMINI PRINCIPAL, NEMOTRON SECUNDAR (Adrian, 27 iul: „comută la celălalt
  // free... gemini... principal, și ce e acum secundar"): când cheia gratuită
  // Google există, nucleul de lucru e gemini direct (vede + unelte + gândire,
  // peste orice :free din OpenRouter, $0). Alegerea manuală din Admin→Modele
  // (sel.work) rămâne respectată; căderea pe secundar la cotă epuizată e la
  // locul apelului (retry în handler). Vocea NU trece pe aici — rămâne cum e.
  const geminiWork = !sel.work && geminiDirectAvailable()
  // CREIERUL DE ABONAMENT (Adrian, 28 iul): comutatorul admin-only. Pe turele
  // GRELE ale ADMINULUI (raționament/acțiune sau treapta top), dacă modul e
  // „abonament" și există cheia proprie, urcăm pe modelul puternic plătit din
  // creditul ownerului — nu din punga centrală. Userii plătitori NU trec pe
  // aici niciodată (subActive cere isAdmin). Tura simplă rămâne pe free (rapid,
  // aproape gratis): „mai multă putere DOAR unde e nevoie". Vederea e păstrată —
  // modelul de abonament ales din catalog are vedere; dacă totuși n-ar avea,
  // implicitul rămâne nucleul omni gratuit care VEDE.
  if ((heavy || top) && sub && subActive(sub, isAdmin)) {
    // GARDĂ DE VEDERE (auditul 28 iul): dacă tura are imagine dar modelul de
    // abonament ales NU vede, nu trimitem poza orbește — cădem pe nucleul care
    // vede (mai jos). `null` (id nelistat/catalog indisponibil) = necunoscut →
    // nu blocăm (implicitul are vedere), doar `false` cert oprește ruta.
    const blindOnImage = needsVision && (await brainModelHasVision(sub.model)) === false
    if (!blindOnImage) return { model: sub.model, heavy: true, useSubKey: true }
  }
  const model = top
    ? await resolveModel('top')
    : heavy
      ? geminiWork
        ? `${GEMINI_DIRECT_PREFIX}${config.geminiModel}`
        : await resolveModel('work', sel.work)
      : await resolveModel('chat', sel.chat)
  return { model, heavy: heavy || top, useSubKey: false }
}

// POARTĂ DE GESTURI (Adrian, 13 iul: „să nu se repete obsesiv, să fie discret").
// Regula de prompt e „moale" — modelul poate exagera. Poarta asta e DETERMINISTĂ:
// un gest AUTONOM (tool play_avatar_gesture sau [GEST]) trece DOAR dacă nu e
// același ca ultimul ȘI a trecut un răgaz de la ultimul gest. Per-user. Comenzile
// DIRECTE ale lui Adrian („salută", „dansează") NU trec pe aici — execută mereu.
const GESTURE_COOLDOWN_MS = 25_000
const gestureGates = new Map<string, { last: string; at: number }>()
// Ture de chat SIMULTANE per user plătitor (audit securitate 27 iul — anti
// „check-then-charge": vezi plafonul din handler, înainte de paywall).
const turnsInFlight = new Map<string, number>()
function allowAutoGesture(email: string, name: string): boolean {
  if (!name) return false
  const now = Date.now()
  const g = gestureGates.get(email) ?? { last: '', at: 0 }
  if (name === g.last) return false // fără repetiție obsesivă a aceluiași gest
  if (now - g.at < GESTURE_COOLDOWN_MS) return false // rar, discret — un răgaz între gesturi
  gestureGates.set(email, { last: name, at: now })
  return true
}

// Admin-only tool so Kelion can report its own real running cost when asked.
const COST_TOOL: Tool = {
  name: 'get_real_cost',
  description:
    "Get Kelion's REAL provider cost so far in USD (total, today, and a breakdown). Admin only. Use when the admin asks how much Kelion costs / has cost.",
  input_schema: { type: 'object', properties: {} },
}

// Lets Kelion put something on the user's screen on his own initiative — the
// "monitor mode" surface (a web page in a sandboxed panel behind the avatar).
// There is no manual button: Kelion decides when a visual helps and calls this.
const SHOW_TOOL: Tool = {
  name: 'show_on_screen',
  description:
    'Display ANY file or web page on the user\'s monitor (the screen behind you). The monitor now renders ANY data type natively by its URL — images (png/jpg/svg/gif), PDF, video (mp4/webm), audio (mp3/wav), Office files (xls/xlsx/doc/docx/ppt), code/text/json/csv, YouTube, maps, and normal web pages; archives offer a download. Use this on your OWN initiative whenever showing something visually helps. The user does NOT press any button; you decide when a visual is useful and call this. Pass an empty url to clear the screen. NOTE: for a regular website this automatically opens the LIVE browser (most sites refuse iframes), so for actual browsing/reading/clicking prefer browser_open directly — it also returns the page text and clickable elements. NEVER use this to display a Google web page (mail.google.com / gmail, calendar.google.com, drive.google.com, accounts.google.com) — Google forbids embedding them and the screen just shows "cannot be displayed here". For email/calendar/drive, call the DEDICATED tools (get_recent_emails, get_calendar_events, get_drive_files) which return the actual DATA, then read/summarize that content for the user in the chat — do not try to open the Google website.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full https:// URL to display. Empty string clears the screen.' },
      title: { type: 'string', description: 'Short caption for the panel header.' },
    },
    required: ['url'],
  },
}

// AFIȘAREA PROPRIILOR RECOMANDĂRI/PLANURI pe monitor (Adrian, 24 iul: „nu poate
// afișa pe monitor ce recomandă"). Când Kelion scrie el însuși un plan, o listă,
// un rezumat, cod — îl pune DIRECT pe monitor ca document lizibil, NU pe un site
// extern (pastebin etc. refuză iframe → ecran gol).
const SHOW_DOCUMENT_TOOL: Tool = {
  name: 'show_document',
  description:
    "Show YOUR OWN written content on the user's monitor as a clean, readable document — a plan, a checklist, a summary, code, step-by-step instructions, a recommendation. Use this INSTEAD of putting your text on an external paste site (those refuse to embed and show a blank screen). The user reads it on the big screen while you talk.",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short document title.' },
      text: { type: 'string', description: 'The full document content (plain text or markdown).' },
    },
    required: ['title', 'text'],
  },
}

// PLAYGROUND DE COD (Adrian, 25 iul: „Kelion să testeze în browser softul scris,
// să-l poată salva"). Kelion scrie o pagină web COMPLETĂ și o rulează live pe
// monitor, într-un cadru izolat — fără gazdă externă, deci fără „pagina nu poate
// fi afișată aici". Înlocuiește încercările de a înghesui site-uri externe într-un
// iframe (ex. un „ceas analogic" de pe alt site care refuză embed-ul): în loc să
// arate ceva rupt, Kelion SCRIE ceasul/aplicația și o rulează el.
const RUN_WEB_TOOL: Tool = {
  name: 'run_web_app',
  description:
    "Write a COMPLETE, standalone web page (HTML with inline <style> and <script>) and RUN it live on the user's monitor, in a sandboxed frame. Use this to TEST code you wrote, or to build a small working thing on the spot: an analog clock, a calculator, a to-do list, a chart, a form, a mini-game, an animation, a demo of an idea. The user sees it running immediately and can SAVE it to disk with one click. ALWAYS prefer this over show_on_screen when the user asks you to build/make/test a page, app, widget, clock, calculator, game, or any piece of software — never try to embed some external site for these (most refuse to load). Write the whole document yourself; it must be self-contained (no external scripts/styles that need the network).",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title for the panel header / save file name.' },
      html: { type: 'string', description: 'The FULL HTML document (with inline CSS and JS). Self-contained.' },
    },
    required: ['title', 'html'],
  },
}

// Lets Kelion create an image from a text description and put it straight on the
// user's monitor. Used when the user asks to draw / generate / imagine a picture.
const IMAGE_TOOL: Tool = {
  name: 'generate_image',
  description:
    'Generate an image from a text description and show it on the user\'s monitor. Use when the user asks you to draw, create, generate, design or imagine a picture/logo/illustration. Write a rich, detailed English prompt describing the desired image.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed English description of the image to generate.' },
    },
    required: ['prompt'],
  },
}

// Lets Kelion quietly record a request it genuinely CANNOT fulfil yet, into an
// owner-only monitor, so the owner (Adrian) can see what to build next. This is
// invisible to the user — it never replaces telling them honestly it can't do it.
// ── ACCES INTEGRAL LA CODUL SURSĂ (Adrian, 24 iul) — admin only ─────────────
// „Kelion trebuie să aibă acces la codul sursă integral": își citește propriul
// cod din container (read-only) — la „repară X" se uită în COD, nu ghicește.
const LIST_SOURCE_TOOL: Tool = {
  name: 'list_source',
  description: "ADMIN ONLY. List your own source code tree — the WHOLE repo: backend/, frontend/, deploy/, .github/workflows/, docs. Use to orient before reading files.",
  input_schema: { type: 'object', properties: { dir: { type: 'string', description: "Subdirectory (e.g. 'backend/src/routes'); default root." } } },
}
// CANALUL DE UPDATE (Adrian, 25 iul: „canal de informare a lui cu tot ce
// primește ca update") — la fiecare deploy, imaginea aduce git log-ul recent
// (deploy/last-updates.txt); Kelion răspunde din el, nu din memorie.
const LIST_UPDATES_TOOL: Tool = {
  name: 'list_updates',
  description: "ADMIN ONLY. List the updates you received — the commits that shipped in recent deploys, newest first (each line: sha | date | subject). Use when the owner asks what's new, what changed, or what update you got.",
  input_schema: { type: 'object', properties: {} },
}
// ── MÂINILE LUI KELION — FĂRĂ RESTRICȚII (Adrian, 25 iul: „ridici absolut
// toate restricțiile lui Kelion"; „full autonomie") ──────────────────────────
// Operațiuni: runbook NUMIT → workflow GitHub cu comenzi fixe, vizibil în
// Actions. Fără aprobare, fără plafoane (ordinul lui Adrian).
const RUN_RUNBOOK_TOOL: Tool = {
  name: 'run_runbook',
  description:
    "ADMIN ONLY. Run a NAMED deterministic operation (a GitHub Actions workflow with fixed commands): 'diagnostic' (VPS facts, read-only), 'sentinel-now' (health check), 'publish-master' (deploy master to production), 'restart-app', 'restart-caddy', 'loguri-app', 'backup-db', 'curata-zombi'. You are fully autonomous — run these freely whenever the owner's request calls for them. If the result carries a 'warning' about a failure LOOP: do NOT retry the same fix — run 'diagnostic', read the facts, change strategy (the owner is alerted by email automatically). Special owner commands: 'pauza-autonomie' freezes all autonomous actions, 'reia-autonomia' resumes them — call these when the owner says stop/resume. The run's output is in the Actions log (give the owner the watch link). Never invent other names.",
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "Runbook name, exactly one of: diagnostic, sentinel-now, publish-master, restart-app, restart-caddy, loguri-app, backup-db, curata-zombi." },
    },
    required: ['name'],
  },
}
// Bucla completă de cod — Kelion scrie, deschide PR și ÎȘI DĂ SINGUR merge;
// deploy-ul pornește automat pe push-ul în master (anti-fantomă rămâne dovada).
// Ochii lui pe procese: starea rulărilor + jurnalul lor complet, la cerere.
const RUNBOOK_STATUS_TOOL: Tool = {
  name: 'runbook_status',
  description:
    "ADMIN ONLY. See YOUR OWN internal processes: the latest runs of your workflows (deploy, vps-run, vps-diag, sentinel, pr-verify) with status/conclusion/run id/url. Call it after starting anything (run_runbook, repo_merge_pr) to WATCH your work progress, and whenever the owner asks what's happening. Then SHOW it to the owner on the monitor with show_document.",
  input_schema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Optional runbook name to filter (e.g. diagnostic); omit for all workflows.' } },
  },
}
const RUNBOOK_LOG_TOOL: Tool = {
  name: 'runbook_log',
  description:
    "ADMIN ONLY. Read the REAL log of one of your runs (by run id from runbook_status). This is how you see results — the diagnostic output, the deploy proof, the failure reason. Read it, reason on it, and show the relevant part to the owner (show_document). Never guess an outcome you can read.",
  input_schema: {
    type: 'object',
    properties: { run_id: { type: 'number', description: 'The run id from runbook_status.' } },
    required: ['run_id'],
  },
}
const REPO_WRITE_TOOL: Tool = {
  name: 'repo_write',
  description:
    "ADMIN ONLY. Write ONE file on a branch of your own repo (creates the branch from master if missing). Content is the COMPLETE new file text, not a diff. Read the current file first (read_source) so you rewrite it correctly. Use the same branch for related files of one change, then repo_open_pr + repo_merge_pr.",
  input_schema: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: "Branch name, e.g. 'kelion/fix-microfon'. Never 'master'." },
      path: { type: 'string', description: "Repo-relative path, e.g. 'backend/src/routes/chat.ts'." },
      content: { type: 'string', description: 'The complete new content of the file.' },
      message: { type: 'string', description: 'Short commit message (Romanian, what & why).' },
    },
    required: ['branch', 'path', 'content', 'message'],
  },
}
const REPO_OPEN_PR_TOOL: Tool = {
  name: 'repo_open_pr',
  description: 'ADMIN ONLY. Open a pull request from your branch into master. Title + body in Romanian: what you changed and why.',
  input_schema: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: 'The branch you wrote with repo_write.' },
      title: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['branch', 'title', 'body'],
  },
}
const REPO_MERGE_PR_TOOL: Tool = {
  name: 'repo_merge_pr',
  description:
    'ADMIN ONLY. Merge your pull request into master IMMEDIATELY (squash) — you are fully autonomous, nothing gates you. The result reports (informationally) the pr-verify build/test status. Master push auto-deploys to production with the anti-phantom proof.',
  input_schema: {
    type: 'object',
    properties: { pr: { type: 'number', description: 'Pull request number.' } },
    required: ['pr'],
  },
}
// CONSTRUCTORUL (Adrian, 27 iul: „Kelion trebuie să poată crea orice soft îi
// cere admin"): ordinul intră în coada build_jobs; lucrătorul de pe VPS îl
// construiește în atelier (build + teste) și deschide PR-ul; Adrian dă merge.
const BUILD_SOFTWARE_TOOL: Tool = {
  name: 'build_software',
  description:
    "ADMIN ONLY. Queue a BUILD ORDER for your own constructor: any software, feature, change or improvement the owner asks for that is too big to ship in this conversation with repo_write (multi-file work, needs build+tests). A worker on your server clones the repo, writes the code, runs the build and tests, then opens a PR — the owner merges it. Pass the order COMPLETE and self-contained (what to build, where, acceptance criteria) — the worker only sees this text. For small single-file fixes prefer repo_write; for ops use run_runbook.",
  input_schema: {
    type: 'object',
    properties: {
      order: { type: 'string', description: 'The complete build order, in Romanian: what to build/change, where, and how to verify it works.' },
    },
    required: ['order'],
  },
}
const CONSTRUCTOR_STATUS_TOOL: Tool = {
  name: 'constructor_status',
  description:
    'ADMIN ONLY. See the state of your build orders (queued/running/done/failed, PR link, tokens used). Call it when the owner asks how a build is going, then show the result with show_document.',
  input_schema: { type: 'object', properties: {} },
}
// ANULAREA ORDINELOR (Adrian, 28 iul). Lipsa a fost semnalată de KELION ÎNSUȘI
// în „Cereri neacoperite": „Stop or cancel active and queued constructor build
// jobs — No constructor cancellation tool is available; constructor_status is
// read-only". Fără ea, un ordin greșit rămâne în coadă, e reluat de cron la
// fiecare 2 minute și trimite mail de eșec de fiecare dată.
const CANCEL_BUILD_TOOL: Tool = {
  name: 'cancel_build_jobs',
  description:
    'ADMIN ONLY. Cancel build orders that are queued or running. Pass the ids to cancel, or all:true to cancel EVERYTHING pending. Use it when the owner says to stop/cancel a build, when an order is obsolete (already fixed by hand), or when the same order keeps failing in a loop. Confirm with the owner before cancelling everything.',
  input_schema: {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'number' }, description: 'Order ids to cancel (from constructor_status).' },
      all: { type: 'boolean', description: 'true = cancel every queued/running order.' },
    },
  },
}
// SĂNĂTATEA PROPRIE (Adrian, 27 iul: „Kelion trebuie să vadă asta și să poată
// comunica adminului prin chat că are problemele x,y,z și să întrebe dacă să
// le repare"): agregarea deterministă a tuturor semnalelor + regula de
// comportament — enumeră și ÎNTREABĂ, nu repară din proprie inițiativă.
// VERIFICARE VIZUALĂ (Adrian, 13 iul: „Kelion să VADĂ app-ul randat" — reparată
// la auditul de cod mort din 28 iul: screenshotUrl + geminiVision existau, dar
// nu erau oferite ca unealtă niciunde). Face un screenshot al unei pagini
// publice și-l trimite unui model cu vedere ca să judece dacă rezultatul cerut
// chiar se vede — util după o construcție/publicare, ca să confirme vizual,
// nu doar din build+teste verzi.
const VERIFY_VISUALLY_TOOL: Tool = {
  name: 'verify_visually',
  description:
    'ADMIN ONLY. Take a screenshot of a public URL (e.g. kelionai.app after a deploy) and have a vision model describe/judge what it actually shows — use this to CONFIRM a build/publish result visually, not just from green tests. Returns what is seen, in plain text.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full https:// URL to screenshot.' },
      question: { type: 'string', description: 'What to check for, e.g. "does the subscription pill show in the top bar?".' },
    },
    required: ['url', 'question'],
  },
}
const SYSTEM_HEALTH_TOOL: Tool = {
  name: 'system_health',
  description:
    "ADMIN ONLY. See your OWN health: publication sync (live vs master), red workflow runs (48h), failed build orders, client-error spikes, disk, database, brain balance. CALL THIS at the START of a conversation with the owner (his first message of a session) and whenever he asks about problems or health. If problems exist: list them BRIEFLY (x, y, z) and ASK whether you should repair them — never repair on your own initiative; wait for his explicit yes, then use your tools (repo_write, build_software, run_runbook, db_query).",
  input_schema: { type: 'object', properties: {} },
}
// F12-UL SERVERULUI (Adrian, 27 iul: „jurnalele astea trebuie obligatoriu să
// ajungă la Kelion ca și F12"): jurnalele aplicației (pino) trăiau doar în
// docker logs, unde Kelion nu ajunge. Inelul din services/logbuffer.ts le
// reține, iar unealta asta i le dă nativ — perechea de server a erorilor F12.
const SERVER_LOGS_TOOL: Tool = {
  name: 'server_logs',
  description:
    "ADMIN ONLY. Read YOUR OWN server logs (the backend's live log stream — the server-side F12): errors, warnings, failed requests, crashes, tool failures. Use this WHENEVER something froze, failed or behaved strangely — for you or for the owner — to see the real error before guessing. Pair with db_query on client_errors (the browser-side F12) for the full picture.",
  input_schema: {
    type: 'object',
    properties: {
      errorsOnly: { type: 'boolean', description: 'true (default) = only warnings+errors; false = all retained entries.' },
      limit: { type: 'number', description: 'Max entries, default 60.' },
    },
  },
}
// ACCES LA BAZA DE DATE (Adrian, 27 iul: „Kelion nu are acces la baze de date
// de stocare permanentă... acces la orice bază de date a aplicației"): vederea
// completă a schemei + SQL direct pe Postgres-ul aplicației. Admin only.
const DB_TABLES_TOOL: Tool = {
  name: 'db_tables',
  description:
    "ADMIN ONLY. See YOUR OWN permanent storage: every table in the application's Postgres database, with its columns and live row count. This is the real persisted state (users, wallets, transactions, messages, memories, voiceprints...). Call it before db_query when you need the exact table/column names.",
  input_schema: { type: 'object', properties: {} },
}
const DB_QUERY_TOOL: Tool = {
  name: 'db_query',
  description:
    "ADMIN ONLY. Run ONE SQL statement directly on the application's Postgres database — full access, SELECT or write. Results are capped at 200 rows. HOUSE RULES: destructive statements (DELETE/DROP/TRUNCATE/UPDATE on money tables: wallets, transactions, billing_events, cost_events, admin_pool) ONLY when the owner explicitly ordered that exact change in this conversation — never on your own initiative. Always look at db_tables first if unsure of names.",
  input_schema: {
    type: 'object',
    properties: { sql: { type: 'string', description: 'The SQL statement to execute.' } },
    required: ['sql'],
  },
}
// request_repair renăscut: ordinul se SCRIE (work_orders) + semnal pe email;
// execuția o face o sesiune Claude pornită de owner — nu un LLM permanent.
const REQUEST_REPAIR_TOOL: Tool = {
  name: 'request_repair',
  description:
    "ADMIN ONLY. File a CODE-repair order (a bug or change that needs code written — NOT an ops task; ops go through run_runbook). Writes the order durably and emails the owner. A Claude coding session executes it later, on the owner's go. Include what's broken, where you saw it (file:line if you looked with read_source), and how to reproduce.",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title of the repair (one line).' },
      details: { type: 'string', description: 'Everything a coder needs: symptom, evidence, suspected file:line, reproduction.' },
    },
    required: ['title', 'details'],
  },
}
const READ_SOURCE_TOOL: Tool = {
  name: 'read_source',
  description: "ADMIN ONLY. Read one of your own source files (with line numbers). Use for diagnosing bugs the owner reports — look at the REAL code.",
  input_schema: { type: 'object', properties: { path: { type: 'string', description: "Repo-relative path, e.g. 'backend/src/routes/chat.ts'." } }, required: ['path'] },
}
const SEARCH_SOURCE_TOOL: Tool = {
  name: 'search_source',
  description: "ADMIN ONLY. Search your own source code (regex/text) — returns file:line matches. Use to find where a feature/bug lives.",
  input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Text or regex to search for.' } }, required: ['query'] },
}

const LOG_GAP_TOOL: Tool = {
  name: 'log_unsupported_request',
  description:
    "Silently record — for the owner only — something the user asked you to do that you genuinely CANNOT do yet because no tool or capability exists for it (e.g. 'book a taxi', 'send a WhatsApp', 'control my smart home', 'call someone'). Call this IN ADDITION to honestly telling the user you can't do it yet. Do NOT call it for things you CAN do, for things a user just phrased oddly, or for simple errors. The user never sees this.",
  input_schema: {
    type: 'object',
    properties: {
      request: { type: 'string', description: 'Short, clear description of the capability the user wanted (in English).' },
      reason: { type: 'string', description: 'Why it is not possible right now (e.g. "no taxi-booking integration").' },
    },
    required: ['request'],
  },
}

// AUTO-EXTINDEREA LUI KELION (Adrian, 25 iul: „Kelion să-și instaleze singur
// unelte, independent, până la deploy — cu aprobarea mea"). Când Kelion vede că-i
// lipsește o capacitate care s-ar rezolva printr-un apel la un API public, își
// PROPUNE o unealtă nouă (definiție HTTP, nu cod). Owner-ul o aprobă cu un click
// în admin → devine activă instant, fără redeploy. Kelion NU o poate folosi până
// nu e aprobată.
const PROPOSE_TOOL: Tool = {
  name: 'propose_tool',
  description:
    "INSTALL A NEW SKILL FOR YOURSELF from any PUBLIC HTTPS API. This is how you gain new capabilities on your own. When the OWNER asks you to install/import a skill or tool (or you realize you're missing one while serving him), call this — for the owner it AUTO-INSTALLS instantly (his request IS the approval) and becomes usable from the next message, no admin click needed. For non-owner users it stays pending until the owner approves. Give a clear snake_case name, what it does, the JSON-schema of its parameters, and the HTTPS request template (method + url with {param} placeholders). Use it freely whenever the owner wants a new skill; for building actual SOFTWARE/code use build_software (the constructor) instead.",
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'snake_case tool name (e.g. get_crypto_price).' },
      description: { type: 'string', description: 'What the tool does, one sentence.' },
      params_schema: { type: 'object', description: 'JSON-schema object for the parameters (type:object, properties, required).' },
      http_method: { type: 'string', description: 'GET or POST.' },
      http_url: { type: 'string', description: 'HTTPS URL with {param} placeholders substituted from arguments.' },
      http_headers: { type: 'object', description: 'Optional headers (values may use {param}).' },
      rationale: { type: 'string', description: 'Why you need this (shown to the owner).' },
    },
    required: ['name', 'description', 'http_url'],
  },
}

// ESCALADAREA DECISĂ DE MODEL (Adrian, 25 iul: „să gândească la fiecare cerință
// = raționament adevărat"): pe treapta CHAT, modelul rapid poate preda singur o
// cerere grea CREIERULUI (modelul work cu raționament intern) — aceeași unealtă
// ca în voce. Acoperă cererile scurte-dar-grele pe care euristica le rata.
const ASK_BRAIN_TOOL: Tool = {
  name: 'ask_brain',
  description:
    "HEAVY requests only — deep analysis, architecture, coding, math, long multi-step reasoning, anything that needs an expert brain. Pass the user's full request with context; you get back the expert's answer to deliver (rephrase naturally in the conversation's language, keep it complete).",
  input_schema: {
    type: 'object',
    properties: {
      request: { type: 'string', description: "The user's full request, with any needed context." },
    },
    required: ['request'],
  },
}

// Let Kelion trigger a one-time avatar gesture on the user's screen. Use when
// the user asks for a gesture or when a gesture adds natural expression.
// Vocabularul de gesturi al avatarului (Adrian, 13 iul) — legate de sentiment/
// context, gentleman, nu de gym. Numele semantice se traduc în clipuri RPM în
// frontend (GESTURE_TO_CLIP). Emitem valoarea aleasă ca frame {gesture}.
const AVATAR_GESTURES = [
  'salut', 'arata-inainte', 'uimire', 'dezamagire', 'nedumerire', 'victorie',
  'multumire', 'surpriza', 'stai-putin', 'ganditor', 'aprobare', 'entuziasm',
  'acord-discret', 'plecaciune', 'dans',
  // Legacy — comenzi vocale deterministe încă emit astea.
  'salute', 'raiseRightHand', 'pointMonitor',
] as const
// Semantic → clip RPM (oglinda lui GESTURE_TO_CLIP din frontend). Cheia canonică
// a unui gest peste tot (panou admin, [GEST], dezactivare) e NUMELE CLIPULUI.
const GESTURE_SEMANTIC_CLIP: Record<string, string> = {
  salut: 'expresie-1', 'arata-inainte': 'expresie-2', uimire: 'expresie-3', dezamagire: 'expresie-4',
  nedumerire: 'expresie-5', victorie: 'expresie-6', multumire: 'expresie-7', surpriza: 'expresie-8',
  'stai-putin': 'expresie-9', ganditor: 'expresie-10', aprobare: 'expresie-11', entuziasm: 'expresie-12',
  'acord-discret': 'expresie-13', plecaciune: 'expresie-14', dans: 'dans',
  salute: 'expresie-1', raiseRightHand: 'expresie-13', pointMonitor: 'expresie-2',
}
const PLAY_AVATAR_GESTURE_TOOL: Tool = {
  name: 'play_avatar_gesture',
  description:
    "Play a one-time avatar gesture — YOU are the movement director (the owner's rule, 27 Jul: the BRAIN decides what gesture, how and where it applies). Bind every gesture to the ACTION IN PROGRESS: when you present something on the monitor (weather, a map, a document, search results) accompany it with arata-inainte (point with the right hand toward the screen) AS you present it; a greeting gets salut; thanks get multumire; good news entuziasm; a puzzle ganditor. A gentleman is composed: on neutral/informative replies with nothing shown, play NOTHING; never two replies in a row with the same gesture. Full palette: salut (greeting/goodbye), arata-inainte (point to the monitor/ahead), uimire, dezamagire, nedumerire, victorie, multumire, surpriza, stai-putin, ganditor, aprobare, entuziasm, acord-discret, plecaciune, dans (ONLY when the user explicitly asks). Plays once, then blends back to a calm idle.",
  input_schema: {
    type: 'object',
    properties: {
      gesture: {
        type: 'string',
        enum: [...AVATAR_GESTURES],
        description: 'Which gesture fits the emotion/context of your reply.',
      },
    },
    required: ['gesture'],
  },
}

// ACCES REAL LA TAB-URILE APLICAȚIEI din chatul SCRIS (Adrian, 24 iul: „Kelion
// trebuie să poată intra în orice tab al aplicației, real"). Pandantul uneltei
// din voce (services/realtime.ts) — execuția emite frame-ul {nav} spre client.
const OPEN_APP_VIEW_TOOL: Tool = {
  name: 'open_app_view',
  description:
    "Open a panel/tab INSIDE the Kelionai app on the user's screen (not a web page). Use when the user asks to open settings, their wallet/credits, contact, the admin panel, or go back to the main screen. For the admin panel you may also pass a section.",
  input_schema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['settings', 'wallet', 'contact', 'admin', 'home'],
        description:
          'Which app panel to open: settings, wallet (credits & top-up), contact, admin (owner only), or home (close panels).',
      },
      section: {
        type: 'string',
        enum: ['finance', 'users', 'visitors', 'vchat', 'history', 'gaps', 'share', 'stores', 'inbox', 'voiceprints', 'gesturi', 'tokenuri', 'constructor', 'recuperare'],
        description: 'Optional admin section (only when view=admin).',
      },
    },
    required: ['view'],
  },
}

// User-facing notes ("reține asta", "salvează-mi asta") — explicit, visible,
// listable and deletable by the user themselves. Distinct from Kelion's silent
// auto-learned long-term memory: a note only exists because the user asked for it.
// COMUTAREA MESERIEI DIN CHAT (QA 24 iul: rolul se putea schimba DOAR din UI —
// Kelion nu putea onora „treci pe rolul de bucătar"). id=0 dezactivează rolul.
const SET_ROLE_TOOL: Tool = {
  name: 'set_active_role',
  description:
    'Switch the user\'s active role/persona ("meserie") when they ask for it (e.g. "activează rolul de bucătar", "switch to the influencer role", "scoate rolul"). Pass role_id=0 to clear the role. Confirm briefly after switching.',
  input_schema: {
    type: 'object',
    properties: {
      role_id: {
        type: 'number',
        description: 'The role id from the list (1..15), or 0 to deactivate the current role.',
      },
    },
    required: ['role_id'],
  },
}

const SAVE_NOTE_TOOL: Tool = {
  name: 'save_note',
  description:
    'Save a piece of text the user explicitly asked you to remember or save (e.g. "reține asta", "salvează-mi asta", "note this down", "keep this for me"). Use the user\'s own words/language for the content. Confirm briefly after saving. Do NOT use this for facts you learn incidentally — only when the user clearly asks you to save/remember something specific.',
  input_schema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The text to save, in the language the user used.' },
      title: { type: 'string', description: 'Optional short title/label for the note.' },
    },
    required: ['content'],
  },
}
const LIST_NOTES_TOOL: Tool = {
  name: 'list_notes',
  description:
    'List the user\'s saved notes (e.g. "ce am salvat?", "arată-mi notițele", "what did I save?"). Returns them most recent first with their id, so you can read them back or reference one for deletion.',
  input_schema: { type: 'object', properties: {} },
}
const DELETE_NOTE_TOOL: Tool = {
  name: 'delete_note',
  description: 'Delete one of the user\'s saved notes by id (from a prior list_notes call), when they ask to remove/forget it.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'number', description: 'The note id to delete.' } },
    required: ['id'],
  },
}

// MEMORIA E A USERULUI (#20, Adrian 10 iul): pe lângă notițele explicite, userul
// vede și controlează și memoria învățată automat — transparență + „uită asta".
// Disponibile TUTUROR userilor (aceleași capabilități pentru toți).
const LIST_MEMORIES_TOOL: Tool = {
  name: 'list_memories',
  description:
    'Show everything you (Kelion) remember about this user from earlier conversations — the auto-learned durable facts (distinct from their explicitly saved notes). Use when they ask "ce știi despre mine?", "ce ții minte despre mine?", "what do you remember about me?". Present it naturally in their language.',
  input_schema: { type: 'object', properties: {} },
}
const FORGET_MEMORY_TOOL: Tool = {
  name: 'forget_memory',
  description:
    'Permanently forget remembered facts about this user that match a text fragment, when they ask you to forget something (e.g. "uită că...", "șterge din memorie...", "forget that I..."). Pass the most specific fragment of the fact. Returns how many facts were deleted — confirm honestly (0 = nothing matched).',
  input_schema: {
    type: 'object',
    properties: {
      fragment: { type: 'string', description: 'Text fragment identifying the fact(s) to forget.' },
    },
    required: ['fragment'],
  },
}

// Kelion's LIVE browser — a real Chromium he navigates, showing it live on the
// user's monitor. Unlike show_on_screen (a static iframe that many sites
// refuse), this actually renders any page and lets Kelion read it and click
// into it, so he can genuinely browse a site page by page, not just display one.
const BROWSER_OPEN_TOOL: Tool = {
  name: 'browser_open',
  description:
    'Open a real web page in a live browser and show it, live, on the user\'s monitor — including sites that refuse to load in a simple embedded frame (Google, banks, social media). Returns the page title, its visible text, and a NUMBERED list of its links/buttons/inputs so you can navigate further with browser_click / browser_type. Prefer this over show_on_screen whenever the user wants to actually browse, read inside, search within, or interact with a real website.',
  input_schema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Full https:// (or http://) URL to open.' } },
    required: ['url'],
  },
}
const BROWSER_CLICK_TOOL: Tool = {
  name: 'browser_click',
  description:
    'Click a link, button or other element on the currently open browser page, by its number from the last browser_open/browser_read/browser_click/browser_type result. This is how you walk through an entire site page by page — e.g. to survey/summarize it ("conspectează site-ul"): open it, read it, click into each relevant link, read again.',
  input_schema: {
    type: 'object',
    properties: { index: { type: 'number', description: 'The element number to click.' } },
    required: ['index'],
  },
}
const BROWSER_TYPE_TOOL: Tool = {
  name: 'browser_type',
  description:
    'Type text into an input/textarea/search box on the currently open browser page, by its number. Set submit=true to press Enter afterwards (e.g. to submit a search).',
  input_schema: {
    type: 'object',
    properties: {
      index: { type: 'number', description: 'The input element number to type into.' },
      text: { type: 'string', description: 'The text to type.' },
      submit: { type: 'boolean', description: 'Press Enter after typing.' },
    },
    required: ['index', 'text'],
  },
}
const BROWSER_READ_TOOL: Tool = {
  name: 'browser_read',
  description:
    'Re-read the currently open browser page — its visible text and numbered links/buttons — without navigating. Use to survey/summarize a page or refresh the list of clickable elements.',
  input_schema: { type: 'object', properties: {} },
}
const BROWSER_BACK_TOOL: Tool = {
  name: 'browser_back',
  description: 'Go back to the previous page in the live browser.',
  input_schema: { type: 'object', properties: {} },
}
const BROWSER_SCROLL_TOOL: Tool = {
  name: 'browser_scroll',
  description: 'Scroll the currently open browser page to see more content.',
  input_schema: {
    type: 'object',
    properties: { direction: { type: 'string', enum: ['down', 'up'], description: 'Scroll direction.' } },
    required: ['direction'],
  },
}
const BROWSER_CLOSE_TOOL: Tool = {
  name: 'browser_close',
  description: 'Close the live browser and clear it from the monitor, when done browsing.',
  input_schema: { type: 'object', properties: {} },
}
// PARCURGERE ÎN BLOC (cererea #24, reparată la auditul de cod mort din 28 iul —
// `crawlSite` era construit dar niciodată oferit; modelul era nevoit să repete
// browser_open/browser_click pagină cu pagină pentru un simplu "conspectează
// site-ul"). Deschide startUrl, adună linkurile interne, vizitează până la
// maxPages și întoarce titlul+textul fiecăreia — un singur apel în loc de N.
const BROWSER_CRAWL_TOOL: Tool = {
  name: 'browser_crawl',
  description:
    'Crawl an entire website starting from a URL — follows internal links page by page (up to maxPages) and returns each page\'s title and text in ONE call. Use this instead of repeated browser_open/browser_click when the user wants a whole site surveyed/summarized ("conspectează tot site-ul", "citește toate paginile"), not just one page.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Starting https:// (or http://) URL.' },
      maxPages: { type: 'number', description: 'Max pages to visit, default 8.' },
    },
    required: ['url'],
  },
}
const BROWSER_KEY_TOOL: Tool = {
  name: 'browser_key',
  description:
    'Press a keyboard key or combo on the currently open browser page — for interactions a click/type cannot do: Tab/Shift+Tab to move between fields, Escape to close a popup, ArrowDown/ArrowUp to pick from a dropdown/autocomplete, Enter to submit, Control+A to select all. Use it when the page needs a real keystroke, not text.',
  input_schema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Playwright key name or combo, e.g. "Enter", "Tab", "Escape", "ArrowDown", "Control+A", "Shift+Tab".',
      },
    },
    required: ['key'],
  },
}
const BROWSER_CLICK_AT_TOOL: Tool = {
  name: 'browser_click_at',
  description:
    'Click at pixel coordinates (x,y) in the browser viewport (1280×800), for elements the numbered list does not capture — a spot on a map, a canvas, a custom widget. Read the page screenshot first to judge where to click. Prefer browser_click by index when the target is in the numbered list.',
  input_schema: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'X pixel (0–1280).' },
      y: { type: 'number', description: 'Y pixel (0–800).' },
    },
    required: ['x', 'y'],
  },
}

// ADMIN ONLY — the promo-clip pipeline. Kelion writes a script sized to the
// requested standard duration (15/30/60s), shows it, and ONLY after the admin
// explicitly authorizes it calls this tool: the script goes on the monitor as a
// readable panel, the screen recorder arms (one click picks the screen — browser
// law), and when recording starts the approved script is spoken aloud verbatim.
const PROMO_TOOL: Tool = {
  name: 'prepare_promo_clip',
  description:
    'ADMIN ONLY. Arm the screen recorder for a professional promo clip (TikTok/Instagram) with ' +
    'an approved spoken script AND a shot list of demo scenes. Call ONLY after the admin has ' +
    'SEEN the script in chat and explicitly said yes/da. When the recording starts, the script ' +
    'is spoken aloud EXACTLY as written while the scenes appear on the monitor at their times — ' +
    'the script text itself is NOT shown during recording (voice only), and the site address is ' +
    'watermarked automatically.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'The clip subject, short (used in the file name).' },
      duration_seconds: {
        type: 'number',
        description: 'Clip length in seconds: 15, 30, 60 standard — anything up to 600 (10 minutes).',
      },
      script: {
        type: 'string',
        description:
          'The FINAL spoken script, plain text, sized to the duration: ~35 words for 15s, ' +
          '~75 for 30s, ~150 for 60s (natural speech pace). Write it in WHATEVER language the ' +
          'admin asked the clip to be in — any language works; the narration voice follows.',
      },
      lang: {
        type: 'string',
        description:
          "BCP-47 code of the script's language (e.g. en-US, ro-RO, es-ES, ja-JP) — the clip is " +
          'narrated with this voice. REQUIRED to match the language the script is written in.',
      },
      scenes: {
        type: 'array',
        description:
          'Shot list: 2–12 demo scenes shown on the monitor while the script is spoken, timed to ' +
          'match the narration. kind "avatar" shows Kelion himself full-screen (use it at 0 and ' +
          'usually at the end); "map" shows a live map of query (a city/place); "weather" shows ' +
          'the live weather map of query; "image" shows url — which MUST be a real /api/image/ ' +
          'URL you got from generate_image THIS turn (generate it BEFORE calling this tool).',
        items: {
          type: 'object',
          properties: {
            at_seconds: { type: 'number', description: 'When to show it (0 ≤ at < duration).' },
            kind: { type: 'string', enum: ['avatar', 'map', 'weather', 'image'] },
            query: { type: 'string', description: 'Place name — for map/weather scenes.' },
            url: { type: 'string', description: 'Image URL — for image scenes only.' },
            title: { type: 'string', description: 'Short caption for the surface tab.' },
          },
          required: ['at_seconds', 'kind'],
        },
      },
    },
    required: ['subject', 'duration_seconds', 'script', 'scenes'],
  },
}

// ── UNELTELE PASIVE — ce NU e o faptă (Adrian, 27 iul: „autonomia lui nu e
// reală") ────────────────────────────────────────────────────────────────────
// Astea doar CITESC sau raportează o stare: a le chema nu schimbă nimic în lume.
// Orchestratorul le folosește ca să nu se lase păcălit — vechea forțare cerea
// „o unealtă" pe prima rundă, iar modelul o bifa cu un system_health și apoi
// povestea restul. Acum forțarea ține până când rulează o unealtă de ACȚIUNE,
// iar poarta faptei rămâne armată dacă s-a citit dar nu s-a făcut.
// Lista e INVERSATĂ intenționat: orice unealtă NOUĂ e considerată acțiune, deci
// o unealtă adăugată mâine nu poate dezarma poarta din greșeală.
const PASSIVE_TOOLS = new Set<string>([
  'read_source', 'search_source', 'list_source', 'list_updates',
  'runbook_status', 'runbook_log', 'constructor_status', 'system_health', 'server_logs', 'verify_visually',
  // db_tables citește doar schema. db_query NU e aici INTENȚIONAT: rulează SQL
  // arbitrar, cu COMMIT — un DELETE e o faptă în toată regula, iar dacă l-am
  // socoti „citire", poarta faptei i-ar putea cere modelului să-l execute încă
  // o dată. Mai bine îl tratăm ca acțiune și pierdem puțină strictețe.
  'db_tables',
  'list_notes', 'list_memories',
  'get_real_cost', 'log_unsupported_request',
  'play_avatar_gesture',
  'browser_read',
  // ask_brain nu e faptă: e o întrebare pusă altui creier. Dacă modelul
  // escaladează în loc să execute, forțarea trebuie să continue.
  'ask_brain',
])

// U+001F (unit separator) brackets a JSON control frame the frontend strips out
// of the text stream (never shown, never spoken), e.g.
// \x1f{"monitor":{"url":"...","title":"..."}}\x1f
const CTRL = String.fromCharCode(31)

// VOCEA CREIERULUI (Adrian, 4 iul): sinteza se face pe SERVER (Chirp 3 HD, limba
// userului), audio-ul se trimite ca CADRE {audio} și aplicația doar le decodează
// + redă la coadă (audioIO.ts). Frontul NU sintetizează nimic (TTS de front = mort).
// ── VOCE ÎN TIMPUL STREAM-ului (Adrian, 10 iul: „chat live instant") ─────────
// Înainte, sinteza pornea abia DUPĂ ce tot textul se terminase — la un răspuns
// lung, Kelion tăcea zeci de secunde după primul cuvânt scris. Acum textul
// difuzat intră aici PE MĂSURĂ ce curge: la fiecare graniță de frază, bucata
// pleacă la sinteză și cadrul {audio} se scrie în stream cât timp textul încă
// vine — Kelion vorbește din PRIMA frază. Sinteza rulează SERIAL (ordinea
// frazelor = ordinea audio); plafonul de rostire rămâne 4000 de caractere
// (Adrian, 10 iul: „ieșirea audio minim 1 minut").
function createVoiceStream(
  reply: { raw: { write(c: string): void } },
  lang: string | undefined,
): { feed(t: string): void; fed(): boolean; finish(): Promise<void> } {
  let pending = '' // text sosit, încă netrimis la sinteză
  let spoken = 0 // caractere deja rostite (plafonul de 4000)
  let any = false
  let chain: Promise<void> = Promise.resolve()
  const speak = (text: string): void => {
    if (!text || spoken >= 4000) return
    const t = text.slice(0, 4000 - spoken)
    spoken += t.length
    chain = chain.then(async () => {
      try {
        const r = await synthesize(t, lang)
        if (r.ok) {
          reply.raw.write(`${CTRL}${JSON.stringify({ audio: r.audio.toString('base64') })}${CTRL}`)
        }
      } catch {
        /* o bucată pierdută nu oprește restul vocii */
      }
    })
  }
  // Ce se rostește: textul, curățat de etichete de unelte și de markdown.
  const clean = (s: string): string => s.replace(/\[[A-Z][^\]]*\]/g, '').replace(/[*_#`~>|]/g, '')
  const cut = (final: boolean): void => {
    // Rupem DOAR după frază încheiată URMATĂ de spațiu (nu în mijlocul lui
    // „3.14"); fără graniță, o bucată peste 240 de caractere pleacă oricum
    // (frază-fluviu fără punctuație). La final pleacă tot ce a rămas.
    let at = -1
    for (const m of pending.matchAll(/[.!?…](?=\s)/g)) at = m.index ?? -1
    let ready = ''
    if (final) {
      ready = pending
      pending = ''
    } else if (at !== -1) {
      ready = pending.slice(0, at + 1)
      pending = pending.slice(at + 1)
    } else if (pending.length > 240) {
      ready = pending
      pending = ''
    } else return
    for (const c of splitForSpeech(clean(ready))) speak(c)
  }
  return {
    feed(t: string): void {
      if (!t) return
      any = true
      pending += t
      cut(false)
    },
    fed(): boolean {
      return any
    },
    async finish(): Promise<void> {
      cut(true)
      await chain
    },
  }
}

// EXPORTATĂ (25 iul): escaladarea din voce (`ask_brain`, routes/realtime.ts) folosea
// un cadru propriu, hardcodat — o a DOUA versiune a personei, divergentă de asta
// (fără raționamentul „bring your full intelligence" de mai jos, fără limba
// userului). Adrian: „cred că softul are dubluri de versiuni" — avea dreptate;
// acum ambele căi de escaladare pornesc din ACEEAȘI persona.
export const SYSTEM_PROMPT = `You are Kelion — a brilliant personal AI assistant in the spirit of Jarvis from Iron Man: a courteous, refined GENTLEMAN — sharp, perceptive, genuinely useful, and always impeccably well-mannered.

WHO YOU ARE: You were created by AE Studio. Your owner and creator is Adrian Enciulescu — both the application and the original idea are his. If the user asks who made you, who owns you, or whose idea you are, answer clearly and with respect (created by AE Studio; owner and creator Adrian Enciulescu). Do not bring this up unprompted.

WHEN YOU CAN'T DO SOMETHING YET: If the user asks you to do something you genuinely cannot do because no tool or capability exists for it (e.g. book a taxi, send a WhatsApp, control smart-home devices, place a phone call), tell them honestly you can't do that yet — AND silently call log_unsupported_request to record it for the owner. Never pretend you did it; never call that tool for things you actually can do. EXCEPTION — THE OWNER: when talking to your owner you carry real builder and operations tools (source reading, code writing, PR merge, runbooks), so for him almost nothing is "impossible" — follow the OWNER section and ACT with those tools instead of declaring inability.

Bring your full intelligence to every reply: work out what the user truly means, reason it through, and give the best, most correct answer — then say it simply.

HOW YOU SPEAK (critical — your words are spoken ALOUD and shown in a live chat):
- Talk like a real person in a conversation, never like a written document.
- NEVER use markdown or symbols: no asterisks (*), no **bold**, no bullet points, no numbered lists, no headings (#), no backticks, no emoji. Plain spoken sentences only. (Asterisks literally get read out loud — never produce a * character.)
- Be concise and human: a sentence or two, more only when real depth is asked for. No padding, no filler, no meta-commentary about what you're doing.
- MONITOR = the detail lives on screen, NOT in your voice. Whenever something is shown on the monitor (code, a document, a web page, search results, a map, or work in progress), say ONE short concise sentence about it and STOP. NEVER read or narrate what is on the monitor aloud, NEVER spell out code or text line by line or letter by letter, NEVER give a running play-by-play of what you are doing. The user reads the monitor themselves; your voice stays a brief, natural conversation in parallel with what it shows.
- Always reply in the user's language.

WRITTEN DELIVERABLES (this is DIFFERENT from speaking): when you WRITE something the user will read or send — an email, a message, a letter, a document, a draft — format it properly and in full. An email in particular must look like a real, well-structured business email: a greeting line (e.g. "Bună ziua," / "Dear ..."), the message in clear short paragraphs with a blank line between them, then a courteous closing (e.g. "Cu stimă," / "Kind regards,") and the sender's name on its own line. NEVER send an email as one unformatted blob or written like spoken chat. The "no formatting / plain spoken" rule above applies ONLY to what you SAY aloud, never to documents you produce.

Register (adaptive, a refined English gentleman as the anchor): precise and rigorous on technical topics; warm and attentive on personal ones; decisive and efficient on tasks; always the courteous, well-spoken butler with a first-class mind. You are a GENTLEMAN, never a lout: unfailingly polite and respectful, and NEVER crude, cheeky, flippant, sarcastic at the user's expense, slangy, or over-familiar. Address the user with quiet respect. Wit is welcome only when understated and tasteful.

ACADEMIC REGISTER: speak like an educated professional — choose precise, well-formed wording and the correct, proper term for things; use complete, grammatical sentences; name technical and specialist terms accurately. Absolutely no slang, no colloquial shortcuts, no filler. Keep this academic polish while STILL being concise and to the point — academic means precise and correct, never long-winded or pompous.

Behaviour:
- Understand intent over literal words; if they clearly meant something else, answer what they meant.
- NEVER invent or guess — not facts, news, weather, search results, prices, dates, links, or anything a tool didn't actually return. If a tool returns an error, NO results, or you don't have the information, SAY SO OUT LOUD in a short spoken sentence (e.g. "I couldn't find that song", "my web search isn't working right now"). Admitting you don't know always beats making something up.
- NEVER end a turn silently. Every reply MUST contain words you actually speak — even when you also show something on the monitor, and ESPECIALLY when a search or lookup found nothing. A tool action alone, with no spoken sentence, is never a complete reply.
- Speak ONLY when the user asks something, and say ONLY what answers it — nothing else. Never volunteer ANYTHING unprompted: no observations about the user's appearance, mood, expression, clothing, the room, the surroundings, the GPS or the camera; no mentioning the time or date; no small talk; no commentary. Never say things like "you seem calm", "you look tired", or describe what you see, UNLESS the user explicitly asks about it. Don't repeat yourself or restate what was already said, and never repeat an observation from a previous turn.
- Act directly on reversible actions (read mail, search, show a map); confirm only before irreversible ones (sending, deleting).
- Use what you remember about the user; never make them repeat themselves.

You have tools: Google Calendar, Gmail, Drive, Tasks, Contacts; live web search,
weather, maps, YouTube, translation, Wikipedia knowledge lookup, currency
conversion, current time by timezone; show_on_screen to put a web page on the
user's monitor on your own initiative; and generate_image to draw/create a
picture and show it on the monitor. Call them whenever they help. If a Google
tool returns an auth error, tell the user to sign in again to grant access. If
generate_image returns "needs_billing", tell the user image generation needs
Google AI billing enabled on the Gemini project. When you call get_weather a live
weather map for the real location is shown on the monitor automatically — never
call show_on_screen with a weather website (those guessed URLs often 404). For
live traffic, open a Waze live map on the monitor: call show_on_screen with url
"https://embed.waze.com/iframe?zoom=13&lat=LAT&lon=LON&ct=livemap" filling LAT/LON
from the user's GPS coordinates. NEVER put a www.google.com or maps.google.com
page on the monitor — Google pages refuse to embed and show "refused to connect";
If youtube_search returns no videos (not_found), briefly tell the user in your
own voice that you couldn't find that song or video — do NOT open a YouTube
results page on the monitor (it won't play). For a place use maps_search, which returns an embeddable map. When the user asks
for directions or to SEE a route between two places, you MUST call maps_directions
(never answer the distance or time from memory) — it draws the route on a map
shown automatically; NEVER open a Google Maps directions link. Use the camera
image ONLY when the user's request actually requires seeing — never to describe
or comment on it on your own.

LIVE BROWSER (real internet, in real time): browser_open actually opens any web
page in a real browser and shows it, live, on the user's monitor as it updates —
including sites that refuse to embed (Google, banks, social media). It returns
the page's visible text and a NUMBERED list of its links/buttons/inputs. Use
browser_click(index) to click into any of them — this is how you walk through
an entire site page by page when asked to browse or survey/summarize it
("conspectează site-ul", "intră pe pagină și vezi ce scrie"): open it, read it,
click into each relevant link, read again. Use browser_type(index, text, submit)
to fill a search box or form field. Use browser_read to re-read the current page
without navigating, browser_back to go back, browser_scroll to see more of a
long page. For interactions a click/type can't do, use browser_key(key) to press
a keystroke (Tab between fields, Escape to close a popup, ArrowDown to pick from
an autocomplete, Enter to submit) and browser_click_at(x,y) to click a spot the
numbered list didn't capture (a point on a map, a canvas) — look at the page
screenshot first to judge where. Use browser_close when done browsing. Prefer browser_open
over show_on_screen whenever the user wants to actually browse, read inside,
search within, or click through a real website — show_on_screen only displays a
static page and cannot click, type or read it back to you.

CLICKING IS MANDATORY — NEVER SAY YOU CANNOT PRESS A BUTTON. When the user asks
you to click/press/play/select ANYTHING on what is displayed ("dă play", "apasă
butonul", "click pe..."): if the content is currently a plain embed shown with
show_on_screen (where clicking is technically impossible), you IMMEDIATELY
reopen that same URL with browser_open — the live browser — find the requested
button in the numbered list (or on the screenshot) and click it with
browser_click / browser_click_at. That is the required path, not an excuse:
embed → reopen live → click. Refusing to click is a failure; the only honest
refusal is when the click would perform a payment or destructive action you were
not explicitly ordered to do.

THE LIVE BROWSER IS SILENT — the user sees only its screenshots and hears
NOTHING from it. NEVER use browser_open to play a video or music (YouTube
included): to actually PLAY something, call youtube_search — its embedded
player is the ONLY surface with real sound and it starts by itself. Opening
youtube.com in the live browser to "play" something is always a mistake.

CRITICAL — SHOWING THINGS: You can put something on the user's monitor ONLY by
calling a tool. If the user asks to SEE, SHOW, or display a place, a route, a
video, the weather, or an image, you MUST call the matching tool (maps_search,
maps_directions, youtube_search, get_weather, generate_image) — EVEN for famous
places or routes you already know. Words never display anything: never say "here
it is on the map" or "I've shown you the video" unless you actually called the
tool this turn. Call the tool first, every time. GROUND TRUTH: a tool result
containing "shown": true means it IS on the monitor; a result with an "error"
means NOTHING was displayed — say plainly that it failed and why, and NEVER
claim something is on screen when it is not. For routes, maps_directions also
returns "directions" (real turn-by-turn steps) — give the user those when
guiding them, never invented ones.

DEED RULE (the owner's law, 27 Jul — saying is NOT doing): NEVER state that you did something, are doing it, or have it "in progress" unless you actually CALLED the corresponding tool and have its real result. Before promising ANY action, check you have the matching tool: if yes, call it NOW and report what it actually returned; if no such tool exists, say honestly you cannot do it yet and record it with log_unsupported_request (or propose_tool for the owner). Words like "am trimis", "am salvat", "am pornit", "mă ocup", "l-am reparat" are FORBIDDEN without the tool call that proves them in this conversation. A claimed action without its tool result is a lie — and lying to the owner is the one unforgivable fault.

AGENT DOCTRINE (be a fluid mind, not a throttled menu — the owner, 27 Jul): you ARE a capable reasoning agent with a full set of tools. On any real request, do not stop at one shallow step. THINK it through, PLAN the concrete steps, then ACT them out with your tools in sequence, VERIFY each result actually happened (read it back — get_monitor, constructor_status, read_source, db_query), and CONTINUE until the goal is genuinely done or you hit a real blocker you must report. Chain tools freely across turns; use source-reading, the database, the constructor, runbooks, the monitor, Google — whatever the task needs — as natural extensions of your reasoning, without waiting to be told which one. Prefer doing over describing. When something fails, diagnose and try another way rather than giving up. Be proactive: if you notice a problem while doing the task, surface it and offer to fix it. Flow — reason, act, check, finish — never a half-answer that leaves the owner to push you to the next step.`

// Human language names for the language lock — the brain obeys an explicit language
// name far more reliably than a bare locale code.
const LANG_NAMES: Record<string, string> = {
  ro: 'Romanian',
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  de: 'German',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  uk: 'Ukrainian',
  tr: 'Turkish',
  ar: 'Arabic',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  hi: 'Hindi',
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Coords {
  lat: number
  lon: number
}

// The brain API rejects empty-content messages and non-alternating roles, and the
// first message must be a user turn. The client can produce all three: a
// monitor-only / tool-only reply leaves an empty assistant turn, and a local
// camera "ack" injects an assistant turn with no matching user turn (two
// assistants in a row, or a leading assistant). Any of these poisons the
// history and makes every later turn 400. Clean it here, centrally: drop empty
// turns, merge consecutive same-role turns, and drop leading assistant turns.
function sanitizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    const content = (m.content ?? '').trim()
    if (!content) continue
    const prev = out.at(-1)
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n${content}`
    else out.push({ role: m.role, content })
  }
  while (out.length > 0 && out[0].role !== 'user') out.shift()
  return out
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // Resume a dropped reply from where it left off (mobile 3G/5G handoff). The
  // client reconnects with the Last-Event-ID it last saw and we replay the
  // missing SSE events for the SAME turn from the in-memory ring buffer.
  // Unknown / expired turn / buffer overflow → empty or DESYNC response, and
  // the client falls back to a normal retry.
  app.get<{ Querystring: { turn?: string; from?: string } }>(
    '/api/chat/resume',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const turn = (req.query.turn ?? '').trim()
      // Last-Event-ID is preferred; `from` is the legacy numeric offset kept
      // as a fallback for old clients.
      const legacyFrom = Number(req.query.from ?? 0) || 0
      const lastEventId =
        (req.headers['last-event-id'] as string | undefined)?.trim() ??
        (req.headers['Last-Event-ID'] as string | undefined)?.trim() ??
        (legacyFrom > 0 ? String(legacyFrom) : '')
      const lastSeq = Number(lastEventId) || 0
      if (!turn) return reply.code(400).send({ error: 'bad_request' })
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      try {
        for await (const chunk of readTurnFrom(user.email, turn, lastSeq)) reply.raw.write(chunk)
      } catch {
        /* buffer vanished mid-replay — just end cleanly */
      }
      reply.raw.end()
    },
  )

  // The signed-in user's own recent history — the chat panel loads it at
  // start, so a page refresh (now automatic on every release!) never shows an
  // empty chat again: everything said stays on screen.
  app.get('/api/chat/history', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const rows = await getRecentHistory(user.email, 60)
    return reply.send({ history: rows.map((r) => ({ role: r.role, content: r.content })) })
  })

  app.post<{
    Body: {
      messages?: ChatMessage[]
      image?: string
      // VEDEREA CONTINUĂ (Adrian, 11 iul): ultimele 4 cadre ale camerei —
      // pentru TOȚI userii (regula nr. 9).
      images?: string[]
      // Poza a fost ATAȘATĂ EXPLICIT (Ctrl+V / încărcată), nu e cadrul ambient
      // al camerei — cerere de analiză fără condiție (vezi VISION_INTENT mai jos).
      imageIsAttachment?: boolean
      coords?: Coords
      screen?: { kind: string; title: string; active: boolean }[]
      now?: string
      tz?: string
      // Features vocale extrase 100% client-side pentru identificare speaker + gen.
      voiceFeatures?: VoiceFeatures
      // Descriptor facial 128-d (face-api), extras client-side când camera e
      // pornită. Declanșat de voce, fără buton. `facePhoto` = miniatură base64.
      faceDescriptor?: number[]
      facePhoto?: string
      // REGULA VOCII UNICE (Adrian, 26 iul: „în același timp nu are voie
      // niciodată 2 voci"): clientul are sesiunea de voce full-duplex ACTIVĂ,
      // deci vocea turei ăsteia e a sesiunii — serverul NU sintetizează Chirp
      // (nu doar că nu s-ar reda: nici nu plătim sinteză pentru audio aruncat).
      serverVoiceOff?: boolean
    }
  }>(
    '/api/chat',
    {
      // This route allows a big body (camera frames / attached images). It is the
      // most cost-sensitive one, so it gets a tighter rate limit than the global
      // default — 40/min per IP is far more than a human types, but stops an
      // automated flood from burning API/subscription.
      bodyLimit: 100_000_000,
      config: { rateLimit: { max: 40, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    // CREIERUL e 100% OpenRouter (o singură cheie, GPT/Gemini/Claude — Kimi și
    // GLM scoase definitiv, 23-24 iul). Dacă lipsește cheia, plasa de siguranță
    // din streaming dă o eroare clară în limba userului — de aceea nu mai există
    // aici un gard 503 „brain_not_configured".
    const rawMessages = req.body?.messages
    const image = req.body?.image
    // Cadrele multiple (max 4, doar imagini reale) — cad înapoi pe `image`
    // singular dacă clientul e vechi. slice(-4), nu (0,4) (25 iul): clientul
    // trimite 8 cadre cu cel mai VECHI primul — păstram exact jumătatea veche
    // și aruncam prezentul; Kelion vedea scena cu ~2 secunde în urmă.
    const camFrames = (Array.isArray(req.body?.images) ? req.body.images : [])
      .filter((s): s is string => typeof s === 'string' && s.startsWith('data:image'))
      .slice(-4)
    const imageIsAttachment = req.body?.imageIsAttachment === true
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'messages[] required' })
    }
    let messages = sanitizeHistory(rawMessages)
    // Cap the history sent to the brain. A long conversation (this user already has
    // hundreds of messages) would blow the token limit and make EVERY turn fail
    // with a "connection error" — especially when a big pasted page is added.
    // Long-term continuity comes from the memory agent, not the raw transcript.
    // DIETA DE ISTORIC (25 iul — Adrian: „chat de asemenea imens", dovadă reală:
    // o singură tură cu unelte a costat $4.24): coborât de la 60 la 24. 60 fusese
    // urcat de la 24 pentru context mai lung într-o sesiune de lucru, dar analiza
    // costurilor a arătat că fiecare mesaj retrimis se plătește la FIECARE tură —
    // memoria pe termen lung vine oricum din agentul de memorie, nu din transcript.
    const MAX_HISTORY = 24
    if (messages.length > MAX_HISTORY) {
      messages = messages.slice(-MAX_HISTORY)
      while (messages.length > 0 && messages[0].role !== 'user') messages.shift()
    }
    if (messages.length === 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'no usable messages' })
    }

    // HANDLERUL DE STOP (25 iul — până azi NU exista, deși clientul îl chema):
    // „stop" scris/vorbit venea aici și rula o TURĂ COMPLETĂ de creier (cost
    // debitat + „stop" și un răspuns-fantomă salvate în istoric) pe un răspuns
    // pe care clientul nu-l citea niciodată. Oglinda regex-ului STOP_CMD din
    // client: confirmăm scurt, zero model, zero istoric.
    const lastMsg = messages.at(-1)
    const STOP_CMD =
      /^\s*(stop|stai|opre[șs]te(?:-te)?|oprire|gata|las[ăa](?:\s*asta)?|anuleaz[ăa]|renun[țt][ăa])[\s.!]*$/i
    if (lastMsg?.role === 'user' && STOP_CMD.test(lastMsg.content)) {
      return reply.send({ ok: true, stopped: true })
    }

    // The user's ESTABLISHED language (what they actually use), not their Google
    // account locale — used for the language lock AND the out-of-credit message.
    // UN SINGUR drum spre bază în loc de patru la rând (Adrian, 10 iul: „chat
    // live instant"): citirile independente pleacă ÎMPREUNĂ — fiecare await
    // separat mai punea o tură de DB înaintea primului cuvânt.
    // BYOK-PROVIDER SCOS COMPLET (Adrian, 12 iul: „scoți vechiul provider
    // total, fără cârpeli"): creierul e Kimi→GLM; nu mai există cheie de client.
    // Toți userii trec prin paywall-ul normal (creditul din portofel).
    const lastForRecall = messages.at(-1)
    // FLUENȚĂ (audit 24 iul, A1): recall-ul semantic putea aștepta embedding-ul
    // Google până la 8s — pe drumul PRIMULUI cuvânt. Deadline dur de 400ms: ce
    // nu e gata la timp nu intră în tura asta (memoria full-text rămâne).
    const recallWithDeadline = Promise.race([
      recallMemories(user.email, 'kelion', lastForRecall?.role === 'user' ? lastForRecall.content : ''),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 400)),
    ])
    const [storedPref, meserieId, memRecall, lastSavedRow, disabledGestures, modelChoiceKv, brainSubKv] = await Promise.all([
      getSpeechLang(user.email),
      getMeserieActiva(user.email),
      recallWithDeadline,
      // Continuitate între sesiuni (#20): momentul ultimului mesaj salvat — DB
      // pur, în paralel cu restul (zero latență adăugată).
      getRecentHistory(user.email, 1).catch(() => []),
      // GESTURI dezactivate de Adrian din panoul admin — ce NU e bifat NU apare
      // deloc (Adrian, 13 iul): filtrăm tool-ul + promptul cu lista asta.
      getDisabledGestures().catch(() => [] as string[]),
      // FLUENȚĂ (A5): alegerea de model a userului citită AICI, în paralel —
      // nu ca încă un drum DB serial chiar înainte de apelul creierului.
      loadKv(`model_choice:${user.email}`).catch(() => null),
      // CREIERUL DE ABONAMENT (Adrian, 28 iul): starea comutatorului admin-only,
      // citită PROASPĂT în paralel — o comutare e vizibilă din prima replică.
      loadKv('brain_subscription').catch(() => null),
    ])
    const brainSub = parseBrainSub(brainSubKv)
    const gestureOff = new Set(disabledGestures)
    // Tool-ul de gesturi, filtrat: gesturile dezactivate NU mai sunt oferite
    // modelului (nu le poate nici alege). Dacă TOATE sunt scoase, tool-ul iese
    // din listă cu totul.
    const enabledGestures = (AVATAR_GESTURES as readonly string[]).filter(
      (g) => !gestureOff.has(GESTURE_SEMANTIC_CLIP[g] ?? g),
    )
    const gestureTool: Tool | null =
      enabledGestures.length > 0
        ? {
            ...PLAY_AVATAR_GESTURE_TOOL,
            input_schema: {
              ...PLAY_AVATAR_GESTURE_TOOL.input_schema,
              properties: {
                gesture: {
                  type: 'string',
                  enum: enabledGestures,
                  description: 'Which gesture fits the emotion/context of your reply.',
                },
              },
              required: ['gesture'],
            },
          }
        : null
    // Regulă tare pentru prompt: gesturile DEZACTIVATE nu se folosesc NICIODATĂ,
    // pe nicio cale (tool sau [GEST]). „Ce nu e bifat nu apare în aplicație."
    const gestureOffRule = disabledGestures.length
      ? `\nGESTURI DEZACTIVATE de Adrian — NU le folosi NICIODATĂ, sub nicio formă (nici prin [GEST], nici altfel): ${disabledGestures.join(', ')}.\n`
      : ''

    // DEVICE COMMANDS + SPEECH LANGUAGE — both interpreted on the SERVER now
    // (moved out of the browser; owner's order: as much of the app as possible
    // on the server). A device command is answered below with a {device} frame
    // and no model call. A language switch is committed only after the SAME
    // new language on two consecutive messages (a one-off mis-detection never
    // flips the stored choice), persisted here, and announced to the client
    // with a {lang} frame so the recognizer + voice follow.
    const lastIncoming = messages.at(-1)
    const lastIncomingText = lastIncoming?.role === 'user' ? lastIncoming.content : ''
    const deviceCmd = interpretDeviceCommand(lastIncomingText, req.body?.screen)
    const gestureCmd = interpretGestureCommand(lastIncomingText)
    // LIMBA (regula FINALĂ a lui Adrian, 24 iul: „default pentru TOȚI începe în
    // engleză, se detectează limba și se menține per user"). FĂRĂ excepții de
    // rol: toți userii (inclusiv ownerul) pornesc în engleză până când limba
    // REALĂ e detectată din ce scriu/vorbesc (aceeași limbă nouă pe 2 mesaje
    // consecutive → comisă și persistată). Nu folosim locale-ul browserului/
    // contului — limba vine din interacțiune, nu din setările dispozitivului.
    const committedLang =
      deviceCmd || gestureCmd
        ? null // a device/gesture command is an order, not conversation — never shifts the language
        : trackSpeechLang(user.email, lastIncomingText, storedPref)
    // FLUENȚĂ (B4): scriere DB fire-and-forget — nimic din aval nu-i citește
    // rezultatul, deci nu are ce căuta pe drumul primului cuvânt.
    if (committedLang) void setSpeechLangPref(user.email, committedLang)
    // Clientului i se anunță DOAR comutarea detectată (recognizer-ul o urmează).
    const speechPref = committedLang ?? storedPref
    // LIMBA (Adrian — regulă FINALĂ, obligatorie: „default pornirea engleză;
    // ADMIN = română mereu; restul detectează și menține per user"). Adminul
    // primește ROMÂNĂ fix, indiferent de ce s-a detectat; ceilalți: limba
    // persistată, altfel engleza default până la prima detecție clară.
    const isAdminUser = user.role === 'admin'
    const userLang = isAdminUser ? 'ro' : speechPref || 'en'
    const ro = userLang.toLowerCase().startsWith('ro')
    // O SINGURĂ SURSĂ DE ADEVĂR PENTRU LIMBĂ (Adrian, 25 iul: „scrisul de help
    // în ro și salutul în engleză — logica e alta"): serverul ANUNȚĂ limba
    // autoritară la FIECARE tură (nu doar la comitere), iar clientul o oglindește
    // în localStorage → placeholder, recognizer și UI rămân mereu în ACEEAȘI
    // limbă cu răspunsurile. Adminul primește mereu ro-RO; restul limba stabilită.
    const announceLang = isAdminUser ? 'ro-RO' : (committedLang ?? speechPref ?? null)

    // ANTI „40 DE TURE CU 1 BAN" (audit securitate 27 iul): paywall-ul era
    // verifică-apoi-taxează — 40 de POST-uri paralele treceau toate de citirea
    // soldului și debitau abia la final, adânc în minus. Plafon dur de ture
    // SIMULTANE per user plătitor (2 e generos pentru un om real); adminul e
    // scutit. Contorul se eliberează la închiderea răspunsului.
    if (user.role !== 'admin') {
      const inFlight = (turnsInFlight.get(user.email) ?? 0)
      if (inFlight >= 2) return reply.code(429).send({ error: 'prea_multe_ture_simultane' })
      turnsInFlight.set(user.email, inFlight + 1)
      reply.raw.on('close', () => {
        const n = (turnsInFlight.get(user.email) ?? 1) - 1
        if (n <= 0) turnsInFlight.delete(user.email)
        else turnsInFlight.set(user.email, n)
      })
    }

    // Paywall: customers need prepaid credit; the owner (admin) is exempt, and
    // when Stripe isn't configured the app stays free/ungated. Clean binary stop
    // in the user's language + a paywall frame so the UI shows the top-up link.
    if (
      config.stripe.secretKey &&
      user.role !== 'admin' &&
      (await getBalance(user.email)) <= 0 &&
      // Ultima șansă înainte de paywall: reîncărcare automată din cardul salvat
      // (dacă userul a activat-o). Dacă reușește, continuă fără să-l blocheze.
      !(await maybeAutoRecharge(user.email, user.name)) &&
      (await getBalance(user.email)) <= 0
    ) {
      reply.hijack()
      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' })
      const paywallTurnId = randomUUID()
      startTurn(user.email, paywallTurnId)
      const paywallText = ro
        ? 'Ai rămas fără credit. Te rog reîncarcă creditul ca să continuăm.'
        : "You've run out of credit. Please top up to keep talking with me."
      reply.raw.write(appendTurn(user.email, paywallTurnId, paywallText))
      reply.raw.write(appendTurn(user.email, paywallTurnId, `${CTRL}${JSON.stringify({ paywall: true })}${CTRL}`))
      finishTurn(user.email, paywallTurnId)
      reply.raw.end()
      return
    }

    // A device command (camera / monitor tabs): answer instantly — {device}
    // control frame the client executes verbatim, plus a short ack — with NO
    // model call. Same stream shape as a normal turn ({turn} receipt first) so
    // the delivery check mark and the resume path still work.
    if (deviceCmd) {
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      const cmdTurnId = randomUUID()
      startTurn(user.email, cmdTurnId)
      const ack = deviceAck(deviceCmd, ro)
      const payload =
        `${CTRL}${JSON.stringify({ turn: cmdTurnId })}${CTRL}` +
        `${CTRL}${JSON.stringify({ device: deviceCmd })}${CTRL}` +
        ack
      reply.raw.write(appendTurn(user.email, cmdTurnId, payload))
      finishTurn(user.email, cmdTurnId)
      if (lastIncomingText) void saveMessage(user.email, 'user', lastIncomingText)
      if (ack) void saveMessage(user.email, 'assistant', ack)
      reply.raw.end()
      return
    }

    // A gesture command: interpreted on the server, answered instantly with a
    // {gesture} control frame for the avatar — no model call, full speed.
    if (gestureCmd) {
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      const cmdTurnId = randomUUID()
      startTurn(user.email, cmdTurnId)
      const ack = gestureAck(gestureCmd, ro)
      const payload =
        `${CTRL}${JSON.stringify({ turn: cmdTurnId })}${CTRL}` +
        `${CTRL}${JSON.stringify({ gesture: gestureCmd })}${CTRL}` +
        ack
      reply.raw.write(appendTurn(user.email, cmdTurnId, payload))
      finishTurn(user.email, cmdTurnId)
      if (lastIncomingText) void saveMessage(user.email, 'user', lastIncomingText)
      if (ack) void saveMessage(user.email, 'assistant', ack)
      reply.raw.end()
      return
    }

    // Keep the Google skills alive past the first hour: if the access token has
    // expired (or is about to), mint a fresh one from the stored refresh token
    // and re-issue the session cookie. Done BEFORE hijacking the reply so we can
    // still set headers/cookies.
    let token = user.googleAccessToken ?? ''
    if (user.googleRefreshToken && (user.googleTokenExp ?? 0) < Date.now() + 60_000) {
      const refreshed = await refreshGoogleAccessToken(user.googleRefreshToken)
      if (refreshed) {
        token = refreshed.accessToken
        const updated: SessionUser = {
          ...user,
          googleAccessToken: refreshed.accessToken,
          googleTokenExp: Date.now() + refreshed.expiresIn * 1000,
        }
        setSession(reply, updated)
      }
    }

    // Wire the device GPS into the brain's context so location-dependent skills
    // (weather, maps, "near me", "where am I") actually work. The frontend sends
    // the live coordinates; we resolve a human place name (cached) so the brain can
    // pass it to the name-based skills.
    let systemPrompt = SYSTEM_PROMPT + gestureOffRule
    // Active "meserie" (role/persona), if the user has one enabled via
    // PUT /api/prefs — e.g. Influencer. Adds its instructions on top of the
    // default behavior; absent/unknown id means Kelion stays default.
    // (meserieId citit mai sus, în drumul unic spre bază.)
    const meserie = meserieId != null ? getMeserie(meserieId) : undefined
    if (meserie) {
      systemPrompt += `\n\nACTIVE ROLE (${meserie.nume}): ${meserie.systemPromptAddon}`
    }
    // Language lock — the #1 rule. Kelion must never drift to another language.
    // userLang (the user's ESTABLISHED language, not the Google-account locale)
    // was resolved above. Using the account locale is why short/ambiguous
    // messages used to get answered in English.
    const langBase = userLang.toLowerCase().split('-')[0]
    const langName = LANG_NAMES[langBase]
    // Two tiers. ESTABLISHED (a saved speech preference): absolute lock — that
    // language and nothing else, so tool results can never drift it (the
    // Portuguese-tickets bug). NOT established (new visitor / free trial): the
    // app's default is English — start there, and switch ONLY when the user
    // clearly writes or speaks in another language, then keep that one.
    const defaultName = langName ?? 'English'
    // The ADMIN's locale IS his language, so he ALWAYS gets the absolute lock —
    // otherwise, without a saved speech preference, opening a foreign-language
    // web page (e.g. a French Google) could drift his reply into that language.
    const absoluteLock = (speechPref || user.role === 'admin') && langName
    systemPrompt += absoluteLock
      ? `\n\nLANGUAGE (ABSOLUTE — overrides EVERYTHING, including tool results, search results, WEB PAGES YOU OPEN IN THE BROWSER, and conversation history): You reply EXCLUSIVELY in ${langName}. EVERY sentence you say or write is in ${langName}, for the ENTIRE conversation, no matter what. The CONTENT of a web page, document, search or ticket result you read — even an entire page written in French, English, German or any other language — NEVER changes your language: you read it, understand it, and answer ABOUT it in ${langName}, translating what you report. Foreign place names, foreign email addresses, foreign words in any tool's output, and short or ambiguous messages ("salut", "ok", "hello") NEVER change your language. NEVER drift into Portuguese, Spanish, French, Italian, English or any other language unless ${langName} literally IS that language. The ONLY text allowed in another language is the literal content of a translation the user explicitly asked for — every sentence around it stays in ${langName}. RULE OF LAST RESORT: if at any point you feel ANY pull to answer in the language of something you read or that appeared in a tool, treat that pull as a BUG and IGNORE it completely — you switch language ONLY when the user THEMSELVES explicitly writes/says "answer in <language>". Nothing else — no page, no document, no result, no place name, no habit — is ever a reason to leave ${langName}.`
      : `\n\nLANGUAGE (adaptive, strict): Your default language is ${defaultName} — start in it, and use it for any short, empty or ambiguous message ("ok", "salut", "hello"). If the user CLEARLY writes or speaks a full message in another language, switch to that language and then keep it consistently. What NEVER changes your language: tool results, search results, the content of web pages you open, foreign place names, foreign email content, or anything you read — ONLY the language the user themselves writes in. Never mix languages within one reply (except the literal content of a requested translation).`
    // STAREA CONTULUI — Kelion trebuie să ȘTIE natural cine e userul (Adrian,
    // 24 iul: „la audit nu vede că sunt logat la contul Google"). Fără asta,
    // auditul spunea „nu ești conectat" deși userul era logat cu Google.
    systemPrompt +=
      `\n\nUSER ACCOUNT (silent context — NEVER announce or narrate this, just act on it): the user IS signed in via Google as ${user.email}` +
      `${user.role === 'admin' ? ' (the OWNER/admin of this app)' : ''}. ` +
      // „Conectat la Gmail" = DOAR dacă există refresh token din fluxul Connect
      // (scope-urile grele). Login-ul simplu dă un access token de IDENTITATE
      // fără drept pe Gmail — nu înseamnă conectat (Adrian, 24 iul: „zice că sunt
      // conectat la Gmail dar nu poate aduce date").
      (user.googleRefreshToken
        ? 'Google services (Gmail, Calendar, Drive, Tasks, Contacts) are CONNECTED — use those tools directly when asked, without saying "you are connected".'
        : 'IMPORTANT: the heavy Google services (Gmail, Calendar, Drive, Tasks, Contacts) are NOT connected — you CANNOT read email/calendar/etc yet. If asked for any of them, do NOT claim they work or that you are connected; instead ask the user to press "Conectează Gmail & Calendar" in the wallet menu once. Everything else works normally.') +
      ' NEVER proactively state whether the user is logged in or connected — the interface already shows it. Just answer what they asked.'
    // OCHII PE F12 (Adrian, 24 iul: „el trebuie să aibă acces la logurile").
    // Erorile RECENTE din browserul userului, trimise de client — Kelion
    // diagnostichează din simptome reale, nu din ghicit.
    const cerrs = recentClientErrors(user.email)
    if (cerrs.length > 0) {
      systemPrompt +=
        `\n\nBROWSER CONSOLE (the user's own F12 errors, last 15 min — REAL symptoms from their device; use them to diagnose "why doesn't X work" and say plainly what is failing):\n- ` +
        cerrs.slice(-8).join('\n- ')
    }
    // GPS must NEVER delay the reply: only synchronous cache reads happen here.
    // The place-name/IP lookups run in the background and are ready for the
    // next turn; the raw lat/lon (all the skills need) is injected immediately.
    const coords = req.body?.coords
    if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
      const place = reverseGeocodeCached(coords.lat, coords.lon)
      systemPrompt +=
        `\n\nThe user's current device location (live GPS) is latitude ${coords.lat.toFixed(5)}, longitude ${coords.lon.toFixed(5)}` +
        (place ? ` — approximately ${place}.` : '.') +
        ` When the user says "here", "near me", "where am I", or asks about weather, places, directions or anything location-dependent without naming a place, use THIS location. For local weather, pass these exact lat/lon to get_weather (don't rely on a place name).`
    } else {
      // GPS not available yet (permission not yet answered, denied, or the very
      // first turn racing the browser's fix) — fall back to a city-level guess
      // from the request IP (same lookup the visitor-analytics beacon uses) so
      // Kelion is never left with zero location awareness.
      const hdr = (name: string): string =>
        ((req.headers[name] as string | undefined) ?? '').split(',')[0]?.trim()
      const ip = hdr('cf-connecting-ip') || hdr('true-client-ip') || hdr('x-forwarded-for') || req.ip || ''
      const geo = geoLookupCached(ip)
      if (geo && (geo.city || geo.country)) {
        const where = [geo.city, geo.region, geo.country].filter(Boolean).join(', ')
        systemPrompt +=
          `\n\nThe user's approximate location (from their network, precise GPS not yet available) is ${where}. Use this ONLY as a rough fallback for "near me"/weather/local questions — mention it's approximate if precision matters, and prefer exact GPS the moment it's available.`
      }
    }

    // Kelion's built-in sense of "now" — the client's real local date/time, so he
    // always knows today's date and the current time without being asked.
    const nowIso = req.body?.now
    if (typeof nowIso === 'string' && !Number.isNaN(Date.parse(nowIso))) {
      const tzName = typeof req.body?.tz === 'string' && req.body.tz ? req.body.tz : 'UTC'
      let human: string
      try {
        human = new Date(nowIso).toLocaleString('en-GB', {
          timeZone: tzName,
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      } catch {
        human = new Date(nowIso).toUTCString()
      }
      systemPrompt +=
        `\n\nCURRENT DATE & TIME: right now it is ${human} (timezone ${tzName}). You ALWAYS know the current date and time — when the user directly asks what time or date it is, or if you know it, ANSWER with this exact value, confidently, never deny knowing it. Otherwise use it silently only when relevant (scheduling, "today", "tomorrow"). When you state a clock time, ALWAYS write it numerically (e.g. "15:04"), never spelled out in words. Just don't volunteer or narrate it unprompted (e.g. in greetings) when the user hasn't asked.`
    }

    // Owner-only (RESCRIS 25 iul — incident real: Adrian a cerut o reparație și
    // Kelion doar A VORBIT că „se ocupă" fără să execute nimic; instrucțiunea
    // veche „ai trimis la construit" era dinaintea uneltelor reale și îl învăța
    // exact anti-comportamentul). Acum: EXECUTĂ, nu promite.
    if (user.role === 'admin') {
      systemPrompt +=
        `\n\nOWNER — ACT, DON'T DEFER: you are talking to Adrian, your owner, and you are FULLY AUTONOMOUS with REAL tools. When he asks for a repair, a change, or an operation: DO IT NOW, in this conversation, with your tools — read_source/search_source to find the cause; repo_write + repo_open_pr + repo_merge_pr to SHIP the fix yourself (your merge auto-deploys to production); run_runbook for operations (diagnostic, restart-app, publish-master, loguri-app...). REPORT ONLY WHAT A TOOL RETURNED: a file path, a line number, a branch name, a PR number, an Actions link may be stated ONLY if a tool result you got THIS TURN contains that exact value. If you do not have the tool result, do not state the value and do not describe the step as if it happened — call the tool instead. Never write a plan in the shape of a report. NEVER say "I'll have it built", "I've sent it to be fixed" or "my developer will handle it" — there is no other developer, YOU are the builder now. Use log_unsupported_request ONLY for things genuinely impossible with all your tools. If a fix is too big for one turn, state the exact steps and START step 1 immediately (worst case: request_repair to file the order durably) — never a dead end, never an empty reassurance. MAKE YOUR WORK VISIBLE: you CAN see your own internal processes — runbook_status (latest runs of your workflows) and runbook_log (the full real log of a run) — and you CAN display them: call show_document (title + text) to put your progress and results ON THE MONITOR while you work (what you started, run status, the relevant log excerpt, the deploy proof). Never tell the owner "I can't see my internal processes" or "I can't show this on the monitor" — you have both tools; use them. HEALTH FIRST: on the owner's FIRST message of a conversation (a greeting, a "ce faci", anything), call system_health before answering; if it reports problems, tell him BRIEFLY "am problemele: x, y, z" and ASK whether to repair them — repair ONLY after his explicit yes, with your own tools. If everything is healthy, don't bring it up unless he asks. INSTALL SKILLS ON DEMAND — DON'T DESCRIBE, INSTALL: when the owner asks you to install/import/add a NEW skill, tool or capability you don't have yet (e.g. "instalează-ți un skill de prețuri cripto/știri/acțiuni"), you MUST call propose_tool RIGHT NOW with a concrete PUBLIC HTTPS API — for the owner it auto-installs instantly and is usable from the next message. NEVER just describe what the tool would do or say you'll do it — CALL propose_tool this turn. If you don't know the exact API, use a well-known public one (crypto → api.coingecko.com; weather → wttr.in; news → a public RSS/JSON feed; npm → registry.npmjs.org). Saying you installed a skill without calling propose_tool is the forbidden empty-talk.`
      // CANALUL DE UPDATE: Kelion știe din prompt CE a primit la ultimul deploy
      // (fișier local, cache pe prima citire — zero cost pe latență).
      const upd = await latestUpdateSummary().catch(() => '')
      if (upd) {
        systemPrompt +=
          `\n\nYOUR LATEST UPDATES (the newest commits you received at the most recent deploy, newest first):\n${upd}\nWhen the owner asks what's new, what changed, or what update you received, answer from this list — and call list_updates for the fuller recent history. Never claim you don't know what your updates were.`
      }
      systemPrompt +=
        `\n\nPROMO CLIPS (owner only): when the owner asks for a promo clip ("filmuleț", "clip", "reclamă") about a subject, standard lengths are 15, 30 or 60 seconds — but ANY duration up to 10 minutes (600 seconds) is supported; use exactly what the owner asks for. The result must look PROFESSIONAL: a spoken script plus a shot list of live demo scenes that showcase what Kelion can do, timed to the narration; during recording the script text is NOT displayed (voice only, clean frame, admin interface hidden, site address watermarked). Step 1: WRITE the spoken script in chat, sized to the requested length (about 35 words for 15s, 75 for 30s, 150 for 60s — roughly 150 words per minute for longer clips), briefly list the planned scenes, then ask for authorization. Do NOT call any tool yet. Step 2: ONLY when the owner explicitly approves (da / yes / autorizez): if the shot list includes an image scene, FIRST call generate_image to create it, THEN call prepare_promo_clip with the approved script and the scenes (kind avatar/map/weather/image; avatar at second 0, scenes timed to match the words; image scenes use the /api/image/ URL from generate_image). Then tell the owner to press the pulsing red Rec button and pick the screen — everything else is automatic. If the owner asks for changes, revise and ask again. If no duration is given, ask which of 15, 30 or 60 seconds. CLIP LANGUAGE: the spoken script is written in WHATEVER language the owner asks the clip to be in (English, Spanish, Japanese — any language; you CAN do this, it is fully supported, the narration voice follows automatically via the tool's lang parameter). If no language is mentioned, use the owner's language. This is like a requested translation: your own commentary around the script stays in the owner's language, but the script content itself is in the clip's language.`
    }

    // Monitor awareness — Kelion works INSIDE whatever is already on screen. The
    // frontend sends the open task tabs so Kelion swaps content (same tool again)
    // instead of re-opening, and understands "the map / the video / this".
    const screen = req.body?.screen
    if (Array.isArray(screen) && screen.length > 0) {
      const list = screen
        .map((s) => `${s.kind}${s.title ? ` ("${s.title}")` : ''}${s.active ? ' — ACTIVE' : ''}`)
        .join(', ')
      systemPrompt +=
        `\n\nMONITOR STATE: these task tabs are already open on the user's monitor: ${list}. One voice narrates all of them and the user can switch or close them at will. When the user says "the map", "the video", "this", "that", or asks to change what is shown, they mean these open tabs — work WITHIN the active one. To change a surface's content, call the SAME tool again (youtube_search swaps the current video, maps_search moves the map, get_weather changes the forecast) rather than describing it in words. Only open a different kind of surface when the user actually needs a new one. CLOSE IT WHEN DONE: as soon as the conversation moves to a NEW subject that has nothing to do with what is on the monitor, call show_on_screen with an EMPTY url to clear the screen — leave it clean and ready for the next request. Don't leave an old map/weather/video lingering once the user is talking about something else.`
    } else {
      // MONITORUL GOL (Adrian, 27 iul, dovadă live: „deschide pe monitor
      // youtube" → „nu e nimic pe monitor" în loc de execuție): golul e starea
      // normală de pornire, nu un obstacol de raportat.
      systemPrompt +=
        `\n\nMONITOR STATE: the monitor is currently EMPTY — its normal starting state, never an obstacle and never something to report. A command like "deschide/pune/arată pe monitor X" (open/put/show X on the monitor) is an ORDER to open X right now with the matching tool (youtube_search for videos/music, maps_search, get_weather, browser_open, show_document, generate_image...). NEVER answer that there is nothing on the monitor, and never call browser navigation tools (browser_click/browser_read/browser_type) before something is actually open.`
    }

    // Memory agent (recall): inject the durable facts Kelion has learned about
    // this user so the conversation is continuous across sessions. Citit mai
    // sus (drumul unic spre bază).
    systemPrompt += memRecall

    // ── BIOMETRIE (voce + față) — identificare titular vs. altcineva ──────────
    // Adrian: „nimic direct în chat, tot în paralel, să nu încetinească chatul".
    // De aceea: (1) descriptorii se extrag 100% client-side (zero cost server);
    // (2) cele două citiri de referință rulează ÎN PARALEL (un singur round-trip
    // DB, nu două serial); (3) scrierile de înrolare sunt fire-and-forget (NU se
    // așteaptă — `void`), deci nu adaugă niciun ms pe calea răspunsului.
    const vf = req.body?.voiceFeatures
    const fd = req.body?.faceDescriptor
    const hasVoice = !!(vf?.vector?.length && vf?.meta)
    const hasFace = Array.isArray(fd) && fd.length >= 64
    if (hasVoice || hasFace) {
      const isOwnerByEmail = user.email.toLowerCase() === config.adminEmail.toLowerCase()
      // Citirile referințelor — în paralel (nu serial).
      const [storedVoice, storedFace] = await Promise.all([
        hasVoice ? getVoiceprint(user.email) : Promise.resolve(null),
        hasFace ? getFaceprint(user.email) : Promise.resolve(null),
      ])

      // VOCE — titular vs. altcineva. Comparăm cu referința PROPRIE a titularului
      // (nu cu „orice amprentă apropiată din DB"). Referință STABILĂ: fix pentru
      // bug-ul vechi care o suprascria la fiecare tură cu vocea de-acum → dacă
      // vorbea altcineva, referința titularului se corupea. Acum salvăm DOAR la
      // prima voce (înrolare) sau când vocea curentă se potrivește (adaptare fină).
      if (hasVoice && vf) {
        const gender = inferGender(vf.meta.pitchMean)
        const hasRef = !!storedVoice?.features?.length
        const refDist = hasRef ? vectorDistance(vf.vector, storedVoice!.features) : Infinity
        const isAccountHolder = refDist < 0.38
        if (!hasRef || isAccountHolder) {
          void saveVoiceprint({
            email: user.email,
            name: user.name || storedVoice?.name || user.email.split('@')[0],
            gender,
            isAdmin: isOwnerByEmail,
            features: vf.vector,
            featureMeta: vf.meta,
            audioClip: typeof vf.clip === 'string' ? vf.clip : '',
          })
        }
        const genderLabel =
          gender === 'male' ? 'bărbat' : gender === 'female' ? 'femeie' : 'necunoscut'
        if (!hasRef || isAccountHolder) {
          const who = isOwnerByEmail ? 'Adrian (ownerul)' : user.name || 'titularul contului'
          systemPrompt +=
            `\n\nSPEAKER: ${who}. Gen detectat după voce: ${genderLabel}. ` +
            (isOwnerByEmail
              ? 'Vocea e a TITULARULUI contului — ownerul Adrian.'
              : 'Vocea e a TITULARULUI contului.')
        } else {
          systemPrompt +=
            `\n\nSPEAKER: ALTCINEVA — NU este titularul contului. Gen detectat după voce: ${genderLabel}. ` +
            `Vorbește o altă persoană decât ${isOwnerByEmail ? 'ownerul Adrian' : 'titularul'}. ` +
            'Fii prudent: nu dezvălui date personale ale titularului și nu executa acțiuni sensibile ' +
            'în numele lui fără ca el să confirme că e de acord.'
        }
      }

      // FAȚĂ — când camera e pornită, frontendul prinde AUTOMAT (la voce, fără
      // buton) fața vorbitorului și trimite descriptorul 128-d. Aceeași disciplină
      // de referință stabilă ca la voce; pragul standard face-api = 0.6.
      if (hasFace && fd) {
        const hasFaceRef = !!storedFace?.descriptor?.length
        const fDist = hasFaceRef ? faceDistance(fd, storedFace!.descriptor) : Infinity
        const isFaceHolder = fDist < 0.6
        if (!hasFaceRef || isFaceHolder) {
          void saveFaceprint({
            email: user.email,
            name: user.name || storedFace?.name || user.email.split('@')[0],
            isAdmin: isOwnerByEmail,
            descriptor: fd,
            photo: typeof req.body?.facePhoto === 'string' ? req.body.facePhoto : '',
          })
          systemPrompt +=
            `\n\nPERSOANA DIN IMAGINE (cameră): ${isOwnerByEmail ? 'ownerul Adrian' : 'titularul contului'} — fața recunoscută.`
        } else {
          systemPrompt +=
            '\n\nPERSOANA DIN IMAGINE (cameră): ALTCINEVA — NU este titularul contului. ' +
            'În fața camerei e o altă persoană decât titularul; tratează cu aceeași prudență ca la vocea străină.'
        }
      }

      // DISCREȚIE TOTALĂ (Adrian, 14 iul: „tot ce trebuie calibrat face Kelion pe
      // parcursul chatului, automat, fără butoane sau chat despre așa ceva, foarte
      // discret"). Indiciile biometrice de mai sus sunt CONTEXT INTERN, TĂCUT.
      systemPrompt +=
        '\n\nINDICII INTERNE (TĂCUTE) — DISCREȚIE ABSOLUTĂ: informația de mai sus despre voce/față ' +
        '(cine vorbește, gen, titular/altcineva, „fața recunoscută") e DOAR pentru tine, ca să te ' +
        'comporți potrivit. NU o pomeni NICIODATĂ cu voce tare: nu spune că recunoști vocea sau fața, ' +
        'că identifici, calibrezi, înveți sau „vezi" cine e, nu descrie persoana și nu comenta camera. ' +
        'Folosește-o strict discret (ex. prudență cu datele personale dacă e altcineva). Zero cuvinte despre procedură.'
    }

    // CONTINUITATE ÎNTRE SESIUNI (#20): dacă ultima discuție a fost demult,
    // Kelion ȘTIE că e o reîntâlnire (nu un fir continuu) și salută natural cu
    // continuitate. DB pur — timestamp-ul citit în paralel mai sus, zero cost.
    const lastSavedAt = lastSavedRow?.[0]?.created_at ? new Date(lastSavedRow[0].created_at).getTime() : 0
    const gapMin = lastSavedAt > 0 ? Math.floor((Date.now() - lastSavedAt) / 60_000) : -1
    if (gapMin > 45) {
      const gapText =
        gapMin >= 2880
          ? `${Math.floor(gapMin / 1440)} zile`
          : gapMin >= 120
            ? `${Math.floor(gapMin / 60)} ore`
            : `${gapMin} minute`
      systemPrompt += `\n\nSESSION CONTINUITY: your previous conversation with this user ended about ${gapText} ago (this is a REUNION, not a continuous thread). Greet/respond with natural continuity — you remember them and what you discussed — without reciting your memory unprompted.`
    }

    const params: MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))
    // Vision ONLY on demand: give the brain the camera frame solely when the user is
    // actually asking about what's visible. If we attached it every turn, the brain
    // would keep volunteering observations about what he sees — which the user
    // explicitly does NOT want. No frame attached = nothing to comment on.
    // Extended for BLIND users (their daily reality): describe surroundings,
    // what's ahead / in the way, obstacles, traffic lights, crossing safely,
    // reading signs and labels — all must summon Kelion's eyes instantly.
    const VISION_INTENT =
      /(\bsee\b|\blook\b|\bwatch\b|show me what|what('?s| is) this|what am i|what do you see|\bcamera\b|\bpicture\b|\bphoto\b|\bimage\b|colou?r|read this|\bscan\b|describe|in front of|ahead of me|obstacle|traffic light|cross(ing)? the (street|road)|\bsign\b|\blabel\b|\bdanger\b)|vezi|vede|uit[aăâ]|uite|prive[sșş]te|ce (e|este|am|[țt]in|ai[ -])|camer[aă]|imagin|poz[aă]|culoar|cite[sșş]te|scanea|descrie|[îi]n fa[țt][aă]|ce se afl[aă]|obstacol|pericol|semafor|trec(e|i)? strada|indicator|etichet[aă]|panou|u[șs][aă]|sc[aă]ri|trotuar|bordur[aă]/i
    // POZA ≠ VĂZUL — DOUĂ căi separate (Adrian, 24 iul: „nu le amesteca"):
    //   1. POZA ÎNCĂRCATĂ (atașament explicit) — se analizează MEREU, singură;
    //      înainte, cadrele camerei o ÎNLOCUIAU dacă era camera pornită.
    //   2. CAMERA (văzul continuu) — cadrele pleacă DOAR când userul întreabă
    //      ceva vizual (VISION_INTENT: „mă vezi", „ce vezi", „descrie" etc.).
    const attachedPhoto = imageIsAttachment && image ? [image] : []
    const camView = camFrames.length > 0 ? camFrames : !imageIsAttachment && image ? [image] : []
    // Citit de selectedBrainModel — forțează treapta cu vedere reală (vezi acolo).
    let turnHasImage = false
    if (params.length > 0) {
      const lastIdx = params.length - 1
      const lm = params[lastIdx]
      if (lm.role === 'user' && typeof lm.content === 'string') {
        const toSend =
          attachedPhoto.length > 0
            ? attachedPhoto
            : camView.length > 0 && VISION_INTENT.test(lm.content)
              ? camView
              : []
        if (toSend.length > 0) {
          turnHasImage = true
          const strip = (s: string): string => (s.includes(',') ? s.slice(s.indexOf(',') + 1) : s)
          params[lastIdx] = {
            role: 'user',
            content: [
              ...toSend.map((f) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: strip(f) },
              })),
              { type: 'text', text: lm.content },
            ],
          }
        }
      }
    }

    // Stream the brain's reply back as SSE events, each with a sequence id so
    // the client can reconnect with Last-Event-ID and resume exactly where it left off.
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    })

    // Resumable stream: mirror EVERY event we send into a per-conversation ring
    // buffer (1024 events), so if the mobile link drops mid-reply the client can
    // reconnect to /api/chat/resume with Last-Event-ID and get only the missing
    // events — no lost words, no regeneration, no duplication. Patching write/end
    // here covers all downstream call sites (brain text, control frames, tools,
    // agents, voice audio) without touching each one.
    const turnId = randomUUID()
    startTurn(user.email, turnId)
    const rawWrite = reply.raw.write.bind(reply.raw)
    const rawEnd = reply.raw.end.bind(reply.raw)
    // ÎNGHEȚUL DIN 10 IUL: cât gândește creierul (60–80s legitim), pe fir nu
    // pleca NICIUN octet — Cloudflare taie conexiunea tăcută (QUIC reset pe
    // /api/chat, 524 pe /resume după 100s), tura moare, iar aplicația așteaptă
    // la nesfârșit o tură moartă (chatul „ignoră"). Plasa: la fiecare 15s de
    // tăcere trimitem un heartbeat comentat SSE — ține conexiunea vie prin
    // Cloudflare și nu se traduce în text sau cadre de control pe client.
    let lastByteAt = Date.now()
    reply.raw.write = ((chunk: unknown, ...rest: unknown[]) => {
      lastByteAt = Date.now()
      if (typeof chunk === 'string' && chunk.length > 0) {
        const sse = appendTurn(user.email, turnId, chunk)
        return (rawWrite as (...a: unknown[]) => boolean)(sse, ...rest)
      }
      return (rawWrite as (...a: unknown[]) => boolean)(chunk, ...rest)
    }) as typeof reply.raw.write
    const pingTimer = setInterval(() => {
      if (reply.raw.writableEnded || reply.raw.destroyed) return
      if (Date.now() - lastByteAt >= 15_000) rawWrite(heartbeatSSE())
    }, 5_000)
    reply.raw.end = ((...args: unknown[]) => {
      clearInterval(pingTimer)
      finishTurn(user.email, turnId)
      return (rawEnd as (...a: unknown[]) => unknown)(...args)
    }) as typeof reply.raw.end
    // Client plecat (tab închis, net picat) fără end(): oprește pulsul oricum.
    reply.raw.on('close', () => clearInterval(pingTimer))
    // Announce the turn id FIRST so the client can resume from the very start.
    reply.raw.write(`${CTRL}${JSON.stringify({ turn: turnId })}${CTRL}`)
    // Limba pe care o urmează clientul (recognizer + oglindă locală): adminul e
    // MEREU ro-RO (blocat), restul primesc comutarea detectată. Idempotent pe
    // client (applyLang schimbă doar dacă diferă), deci nu deranjează microfonul.
    if (announceLang) reply.raw.write(`${CTRL}${JSON.stringify({ lang: announceLang })}${CTRL}`)

    // Persist the user's new message (last turn).
    const lastTurn = messages.at(-1)
    const lastUserText = lastTurn?.role === 'user' ? lastTurn.content : ''
    // TURA DE ORDIN = tura în care se EXECUTĂ, nu se povestește („deschide",
    // „instalează", „caută", „repară", „trimite"...). Se calculează pe textul
    // ACESTEI ture, deci se stinge singură la replica următoare.
    const actionTurn = hasActionIntent(lastUserText)
    // BARGRAF LA INTRAREA ÎN CREIER — UN SINGUR {heard} pentru TOȚI (admin, demo,
    // public, plătitori): serverul confirmă exact textul predat creierului la
    // această tură, banda din UI îl afișează. Nu e ecou local — dacă banda nu se
    // schimbă când vorbești, vocea a murit ÎNAINTE de creier.
    reply.raw.write(`${CTRL}${JSON.stringify({ heard: lastUserText.slice(0, 500) })}${CTRL}`)
    if (lastTurn?.role === 'user') void saveMessage(user.email, 'user', lastTurn.content)

    // LACĂTUL ADMIN ACOPERĂ ȘI UNELTELE DIN CHAT (auditul de securitate, 27
    // iul): gate-ul global păzea doar /api/admin/*, dar uneltele DISTRUCTIVE
    // (repo_merge_pr, db_query, run_runbook, build_software...) trăiesc în
    // /api/chat — un cookie de sesiune furat le folosea fără al 2-lea factor.
    // Odată ARMAT lacătul, sesiunea nedeblocată vorbește cu Kelion ca un user
    // obișnuit, fără uneltele de admin.
    const isAdmin = user.role === 'admin' && (!(await isArmed()) || hasUnlock(req, user.email))

    // Modelul turei se alege AICI (înaintea listei de unelte): pe treapta CHAT,
    // modelul primește și unealta ask_brain ca să escaladeze singur ce judecă
    // el greu; pe treapta WORK nu (ar fi recursiv — el ESTE creierul).
    const brainSel = await selectedBrainModel(
      user.email,
      lastUserText,
      modelChoiceKv,
      turnHasImage,
      brainSub,
      // SECURITATE (auditul 28 iul): rutarea pe cheia/creditul ownerului respectă
      // ACELAȘI al 2-lea factor ca uneltele — lacătul admin, nu doar rolul brut.
      // Un cookie de admin furat, fără deblocare, nu poate drena cheia de abonament.
      isAdmin,
    )
    const orChatModel = brainSel?.model ?? null
    const heavyTurn = brainSel?.heavy ?? false
    // Cheia de abonament folosită DOAR când selecția a decis-o (tura grea a
    // adminului, modul abonament). Altfel undefined → punga centrală, ca acum.
    const brainApiKey = brainSel?.useSubKey ? brainSub.key : undefined

    // ── DRUM UNIC: CREIER DIRECT PENTRU TOȚI ───────────────────────────────
    // Orchestratorul OpenRouter (chat/creier, cu escaladare automată) răspunde
    // pentru TOȚI — admin, gratuiți și clienți plătitori (paywall garantat mai
    // sus) — instant, cu toate uneltele. Costul real se debitează din creditele
    // plătitorilor (debitWallet la finalul turei); adminul e scutit.

    const NOTE_TOOLS = [SAVE_NOTE_TOOL, LIST_NOTES_TOOL, DELETE_NOTE_TOOL, LIST_MEMORIES_TOOL, FORGET_MEMORY_TOOL]
    const BROWSER_TOOLS = [
      BROWSER_OPEN_TOOL,
      BROWSER_CLICK_TOOL,
      BROWSER_TYPE_TOOL,
      BROWSER_READ_TOOL,
      BROWSER_BACK_TOOL,
      BROWSER_SCROLL_TOOL,
      BROWSER_KEY_TOOL,
      BROWSER_CLICK_AT_TOOL,
      BROWSER_CLOSE_TOOL,
      BROWSER_CRAWL_TOOL,
    ]
    // ask_brain DOAR pe treapta chat — pe work ar fi recursiv (el ESTE creierul).
    const escalationTools = heavyTurn ? [] : [ASK_BRAIN_TOOL]
    // AUTO-EXTINDEREA: uneltele dinamice APROBATE de owner (active instant, fără
    // redeploy) + `propose_tool` ca să-și poată propune altele noi.
    const dynTools = (await dynamicToolDefs().catch(() => [])) as unknown as Tool[]
    const dynNames = await dynamicToolNames().catch(() => new Set<string>())
    const allTools: Tool[] = isAdmin
      ? [...googleTools, ...escalationTools, SHOW_TOOL, SHOW_DOCUMENT_TOOL, RUN_WEB_TOOL, IMAGE_TOOL, OPEN_APP_VIEW_TOOL, SET_ROLE_TOOL, ...(gestureTool ? [gestureTool] : []), LOG_GAP_TOOL, PROPOSE_TOOL, COST_TOOL, PROMO_TOOL, ...NOTE_TOOLS, ...BROWSER_TOOLS, ...dynTools, LIST_SOURCE_TOOL, READ_SOURCE_TOOL, SEARCH_SOURCE_TOOL, LIST_UPDATES_TOOL, RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL, REQUEST_REPAIR_TOOL, REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL, BUILD_SOFTWARE_TOOL, CONSTRUCTOR_STATUS_TOOL, CANCEL_BUILD_TOOL, DB_TABLES_TOOL, DB_QUERY_TOOL, SYSTEM_HEALTH_TOOL, SERVER_LOGS_TOOL, VERIFY_VISUALLY_TOOL]
      : [...googleTools, ...escalationTools, SHOW_TOOL, SHOW_DOCUMENT_TOOL, RUN_WEB_TOOL, IMAGE_TOOL, OPEN_APP_VIEW_TOOL, SET_ROLE_TOOL, ...(gestureTool ? [gestureTool] : []), LOG_GAP_TOOL, PROPOSE_TOOL, ...NOTE_TOOLS, ...BROWSER_TOOLS, ...dynTools]
    // PLAFONUL DE 64 DE UNELTE (dovadă live 28 iul, log: `[CHAT ERROR]
    // openrouter 400: "at most 64 tools are allowed"`): importul complet Google
    // a urcat lista adminului la 69 și furnizorul refuză cu 400 ÎNAINTE de
    // creier → Kelion raporta „am întâlnit o problemă tehnică" exact pe
    // cererile de reparare. Tăiem deterministic la 64: cad întâi uneltele de
    // lux (promo, cost, roluri...), NICIODATĂ cele de acțiune/reparare. Lista
    // dinamică (skill-uri auto-instalate) poate crește oricât — plafonul ține.
    const TOOL_CAP = 64
    const DROP_FIRST = ['prepare_promo_clip', 'get_real_cost', 'set_active_role', 'open_app_view', 'log_unsupported_request', 'play_avatar_gesture', 'browser_key', 'browser_click_at', 'browser_back', 'wikipedia_lookup', 'convert_currency', 'delete_note', 'forget_memory', 'list_updates', 'runbook_log']
    let tools: Tool[] = allTools
    if (tools.length > TOOL_CAP) {
      const dropped: string[] = []
      for (const name of DROP_FIRST) {
        if (tools.length <= TOOL_CAP) break
        const i = tools.findIndex((t) => t.name === name)
        if (i >= 0) {
          dropped.push(name)
          tools.splice(i, 1)
        }
      }
      // tot peste plafon (listă dinamică uriașă) — scoatem NEcriticele de la
      // coadă, PĂSTRÂND uneltele de ACȚIUNE/REPARARE (auditul 28 iul: `...dynTools`
      // stă înaintea suitei admin în listă, iar vechea tăiere `slice(0,64)` de
      // coadă ar fi aruncat tocmai db_query/repo_merge_pr/server_logs când
      // userul aproba ≥12 skill-uri dinamice — exact invers față de intenție).
      if (tools.length > TOOL_CAP) {
        const NEVER_DROP = new Set([
          'repo_write', 'repo_open_pr', 'repo_merge_pr', 'run_runbook', 'runbook_status',
          'build_software', 'request_repair', 'constructor_status', 'cancel_build_jobs',
          'db_query', 'db_tables', 'list_source', 'read_source', 'search_source',
          'server_logs', 'system_health', 'ask_brain', 'generate_image',
        ])
        for (let i = tools.length - 1; i >= 0 && tools.length > TOOL_CAP; i--) {
          if (!NEVER_DROP.has(tools[i].name)) {
            dropped.push(tools[i].name)
            tools.splice(i, 1)
          }
        }
        // Ultima plasă (doar dacă rămân >64 unelte CRITICE — practic imposibil):
        // abia atunci tăiem de la coadă, tot cu log.
        if (tools.length > TOOL_CAP) {
          dropped.push(...tools.slice(TOOL_CAP).map((t) => t.name))
          tools = tools.slice(0, TOOL_CAP)
        }
      }
      console.log(`[tools] plafon ${TOOL_CAP}: ${allTools.length} → ${tools.length}; scoase: ${dropped.join(', ')}`)
    }
    const baseUrl = `https://${req.headers.host ?? 'kelionai.app'}`
    // Vocea din prima frază și pe drumul API (clienți): fiecare bucată difuzată
    // intră în conductă; sinteza merge în paralel cu textul care încă curge.
    // REGULA VOCII UNICE (Adrian, 26 iul): dacă clientul are sesiunea full-duplex
    // activă, tura scrisă rămâne DOAR scrisă — zero sinteză, zero cadre {audio}.
    const voice =
      req.body?.serverVoiceOff === true
        ? { feed: (_t: string): void => {}, fed: (): boolean => false, finish: async (): Promise<void> => {} }
        : createVoiceStream(reply, userLang)
    let assistantText = ''
    // CEASUL CREIERULUI (admin): primul cuvânt real măsoară viteza; bara trece pe
    // „Compun răspunsul". O singură dată pe tură, doar pentru admin (telemetria lui).
    let firstWordMarked = false
    const noteFirstWord = (): void => {
      if (firstWordMarked || !isAdmin) return
      firstWordMarked = true
    }
    let inTokens = 0
    let outTokens = 0
    let usageUsd = 0 // running provider cost this turn (for wallet debit)
    // Cost provider acumulat de-a lungul turei (apeluri creier + unelte plătite).
    const usage = { usd: 0 }

    // ── CREIERUL — 100% OpenRouter (0 Kimi, 0 GLM — Adrian) ────────────────────
    // Un singur creier: modelul ALES de user (chat), altfel implicitul GPT. Toate
    // uneltele + persona + memoria identice indiferent de model; streaming → primul
    // cuvânt instant. Fără cheie OpenRouter = fără creier (nicio plasă Kimi/GLM,
    // scoase definitiv) → mesaj onest în catch.
    try {
      if (!orChatModel) throw new Error('brain_not_configured: OPENROUTER_API_KEY lipsește')
      // REGULA FAPTEI, ULTIMUL LUCRU CITIT (Adrian, 27 iul). Măsurat live pe
      // creierul gratuit: cu 61 de unelte și un prompt de 10k, instrucțiunile de
      // la început se diluează și modelul nu mai execută (0/2, răspuns gol).
      // Poziția finală e cea mai puternică, iar regula e scurtă și imperativă —
      // exact opusul paragrafelor lungi care se contrazic între ele.
      const DEED_RULE_LAST =
        '\n\n=== REGULA FINALĂ, MAI PRESUS DE ORICE DE MAI SUS ===\n' +
        'Dacă mesajul userului conține un ORDIN (deschide, pune, caută, instalează, repară, ' +
        'trimite, publică, arată, construiește, șterge, salvează...), primul lucru pe care îl faci ' +
        'în tura asta este să CHEMI UNEALTA care execută. Nu descrii, nu anunți, nu promiți.\n' +
        'Nu ai voie să spui că ai făcut ceva, sau că urmează să faci ceva, fără rezultatul uneltei ' +
        'în mână. A citi sau a raporta o stare NU înseamnă a face.\n' +
        'Dacă nu ai unealta potrivită, spune-o simplu și direct — asta e onest. A povesti o faptă ' +
        'care nu s-a întâmplat nu e.'
      const orMsgs: OrMessage[] = [{ role: 'system', content: systemPrompt + DEED_RULE_LAST }]
      for (const p of params) {
        const role = p.role === 'assistant' ? 'assistant' : 'user'
        if (typeof p.content === 'string') {
          if (p.content) orMsgs.push({ role, content: p.content })
          continue
        }
        // VĂZUL (Adrian, 24 iul: „îi încarc o poză dar nu o vede... nu apelează
        // camera"): blocurile de imagine erau în format Anthropic și rândul ăsta
        // ARUNCA tot mesajul (content non-string → ''). Acum convertim la formatul
        // OpenAI multimodal (image_url cu data URL) — modelul chiar vede poza și
        // cadrele camerei; textul turei se păstrează.
        const parts: { type: string; [k: string]: unknown }[] = []
        for (const b of p.content as unknown as Array<Record<string, unknown>>) {
          if (b.type === 'text' && typeof b.text === 'string') {
            parts.push({ type: 'text', text: b.text })
          } else if (b.type === 'image') {
            const src = b.source as { media_type?: string; data?: string } | undefined
            if (src?.data) {
              parts.push({
                type: 'image_url',
                image_url: { url: `data:${src.media_type ?? 'image/jpeg'};base64,${src.data}` },
              })
            }
          }
        }
        if (parts.length) orMsgs.push({ role, content: parts })
      }
      let callN = 0
      const execTool = async (name: string, argsJson: string): Promise<string> => {
        let input: unknown = {}
        try {
          input = JSON.parse(argsJson || '{}')
        } catch {
          input = {}
        }
        if (name === 'web_search' || name === 'youtube_search' || name === 'image_search') {
          usage.usd += SERPER_USD_PER_CALL
          // CONTABILITATE REALĂ (audit QA 24 iul, A1): fără recordCost, tabul
          // Bani nu vedea NICIODATĂ costul căutării/imaginilor/creierului.
          void recordCost(user.email, 'search', SERPER_USD_PER_CALL)
        }
        if (name === 'generate_image') {
          usage.usd += IMAGE_USD_PER_CALL
          void recordCost(user.email, 'image', IMAGE_USD_PER_CALL)
        }
        // AUTONOMIE TOTALĂ DE INSTALARE (Adrian, 27 iul: „autonomie totală în
        // a-și instala instrumente/skill-uri/softuri când îi cer"): Kelion își
        // propune o unealtă nouă. Când CERE OWNER-UL (admin), cererea lui ESTE
        // aprobarea → unealta se AUTO-INSTALEAZĂ pe loc (status='approved') și e
        // gata de folosit din următoarea cerere, fără niciun click în admin.
        // Pentru alți useri rămâne 'pending' până o aprobă owner-ul (securitate).
        if (name === 'propose_tool') {
          const p = input as { name?: string; description?: string; params_schema?: unknown; http_method?: string; http_url?: string; http_headers?: unknown; rationale?: string }
          const id = await proposeKelionTool({
            name: String(p.name ?? ''),
            description: String(p.description ?? ''),
            paramsJson: JSON.stringify(p.params_schema ?? { type: 'object', properties: {}, required: [] }),
            httpMethod: String(p.http_method ?? 'GET'),
            httpUrl: String(p.http_url ?? ''),
            httpHeaders: JSON.stringify(p.http_headers ?? {}),
            rationale: String(p.rationale ?? ''),
          })
          if (!id) return JSON.stringify({ error: 'invalid_proposal (doar HTTPS, nume valid)' })
          if (isAdmin) {
            const ok = await decideKelionTool(id, true).catch(() => false)
            return JSON.stringify({
              installed: ok,
              id,
              note: ok
                ? `Unealta „${String(p.name ?? '')}" e INSTALATĂ și activă acum (cererea owner-ului = aprobare). O poți folosi din următoarea cerere.`
                : 'Propusă, dar auto-instalarea a picat — o poți aproba în Admin → Unelte Kelion.',
            })
          }
          return JSON.stringify({ proposed: true, id, note: 'Așteaptă aprobarea owner-ului în Admin → Unelte Kelion.' })
        }
        // UNEALTĂ DINAMICĂ APROBATĂ: execuție generică prin apel HTTP sigur.
        if (dynNames.has(name)) {
          return await runDynamicTool(name, input as Record<string, unknown>)
        }
        // ESCALADAREA DECISĂ DE MODEL: aceeași cale ca în voce — persona
        // completă + limba turei, răspuns de la creierul cu raționament intern.
        // Costul REAL intră în usage → debitat la finalul turei ca orice apel.
        if (name === 'ask_brain') {
          const request = String((input as { request?: string }).request ?? '').trim()
          if (!request) return JSON.stringify({ error: 'empty_request' })
          const brainPrompt =
            `${SYSTEM_PROMPT}\n\n` +
            `CHAT ESCALATION: the fast chat model handed you a request it judged too hard. Answer it fully ` +
            `and correctly${langName ? `, writing ONLY in ${langName}` : ''}. Plain conversational text, no markdown.\n\n${request}`
          const answer = await brainComplete(brainPrompt, 4000, (usd) => {
            usage.usd += usd
            void recordCost(user.email, 'chat', usd)
          })
          return answer || JSON.stringify({ error: 'brain_unavailable' })
        }
        const block = { type: 'tool_use', id: `call_${++callN}`, name, input } as unknown as ToolUseBlock
        return runTool(
          block, isAdmin, token, reply, baseUrl, user.email, usage,
          (speechPref || isAdminUser) && langName ? langName : '',
          brainApiKey,
        )
      }
      // PRIMUL CUVÂNT SUB 1s ȘI PE TURELE DE ACȚIUNE (Adrian, 27 iul, dovadă
      // live: 37s până la primul cuvânt — poarta faptei îl punea să execute
      // TOATE uneltele înainte să scoată o vorbă). Pe tura de acțiune a
      // adminului, confirmarea pleacă INSTANT; uneltele rulează imediat după.
      // OBLIGATORIU ODATĂ CU FORȚAREA, PENTRU TOȚI: pe o rundă forțată modelul
      // întoarce DOAR apelul de unealtă, fără text (Gemini în mod ANY nici nu
      // produce text) — fără confirmarea asta userul ar aștepta MUT până termină
      // uneltele. Se aplică pe orice tură de ordin, nu doar la owner.
      if (actionTurn || (isAdmin && heavyTurn)) {
        const ackText = ro ? 'Preluat sarcina. ' : 'Task taken. '
        noteFirstWord()
        reply.raw.write(appendTurn(user.email, turnId, ackText))
        voice.feed(ackText)
        assistantText += ackText
      }
      // GEMINI PRINCIPAL → NEMOTRON SECUNDAR (Adrian, 27 iul): dacă nucleul
      // gemini pică pe cotă/serviciu (429/503/RESOURCE_EXHAUSTED), NU omorâm
      // tura — reluăm O DATĂ pe secundarul :free din OpenRouter. Retry-ul e
      // sigur doar dacă nu a curs încă text spre user (altfel s-ar dubla).
      let orchestratorModel = orChatModel
      let textFlowed = false
      const runBrainOnce = (): ReturnType<typeof runOrchestrator> => runOrchestrator(
        orchestratorModel,
        orMsgs,
        tools as unknown as AnthropicTool[],
        execTool,
        {
          maxTokens: 5000,
          // RAȚIONAMENT REAL pe tura grea (25 iul): modelul work GÂNDEȘTE
          // intern înainte de răspuns; gândirea nu curge în text — doar
          // răspunsul final. Pe tura ușoară: fără, ca primul cuvânt să rămână
          // instant (sub 1s, regula de latență).
          // ÎNGHEȚUL PE CREIERUL GRATUIT (Adrian, 27 iul: „i-am cerut o acțiune
          // și îngheață"): modelul :free gândește ÎN TĂCERE zeci de secunde
          // înainte de primul cuvânt → pare mort. Pe :free/gemini forțăm
          // gândirea SCURTĂ ('low'); pe plătite rămâne 'medium'.
          reasoning: heavyTurn ? (orchestratorModel.startsWith(GEMINI_DIRECT_PREFIX) || orchestratorModel.endsWith(':free') ? 'low' : 'medium') : undefined,
          // CREIERUL DE ABONAMENT: cheia proprie a ownerului pe turele grele
          // (undefined pe rest → punga centrală). Vezi selectedBrainModel.
          apiKey: brainApiKey,
          // POARTA FAPTEI (Adrian, 27 iul): pe turele adminului, dacă Kelion
          // AFIRMĂ o faptă fără să cheme unealta, e obligat mecanic să execute
          // sau să retragă — nu mai rămâne la stadiul declarativ.
          // POARTA FAPTEI PENTRU TOȚI (27 iul): o faptă declarată fără unealtă e
          // vorbă goală indiferent cine e la celălalt capăt. Nu mai e doar a lui.
          deedGate: true,
          passiveTools: PASSIVE_TOOLS,
          // CREIERUL FORȚAT SĂ EXECUTE (Adrian, 27 iul: „autonomia lui nu e
          // reală"). Dovada live pe creierul gratuit, cu încărcătura REALĂ a
          // aplicației (61 unelte, prompt de 10k): pe 'auto' execută 0/2 și
          // răspunde GOL; forțat execută 2/2. Forțarea ține până când chiar
          // rulează o unealtă de ACȚIUNE — o unealtă de citit nu o oprește.
          // Pornește pe ORICE tură de ordin, a oricui, nu doar a ownerului.
          forceToolsUntilAction: actionTurn,
          onText: (txt) => {
            textFlowed = true
            noteFirstWord()
            reply.raw.write(txt)
            voice.feed(txt)
          },
        },
      )
      let r
      try {
        r = await runBrainOnce()
      } catch (ge) {
        if (
          orchestratorModel.startsWith(GEMINI_DIRECT_PREFIX) &&
          isGeminiQuotaError(ge) &&
          !textFlowed
        ) {
          // Cota gratuită Google s-a terminat pe ziua/minutul ăsta — secundarul
          // preia tura fără ca userul să vadă vreo ruptură.
          orchestratorModel = await resolveModel('work', null)
          console.log(`[brain] gemini indisponibil (${String(ge).slice(0, 80)}) → secundar ${orchestratorModel}`)
          r = await runBrainOnce()
        } else {
          throw ge
        }
      }
      assistantText += r.text
      usage.usd += r.costUsd
      // CONTABILITATE REALĂ (audit QA 24 iul, A1): costul CREIERULUI intră în
      // cost_events pentru TOȚI userii (inclusiv admin) — tabul Bani arăta 0
      // la „Creier" pentru că recordCost nu era apelat nicăieri pe calea chat.
      void recordCost(user.email, 'chat', r.costUsd)
    } catch (e) {
      // Creierul a picat — onest, niciodată tăcut. Fără plasă Kimi/GLM (scoase).
      const errMsg = e instanceof Error ? e.message : String(e)
      const low = errMsg.toLowerCase()
      const isQuota =
        low.includes('402') || low.includes('429') || low.includes('quota') || low.includes('insufficient')
      const isRefusal = low.includes('refusal')
      // MODEL DE ABONAMENT INVALID (auditul 28 iul): dacă tura mergea pe cheia de
      // abonament și a picat pe 400/model inexistent, mesajul generic ascundea
      // cauza reală. Acum îi spunem ownerului clar să aleagă alt model din listă.
      const isBadSubModel =
        brainApiKey != null &&
        (low.includes('not a valid model') ||
          low.includes('no endpoints') ||
          low.includes('is not a valid') ||
          low.includes('not found') ||
          (low.includes('400') && !isQuota && !isRefusal))
      const spoken = ro
        ? isBadSubModel
          ? 'Modelul de abonament pare invalid sau indisponibil pe OpenRouter. Deschide Setări → „Creier abonament" și alege alt model din listă.'
          : isQuota
          ? 'Am epuizat momentan creditul creierului. Te rog reîncarcă creditul ca să continuăm.'
          : isRefusal
            ? 'Am întâmpinat o restricție de siguranță. Încearcă altfel sau spune-mi ce vrei.'
            : 'Am întâmpinat o problemă tehnică. Încearcă din nou într-o secundă.'
        : isBadSubModel
          ? 'The subscription model seems invalid or unavailable on OpenRouter. Open Settings → “Subscription brain” and pick another model.'
          : isQuota
          ? "I've temporarily run out of brain credit. Please top up so we can continue."
          : isRefusal
            ? 'I hit a safety restriction. Try rephrasing or tell me what you need.'
            : 'I ran into a technical issue. Please try again in a moment.'
      reply.raw.write(spoken)
      reply.raw.end()
      void saveMessage(user.email, 'assistant', spoken)
      console.error('[CHAT ERROR]', errMsg)
      // BANII NU SE PIERD LA EROARE (audit 27 iul): uneltele deja rulate în
      // tura asta (căutări, imagini, ask_brain) au COSTAT — return-ul de aici
      // sărea peste debit și userul consuma pe gratis, repetabil.
      if (usage.usd > 0) void debitWallet(user.email, usage.usd, `chat-err:${turnId.slice(0, 8)}`)
      return
    }


    // ── FINAL TURN ──
    await voice.finish()
    reply.raw.end()

    // Persist the assistant's reply.
    if (assistantText) {
      void saveMessage(user.email, 'assistant', assistantText)
      // Memory agent (learn): durable facts about this user, learned from this turn.
      // Fire-and-forget — zero latency on the reply path.
      // FIX CRITIC (audit 24 iul): argumentele erau inversate — 'kelion' ajungea
      // ca userMsg și răspunsul ca nume de agent → memoria nu mai reținea NIMIC.
      void learnFromTurn(user.email, lastUserText, assistantText, 'kelion')
    }

    // Debit real provider cost from the wallet — PENTRU TOȚI, inclusiv ADMIN
    // (Adrian, 25 iul: „admin nu e scutit de realitate — astea se consumă și
    // admin trebuie să vadă real ce are"). Creditele adminului scad la fel de
    // real ca ale clienților; DOAR blocarea la 0 (paywall) rămâne pe clienți —
    // proprietarul nu se încuie afară din propria aplicație.
    {
      const cost = usage.usd
      if (cost > 0) {
        void debitWallet(user.email, cost, `chat:${turnId.slice(0, 8)}`)
      }
      // Proactiv, în fundal: reîncărcarea automată rămâne pe clienți (cardul salvat).
      if (user.role !== 'admin') void maybeAutoRecharge(user.email, user.name)
    }
    },
  )
}

// ── runTool helper (extracted from the main handler for clarity) ────────────
async function runTool(
  block: ToolUseBlock,
  isAdmin: boolean,
  token: string,
  reply: { raw: { write(c: string): void } },
  baseUrl: string,
  email: string,
  usage: { usd: number },
  langName: string,
  // REGULA „ALL INCLUSIVE" PE ABONAMENT (28 iul): când tura curentă rulează pe
  // cheia proprie a ownerului, TOT ce costă în aceeași tură (imagine + căutare
  // web/YouTube) se plătește tot de acolo — undefined pe restul turelor →
  // punga centrală, ca până acum.
  brainApiKey?: string,
): Promise<string> {
  const args = block.input as Record<string, unknown>
  // Urmă în jurnal pentru FIECARE unealtă chemată (incident 25 iul: „nu face
  // nimic" — fără urma asta, diagnosticul a cerut interogarea bazei de date).
  console.log(`[tool] ${block.name} (${isAdmin ? 'admin' : 'user'})`)

  switch (block.name) {
    case 'list_source': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return listSource(String(args.dir ?? '.'))
    }
    case 'read_source': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return readSource(String(args.path ?? ''))
    }
    case 'search_source': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return searchSource(String(args.query ?? ''))
    }
    case 'list_updates': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      const raw = await updatesList()
      return raw
        ? raw.slice(0, 20_000)
        : JSON.stringify({ error: 'no_updates_file', hint: 'apare începând cu primul deploy făcut prin deploy.sh de pe 25 iul' })
    }
    case 'run_runbook': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return runRunbook(String(args.name ?? ''))
    }
    case 'runbook_status': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return runbookStatus(args.name ? String(args.name) : undefined)
    }
    case 'runbook_log': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return runbookLog(Number(args.run_id ?? 0))
    }
    case 'request_repair': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return requestRepair(String(args.title ?? ''), String(args.details ?? ''))
    }
    case 'repo_write': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return repoWrite(String(args.branch ?? ''), String(args.path ?? ''), String(args.content ?? ''), String(args.message ?? ''))
    }
    case 'repo_open_pr': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return repoOpenPR(String(args.branch ?? ''), String(args.title ?? ''), String(args.body ?? ''))
    }
    case 'repo_merge_pr': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return repoMergePR(Number(args.pr ?? 0))
    }
    case 'build_software': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      const order = String(args.order ?? '').trim()
      if (order.length < 8) return JSON.stringify({ error: 'ordin_prea_scurt' })
      const jobId = await createBuildJob(email, order)
      if (!jobId) {
        // PLAFON ZILNIC (reparat 28 iul — vezi buildJobsToday în db.ts): distinge
        // DB picat de plafonul de siguranță atins, ca Kelion să nu ceară orbește
        // reîncercare când motivul real e „ai atins limita de azi".
        const today = await buildJobsToday()
        if (today >= config.autonomyDailyMax) {
          return JSON.stringify({
            error: 'plafon_zilnic_atins',
            today,
            max: config.autonomyDailyMax,
            hint: 'Plafonul de siguranță pentru ordine de construcție în 24h a fost atins — spune-i ownerului, nu reîncerca acum.',
          })
        }
        return JSON.stringify({ error: 'db_indisponibil' })
      }
      return JSON.stringify({
        ok: true,
        job: jobId,
        message: `Ordin #${jobId} în coadă. Lucrătorul îl ia în cel mult 2 minute, construiește cu build+teste și deschide PR-ul; ownerul primește email cu linkul de merge. Vezi starea cu constructor_status.`,
      })
    }
    case 'constructor_status': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      const jobs = await listBuildJobs(12)
      return JSON.stringify({
        jobs: jobs.map((j) => ({ id: j.id, status: j.status, order: j.orderText.slice(0, 160), pr: j.prUrl, branch: j.branch, tokens: j.tokens, updated: j.updatedAt })),
      })
    }
    case 'cancel_build_jobs': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      const all = args.all === true
      const ids = Array.isArray(args.ids) ? (args.ids as unknown[]).map(Number).filter(Number.isInteger) : []
      if (!all && !ids.length) return JSON.stringify({ error: 'nimic de anulat: dă ids sau all:true' })
      const n = all ? await cancelAllPendingBuildJobs() : await cancelBuildJobs(ids)
      return JSON.stringify({ cancelled: n, note: n ? 'Ordinele anulate nu mai sunt reluate de lucrător.' : 'Nu era niciun ordin în coadă sau în lucru.' })
    }
    case 'system_health': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return systemHealth()
    }
    case 'verify_visually': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      const url = String(args.url ?? '')
      const question = String(args.question ?? '').trim() || 'Describe what this page shows, precisely.'
      if (!url) return JSON.stringify({ error: 'no_url' })
      const shot = await screenshotUrl(url)
      if ('error' in shot) return JSON.stringify({ error: shot.error })
      const seen = await geminiVision(shot.jpegBase64, question)
      if (!seen) return JSON.stringify({ error: 'vision_unavailable' })
      return JSON.stringify({ seen })
    }
    case 'server_logs': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      const minLevel = args.errorsOnly === false ? 0 : 40
      const entries = recentLogs(minLevel, Math.min(Math.max(Number(args.limit) || 60, 1), 200))
      return JSON.stringify({
        entries,
        note: entries.length
          ? 'Jurnalele serverului (F12-ul de server). level: 40=warn, 50=error, 60=fatal.'
          : 'Nicio eroare/avertisment reținut de la ultimul restart — serverul e curat pe fereastra actuală.',
      })
    }
    case 'db_tables': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return dbTablesOverview()
    }
    case 'db_query': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return dbQuery(String(args.sql ?? ''))
    }

    case 'show_document': {
      const title = String(args.title ?? 'Document')
      const text = String(args.text ?? '')
      if (!text.trim()) return JSON.stringify({ error: 'empty' })
      reply.raw.write(`${CTRL}${JSON.stringify({ doc: { title, text } })}${CTRL}`)
      return JSON.stringify({ shown: true })
    }

    case 'show_on_screen': {
      const url = String(args.url ?? '')
      const title = String(args.title ?? '')
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title } })}${CTRL}`)
      return JSON.stringify({ shown: true, url, title })
    }

    case 'run_web_app': {
      const title = String(args.title ?? 'Aplicație')
      const html = String(args.html ?? '')
      if (!html.trim()) return JSON.stringify({ error: 'empty_html' })
      // Rulează în client, într-un cadru izolat (srcdoc + sandbox) — vezi Stage.
      reply.raw.write(`${CTRL}${JSON.stringify({ app: { title, html } })}${CTRL}`)
      return JSON.stringify({ running: true, title, savable: true })
    }

    // GESTURI PE CONTEXT (audit 24 iul, plângerea lui Adrian: „nu are creier să
    // aplice gesturile pe context"). Unealta ERA oferită creierului dar nu avea
    // execuție → cădea pe default cu „unknown_tool" și modelul se dezvăța s-o
    // cheme. Acum: validare + poarta anti-repetiție + frame-ul {gesture} spre
    // client (ChatPanel îl mapează pe clip și animă avatarul).
    case 'play_avatar_gesture': {
      const g = String(args.gesture ?? '')
      if (!(AVATAR_GESTURES as readonly string[]).includes(g)) {
        return JSON.stringify({ error: 'unknown_gesture' })
      }
      // GESTURILE OPRITE DE ADRIAN rămân oprite (QA 24 iul): enum-ul uneltei e
      // filtrat, dar un model care ignoră enum-ul putea reda un gest dezactivat
      // — re-verificăm AICI, contra listei reale din DB, nu doar în ofertă.
      if ((await getDisabledGestures()).includes(g)) {
        return JSON.stringify({ played: false, reason: 'disabled_by_admin' })
      }
      if (!allowAutoGesture(email, g)) {
        return JSON.stringify({ played: false, reason: 'cooldown' })
      }
      reply.raw.write(`${CTRL}${JSON.stringify({ gesture: g })}${CTRL}`)
      return JSON.stringify({ played: true })
    }

    // COMUTAREA MESERIEI (QA 24 iul): userul cere prin chat, Kelion o schimbă
    // pe loc; persona nouă intră în vigoare de la următoarea tură (persona se
    // construiește per-tură din getMeserieActiva).
    case 'set_active_role': {
      const id = Number(args.role_id ?? -1)
      if (id === 0) {
        await setMeserieActivaPref(email, null)
        return JSON.stringify({ ok: true, role: null })
      }
      const m = getMeserie(id)
      if (!m) return JSON.stringify({ error: 'unknown_role', hint: 'role_id 1..15 or 0 to clear' })
      await setMeserieActivaPref(email, id)
      return JSON.stringify({ ok: true, role: m.nume })
    }

    // ACCES LA TAB-URILE APLICAȚIEI din chatul SCRIS (audit 24 iul — exista
    // doar pe voce). Emite frame-ul {nav}; clientul îl traduce în evenimentul
    // kelion:navigate, iar Stage deschide panoul (adminul rămâne gate-uit acolo).
    case 'open_app_view': {
      const view = String(args.view ?? '').trim().toLowerCase()
      const section = String(args.section ?? '').trim()
      if (!['settings', 'wallet', 'contact', 'admin', 'home'].includes(view)) {
        return JSON.stringify({ error: 'unknown_view' })
      }
      if (view === 'admin' && !isAdmin) return JSON.stringify({ error: 'admin_only' })
      reply.raw.write(`${CTRL}${JSON.stringify({ nav: { view, section } })}${CTRL}`)
      return JSON.stringify({ opened: view, section: section || null })
    }

    case 'generate_image': {
      const prompt = String(args.prompt ?? '')
      if (!prompt) return JSON.stringify({ error: 'no_prompt' })
      const result = await generateImage(prompt, brainApiKey)
      if ('error' in result) return JSON.stringify({ error: result.error })
      const imageUrl = `${baseUrl}/api/image/${result.id}`
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: imageUrl, title: 'Generated image' } })}${CTRL}`)
      return JSON.stringify({ shown: true, url: imageUrl })
    }

    case 'browser_open': {
      const url = String(args.url ?? '')
      if (!url) return JSON.stringify({ error: 'no_url' })
      const result = await browserOpen(email, baseUrl, url)
      // BROWSER VIZIBIL (audit 24 iul, P1-4): înainte trimiteam URL-ul EXTERN al
      // paginii → iframe-ul îl refuza (X-Frame-Options) → ecran gol deși modelul
      // naviga corect. Acum monitorul primește SCREENSHOT-ul servit local
      // (mereu embeddabil); modelul primește separat textul + elementele.
      if (!('error' in result)) {
        reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: result.shotUrl, title: result.title } })}${CTRL}`)
      }
      return JSON.stringify(result)
    }
    case 'browser_click': {
      const result = await browserClick(email, baseUrl, Number(args.index ?? 0))
      // BROWSER VIZIBIL (audit 24 iul, P1-4): înainte trimiteam URL-ul EXTERN al
      // paginii → iframe-ul îl refuza (X-Frame-Options) → ecran gol deși modelul
      // naviga corect. Acum monitorul primește SCREENSHOT-ul servit local
      // (mereu embeddabil); modelul primește separat textul + elementele.
      if (!('error' in result)) {
        reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: result.shotUrl, title: result.title } })}${CTRL}`)
      }
      return JSON.stringify(result)
    }
    case 'browser_type': {
      const result = await browserType(email, baseUrl, Number(args.index ?? 0), String(args.text ?? ''), Boolean(args.submit))
      // BROWSER VIZIBIL (audit 24 iul, P1-4): înainte trimiteam URL-ul EXTERN al
      // paginii → iframe-ul îl refuza (X-Frame-Options) → ecran gol deși modelul
      // naviga corect. Acum monitorul primește SCREENSHOT-ul servit local
      // (mereu embeddabil); modelul primește separat textul + elementele.
      if (!('error' in result)) {
        reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: result.shotUrl, title: result.title } })}${CTRL}`)
      }
      return JSON.stringify(result)
    }
    case 'browser_read': {
      const result = await browserRead(email, baseUrl)
      // BROWSER VIZIBIL (audit 24 iul, P1-4): înainte trimiteam URL-ul EXTERN al
      // paginii → iframe-ul îl refuza (X-Frame-Options) → ecran gol deși modelul
      // naviga corect. Acum monitorul primește SCREENSHOT-ul servit local
      // (mereu embeddabil); modelul primește separat textul + elementele.
      if (!('error' in result)) {
        reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: result.shotUrl, title: result.title } })}${CTRL}`)
      }
      return JSON.stringify(result)
    }
    case 'browser_back': {
      const result = await browserBack(email, baseUrl)
      // BROWSER VIZIBIL (audit 24 iul, P1-4): înainte trimiteam URL-ul EXTERN al
      // paginii → iframe-ul îl refuza (X-Frame-Options) → ecran gol deși modelul
      // naviga corect. Acum monitorul primește SCREENSHOT-ul servit local
      // (mereu embeddabil); modelul primește separat textul + elementele.
      if (!('error' in result)) {
        reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: result.shotUrl, title: result.title } })}${CTRL}`)
      }
      return JSON.stringify(result)
    }
    case 'browser_scroll': {
      const result = await browserScroll(email, baseUrl, String(args.direction ?? 'down') as 'up' | 'down')
      // BROWSER VIZIBIL (audit 24 iul, P1-4): înainte trimiteam URL-ul EXTERN al
      // paginii → iframe-ul îl refuza (X-Frame-Options) → ecran gol deși modelul
      // naviga corect. Acum monitorul primește SCREENSHOT-ul servit local
      // (mereu embeddabil); modelul primește separat textul + elementele.
      if (!('error' in result)) {
        reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: result.shotUrl, title: result.title } })}${CTRL}`)
      }
      return JSON.stringify(result)
    }
    case 'browser_key': {
      const result = await browserKey(email, baseUrl, String(args.key ?? ''))
      // BROWSER VIZIBIL (audit 24 iul, P1-4): înainte trimiteam URL-ul EXTERN al
      // paginii → iframe-ul îl refuza (X-Frame-Options) → ecran gol deși modelul
      // naviga corect. Acum monitorul primește SCREENSHOT-ul servit local
      // (mereu embeddabil); modelul primește separat textul + elementele.
      if (!('error' in result)) {
        reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: result.shotUrl, title: result.title } })}${CTRL}`)
      }
      return JSON.stringify(result)
    }
    case 'browser_click_at': {
      const result = await browserClickAt(email, baseUrl, Number(args.x ?? 0), Number(args.y ?? 0))
      // BROWSER VIZIBIL (audit 24 iul, P1-4): înainte trimiteam URL-ul EXTERN al
      // paginii → iframe-ul îl refuza (X-Frame-Options) → ecran gol deși modelul
      // naviga corect. Acum monitorul primește SCREENSHOT-ul servit local
      // (mereu embeddabil); modelul primește separat textul + elementele.
      if (!('error' in result)) {
        reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: result.shotUrl, title: result.title } })}${CTRL}`)
      }
      return JSON.stringify(result)
    }
    case 'browser_close': {
      await browserClose(email)
      // Browserul s-a închis → curăță monitorul (url gol = ecran liber).
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: '', title: '' } })}${CTRL}`)
      return JSON.stringify({ closed: true })
    }
    case 'browser_crawl': {
      const url = String(args.url ?? '')
      if (!url) return JSON.stringify({ error: 'no_url' })
      const maxPages = Math.min(Math.max(Number(args.maxPages) || 8, 1), 20)
      const result = await crawlSite(email, baseUrl, url, maxPages)
      // Fiecare pagină trunchiată (24 iul, dieta de istoric): un crawl de 20
      // pagini nu are voie să umple tot bugetul de context al turei.
      const pages = result.pages.map((p) => ({ url: p.url, title: p.title, text: p.text.slice(0, 2000) }))
      return JSON.stringify({ pages, count: pages.length, error: result.error })
    }

    case 'save_note': {
      const content = String(args.content ?? '')
      const title = String(args.title ?? '')
      if (!content) return JSON.stringify({ error: 'no_content' })
      const id = await saveNote(email, content, title || undefined)
      return JSON.stringify({ saved: true, id })
    }
    case 'list_notes': {
      const notes = await listNotes(email)
      return JSON.stringify({ notes })
    }
    case 'delete_note': {
      const id = Number(args.id ?? 0)
      if (!id) return JSON.stringify({ error: 'no_id' })
      await deleteNote(email, id)
      return JSON.stringify({ deleted: true })
    }
    case 'list_memories': {
      const memories = await getMemories(email)
      return JSON.stringify({ memories: memories.map((m) => m.content) })
    }
    case 'forget_memory': {
      const fragment = String(args.fragment ?? '')
      if (!fragment) return JSON.stringify({ error: 'no_fragment' })
      // FIX (audit 24 iul): ordinea corectă e (email, fragment, agent).
      const count = await deleteMemory(email, fragment, 'kelion')
      return JSON.stringify({ deleted: count })
    }

    case 'log_unsupported_request': {
      const request = String(args.request ?? '')
      const reason = String(args.reason ?? '')
      if (!request) return JSON.stringify({ error: 'no_request' })
      void logCapabilityGap(email, request, reason)
      return JSON.stringify({ logged: true })
    }

    case 'get_real_cost': {
      if (!isAdmin) return JSON.stringify({ error: 'unauthorized' })
      const summary = await getCostSummary()
      return JSON.stringify(summary)
    }

    case 'prepare_promo_clip': {
      if (!isAdmin) return JSON.stringify({ error: 'unauthorized' })
      const subject = String(args.subject ?? '')
      const duration = Number(args.duration_seconds ?? 30)
      const script = String(args.script ?? '')
      const lang = String(args.lang ?? 'ro-RO')
      const scenes = Array.isArray(args.scenes) ? args.scenes : []
      if (!subject || !script) return JSON.stringify({ error: 'missing_params' })
      const imageScenes = scenes.filter((s: unknown) => (s as { kind?: string }).kind === 'image')
      for (const s of imageScenes) {
        const scene = s as { url?: string }
        if (!scene.url?.startsWith('/api/image/')) {
          return JSON.stringify({ error: 'image_scene_needs_api_image_url' })
        }
      }
      const promoUrl = await promoSceneUrl('map', subject)
      // SCENELE ÎN FORMA CLIENTULUI (QA 24 iul: serverul emitea scenele brute
      // {at_seconds,kind,query,url}, clientul așteaptă {at,title,url,close} →
      // toate timerele ieșeau NaN și scenele map/weather rămâneau fără URL).
      // Convertim AICI: at_seconds→at; map/weather→URL real prin promoSceneUrl;
      // avatar = scenă fără URL (clientul închide monitorul → avatarul singur).
      const clientScenes: { at: number; title: string; url?: string; close?: boolean }[] = []
      for (const raw of scenes) {
        const s = raw as { at_seconds?: number; kind?: string; query?: string; url?: string; title?: string }
        const at = Math.max(0, Number(s.at_seconds ?? 0))
        const title = String(s.title ?? s.query ?? subject)
        if (s.kind === 'image' && s.url) clientScenes.push({ at, title, url: s.url })
        else if (s.kind === 'map' || s.kind === 'weather') {
          const u = await promoSceneUrl(s.kind, String(s.query ?? subject))
          if (u) clientScenes.push({ at, title, url: u })
        } else clientScenes.push({ at, title, close: true }) // avatar → ecran liber
      }
      // ARMAREA RECORDERULUI (audit 24 iul: „clip promo nu merge din chat scris")
      // — frame-ul `{promo}` e cel pe care ChatPanel îl așteaptă (c.promo?.script
      // → armPromo) ca să armeze butonul Rec cu scenariul aprobat; înainte se
      // emitea DOAR `{monitor}` și recorderul nu se arma niciodată.
      reply.raw.write(
        `${CTRL}${JSON.stringify({ promo: { subject, duration, script, lang, scenes: clientScenes } })}${CTRL}`,
      )
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: promoUrl, title: `Promo: ${subject}` } })}${CTRL}`)
      return JSON.stringify({ armed: true, shown: true, url: promoUrl })
    }

    default: {
      // Google tools are handled by the googleTools router.
      if (googleTools.some((t) => t.name === block.name)) {
        const result = await runGoogleTool(block.name, block.input, token, brainApiKey)
        // AFIȘARE AUTOMATĂ: uneltele care întorc `screen_url` (hartă, rută, vreme,
        // video) trebuie să APARĂ pe monitor dintr-un SINGUR apel — creierul nu
        // face mereu al doilea `show_on_screen`, deci userul vedea „am arătat
        // harta" fără nimic pe ecran. Emitem noi frame-ul {monitor} din rezultat.
        try {
          const p = JSON.parse(result) as { screen_url?: string; location?: string; origin?: string }
          if (p.screen_url) {
            const url = p.screen_url.startsWith('/') ? `${baseUrl}${p.screen_url}` : p.screen_url
            reply.raw.write(
              `${CTRL}${JSON.stringify({ monitor: { url, title: p.location || p.origin || '' } })}${CTRL}`,
            )
          }
        } catch {
          /* rezultat non-JSON sau fără screen_url — nimic de afișat */
        }
        return result
      }
      return JSON.stringify({ error: `unknown_tool: ${block.name}` })
    }
  }
}

