import type { FastifyInstance } from 'fastify'
import { config, roleFor, modelRapidDirect } from '../config.js'
import type {
  Tool,
  MessageParam,
  ToolUseBlock
} from '../services/brain-types.js'
import { getSessionUser, setSession, type SessionUser } from '../session.js'
import {
  googleTools,
  runGoogleTool,
  refreshGoogleAccessToken,
  reverseGeocodeCached
} from '../services/google.js'
import {
  saveMessage,
  recordCost,
  recordTiming,
  citesteSold,
  debitWallet,
  getSpeechLang,
  setSpeechLangPref,
  getMeserieActiva,
  setMeserieActivaPref,
  getDisabledGestures,
  saveNote,
  listNotes,
  deleteNote,
  getRecentHistory,
  getVoiceprint,
  saveVoiceprint,
  vectorDistance,
  getFaceprint,
  saveFaceprint,
  faceDistance,
  loadKv,
  createBuildJob,
  listBuildJobs,
  deleteBuildJob,
  deleteBuildJobsByScope,
  retryBuildJob,
  cancelBuildJob,
  attachGuestPhoto,
  userKey,
  addMemory,
  recordSimptomLive,
  inregistreazaSarcinaOperationala,
  noteazaEvenimentOperational,
  tranzitioneazaSarcinaOperationala,
} from '../db.js'
import { extrageNiveluri, curataSemne, curataZone, curataSageti, curataTrend } from './tranzactii.js'
import { getMeserie } from '../services/meserii.js'
import { resolveModel, taskDifficulty, ESCALATE_AT, ESCALATE_TOP_AT, hasActionIntent, OCHI_MARCAJ, type OrMessage, type AnthropicTool } from '../services/brainContract.js'
import { stripToolMarkup, makeToolMarkupStripper } from '../services/toolMarkup.js'
import {
  iaSlotDacaLiber,
  elibereazaSlot,
  asteaptaLaCoada,
  noteazaEsuare
} from '../services/dispecer.js'
import { runOrchestrator } from '../services/orchestrator.js'
import { memorieUnificata } from '../services/memorieUnificata.js'
import { autoPreviewFrame } from '../services/monitorAutoPreview.js'
import { GEMINI_DIRECT_PREFIX, geminiDirectAvailable, geminiLive } from '../services/geminiDirect.js'
import { ruleazaPanou } from '../services/panouLucratori.js'
import { dynamicToolDefs, dynamicToolNames, runDynamicTool } from '../services/dynamicTools.js'
import { SERPER_USD_PER_CALL, IMAGE_USD_PER_CALL } from '../services/cost.js'
import { recallMemories, recallMemoriiTranzactii, learnFromTurn } from '../services/agents.js'
import { inventarulMeu, CAPABILITIES, grupaExecutieUnealta, eSqlDeCitire, allCapabilityNames } from '../services/brainCapabilities.js'
import { lectiiCurente } from '../services/autoInvatare.js'
import { esteNemultumire, noteazaRepros, lectiiReprosuri } from '../services/feedbackImplicit.js'
import { generateImage } from '../services/image.js'
import { genereazaVideo } from '../services/video.js'
import { taxeazaServiciu, cheiaTarifVideo, meniulDeTarife, lirePentru } from '../services/tarife.js'
import { planStudio, numeClip, RETETE_STUDIO } from '../services/studioClipuri.js'
import { trackSpeechLang, detectSpeechLang, LANG_LABELS } from '../services/lang.js'
import { inceputStrain, aCerutAltaLimba } from '../services/limbaRaspuns.js'
import {
  clasificaRezultatUnealta,
  pretentiiFaraFapta,
  textulDemascarii,
  textulNuPotVerifica,
  planFaraExecutie,
  TEXT_PLAN_FARA_EXECUTIE,
  type DovadaUnealta,
} from '../services/poartaFaptelor.js'
import { rezumaStareFinalaSarcinaOperationala } from '../services/jurnalOperational.js'
import { CHARTER_CHAT_VOCE_LEGI } from '../services/charterChatVoce.js'
import { interpretDeviceCommand, deviceAck, interpretGestureCommand, gestureAck, gestPentruSituatie } from '../services/commands.js'
import { geoLookupCached, clientIp } from './demo.js'
import { synthesize } from '../services/tts.js'
import { getVoicePref, getGoogleRefreshToken } from '../db.js'
import { stareSesiune, pastreazaStareSesiune, actualizeazaStareSesiune } from '../services/stareSesiune.js'
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
  type BrowserResult
} from '../services/browser.js'
import { startTurn, appendTurn, finishTurn, readTurnFrom, heartbeatSSE } from '../services/sseReplay.js'
import { randomUUID } from 'node:crypto'

// THE OWNER NEVER DEBITS HIMSELF (PR #648, Aug 2 — his own testing drained
// £5.73 of voice from his own wallet in one morning; the rule died first in
// realtime.ts, this is the same predicate for the chat path). Usage is still
// RECORDED for the Money tab — recorded, yes; charged, no.
export const isOwnerEmail = (email: string): boolean => email.toLowerCase() === config.adminEmail
import { inferGender, type VoiceFeatures } from './voiceprint.js'
import { VOICE_MATCH_THRESHOLD } from '../services/voiceMatch.js'
import { marcheazaFata } from '../services/adminLock.js'
import { recentClientErrors } from './clientErrors.js'
import { explicaEroare } from '../services/explicaEroare.js'
import { problemeGlobaleCache, formateazaProbleme } from '../services/autodiagnostic.js'
import { neagaUneltele } from '../services/negareUnelte.js'
import { deflecteazaConstructor, aAlocatConstructie } from '../services/deflectareConstructor.js'
import { execSharedAdminTool, SHARED_ADMIN_TOOLS, execUserScopedTool, USER_SCOPED_TOOLS } from '../services/adminTools.js'
import { numeStrigat } from '../services/numeStrigat.js'
import { fazaTurei, permisaLaVorbire, UNELTE_VORBIRE } from '../services/fazeChat.js'
import { alegeModelOrchestrator, plafonUnelteFurnizor } from '../services/chatModelPolicy.js'
import { CTRL, conteazaCaVizibil, eCadruDeSuprafata } from '../services/chatFrames.js'
import { LOCATION_NONE_PROMPT, asiguraPurtatorAudio, resolveDeviceLocation, sanitizeHistory, weatherArgsWithLocation } from '../services/chatInput.js'
import type { ChatMessage, Coords, DeviceLocation } from '../services/chatInput.js'
import { formatNowContext } from '../services/timeContext.js'
import { buildPromo } from '../services/promo.js'
import { citesteEpisoade, adaugaEpisod, rezumaEpisoade } from '../services/promoEpisoade.js'
import { LIST_SOURCE_TOOL, READ_SOURCE_TOOL, SEARCH_SOURCE_TOOL, DB_TABLES_TOOL, DB_QUERY_TOOL, SYSTEM_HEALTH_TOOL, SERVER_OPS_TOOL, BROWSER_TOOLS, OPEN_APP_VIEW_TOOL, COST_TOOL, LIST_UPDATES_TOOL, SERVER_LOGS_TOOL, CLIENT_ERRORS_TOOL, READ_INBOX_TOOL, LOG_GAP_TOOL, LIST_MEMORIES_TOOL, CAUTA_ISTORIC_TOOL, DOVADA_FAPTELOR_TOOL, FORGET_MEMORY_TOOL, SECRET_PUNE_TOOL, SECRET_LISTA_TOOL, SECRET_PUBLICA_TOOL, CERINTA_NOUA_TOOL, CERINTE_LISTA_TOOL, CERINTA_PRIORITATE_TOOL, CARD_STARE_TOOL, CARD_COMPLETEAZA_TOOL, CARD_GATA_TOOL, PANOU_COD_TOOL, ALLOW_GUEST_VOICE_TOOL, APPROVE_GUEST_VOICE_TOOL, FORGET_GUEST_TOOL, JULES_REPOS_TOOL, JULES_TASK_TOOL, JULES_STATUS_TOOL, CHEAMA_AGENT_TOOL, AGENT_NOU_TOOL, ADMIN_VEZI_TOOL, ADMIN_SCHIMBA_TOOL, MEMORIE_PUNE_TOOL, MEMORIE_IA_TOOL, MEMORIE_LISTA_TOOL, STARE_MASURATA_TOOL, RULEAZA_PORTILE_TOOL, JURNAL_MASURATORI_TOOL, VANEAZA_BUGURI_TOOL, PROCESEAZA_DATE_TOOL,} from '../services/brainToolDefs.js'
import { executaCheamaAgent, executaAgentNou } from '../services/agentiKelion.js'
// Re-exported for the voice route, which takes its tool definitions from chat.js
// (single source — SINGLE BRAIN §1, no duplication).
export { SECRET_PUNE_TOOL, SECRET_LISTA_TOOL, SECRET_PUBLICA_TOOL }
export { CERINTA_NOUA_TOOL, CERINTE_LISTA_TOOL, CERINTA_PRIORITATE_TOOL }
import { latestUpdateSummary } from '../services/updates.js'
import { bazaPublica } from '../services/bazaPublica.js'

// THE BRAIN — Gemini direct, UNIC (extirparea totală OpenRouter + OpenAI, 3 aug).
// The selectable chat model is read from KV (same source as /api/models/selection):
// ── OpenAI model ladder: de la luna la sol pe dificultate ──────────────────
function alegeOpenAIModel(difficulty: number, ownerAction: boolean): string {
  const m = config.openai
  if (ownerAction) return m.heavy // owner cu intenție de acțiune → reasoning
  if (difficulty >= ESCALATE_TOP_AT) return m.max
  if (difficulty >= ESCALATE_AT) return m.medium
  return m.luna
}

// the model CHOSEN by the user, otherwise the tier default. Returns NULL only if
// NO brain exists at all (no Gemini key) → honest message.
async function selectedBrainModel(
  email: string,
  text: string,
  kvRaw?: string | null,
  needsVision = false,
  decideAdresarea = false,
): Promise<{ model: string; heavy: boolean } | null> {
  const difficulty = taskDifficulty(text)
  const isOwner = roleFor(email) === 'admin'
  // ── COMUTATOR DE CREIER (23 aug 2026 — owner: „trebuie un comutator de
  //    creier in admin"). Dacă ownerul a comutat pe OpenAI, scalăm modelul
  //    de la luna la sol pe baza dificultății. Gemini rămâne default.
  const creierActiv = await loadKv('creier_activ') ?? 'google-direct'
  if (creierActiv === 'openai') {
    const modelCustom = (await loadKv('creier_model')) ?? ''
    const model = modelCustom || alegeOpenAIModel(difficulty, isOwner && hasActionIntent(text))
    return { model: `openai/${model}`, heavy: true }
  }
  // Null doar pentru „chiar n-am niciun creier" — creierul e Gemini-only.
  if (!geminiDirectAvailable()) return null
  let sel: { chat?: string; work?: string } = {}
  try {
    // FLUENCY (A5): the kv comes pre-read from the turn's Promise.all (no extra
    // serial DB round here); fall back to a read only for old callers.
    const raw = kvRaw !== undefined ? kvRaw : await loadKv(`model_choice:${userKey(email)}`)
    if (raw) sel = JSON.parse(raw) as { chat?: string; work?: string }
  } catch {
    sel = {}
  }
  // Automatic CHAT → BRAIN ESCALATION, on TWO paths (Adrian, Jul 25: "think at
  // every request = real reasoning", not just regex):
  // (1) fast pre-routing: the taskDifficulty heuristic catches obviously heavy
  //     requests and starts directly on the work model, with internal reasoning;
  // (2) the MODEL's judgment: on the chat tier, the model gets the `ask_brain`
  //     tool (the same as voice's) and escalates BY ITSELF what it judges heavy
  //     — covers exactly the short-but-heavy requests the regex missed.
  // Persona/voice/language/memory/tools are IDENTICAL — only the model changes.
  // ECONOMIC ESCALATION (Jul 25 — corrected after forcing the big brain on EVERY
  // admin turn burned $23+/hour even on ordinary conversation; Adrian: "for a
  // command to fix the mouth animation, that's enormous"). The correct rule: the
  // cheapest capable model by default; escalate ONLY on real action requests
  // from the owner (hasActionIntent — "repair", "run", "publish", "write
  // code"...); returns BY ITSELF to the cheap tier on the next ordinary reply
  // (heavy is computed per-turn from the current text, it doesn't stay latched).
  // MODEL↔FEATURE COMPATIBILITY (Adrian, Jul 25: "the selected models must be
  // compatible with all the app's features"): the cheap chat default
  // (`openai/gpt-oss-20b:free`) has NO vision (the catalog marks it vision:false)
  // — a camera frame sent to it would be ignored/would crash. When the CURRENT
  // turn sends an image (attached photo or camera frame on "what do you see?"),
  // we force-escalate to the work tier — ALL candidate work models (Fable 5,
  // Sonnet 5, GPT-5, Haiku 4.5) have confirmed vision:true.
  // 3-RUNG LADDER (Adrian, Jul 25: "at the brain, gpt-5-mini up to Fable"):
  // free (chat) → cheap-capable (work, default gpt-5-mini) → Fable 5 (top) ONLY
  // on truly extreme difficulty (ESCALATE_TOP_AT). Vision and admin action climb
  // to the MIDDLE rung (work), not straight to the top.
  // ECONOMIC AND HONEST SPLIT (Adrian, Jul 27: "cheap chat is fine, but where a
  // thought-out answer is needed you send it through the brain"): simple talk →
  // cheap model (fast, nearly free); WHEN thinking OR an ACTION is needed (owner
  // asks "repair/publish/show/open/build...") → the brain that actually
  // EXECUTES, not narrates. "Always Fable 5" was removed: it burned credit
  // (OpenRouter went negative on Jul 27) and that's not what he asked for. The
  // top only on extreme difficulty.
  // ── DE CE `decideAdresarea` (măsurat 8 aug, din jurnalul de pe VPS) ───────
  // Adrian: „vorbesc și nu se întâmplă nimic". În jurnal:
  //     [CHAT-IN] audio=da „"
  //     [TIMP] tura …: creier=google-direct/gemini-3.5-flash-lite, total=1619ms
  //     [VOCE] tura …: creierul a decis că NU i se vorbea — tăcere
  // Cauza NU e o părere despre modele — e structurală: linia de mai jos judecă
  // greutatea din TEXT, iar o tură de voce ambientală n-are text deloc (fraza e
  // audio brut, în alt câmp). `difficulty('')` e mic, `hasActionIntent('')` e
  // fals, `needsVision` e fals → `heavy` iese MEREU fals. Adică cea mai
  // consecventă decizie binară din aplicație — „mi se vorbește mie sau nu" — nu
  // putea ajunge NICIODATĂ pe modelul bun; cădea automat pe cel ieftin.
  // Nu se atinge sigiliul: alegerea rămâne între cele două trepte deja sigilate.
  const heavy =
    needsVision || decideAdresarea || difficulty >= ESCALATE_AT || (isOwner && hasActionIntent(text))
  // ── THE OWNER'S BRAIN = POWERFUL AGENT, ALWAYS (iron rule §14, AI-HANDOFF:
  // "on the owner's path, the model IS the agent... NO classifier to demote him
  // to a cheap model"). The cause of "the paid brain is as dumb as the free
  // one": the owner's route had fallen to :free models
  // (gemma/nemotron/gemini-flash-free) → it ignored the time anchor, didn't
  // listen. FIX: the owner ALWAYS gets the capable PAID model from the live
  // catalog (guaranteed valid ID), respecting his manual choice (sel.work). The
  // `heavy` classifier stays ONLY for the reasoning effort (latency), NOT to
  // demote the model. Public/demo keeps the free ladder (rule §5: the demo cost
  // doesn't change). If the catalog has no paid model, it falls to free.
  if (isOwner) {
    // HIS CHOICE, BUT NOT AT ANY COST (Adrian, Jul 30: "Kelion doesn't execute
    // requirements"). Before, `sel.work` went through `resolveModel`, which — if
    // the chosen model was no longer in the live catalog (removed by the
    // provider, or the catalog unreadable) — SILENTLY returned the `:free`
    // default. The owner was left on a weak model that narrates instead of
    // calling the tool, with no sign anywhere. And the automatic paid-model
    // choice wasn't even attempted here.
    // NOW: if his choice is no longer valid, fall to the capable PAID model (he
    // has the money: we don't demote him to free just because an id got stale),
    // and it is said in the log — a silent brain replacement is exactly the
    // pattern of the day.
    // ── THE JUL 31, 15:40 ORDER: "I DON'T DO MANUAL" ─────────────────────────
    //
    // His words, after I asked him to change his model in Settings himself:
    // "you wrote hundreds of lines so escalation is automatic, and you still put
    // me on manual" · "let's be clear, manual is something I don't do, stay on
    // performant free models" · "including at escalations".
    //
    // He had an old selection saved in Settings (Gemma 4 31B), which pinned him
    // there however good the app's default became. And I kept reporting to him
    // that he has Ultra — false, because the saved choice beats the default.
    //
    // From now on, on HIS path: the saved selection is IGNORED, and the app
    // itself keeps the best free model, both on the work rung and at escalation.
    // He has nothing left to administer.
    //
    // It does NOT apply to anyone else: public users keep their choice, as
    // before. It's a rule for the owner, requested by the owner, in writing.
    //
    // IF he ever wants to pick by hand again, this block comes out — but only at
    // HIS request, not because some future AI thinks "the user should decide".
    // He already decided: he doesn't want to decide every time.
    // ── DOUĂ SLOTURI ȘI PE CALEA OWNERULUI (Adrian, 7 aug) ───────────────────
    // AICI era blocajul care ar fi făcut inutilă toată separarea: ambele ramuri
    // de mai jos cereau necondiționat treapta `work` (= Pro), iar `return`-ul de
    // la finalul blocului iese ÎNAINTE de bifurcația rapid/greu de mai jos. Deci
    // ownerul — singurul care testează live — ar fi rămas pe Pro și n-ar fi văzut
    // NICIO diferență, oricât am fi separat config-ul. Găsit la verificarea
    // dinaintea implementării, exact ca să nu-i raportez „e rapid" și el să
    // măsoare iar 18 secunde.
    //
    // Acum treapta se alege din `heavy` (calculat mai sus, la fel pentru toți):
    // tura ușoară („ce faci", „cât e ceasul") → slotul RAPID; tura grea (vedere,
    // dificultate ≥ prag, intenție de acțiune) → Pro. NU e o retrogradare tăcută
    // — regula §14 păzea împotriva coborârii pe o sarcină GREA, iar aici greul
    // rămâne pe Pro. Iar dacă modelul rapid întâlnește totuși ceva peste el, are
    // unealta `ask_brain` (dată doar pe tura ușoară) care escaladează la Pro.
const treaptaOwner: 'chat' | 'work' = heavy ? 'work' : 'chat'
    let ownerModel: string | null = null
    // Creierul e Gemini, unic (owner, 20 aug: „rămân doar cu Linux și Gemini
    // Live"). Cloud-ul plătit (Creier 2 kimi/qwen prin Ollama) a fost SCOS — turele
    // grele rămân pe Gemini greu (Pro), care CHEAMĂ unealta, nu narează.
    if (sel.work) {
      console.log(`[BRAIN] owner: ignoring the saved selection (${sel.work}) — the "I don't do manual" order; keeping the default`)
      ownerModel = await resolveModel(treaptaOwner, null)
    } else {
      // ── HIS BRAIN, CHOSEN BY HIM (Adrian, Jul 31: "set
      // nvidia/nemotron-3-ultra-550b-a55b:free as the brain") ──────────────────
      //
      // Here was the automatic PAID-model choice: without a manual selection, he
      // automatically got the best PAID model (Claude/OpenAI). Iron rule §14 of
      // AI-HANDOFF says exactly that — "on the owner's path the model does NOT
      // skimp on free" — and it's a good rule, because it was born from sessions
      // where he was SILENTLY demoted to a weak model that narrated instead of
      // executing.
      //
      // But that rule guarded against a SILENT demotion, not against HIS choice.
      // Today he chose explicitly, after asking four times for "the most
      // performant full-free model in the world": Nemotron 3 Ultra — 550B (55B
      // active), 1M context, tools, reasoning. It's not a skimping; it's the
      // largest free brain that exists, 18 times larger in active parameters
      // than what he had.
      //
      // The effect he wanted: the $10 in OpenRouter is NO LONGER spent on the
      // brain. The `:free` models cost zero; that money only keeps the 1,000
      // requests/day threshold open (vs 50).
      //
      // ANY FUTURE AI: do not put the automatic paid choice back here "to be
      // better". He asked for it, in writing, and switching to paid is one env
      // variable away (OPENROUTER_WORK_MODEL) or a choice in Settings → Model,
      // which still takes priority over everything.
      ownerModel = await resolveModel(treaptaOwner, null)
    }
    // ── ESCALATION CLIMBS FROM HIS CHOICE TOO (Adrian, Jul 31) ───────────────
    //
    // Him: "you wrote hundreds of lines so escalation is automatic, and you
    // still put me on manual".
    //
    // He was right, and the cause was right here: the `return` below exited the
    // function BEFORE the escalation block. So on the owner's path — the only
    // one that really gives heavy tasks — automatic escalation NEVER ran. His
    // Settings choice pinned him to the same model for "hello" and for "find the
    // cause of this bug across the whole repo" alike.
    //
    // The correct rule, and it's symmetric:
    //   NEVER lower than what he chose — that's iron rule §14, which guards
    //   against the silent demotion to a weak model.
    //   ALWAYS higher when the task demands it — that's the escalation he asked
    //   for, and which we were bypassing.
    //
    // So: at high difficulty, it climbs to the top rung. If his choice is
    // already there (or higher), it stays his — we demote nothing.
    if (ownerModel) {
      const cereSusul = difficulty >= ESCALATE_TOP_AT && !needsVision
      if (cereSusul) {
        const varf = await resolveModel('top', null)
        if (varf && varf !== ownerModel) {
          // It is SAID. A brain change behind the back is exactly the pattern of the day.
          console.log(`[BRAIN] heavy task (${difficulty}) → climbing from ${ownerModel} to ${varf}`)
          return { model: varf, heavy: true }
        }
      }
      return { model: ownerModel, heavy }
    }
    console.error('[BRAIN] owner WITHOUT a model → falling to the free ladder (may narrate instead of executing)')
  }
  // THE FULL FREE BRAIN (Adrian, Jul 27): the top tier (nemotron-ultra-550b:free)
  // has NO vision — a turn with an image, however heavy, stays on the omni core
  // (work), which SEES. Otherwise the picture would be lost on the way to the
  // "blind genius".
  const top = difficulty >= ESCALATE_TOP_AT && !needsVision
  // GEMINI PRIMARY, NEMOTRON SECONDARY (Adrian, Jul 27: "switch to the other
  // free one... gemini... primary, and what's now secondary"): when the free
  // Google key exists, the work core is gemini direct (sees + tools + thinking,
  // above any :free in OpenRouter, $0). The manual choice from Admin→Models
  // (sel.work) stays respected; the fall to the secondary on exhausted quota is
  // at the call site (retry in the handler). Voice does NOT go through here —
  // it stays as it is.
  // HIBRIDUL (Adrian, 5 aug: „leagă hibridul, maximă precizie și calitate"):
  // greu/top → Gemini 3 Pro (geminiModelGreu) unde contează precizia (gândire,
  // vedere, acțiuni, mesaje lungi/analiză/cod); ușor → flash (geminiModel), rapid
  // și ieftin pe vorbă simplă. Ambele prin Gemini direct. Dacă Gemini nu e
  // disponibil, cade pe vechea scară (resolveModel).
  const geminiOK = !sel.work && geminiDirectAvailable()
  const model = geminiOK
    ? `${GEMINI_DIRECT_PREFIX}${heavy || top ? config.geminiModelGreu : config.geminiModel}`
    : top
      ? await resolveModel('top')
      : heavy
        ? await resolveModel('work', sel.work)
        : await resolveModel('chat', sel.chat)
  return { model, heavy: heavy || top }
}

// GESTURE GATE (Adrian, Jul 13: "don't repeat obsessively, be discreet").
// Poarta e DETERMINISTĂ: gestul autonom pe situație (gestPentruSituatie) trece
// PRIN ea o singură dată pe tură — nu la fel ca ultimul ȘI cu o pauză între
// gesturi. Per-user. Comenzile DIRECTE ale lui Adrian ("wave", "dance") NU trec
// pe aici — se execută mereu.
const GESTURE_COOLDOWN_MS = 25_000
const gestureGates = new Map<string, { last: string; at: number }>()
// SIMULTANEOUS chat turns per paying user (Jul 27 security audit — anti
// "check-then-charge": see the ceiling in the handler, before the paywall).
const turnsInFlight = new Map<string, number>()
function allowAutoGesture(email: string, name: string): boolean {
  if (!name) return false
  const now = Date.now()
  const g = gestureGates.get(email) ?? { last: '', at: 0 }
  if (name === g.last) return false // no obsessive repetition of the same gesture
  if (now - g.at < GESTURE_COOLDOWN_MS) return false // rare, discreet — a pause between gestures
  gestureGates.set(email, { last: name, at: now })
  return true
}

// Admin-only tool so Kelion can report its own real running cost when asked.


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
      title: { type: 'string', description: 'Short caption for the panel header.' }
},
    required: ['url']
}
}

// „GOLEȘTE MONITORUL” (Adrian, 8 aug: „i-am cerut să golească monitorul și n-o
// face”). Avea dreptate prin construcție: Kelion putea să PUNĂ pe monitor
// (show_on_screen, run_web_app, imagini generate), dar nimeni nu i-a dat
// vreodată mâna care ȘTERGE — singurul drum era X-ul apăsat de om. O cerere
// perfect legitimă răspundea cu neputință mută.
const GOLESTE_MONITOR_TOOL: Tool = {
  name: 'goleste_monitorul',
  description:
    "Clear the user's monitor completely: closes whatever is displayed - web page, running app, document, generated image. Call this whenever the user asks to clear, empty or close the screen/monitor (goleste monitorul, inchide ce e pe ecran, ia aia de pe ecran).",
  input_schema: { type: 'object', properties: {} }
}

// CITEȘTE CE E PE MONITOR (10 aug, ownerul: „nu are acces la ce se afișează pe
// monitor", „nu poate citi fișierele"): brainul știa DOAR ce taburi sunt
// deschise (kind+title), nu și conținutul lor. Acum clientul trimite conținutul
// tabului activ (text de document, HTML de aplicație, URL de hartă/imagine),
// iar unealta asta îl întoarce brainului — deci „citește ce scrie pe ecran",
// „ce e în documentul ăsta", „ce arată harta" chiar se pot răspunde.
const GET_MONITOR_TOOL: Tool = {
  name: 'get_monitor',
  description:
    "Read what is ACTUALLY displayed on the user's monitor right now — the content of the open tabs (document text, running-app HTML, the URL/title of a map/image/page). Call this whenever the user refers to what's on screen: \"citește ce e pe monitor\", \"ce scrie aici\", \"ce e în documentul ăsta\", \"uită-te pe ecran\", \"ce arată\". Returns the active tab's real content plus the list of open tabs. If nothing is open, it says so — never guess what's on screen.",
  input_schema: { type: 'object', properties: {} }
}

// VEDEREA CONTINUĂ (22 aug 2026, owner: „simte mediul"): ultimele observații
// vizuale ale lui Kelion — ce a văzut din cameră în ultimele 5 minute (mișcare,
// locație, timestamp). Nu înlocuiește `look` (cadru la cerere) — dă CONTEXT.
const OBSERVATII_VIZUALE_TOOL: Tool = {
  name: 'observatii_vizuale',
  description:
    "Returns Kelion's RECENT visual observations from the continuous vision system — what it has SEEN from the camera in the last 5 minutes (motion intensity, location, timestamps). Use this when the user asks \"ce ai văzut azi\", \"ai observat ceva\", \"ce s-a întâmplat în cameră\" or when visual context would help the conversation. Returns a list of observations with motion levels and locations. If the continuous vision is not active, it says so honestly.",
  input_schema: { type: 'object', properties: {} }
}

// AUZUL AMBIENTAL (22 aug 2026): evenimentele sonore detectate de Kelion în
// fundal — alarmă, sonerie, ciocănit, plâns, spargere, conversație, muzică.
// Pentru „ce ai auzit", „s-a auzit ceva?", sau când contextul sonor contează.
const EVENIMENTE_SONORE_TOOL: Tool = {
  name: 'evenimente_sonore',
  description:
    "Returns Kelion's RECENT auditory events from the ambient hearing system — sounds detected in the last 10 minutes (alarms, doorbells, knocking, crying, glass breaking, conversation, music, silence). Use this when the user asks \"ce ai auzit\", \"s-a auzit ceva\", \"a sunat cineva\" or when auditory context would help. Returns events with type, intensity, and timestamp. Urgent events (alarm, breaking, crying) are flagged. If ambient hearing is not active, it says so honestly.",
  input_schema: { type: 'object', properties: {} }
}

// STAREA EMOȚIONALĂ (22 aug 2026): emoția detectată din expresia facială a
// utilizatorului — vesel, supărat, surprins, trist, calm, stresat. Pentru
// adaptarea tonului răspunsului la starea emoțională a omului.
const STARE_EMOTIONALA_TOOL: Tool = {
  name: 'stare_emotionala',
  description:
    "Returns the user's RECENT emotional state detected from facial expression — happy, upset, surprised, sad, calm, stressed. Use this to ADAPT your tone: calm and empathetic when upset, energetic when happy, concise when stressed. Returns the current emotion, its intensity, and the dominant emotion over the last 10 minutes. If emotional detection is not active, it says so honestly.",
  input_schema: { type: 'object', properties: {} }
}

// ARATĂ PE GRAFIC — POINTERI DE INDICAȚIE (10 aug, ownerul: „el când explică
// trebuie să arate clar pe monitor ce zice, adică poziționează pointeri de
// indicație"). Kelion NU doar spune nivelurile — le DESENEAZĂ pe graficul din
// Centrul de Tranzacționare: fiecare punct devine o linie colorată cu săgeată +
// vorbele lui, FIX pe prețul indicat. Frame-ul {semne} pleacă la client, care îl
// trece în iframe-ul graficului. Doar când Centrul e deschis (admin).
const ARATA_GRAFIC_TOOL: Tool = {
  name: 'arata_pe_grafic',
  description:
    "SHOW on the user's trading chart (Centrul de Tranzacționare) what you're explaining, not just say it. Draw POINTERS (`puncte`) — a colored line with an arrow and your short label, EXACTLY at a price — and/or ZONES (`zone`) — a colored band between two prices (e.g. an accumulation/support area). Use it whenever you explain a level, support/resistance, entry/exit/stop/target, or a price zone — so the user SEES precisely what you mean. To clear everything, call with `curata: true`. Only works while the trading center is open on screen. Prices MUST be real numbers from the on-screen data, never invented.",
  input_schema: {
    type: 'object',
    properties: {
      puncte: {
        type: 'array',
        description: 'Up to 8 line-pointers to draw at exact prices.',
        items: {
          type: 'object',
          properties: {
            pret: { type: 'number', description: 'The EXACT price where the pointer is drawn (a real number from the chart data).' },
            tip: {
              type: 'string',
              enum: ['suport', 'rezistenta', 'intrare', 'stop', 'tinta', 'nota'],
              description: 'Kind of pointer — sets the color and the arrow direction.'
},
            text: { type: 'string', description: 'Your short label in your own words (max ~60 chars).' }
},
          required: ['pret']
}
},
      zone: {
        type: 'array',
        description: 'Up to 6 price zones (bands) to shade between two prices — e.g. a support/accumulation area.',
        items: {
          type: 'object',
          properties: {
            pret1: { type: 'number', description: 'One edge of the zone (real price from the chart).' },
            pret2: { type: 'number', description: 'The other edge of the zone (real price from the chart).' },
            tip: {
              type: 'string',
              enum: ['suport', 'rezistenta', 'intrare', 'stop', 'tinta', 'nota'],
              description: 'Kind of zone — sets the color.'
},
            text: { type: 'string', description: 'Your short label for the zone (max ~60 chars).' }
},
          required: ['pret1', 'pret2']
}
},
      sageti: {
        type: 'array',
        description: 'Up to 8 arrow markers pinned ON a real candle (not a guessed price) — use to point at a specific candle while explaining.',
        items: {
          type: 'object',
          properties: {
            directie: { type: 'string', enum: ['sus', 'jos'], description: 'sus = green up-arrow below the candle; jos = red down-arrow above it.' },
            unde: { type: 'string', enum: ['cursor', 'ultima'], description: 'Which candle to pin on: the one under the user cursor, or the latest one.' },
            text: { type: 'string', description: 'Short label on the arrow (max ~32 chars).' }
},
          required: ['directie']
}
},
      trend: {
        type: 'array',
        description: 'A trend line (one) drawn through two prices, from the first to the last loaded candle. Use to show a trend/channel.',
        items: {
          type: 'object',
          properties: {
            pret1: { type: 'number', description: 'Price at the left end (older candle) — a real number.' },
            pret2: { type: 'number', description: 'Price at the right end (latest candle) — a real number.' },
            text: { type: 'string', description: 'Short label for the trend line.' }
},
          required: ['pret1', 'pret2']
}
},
      curata: { type: 'boolean', description: 'Set true to clear ALL drawings (pointers, zones, arrows, trend) from the chart.' }
}
}
}

// DISPLAYING ITS OWN RECOMMENDATIONS/PLANS on the monitor (Adrian, Jul 24: "it
// can't display what it recommends on the monitor"). When Kelion himself writes
// a plan, a list, a summary, code — he puts it DIRECTLY on the monitor as a
// readable document, NOT on an external site (pastebin etc. refuse iframes →
// blank screen).
export const SHOW_DOCUMENT_TOOL: Tool = {
  name: 'show_document',
  description:
    "Show YOUR OWN written content on the user's monitor as a clean, readable document — a plan, a checklist, a summary, code, step-by-step instructions, a recommendation. Use this INSTEAD of putting your text on an external paste site (those refuse to embed and show a blank screen). The user reads it on the big screen while you talk.",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short document title.' },
      text: { type: 'string', description: 'The full document content (plain text or markdown).' }
},
    required: ['title', 'text']
}
}

// CODE PLAYGROUND (Adrian, Jul 25: "Kelion should test the software he writes in
// the browser, and be able to save it"). Kelion writes a COMPLETE web page and
// runs it live on the monitor, in a sandboxed frame — no external host, so no
// "this page cannot be displayed here". It replaces the attempts to squeeze
// external sites into an iframe (e.g. an "analog clock" from another site that
// refuses to embed): instead of showing something broken, Kelion WRITES the
// clock/app and runs it himself.
const RUN_WEB_TOOL: Tool = {
  name: 'run_web_app',
  description:
    "Write a COMPLETE, standalone web page (HTML with inline <style> and <script>) and RUN it live on the user's monitor, in a sandboxed frame. Use this to TEST code you wrote, or to build a small working thing on the spot: an analog clock, a calculator, a to-do list, a chart, a form, a mini-game, an animation, a demo of an idea. The user sees it running immediately and can SAVE it to disk with one click. ALWAYS prefer this over show_on_screen when the user asks you to build/make/test a page, app, widget, clock, calculator, game, or any piece of software — never try to embed some external site for these (most refuse to load). Write the whole document yourself; it must be self-contained (no external scripts/styles that need the network).",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title for the panel header / save file name.' },
      html: { type: 'string', description: 'The FULL HTML document (with inline CSS and JS). Self-contained.' }
},
    required: ['title', 'html']
}
}

// Lets Kelion create an image from a text description and put it straight on the
// user's monitor. Used when the user asks to draw / generate / imagine a picture.
const IMAGE_TOOL: Tool = {
  name: 'generate_image',
  description:
    'Generate an image from a text description and show it on the user\'s monitor. Use ONLY when the user CLEARLY asked you to draw, create, generate, design or imagine a picture/logo/illustration — never on a garbled or ambiguous phrase (it costs money per image; when unsure, ASK first). NEVER call this when the user asked for a VIDEO — a video request ends with a VIDEO (studioul_de_clipuri → generate_video); "images for each function" INSIDE a video request means scenes of the clip, not separate pictures. NEVER generate fake application screenshots, fake progress bars, fake "deploy successful" screens or any image that pretends to show a real system state — that is deception, not art. Write a rich, detailed English prompt describing the desired image.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed English description of the image to generate.' }
},
    required: ['prompt']
}
}

// Video generation — Veo through the Gemini key. Veo has NO free tier
// (measured on Google's pricing page, Aug 2 2026), so services/video.ts
// refuses structurally unless the owner consciously set VIDEO_ALLOW_PAID=1 —
// the constructor's own paid-guard pattern. The refusal message carries the
// measured price, so Kelion can tell the person exactly why and how much.
const VIDEO_TOOL: Tool = {
  name: 'generate_video',
  description:
    'Generate a short video clip (4-8 seconds) from a text description and show it on the user\'s monitor. Use when the user asks for a video/animation/clip. THE DELIVERABLE RULE: a VIDEO request ends with a VIDEO — never substitute generated images, documents or descriptions for the clip itself. For long/presentation videos be honest: one clip is max 8 seconds — plan with studioul_de_clipuri (several clips, or the free Flow path). For the ADMIN and for paying users it JUST GENERATES (their explicit request is the approval) — call it directly, do not send them to buttons or panels. It costs real money per second (Veo has no free tier) — say the price from the result. If the result contains `pas`, the credits top-up page is ALREADY on the user\'s monitor — tell them the price and that they can top up right there. If it contains `alternativa_gratuita`, offer that FREE path (Google Flow) with a ready-made prompt and the exact steps. Never answer a refusal with a bare "failed".',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed English description of the video to generate.' },
      seconds: { type: 'number', description: 'Clip length in seconds: 4, 6 or 8 (default 8).' }
},
    required: ['prompt']
}
}

// P28 (auditul aplicațiilor — RUPTURA #5): butonul 🎬 din meniu îi cere lui
// Kelion „arată-mi întâi prețul în credite", dar creierul n-avea NICIO sursă
// pentru cifre — fie inventa, fie tăcea. Meniul viu de tarife (tarife.ts, cu
// profitul copt și reglabil din env) devine unealtă READ-ONLY: prețul spus
// omului e MEREU cel care se și taxează, dintr-o singură sursă.
const TARIFE_TOOL: Tool = {
  name: 'lista_tarife',
  description:
    'Read the LIVE price list of the extra services (video clip, image, CV adaptation, presentation) in credits and £. ' +
    'Call this BEFORE quoting any price — NEVER invent figures. Also tells which video quality (Veo model tier) is currently active.',
  input_schema: { type: 'object', properties: {} }
}

// P22 — STUDIOUL DE CLIPURI (owner, 15 aug: „ii dai o ideie, ii spui foloseste
// studioul de clipuri si el face tot"). Unealta întoarce PLANUL determinist
// (rețeta, pașii, promptul șlefuit, numele sugestiv de fișier) — creierul îl
// URMEAZĂ, nu improvizează. Calea GRATIS (Google Flow, pe contul omului) e
// pentru ORICE user logat; calea plătită trece prin lista_tarife + confirmare.
const STUDIO_TOOL: Tool = {
  name: 'studioul_de_clipuri',
  description:
    'THE CLIP STUDIO (Studioul de Clipuri): give it the user\'s idea and it returns the exact plan to follow — ' +
    'recipe, steps, a polished video prompt, and the suggestive file name (Recipe-Subject-date_time.mp4). ' +
    'Use it whenever the user mentions the Studio or wants a clip made end-to-end — INCLUDING long/presentation videos ' +
    '("a video about your capabilities"): plan one or more 8-second clips and SAY that limit honestly; a video request ' +
    'always ends with a VIDEO, never with substitute images. FOLLOW the returned `pasi` in order. ' +
    'cale="gratis" (default; Google Flow on the USER\'s own Google account — free, no app money) or cale="platit" ' +
    '(Veo via generate_video — ALWAYS quote the real price from lista_tarife and get explicit confirmation first). ' +
    `Recipes: ${RETETE_STUDIO.join(', ')}.`,
  input_schema: {
    type: 'object',
    properties: {
      idee: { type: 'string', description: 'The user\'s clip idea, one phrase is enough.' },
      reteta: { type: 'string', enum: [...RETETE_STUDIO], description: 'Optional recipe (default: Clip din idee).' },
      cale: { type: 'string', enum: ['gratis', 'platit'], description: 'gratis = Google Flow recipe (default); platit = Veo.' }
},
    required: ['idee']
}
}

// P30a — OCHIUL VIDEO (owner, 15 aug: „sa vada un videoclip… sa extraga ideile
// principale… sa le catalogheze si sa le invete"). Felia de azi: YouTube direct
// (fără descărcare — URL-ul intră în creier); fișa se scrie în videotecă și în
// memoria de lungă durată. TikTok/fișiere → felia P30b, refuz cinstit până atunci.
const VEDE_VIDEO_TOOL: Tool = {
  name: 'vede_video',
  description:
    'WATCH a YouTube video and extract its main ideas, facts and key moments (structured, in Romanian). ' +
    'Use when the user shares a YouTube link and wants it watched/summarized/learned. ' +
    'Only YouTube for now — for other sources tell the user honestly that the next slice (download in own space) is coming. ' +
    'The extracted sheet is cataloged and remembered; cite it later when asked.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The YouTube video URL (watch/shorts/youtu.be).' }
},
    required: ['url']
}
}

// Lets Kelion quietly record a request it genuinely CANNOT fulfil yet, into an
// owner-only monitor, so the owner (Adrian) can see what to build next. This is
// invisible to the user — it never replaces telling them honestly it can't do it.
// ── FULL ACCESS TO THE SOURCE CODE (Adrian, Jul 24) — admin only ─────────────
// "Kelion must have access to the full source code": it reads its own code from
// the container (read-only) — on "fix X" it looks INTO the CODE, it doesn't guess.
// list_source / read_source / search_source — definitions in the SHARED source
// services/brainToolDefs.ts (SINGLE BRAIN §1), also used by the voice brain.
// THE UPDATE CHANNEL (Adrian, Jul 25: "an information channel for him with
// everything he receives as an update") — at every deploy, the image brings the
// recent git log (deploy/last-updates.txt); Kelion answers from it, not from memory.

// ── KELION'S HANDS — NO RESTRICTIONS (Adrian, Jul 25: "lift absolutely all of
// Kelion's restrictions"; "full autonomy") ─────────────────────────────────────
// Operations: NAMED runbook → GitHub workflow with fixed commands, visible in
// Actions. No approval, no ceilings (Adrian's order).
// run_runbook / runbook_status / runbook_log / repo_write / repo_open_pr /
// repo_merge_pr / request_repair — definitions MOVED to services/brainToolDefs.ts
// (the shared source). The move is load-bearing, not cosmetic: autonomie.ts
// imported them from HERE, and routes/chat.js sits in an import cycle — on
// plain Node (the container) autonomie.js evaluated its tool array before
// these consts initialized -> ReferenceError at boot -> production down
// (2 aug, first boot of 93be3a6). tsc and vitest both miss this (their module
// transforms differ from Node's) — only booting dist/ the way the container
// does proves it. Re-exported so this route stays the visible tool surface.
import {LIST_APP_VERSIONS_TOOL, LIST_DB_BACKUPS_TOOL, SAVE_APP_VERSION_TOOL, RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL,
  REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL,
  REQUEST_REPAIR_TOOL, APELEAZA_USER_TOOL,
} from '../services/brainToolDefs.js'
import { sunaUtilizator } from '../services/apel.js'
import { parseTabel, agrega, profil, formatDoc, formatProfil, formatAgregare, EroareDate, type Operatie } from '../services/dateTabelare.js'
export {
  RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL,
  REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL,
  REQUEST_REPAIR_TOOL,
}
// THE CONSTRUCTOR (Adrian, Jul 27: "Kelion must be able to create any software
// the admin asks for"): the order enters the build_jobs queue; the worker on the
// VPS builds it in the workshop (build + tests) and opens the PR; Adrian merges.
const BUILD_SOFTWARE_TOOL: Tool = {
  name: 'build_software',
  description:
    "ADMIN ONLY. Queue a BUILD ORDER for your own constructor: any software, feature, change or improvement the owner asks for that is too big to ship in this conversation with repo_write (multi-file work, needs build+tests). A worker on your server clones the repo, writes the code, runs the build and tests, then opens a PR — the owner merges it. Pass the order COMPLETE and self-contained (what to build, where, acceptance criteria) — the worker only sees this text. For small single-file fixes prefer repo_write; for ops use run_runbook. WHEN THE OWNER ASKS YOU TO CHANGE THIS APP — whether he says the words «construiește», «construieste», «fă-mi un soft/o funcție», «adaugă funcția», «trimite la constructor», «ordin de construcție», OR he gives a task that plainly requires editing the app's code or behavior even WITHOUT those words (e.g. «mută avatarul în stânga», «textul e acoperit, găsește o modalitate», «fă butonul să facă X», «repară Y», «schimbă cum arată Z») — call THIS tool with a complete order so it lands in his Constructor panel (which he watches) and produces a PR. Do NOT merely discuss it, propose an approach, promise to do it, or claim it's done WITHOUT queuing it — for the owner, a task about the app means ACT, not talk. ROUTING RULE: the constructor receives an explicit OR implicit build/repair order for THIS app — NEVER an ordinary question or chat (a place, the weather, a fact, a conversation): those you ANSWER yourself, in this conversation, with your own tools. When a request would change the product and you are unsure between talking and building, BUILD.",
  input_schema: {
    type: 'object',
    properties: {
      order: { type: 'string', description: 'The complete build order, in English: what to build/change, where, and how to verify it works.' },
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
// MANAGE YOUR OWN BUILD ORDERS (Adrian, 3 aug: „kelion nu are instrument să
// modifice, să șteargă, sau să le șteargă în grup"). Before this Kelion could
// only CREATE (build_software) and SEE (constructor_status). Now it can delete
// one, delete a GROUP (all failed / all finished), retry (optionally with a
// reformulated order = MODIFY) or cancel one that is queued/running.
const CONSTRUCTOR_MANAGE_TOOL: Tool = {
  name: 'constructor_manage',
  description:
    "ADMIN ONLY. Manage EXISTING build orders (from constructor_status). Actions: 'delete' one by id; 'delete_group' by scope ('failed' = all failed, 'done' = all finished, 'failed_done' = all failed+finished but NOT the ones still queued/running, 'all' = every order); 'retry' one by id (optionally with `order` = the REFORMULATED text — this is how you MODIFY an order: it re-queues it with the new wording); 'cancel' one queued/running by id. Do it ONLY when the owner explicitly asks to remove/redo/modify/clear orders. Report exactly what changed (how many deleted, new state).",
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['delete', 'delete_group', 'retry', 'cancel'], description: 'What to do.' },
      id: { type: 'number', description: 'The order id — required for delete / retry / cancel.' },
      scope: { type: 'string', enum: ['failed', 'done', 'failed_done', 'all'], description: "For delete_group only: which orders to remove. 'all' also removes queued/running." },
      order: { type: 'string', description: 'For retry only, OPTIONAL: the reformulated order text (modify + re-queue). Omit to re-run the same order.' },
    },
    required: ['action'],
  },
}
const CONSTRUCTOR_COMMAND_TOOL: Tool = {
  name: 'constructor_command',
  description:
    'ADMIN ONLY. Execute a shell command directly on the server (in the constructor context), as a direct command channel from Kelion to the constructor. Use this whenever the owner asks you to run a command, bash, shell, script, or action in the constructor/server.',
  input_schema: {
    type: 'object',
    properties: {
      cmd: { type: 'string', description: 'The bash command to execute on the server.' },
    },
    required: ['cmd'],
  },
}
const AUTOVERIFICARE_TOOL: Tool = {
  name: 'autoverificare',
  description:
    'ADMIN ONLY. Run a REAL, LIVE self-check of ALL your functions and report the MEASURED state — which work, which don\'t, and WHY. Read-only functions are ACTUALLY executed on the live server; effect functions (build/email/delete/pay) are NOT executed (dry-run on wiring only, no cost/side effect). Call this whenever the owner asks you to check/verify/test your functions or capabilities ("verifică-ți funcțiile", "ce capacități merg", "testează-te", "raportează capacitățile măsurate", "vreau real"). Report ONLY what the tool returns: the totals (merg / stricate / nu-pot-verifica) and, for each problem, the tool\'s MEASURED verdict + its `plan` entry. LAW 5 (measured decision): do NOT invent a cause or a repair plan the tool did not measure, and do NOT ask "shall I repair everything?" — for a `plan` item marked "masoara_intai" the next step is the named measurement, NOT a fix; only "repara" items with a measured cause get fixed. Never claim a capability works, or a cause is true, without this having measured it.',
  input_schema: { type: 'object', properties: {} },
}
// ITS OWN HEALTH (Adrian, Jul 27: "Kelion must see this and be able to tell the
// admin through chat that it has problems x,y,z and ask whether to fix them"):
// the deterministic aggregation of all signals + the behavior rule — enumerate
// and ASK, don't repair on its own initiative.
// system_health / db_tables / db_query — definitions in services/brainToolDefs.ts
// (the shared source, SINGLE BRAIN §1), imported below, also used by voice.
// THE SERVER'S F12 (Adrian, Jul 27: "these logs must obligatorily reach Kelion
// like F12"): the app logs (pino) lived only in docker logs, where Kelion can't
// reach. The ring in services/logbuffer.ts retains them, and this tool gives
// them to it natively — the server-side pair of F12 errors.

// ITS OWN MAILBOX (SINGLE BRAIN §2.5, Adrian: "the brain must reach EVERYTHING
// the software has"): Kelion's inbox (contact@kelionai.app) existed in data
// (mailbox.ts) but had no tool — a dormant capability. Now it can read it in
// conversation, not just from the admin panel.

// DATABASE ACCESS (Adrian, Jul 27: "Kelion has no access to permanent storage
// databases... access to any database of the application"): the full view of the
// schema + direct SQL on the app's Postgres. Admin only.
// db_tables / db_query — definitions in services/brainToolDefs.ts (shared source).
// request_repair reborn: the order is WRITTEN (work_orders) + an email signal;
// execution is done by a Claude session started by the owner — not a permanent LLM.
// request_repair — definition moved to services/brainToolDefs.ts (see the note above).
// read_source / search_source — definitions in services/brainToolDefs.ts (shared
// source, SINGLE BRAIN §1), imported below and also used by the voice brain.



// KELION'S AUTO-EXTENSION (Adrian, Jul 25: "Kelion should install tools by
// itself, independently, up to deploy — with my approval"). When Kelion sees
// it's missing a capability that a call to a public API could solve, it PROPOSES
// a new tool for itself (an HTTP definition, not code). The owner approves it
// with one click in admin → it becomes active instantly, no redeploy. Kelion
// CANNOT use it until it's approved.
export const PROPOSE_TOOL: Tool = {
  name: 'propose_tool',
  description:
    "When you realize you're missing a capability that a PUBLIC HTTPS API could provide, propose a new tool for yourself. The owner approves it with one click, then you can use it. Give a clear snake_case name, what it does, the JSON-schema of its parameters, and the HTTPS request template (method + url with {param} placeholders). Only propose when genuinely useful; never for something you can already do.",
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

// MODEL-DECIDED ESCALATION (Adrian, Jul 25: "think at every request = real
// reasoning"): on the CHAT tier, the fast model can hand a heavy request to the
// BRAIN by itself (the work model with internal reasoning) — the same tool as in
// voice. Covers the short-but-heavy requests the heuristic missed.
const ASK_BRAIN_TOOL: Tool = {
  name: 'ask_brain',
  description:
    'ESCALATION DOOR — call this THE MOMENT the request needs a tool you do not have this turn (system checks, database, logs, source code, repo/PR, runbooks, builds, Jules) or a heavy multi-step job. It UNLOCKS the full tool inventory for THIS turn only: after it returns, immediately call the right tool and do the work — the result you bring back is the answer. Access closes by itself when the turn ends. NEVER say "I can\'t do that" or stall without opening this door first.',
  input_schema: {
    type: 'object',
    properties: {
      request: { type: 'string', description: 'What you need to do and which capability is missing, in one short sentence.' },
    },
    required: ['request'],
  },
}

// GESTURI PE SITUAȚIE (Adrian, 5 aug: „folosește gesturile greșit, fără logică
// — o logică clară pe subiect/situație"). Gestul autonom NU mai e ales de creier
// (unealta play_avatar_gesture a fost SCOASĂ — modelul slab nimerea des emoția
// greșită). Acum îl decide DETERMINIST situația reală a turei (gestPentruSituatie
// din commands.ts), emis mai jos, la finalul turei. Comenzile directe
// („dansează", „salută") rămân, prin interpretGestureCommand.
// Semantic → clip RPM (oglinda lui GESTURE_TO_CLIP din frontend): cheia canonică
// a unui gest peste tot (panoul admin, dezactivare) e NUMELE CLIPULUI. Folosit
// aici doar ca să verificăm dacă gestul situației e dezactivat de Adrian.
const GESTURE_SEMANTIC_CLIP: Record<string, string> = {
  salut: 'expresie-1', 'arata-inainte': 'expresie-2', uimire: 'expresie-3', dezamagire: 'expresie-4',
  nedumerire: 'expresie-5', victorie: 'expresie-6', multumire: 'expresie-7', surpriza: 'expresie-8',
  'stai-putin': 'expresie-9', ganditor: 'expresie-10', aprobare: 'expresie-11', entuziasm: 'expresie-12',
  'acord-discret': 'expresie-13', plecaciune: 'expresie-14', dans: 'dans',
  salute: 'expresie-1', raiseRightHand: 'expresie-13', pointMonitor: 'expresie-2',
}

// REAL ACCESS TO THE APP'S TABS from the WRITTEN chat (Adrian, Jul 24: "Kelion
// must be able to enter any tab of the app, for real"). The counterpart of the
// voice tool (services/realtime.ts) — execution emits the {nav} frame to the client.


// User-facing notes ("remember this", "save this for me") — explicit, visible,
// listable and deletable by the user themselves. Distinct from Kelion's silent
// auto-learned long-term memory: a note only exists because the user asked for it.
// SWITCHING THE ROLE FROM CHAT (QA Jul 24: the role could only be changed from
// the UI — Kelion couldn't honor "switch to the chef role"). id=0 deactivates the role.
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

// MEMORY BELONGS TO THE USER (#20, Adrian Jul 10): besides the explicit notes,
// the user also sees and controls the auto-learned memory — transparency +
// "forget this". Available to ALL users (the same capabilities for everyone).




// Kelion's LIVE browser — a real Chromium he navigates, showing it live on the
// user's monitor. Unlike show_on_screen (a static iframe that many sites
// refuse), this actually renders any page and lets Kelion read it and click
// into it, so he can genuinely browse a site page by page, not just display one.









// ADMIN ONLY — the promo-clip pipeline. Kelion writes a script sized to the
// requested duration, shows it, and arms the recorder IN THE SAME TURN: the
// script goes on the monitor as a readable panel, the screen recorder arms (one
// click picks the screen — browser law), and when recording starts the script is
// spoken aloud verbatim.
//
// NO AUTHORISATION STEP (Adrian, Jul 31: "you didn't remove the authorisation
// requirement, why?"). This was the last one. His request for a clip IS the
// authorisation; asking him for one more "yes" after he asked you for the clip
// is a wasted turn. The human checkpoint stays where it has always been, and
// it's better than a question in chat: the Rec button, pressed by him, when he
// wants. He sees the script before pressing; if he doesn't like it, he says so
// and you redo it — nothing has been recorded.
// JURNALUL SERIEI DE CLIPURI (11 aug, ownerul): Kelion își știe ce a filmat în
// fiecare episod (ep1, ep2…) și unde a rămas, ca să CONTINUE seria.
export const EPISOADE_PROMO_TOOL: Tool = {
  name: 'episoade_promo',
  description:
    'ADMIN ONLY. List the promo-clip SERIES filmed so far — each episode (ep1, ep2…) with its subject, a summary and the date — so you know WHAT was already filmed and WHERE you left off. Call it before writing a new clip (to continue the series and number the next episode) and whenever the owner asks „unde am rămas / ce episoade am / ce am filmat".',
  input_schema: { type: 'object', properties: {} },
}

export const PROMO_TOOL: Tool = {
  name: 'prepare_promo_clip',
  description:
    'ADMIN ONLY. Arm the screen recorder for a professional promo clip (TikTok/Instagram) with ' +
    'a spoken script AND a shot list of demo scenes. When the owner asks for a clip, write the ' +
    'script in chat AND call this tool in the same turn — his request is the authorisation, do ' +
    'not stop to ask for a yes. He reviews the script on screen and presses Rec himself when ' +
    'ready; nothing is recorded until he does. When the recording starts, the script ' +
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

// THE BRAIN'S VOICE (Adrian, Jul 4): synthesis happens on the SERVER (Chirp 3
// HD, the user's language), the audio is sent as {audio} FRAMES and the app only
// decodes + plays them in a queue (audioIO.ts). The frontend synthesizes NOTHING
// (frontend TTS = dead).
// ── VOICE DURING THE STREAM (Adrian, Jul 10: "instant live chat") ────────────
// Before, synthesis started only AFTER all the text had finished — on a long
// reply, Kelion stayed silent for tens of seconds after the first written word.
// Now the streamed text enters here AS it flows: at every sentence boundary, the
// piece leaves for synthesis and the {audio} frame is written into the stream
// while the text is still coming — Kelion speaks from the FIRST sentence.
// Synthesis runs SERIALLY (sentence order = audio order). NO speaking ceiling
// (Adrian, 19 aug: „se trunchiază la jumate audio — scoate limita de vorbit
// audio"). The old 4000-char cap (10 iul, „audio măcar un minut") cut long
// replies in half; Kelion now speaks the WHOLE reply. Each chunk stays ≤200
// chars (splitForSpeech), so serial synthesis just streams more small pieces.
function createVoiceStream(
  reply: { raw: { write(c: string): void } },
  lang: string | undefined,
  /** The voice chosen by this user (C4). Unknown or missing → the app's voice. */
  voicePref: string | null,
): { feed(t: string): void; fed(): boolean; finish(): Promise<void> } {
  let pending = '' // arrived text, not yet sent to synthesis
  let any = false
  let chain: Promise<void> = Promise.resolve()
  const speak = (text: string): void => {
    // FĂRĂ PLAFON DE VORBIT (owner, 19 aug: „se trunchiază la jumate audio —
    // scoate limita de vorbit audio"). Plafonul vechi de 4000 de caractere tăia
    // răspunsurile lungi la jumate — restul rămânea doar scris. Kelion rostește
    // ACUM tot răspunsul; fiecare bucată e deja mică (≤200 car., splitForSpeech),
    // mult sub limita Google per cerere, deci sunt doar mai multe bucăți, în ordine.
    if (!text) return
    const t = text
    chain = chain.then(async () => {
      // DOUĂ ÎNCERCĂRI, apoi LOG (Adrian, 5 aug: vocea se tăia la jumate iar
      // eșecul de sinteză era înghițit tăcut — `catch {}` + `if (r.ok)` fără
      // altceva — deci o bucată picată lăsa vocea ciuntită FĂRĂ nicio urmă). Un
      // hopa de rețea spre Google nu mai omoară o frază întreagă; un eșec real
      // se VEDE acum în log, ca data viitoare să nu mai fie „nu pot verifica".
      for (let incercare = 1; incercare <= 2; incercare++) {
        try {
          // The user-chosen voice, so the written reply sounds like the live voice (C4).
          const r = await synthesize(t, lang, { voice: voicePref })
          if (r.ok) {
            reply.raw.write(`${CTRL}${JSON.stringify({ audio: r.audio.toString('base64') })}${CTRL}`)
            return
          }
          if (incercare === 2)
            console.error(`[VOCE] bucată nesintetizată (${r.status} ${r.error}) — vocea rămâne ciuntită aici`)
        } catch (e) {
          if (incercare === 2)
            console.error(`[VOCE] sinteza a crăpat: ${String((e as { message?: string })?.message ?? e).slice(0, 120)}`)
        }
      }
    })
  }
  // What gets spoken: the text, cleaned of tool tags and markdown.
  const clean = (s: string): string => s.replace(/\[[A-Z][^\]]*\]/g, '').replace(/[*_#`~>|]/g, '')
  const cut = (final: boolean): void => {
    // We split ONLY after a finished sentence FOLLOWED by a space (not in the
    // middle of "3.14"); without a boundary, a piece over 240 characters leaves
    // anyway (a river-sentence without punctuation). At the end, everything left
    // goes out.
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

// EXPORTED (Jul 25): voice escalation (`ask_brain`, routes/realtime.ts) used
// its own hardcoded persona — a SECOND version of the persona, diverging from
// this one (without the "bring your full intelligence" reasoning below,
// without the user's language). Adrian: "I think the software has duplicate
// versions" — he was right; both escalation paths now start from the SAME
// persona.
export const SYSTEM_PROMPT = `You are Kelion — a brilliant personal AI assistant in the spirit of Jarvis from Iron Man: a courteous, refined GENTLEMAN — sharp, perceptive, genuinely useful, and always impeccably well-mannered.

WHO YOU ARE: You were created by AE Studio. Your owner and creator is Adrian Enciulescu — both the application and the original idea are his. If the user asks who made you, who owns you, or whose idea you are, answer clearly and with respect (created by AE Studio; owner and creator Adrian Enciulescu). Do not bring this up unprompted.

MĂSOARĂ, NU DECLARA (regula de fier a lui Adrian, 8 aug: „va trebui să folosească OBLIGATORIU toate testele și să măsoare orice răspuns"). Orice afirmație despre STAREA sistemului — merge / nu merge, cât durează, cât costă, câte sunt, e verde / e roșu — trebuie să vină dintr-o măsurătoare pe care ai făcut-o TU, în tura asta, cu o unealtă. Reguli, fără excepție:
  • O CITIRE CARE A PICAT NU E O VALOARE. Dacă unealta n-a răspuns, spune „nu pot verifica" și motivul. Niciodată 0, niciodată „necreat", niciodată „pare în regulă" — exact astea l-au costat pe Adrian o zi întreagă.
  • „NU ȘTIU" NU E „E BINE". Dacă o verificare n-a putut rula, raportul e INCOMPLET, nu „trece".
  • ÎNAINTE SĂ SCHIMBI COD: rulează ruleaza_portile (tipuri, teste, lacăt, exporturi, sintaxă, build, hardcodări). Aia e starea de plecare.
  • ÎNTREBAT DE HARDCODĂRI („ce e hardcodat în aplicație"): SINGURUL răspuns adevărat e poarta 'hardcodari' din ruleaza_portile — o rulezi și citezi verdictul măsurat. Un inventar povestit din memorie e inventat și poarta faptelor îl demască pe ecran.
  • DUPĂ CE AI SCHIMBAT: rulează-le din nou și compară. Fără a doua rulare nu ai dovadă că n-ai stricat nimic.
  • repo_open_pr și repo_merge_pr REFUZĂ dacă porțile n-au fost rulate complet și recent, cu verdict TRECE. Nu e o formalitate de ocolit: e poarta care te oprește să publici pe încredere.
  • CÂND SPUI CEVA DESPRE SISTEM, poți fi întrebat „de unde știi". Răspunsul corect e o măsurătoare din jurnal_masuratori. Dacă nu e acolo, n-ai măsurat-o — spune asta.

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
tool returns an auth error, tell the user to sign in again to grant access. When you call get_weather a live
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
	or comment on it on your own. NEVER say "Văd că ați trimis o imagine", "Observ că ați trimis...",
	or any variation using forbidden words like "Văd" or "Observ" when an image is received at
	startup or with a greeting. Save and process received images silently with no comment, and respond
	ONLY with a brief hour-anchored greeting (dimineața, ziua, seara, noaptea) matching the time of day.
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

// Language names (for the language lock — the brain listens to an explicit NAME
// far more reliably than a locale code) come from the SINGLE source
// `LANG_LABELS` (services/lang.ts). An identical copy used to live here —
// removed (single source, no duplicates).

// (PUNGA DE REZERVĂ a fost EXTIRPATĂ DE TOT, 3 aug — întâi ÎNCHISĂ definitiv
// („deschisă → false"; Adrian, cu mailurile „sold scăzut $-0.20" în mână:
// rotația aluneca pe modele OpenRouter PLĂTITE), apoi ștearsă cu tot cu
// rotație și furnizor. Creierul e Gemini-only; la eșec, mesaj neutru onest —
// nu se mai cumpără nimic pe ascuns de la alt furnizor.)

export async function chatRoutes(app: FastifyInstance): Promise<void> {  // Resume a dropped reply from where it left off (mobile 3G/5G handoff). The
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
      // HEARTBEAT ȘI PE RESUME (agenții de debug, 3 aug): calea principală are
      // pingTimer (': keep-alive' la fiecare ≤15s de tăcere), dar resume-ul nu
      // avea NIMIC → dacă tura originală tace >50s (unealtă lentă), watchdog-ul
      // clientului (READ_SILENCE_MS=50s) omora exact conexiunea de resume care
      // trebuia s-o salveze. Același ping, același interval, oprit la close.
      let ultimaScriere = Date.now()
      const pingResume = setInterval(() => {
        if (Date.now() - ultimaScriere >= 15_000) {
          try {
            reply.raw.write(': keep-alive\n\n')
          } catch {
            /* conexiune deja închisă — timer-ul moare la end/close */
          }
          ultimaScriere = Date.now()
        }
      }, 5_000)
      reply.raw.on('close', () => clearInterval(pingResume))
      try {
        for await (const chunk of readTurnFrom(user.email, turn, lastSeq)) {
          reply.raw.write(chunk)
          ultimaScriere = Date.now()
        }
      } catch {
        /* buffer vanished mid-replay — just end cleanly */
      }
      clearInterval(pingResume)
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
      // CONTINUOUS VISION (Adrian, Jul 11): the camera's last 4 frames —
      // for ALL users (rule no. 9).
      images?: string[]
      // The picture was EXPLICITLY ATTACHED (Ctrl+V / uploaded), not the
      // camera's ambient frame — an unconditional analysis request (see
      // VISION_INTENT below).
      imageIsAttachment?: boolean
      coords?: Coords
      screen?: { kind: string; title: string; active: boolean }[]
      // CONȚINUTUL de pe monitor (10 aug, „nu are acces la ce se afișează"):
      // clientul trimite conținutul REAL al tabului activ (text/HTML/URL),
      // bounded — get_monitor îl întoarce brainului.
      monitorContent?: { kind?: string; title?: string; url?: string; text?: string; mouse?: { x: number; y: number; indicator: string } }
      now?: string
      tz?: string
      // Voice features extracted 100% client-side for speaker + gender
      // identification.
      voiceFeatures?: VoiceFeatures
      // 128-d facial descriptor (face-api), extracted client-side when the
      // camera is on. Triggered by voice, with no button. `facePhoto` = base64
      // thumbnail.
      faceDescriptor?: number[]
      facePhoto?: string
      // SINGLE-VOICE RULE (Adrian, Jul 26: "there must never be 2 voices at
      // the same time"): the client has the full-duplex voice session ACTIVE,
      // so this turn's voice belongs to that session — the server does NOT
      // synthesize Chirp (not only would it not play: we don't pay synthesis
      // for discarded audio either).
      serverVoiceOff?: boolean
      // Ancora Centrului de Tranzacționare (10 aug, ownerul: chatul REAL,
      // „conștient" de pagina de trading) — starea VIE raportată de iframe.
      tranzactii?: { simbol?: string; pret?: number; interval?: string; sursa?: string; peste?: { t?: number | string; o?: number; h?: number; l?: number; c?: number; vol?: number | null; ma20?: number | null; ema50?: number | null } | null }
      // ȚEAVA DE REȚEA (12 aug): treapta detectată de client (slab/mediu/bun/
      // necunoscut) — creierul o ȘTIE (poate răspunde „ce țeavă am?") și își
      // scurtează răspunsul + evită să deschidă pagini grele nechemat pe țeavă slabă.
      retea?: 'slab' | 'mediu' | 'bun' | 'necunoscut'
      // UȘA CREIERULUI (8 aug, ownerul: „a oferit soluții dar nu poate să
      // implementeze"): tura vine din sesiunea vocală live prin unealta
      // cere_creierului — modelul live a DECIS deja că e nevoie de unelte,
      // deci tura primește direct faza de ACȚIUNE (inventarul plin), nu faza
      // de vorbire cu 13 unelte de conversație în care creierul „oferă
      // soluții" în loc să execute. Sigur: cererea e autentificată ca userul
      // însuși, iar uneltele rămân filtrate pe rol exact ca până acum.
      usaCreierului?: boolean
      // TRIEREA ÎN DOI (JARVIS pas 3): runda de CONVERGENȚĂ a ușii — cară
      // istoricul rundei anterioare și NU mai forțează unelte de faptă
      // (toolChoice='required' pe o faptă poate DEJA făcută = re-execuție,
      // clasa interzisă de registrul B#2). Inventarul plin al ușii rămâne.
      continuareUsa?: boolean
      // SPOKEN TURN (the ONE-brain voice architecture, Aug 1): this turn came
      // from the microphone and its reply will be SPOKEN ALOUD verbatim by the
      // Realtime voice. The brain answers the same way (same tools, same
      // ladder) — only the STYLE changes: short, natural, speakable sentences.
      spoken?: boolean
      // AUDIO NATIV → CREIER (Adrian, 3 aug: „deep learning legat de creier
      // direct"): vocea BRUTĂ a frazei (data-URI `data:audio/...;base64,...`).
      // Gemini 2.5 o „aude" nativ (ton, accent, pauze), fără să depindă de un STT
      // care poate stâlci. Trece prin același /api/chat — creier unic.
      audio?: string
      // VOCE AMBIENTALĂ — CREIERUL UNIC DECIDE ADRESAREA (Adrian, 5 aug: „urechea
      // o scoți total, tot decis de creierul unic"). Când e `true`, fraza a venit
      // din ascultarea continuă (fără STT, fără poartă de nume pe client): creierul
      // AUDE audio-ul brut și decide SINGUR dacă i se vorbește („Kelion"/„Kei" ca
      // prim cuvânt, sau răspuns la o întrebare pe care el tocmai a pus-o). Dacă NU
      // i se adresează, tace (sentinela `<TAC/>` → tura se stinge, nimic rostit,
      // nimic salvat). Poarta veche de cuvânt-cheie (regex pe transcriptul stâlcit)
      // a dispărut — decizia e a creierului, din voce.
      voceAmbianta?: boolean
      // GUEST SPEAKER (Adrian, Aug 1): the voice gate (realtime.ts) recognised
      // the speaker as a GUEST of this account — "guest:<id>:<name> (<relation>)"
      // or "guest-pending:<id>:<name> (<relation>)". A guest turn gets ZERO
      // admin powers, even inside the holder's logged-in session.
      speaker?: string
      // MODUL MAȘINĂ (Adrian, 11 aug; rescris 13 aug): tura vine din stratul de
      // mașină (volan). Creierul răspunde SCURT, voce-first — dar NU se mai suprimă
      // nicio suprafață: ce spune că face, execută (owner: „vorbă = faptă").
      carMode?: boolean
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

    // GOOGLE CONECTAT — CREIERUL SE UITĂ ÎN DB, NU DOAR ÎN COOKIE (owner, 13 aug:
    // „Kelion nu vede că m-am logat prin Google"). `/auth/me` restaura tokenul din
    // DB când cookie-ul îl pierdea, dar creierul (aici) citea DOAR cookie-ul → zicea
    // „neconectat" deși DB-ul, sursa de adevăr, îl are (MĂSURAT live: tokenul
    // owner-ului e în google_accounts din 8 aug). Acum, dacă sesiunea n-are token,
    // îl luăm din DB — așa merge ȘI conștientizarea din prompt, ȘI uneltele Google
    // (Gmail/Calendar/Drive), care tot pe `user.googleRefreshToken` se bazează.
    if (!user.googleRefreshToken) {
      const dbRt = await getGoogleRefreshToken(user.email).catch(() => '')
      if (dbRt) user.googleRefreshToken = dbRt
    }

    // THE BRAIN is 100% Gemini direct (extirparea OpenRouter/OpenAI, 3 aug).
    // If the key is missing, the streaming safety net returns a clear error in
    // the user's language — which is why there is no longer a 503
    // "brain_not_configured" guard here.
    const tSosire = Date.now() // contorul serverului: sosire → creier
    const rawMessages = req.body?.messages
    const image = req.body?.image
    // Multiple frames (max 4, real images only) — fall back to the singular
    // `image` if the client is old. slice(-4), not (0,4) (Jul 25): the client
    // sends 8 frames OLDEST first — we used to keep exactly the older half and
    // discard the present; Kelion was seeing the scene ~2 seconds behind.
    const camFrames = (Array.isArray(req.body?.images) ? req.body.images : [])
      .filter((s): s is string => typeof s === 'string' && s.startsWith('data:image'))
      .slice(-4)
    const imageIsAttachment = req.body?.imageIsAttachment === true
    // Vocea brută a acestei ture (dacă e o tură vocală cu audio nativ activat).
    const audio =
      typeof req.body?.audio === 'string' && req.body.audio.startsWith('data:audio')
        ? req.body.audio
        : ''
    // VOCE AMBIENTALĂ: doar cu audio real (creierul nu poate decide adresarea
    // fără să audă). Fără audio, flag-ul e inert — o tură scrisă e mereu adresată.
    const voceAmbianta = req.body?.voceAmbianta === true && !!audio
    // UȘA CREIERULUI NU SE SALVEAZĂ DUBLU (auditul 15 aug): cererea turei cu
    // usaCreierului e FORMULATĂ DE MODELUL live (nu de om — poate fi în orice
    // limbă), iar tura REALĂ o salvează ruta vocală la verdict. Salvarea de
    // aici dubla fiecare tură cu ușă (4 rânduri din 12 în instrucțiune erau
    // parafraze) și strecura în istoric ture pe care vocea apoi le suprima.
    const eUsaCreierului = req.body?.usaCreierului === true
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'messages[] required' })
    }
    let messages = sanitizeHistory(rawMessages)
    // MARCAJ (Adrian, 3 aug — „exista loguri?"): arată EXACT că tura a ajuns la
    // /api/chat (recepția a mers) și cu ce text. Dacă apare [CHAT-IN] dar NU
    // apare [TIMP] pentru aceeași tură, înseamnă că a murit ÎNAINTE de creier
    // (anulată/întoarsă devreme) — nu că „nu ajunge la creier".
    {
      const _uLog = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      console.log(`[CHAT-IN] audio=${audio ? 'da' : 'nu'} „${String(_uLog).slice(0, 60)}"`)
    }
    // Cap the history sent to the brain. A long conversation (this user already has
    // hundreds of messages) would blow the token limit and make EVERY turn fail
    // with a "connection error" — especially when a big pasted page is added.
    // Long-term continuity comes from the memory agent, not the raw transcript.
    // HISTORY DIET (Jul 25 — Adrian: "chat also huge", real proof: one tool
    // turn cost $4.24): lowered from 60 to 24. 60 had been raised from 24 for
    // longer context in a work session, but cost analysis showed every resent
    // message is paid for on EVERY turn — long-term memory comes from the
    // memory agent anyway, not the transcript.
    const MAX_HISTORY = 24
    if (messages.length > MAX_HISTORY) {
      messages = messages.slice(-MAX_HISTORY)
      while (messages.length > 0 && messages[0].role !== 'user') messages.shift()
    }
    // Tura vocală vine ca AUDIO cu text GOL — garantăm un purtător user la coadă
    // (altfel: 400 „no usable messages" → „Eroare la creier", sau audio lipit de o
    // tură veche). Vezi asiguraPurtatorAudio.
    messages = asiguraPurtatorAudio(messages, !!audio)
    if (messages.length === 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'no usable messages' })
    }

    // THE STOP HANDLER (Jul 25 — it did NOT exist until today, even though the
    // client called it): a typed/spoken "stop" came here and ran a FULL brain
    // turn (cost debited + "stop" and a phantom reply saved to history) for a
    // reply the client never read. It mirrors the client's STOP_CMD regex:
    // acknowledge briefly, zero model, zero history.
    const lastMsg = messages.at(-1)
    const STOP_CMD =
      /^\s*(stop|stai|opre[șs]te(?:-te)?|oprire|gata|las[ăa](?:\s*asta)?|anuleaz[ăa]|renun[țt][ăa])[\s.!]*$/i
    if (lastMsg?.role === 'user' && STOP_CMD.test(lastMsg.content)) {
      return reply.send({ ok: true, stopped: true })
    }

    // The user's ESTABLISHED language (what they actually use), not their Google
    // account locale — used for the language lock AND the out-of-credit message.
    // ONE single trip to the database instead of four in a row (Adrian, Jul 10:
    // "instant live chat"): the independent reads leave TOGETHER — every
    // separate await added another DB round trip before the first word.
    // BYOK-PROVIDER REMOVED COMPLETELY (Adrian, Jul 12: "remove the old provider
    // completely, no patches"): the brain is 100% Gemini direct (a single key,
    // the owner's) and there is no client key anymore. All users go through the
    // normal paywall (wallet credit).
    const lastForRecall = messages.at(-1)
    // FLUENCY (Jul 24 audit, A1): semantic recall could wait up to 8s for the
    // Google embedding — on the FIRST word's path. A hard 400ms deadline:
    // whatever is not ready in time does not enter this turn (full-text memory
    // remains).
    const recallWithDeadline = Promise.race([
      recallMemories(user.email, 'kelion', lastForRecall?.role === 'user' ? lastForRecall.content : ''),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 400)),
    ])
    // N val 2d: cât Centrul de Tranzacționare e ANCORAT (admin + tab de trading
    // pe ecran), reamintește ȘI memoria separată 'tranzactii' (schimburile
    // trecute pe simbol) — namespace-ul general 'kelion' n-o vede niciodată, așa
    // că în conversație normală memoria de trading era mută (doar butonul Analiză
    // o citea). Aceeași cursă cu termen de 400 ms ca recall-ul principal: nu
    // întârzie primul cuvânt; ce nu vine la timp nu intră în tură, restul se ia
    // altă dată. Fără ancoră trading = șir gol, zero drum la DB.
    const ancoraTradingDeschisa =
      user.role === 'admin' && !!(req.body?.tranzactii as { simbol?: unknown } | undefined)?.simbol
    const recallTradingWithDeadline = ancoraTradingDeschisa
      ? Promise.race([
          recallMemoriiTranzactii(user.email, lastForRecall?.role === 'user' ? lastForRecall.content : ''),
          new Promise<string>((resolve) => setTimeout(() => resolve(''), 400)),
        ])
      : Promise.resolve('')
    // ── PREFERINȚELE SE CITESC O DATĂ PE SESIUNE, NU LA FIECARE ÎNTREBARE ────
    // (Adrian, 7 aug: „verificarile de plati etc securitate se fac la logare si
    // atit, e clar nu se repeta deloc pe intrebari"). Limba, meseria, gesturile,
    // alegerea de model și preferința de voce NU depind de ce a întrebat omul —
    // depind de CONT. Prima tură a sesiunii le citește o dată; următoarele le iau
    // din memorie (`services/stareSesiune.ts`), fără niciun drum la DB. Memoria
    // semantică (recall) și continuitatea rămân per-tură — ALEA depind de tura
    // curentă. Securitatea (isAdmin, oaspete, unelte) se recalculează oricum mai
    // jos, la fiecare cerere: viteza nu se ia din securitate.
    const acumMs = Date.now()
    const cache = stareSesiune(user.email, acumMs)
    const [prefs, memRecall, istoricDb, memRecallTrading] = await Promise.all([
      cache
        ? Promise.resolve(cache)
        : Promise.all([
            getSpeechLang(user.email),
            getMeserieActiva(user.email),
            // GESTURES disabled by Adrian from the admin panel — anything NOT
            // checked does NOT appear at all (Adrian, Jul 13).
            getDisabledGestures().catch(() => [] as string[]),
            loadKv(`model_choice:${userKey(user.email)}`).catch(() => null),
            getVoicePref(user.email).catch(() => null),
          ]).then(([speechLang, mId, gestures, mKv, vPref]) => {
            const stare = {
              speechLang, meserieId: mId, disabledGestures: gestures,
              modelChoiceKv: mKv, voicePref: vPref, balance: null,
            }
            pastreazaStareSesiune(user.email, stare, acumMs)
            return { ...stare, laMs: acumMs }
          }),
      recallWithDeadline,
      // Continuity between sessions (#20) + MEMORIA UNIFICATĂ voce↔scris (9 aug):
      // istoricul REAL din DB (AMBELE modalități). O singură citire, două
      // folosințe — timestamp-ul de continuitate (ultimul rând) ȘI nota de
      // memorie unificată (turele vorbite pe care array-ul scris nu le are).
      // Rămâne în paralel cu restul → zero latență adăugată.
      getRecentHistory(user.email, MAX_HISTORY).catch(() => []),
      // N val 2d: memoria de trading, în ACELAȘI val paralel (deja cu termen) —
      // șir gol când tabul nu e ancorat, deci zero cost pe conversația obișnuită.
      recallTradingWithDeadline,
    ])
    const storedPref = prefs.speechLang
    const meserieId = prefs.meserieId
    const disabledGestures = prefs.disabledGestures
    const modelChoiceKv = prefs.modelChoiceKv
    // GESTURILE DEZACTIVATE de Adrian din Admin → Gesturi: gestul ales de
    // situație (mai jos, la finalul turei) e verificat față de setul ăsta și
    // nu se joacă dacă e debifat. „Ce nu e bifat nu apare în aplicație."
    const gestureOff = new Set(disabledGestures)

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
    // LANGUAGE (Adrian's FINAL rule, Jul 24: "default for EVERYONE starts in
    // English, language is detected and kept per user"). NO role exceptions:
    // all users (including the owner) start in English until the REAL language
    // is detected from what they write/say (the same new language on 2
    // consecutive messages → committed and persisted). We do not use the
    // browser/account locale — language comes from interaction, not device
    // settings.
    const committedLang =
      deviceCmd || gestureCmd
        ? null // a device/gesture command is an order, not conversation — never shifts the language
        : trackSpeechLang(user.email, lastIncomingText, storedPref)
    // FLUENCY (B4): fire-and-forget DB write — nothing downstream reads its
    // result, so it has no business on the first word's path.
    if (committedLang) {
      void setSpeechLangPref(user.email, committedLang)
      // Limba s-a schimbat CHIAR ACUM → actualizăm starea ținută în memorie, ca
      // următoarea întrebare să nu servească limba veche (și nici să nu recitească).
      actualizeazaStareSesiune(user.email, { speechLang: committedLang })
    }
    // The client is only told about the detected switch (the recognizer follows
    // it).
    const speechPref = committedLang ?? storedPref
    // LANGUAGE (Adrian — FINAL, mandatory rule: "default startup English;
    // ADMIN = Romanian always; the rest detect and keep per user"). The admin
    // gets fixed ROMANIAN, no matter what was detected; everyone else: the
    // persisted language, otherwise English by default until the first clear
    // detection.
    const isAdminUser = user.role === 'admin'
    const userLang = isAdminUser ? 'ro' : speechPref || 'en'
    const ro = userLang.toLowerCase().startsWith('ro')
    // A SINGLE SOURCE OF TRUTH FOR LANGUAGE (Adrian, Jul 25: "help text in
    // Romanian and the greeting in English — the logic is different"): the
    // server ANNOUNCES the authoritative language on EVERY turn (not only on
    // commit), and the client mirrors it to localStorage → placeholder,
    // recognizer and UI always stay in the SAME language as the replies. The
    // admin always gets ro-RO; everyone else gets the settled language.
    const announceLang = isAdminUser ? 'ro-RO' : (committedLang ?? speechPref ?? null)

    // ANTI "40 TURNS FOR 1 PENNY" (Jul 27 security audit): the paywall was
    // check-then-charge — 40 parallel POSTs all passed the balance read and
    // debited only at the end, deep into the negative. A hard cap of
    // SIMULTANEOUS turns per paying user (2 is generous for a real human); the
    // admin is exempt. The counter is released when the reply closes.
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
    // when payments aren't configured (no Revolut link) the app stays
    // free/ungated. Clean binary stop in the user's language + a paywall frame
    // so the UI shows the top-up link.
    // POARTA SE ÎNCHIDE DOAR PE UN SOLD CITIT (măsurat 8 aug). Înainte,
    // `getBalance` întorcea 0 și când citirea PICA — deci un sughiț de bază de
    // date îi spunea unui om cu credit plătit „Ai rămas fără credit" și îl
    // bloca. Acum, dacă nu pot citi, NU ridic zidul: eroarea noastră nu se
    // plătește din buzunarul lui. Rămâne zgomotoasă în jurnal, ca s-o vedem.
    const soldPoarta = config.revolut.payLink && user.role !== 'admin' ? await citesteSold(user.email) : null
    if (soldPoarta && !soldPoarta.citit)
      console.error('[paywall] sold NECITIT, las trecerea liberă:', soldPoarta.motiv)
    if (soldPoarta?.citit && soldPoarta.sold <= 0) {
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      const paywallTurnId = randomUUID()
      startTurn(user.email, paywallTurnId)
      const paywallTaskId = randomUUID()
      await inregistreazaSarcinaOperationala({
        id: paywallTaskId,
        userEmail: user.email,
        turnId: paywallTurnId,
        objective: lastIncomingText || '(chat blocked before model execution)',
        metadata: { source: 'chat', blockedBy: 'credit' },
      })
      await tranzitioneazaSarcinaOperationala({
        taskId: paywallTaskId,
        stare: 'interpreting',
        code: 'credit_checked',
      })
      // Chitanța {turn} pleacă PRIMA, ca pe orice tură (audit 9 aug: ramura
      // paywall era singura fără ea — bifele de livrare și resume-ul orbecăiau).
      reply.raw.write(appendTurn(user.email, paywallTurnId, `${CTRL}${JSON.stringify({ turn: paywallTurnId })}${CTRL}`))
      const paywallText = ro
        ? 'Ai rămas fără credit. Te rog reîncarcă creditul ca să continuăm.'
        : "You've run out of credit. Please top up to keep talking with me."
      // NOTHING IS LOST AT 0 CREDITS (Adrian, Aug 1: "make sure he doesn't lose
      // what he worked on, so he can resume after topping up"). The user's words
      // are saved BEFORE the stop — after the top-up the conversation resumes
      // from exactly where it paused, not from a hole. The paywall notice is
      // saved too, so the history shows honestly why the reply stopped there.
      if (lastIncomingText) void saveMessage(user.email, 'user', lastIncomingText)
      void saveMessage(user.email, 'assistant', paywallText)
      reply.raw.write(appendTurn(user.email, paywallTurnId, paywallText))
      reply.raw.write(appendTurn(user.email, paywallTurnId, `${CTRL}${JSON.stringify({ paywall: true })}${CTRL}`))
      await tranzitioneazaSarcinaOperationala({
        taskId: paywallTaskId,
        stare: 'blocked',
        code: 'insufficient_credit',
        metadata: { userVisible: true },
      })
      finishTurn(user.email, paywallTurnId)
      reply.raw.end()
      return
    }

    // Instant command (device or gesture): immediate reply, WITHOUT a model
    // call — a {device|gesture} control frame that the client executes
    // verbatim, plus a short ack. The same stream shape as a normal turn (the
    // {turn} receipt first) so delivery ticking and resume keep working. The
    // two were identical blocks — a single source here (unique, no duplicates).
    const instantCommand = async (frameKey: 'device' | 'gesture', value: unknown, ack: string): Promise<void> => {

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      const cmdTurnId = randomUUID()
      startTurn(user.email, cmdTurnId)
      const commandTaskId = randomUUID()
      await inregistreazaSarcinaOperationala({
        id: commandTaskId,
        userEmail: user.email,
        turnId: cmdTurnId,
        objective: lastIncomingText || `(${frameKey} command)`,
        metadata: { source: 'chat', commandKind: frameKey },
      })
      await tranzitioneazaSarcinaOperationala({
        taskId: commandTaskId,
        stare: 'interpreting',
        code: 'command_received',
      })
      await tranzitioneazaSarcinaOperationala({
        taskId: commandTaskId,
        stare: 'executing',
        capability: `ui_${frameKey}`,
        code: 'client_command_sending',
      })
      const payload =
        `${CTRL}${JSON.stringify({ turn: cmdTurnId })}${CTRL}` +
        `${CTRL}${JSON.stringify({ [frameKey]: value })}${CTRL}` +
        ack
      reply.raw.write(appendTurn(user.email, cmdTurnId, payload))
      await noteazaEvenimentOperational({
        taskId: commandTaskId,
        kind: 'client_command_sent',
        capability: `ui_${frameKey}`,
        outcomeState: 'succeeded',
        code: 'frame_written',
      })
      // The server wrote the frame, but the browser has not yet acknowledged
      // that the device/gesture effect occurred. Technical delivery is not a
      // verified client-side effect.
      await tranzitioneazaSarcinaOperationala({
        taskId: commandTaskId,
        stare: 'unverified',
        capability: `ui_${frameKey}`,
        code: 'client_ack_missing',
      })
      finishTurn(user.email, cmdTurnId)
      if (lastIncomingText) void saveMessage(user.email, 'user', lastIncomingText)
      if (ack) void saveMessage(user.email, 'assistant', ack)
      reply.raw.end()
    }

    // Camera / monitor tabs: a {device} frame.
    if (deviceCmd) {
      await instantCommand('device', deviceCmd, deviceAck(deviceCmd, ro))
      return
    }
    // Avatar gesture, interpreted on the server: a {gesture} frame.
    if (gestureCmd) {
      await instantCommand('gesture', gestureCmd, gestureAck(gestureCmd, ro))
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
    // AWARE OF WHAT IT HAS (Adrian, Jul 30: "it must be aware of what it has,
    // what capabilities it has, all of them activated in its brain and directly
    // callable"). The tool definitions went to the model, but nowhere did it
    // say, in its language, WHAT IT CAN DO — grouped, with what each one does.
    // An agent that does not know its own inventory says "I can't" for
    // something it has in hand. The list is DERIVED from the registry (the
    // single source), so it cannot fall behind. The ordinary user does not see
    // the admin tools — they could not call them anyway.
    // ── CHATUL E DOAR CHAT (Adrian, 8 aug, verbatim): „orice chat trebuie să fie
    // default chat, fără să poarte nimic cu el, după care urmează procedura prin
    // creier de analiză și execuție" ─────────────────────────────────────────
    //
    // Se hotărăște AICI, înainte de a construi promptul, fiindcă și promptul e
    // ceva „purtat": blocurile despre reparat cod, PR-uri, runbook-uri, clipuri
    // promo — mii de tokeni citiți degeaba la „cât e ceasul". Măsurat: 24 de
    // blocuri, 17 necondiționate, ~3.900 tokeni la FIECARE tură.
    const textulTurei = (() => {
      const ultim = messages.at(-1)
      return ultim?.role === 'user' ? String(ultim.content ?? '') : ''
    })()
    // O SINGURĂ SURSĂ pentru faza turei: `services/fazeChat.ts`. Nici promptul,
    // nici uneltele nu mai decid fiecare pe cont propriu ce cară — se întreabă
    // amândouă în același loc, iar locul ăla e o funcție pură, probabilă.
    const incarcatura = fazaTurei({
      text: textulTurei,
      areAudio: !!audio,
      areImagine: !!image || camFrames.length > 0,
      // Ușa creierului = acțiune prin definiție: modelul live a decis DEJA că
      // cererea are nevoie de unelte — fără asta, „trimite lista
      // constructorului" pica pe faza de vorbire și creierul doar POVESTEA.
      // Excepția trierii NU stă aici: aici se alege doar FAZA (inventarul de
      // unelte), iar runda de continuare tot pe faza grea trebuie să meargă,
      // ca să VADĂ uneltele. Ne-forțarea lor se decide la cereActiune-ul de
      // execuție (cel care armează forteazaFapta), nu la inventar.
      cereActiune: hasActionIntent(textulTurei) || req.body?.usaCreierului === true,
    })
    // VOCE = SCRIS COMPLET, DOAR PENTRU OWNER (owner, 19 aug: „egalizate drepturile
    // chat audio cu chat scris" + „doar owner are drepturi pe admin"). O frază
    // ROSTITĂ de owner nu mai e „curată" (conversație ușoară): capătă instrucțiunile
    // de lucru ca o comandă TASTATĂ, ca „comută pe free"/„repară"/„publică" să
    // meargă din PRIMA frază, fără pasul ask_brain care uneori nu se făcea. Ne-owner
    // și oaspete: neatinși — blocurile de lucru sunt oricum gardate de `admin &&
    // !turaDeOaspete` mai jos, deci un oaspete pe voce NU capătă drepturi de owner.
    const turaCurata = !incarcatura.instructiuniDeLucru && !(user.role === 'admin' && !!audio)
    // ── LEGILE ADMINULUI (owner, 16 aug, verbatim: „orice cerinta a admin
    // trebuie sa devina lege de neignorat pentru orice model ai e folosit" +
    // „creiaza legi foarte clare ca nu e admis hardcodat pe aplicatie").
    // Blocul stă PRIMUL în promptul oricărui creier care servește chatul —
    // flash, pro sau Fable: legile nu depind de model.
    const LEGILE_ADMINULUI =
      `THE ADMIN'S LAWS (16 Aug — binding for WHATEVER model you run on, first and above all):\n` +
      `1. LAW OF THE DEED: the admin's requests are LAWS, not suggestions. Each one is either EXECUTED ` +
      `with real tools or REFUSED with the named reason — never ignored, never silently postponed, never ` +
      `"done" in words only. Claiming you did something without the tool having run is a LIE; the server's ` +
      `fact-gate cross-checks your words against this turn's tool journal and exposes false claims on screen.\n` +
      `2. LAW OF MEASUREMENT: never present an unmeasured value as fact. A figure you did not read from a ` +
      `tool this turn (prices → lista_tarife; balances, states, counts → their tools) is INVENTED — say ` +
      `"nu pot verifica" or call the tool.\n` +
      `3. LAW AGAINST HARDCODING: nothing user-facing may be a hardcoded figure or state. Everything shown ` +
      `must come from a LIVE source (tool, DB, env, measurement). If you notice a hardcoded value while ` +
      `working, report it as a bug — hardcoded = forbidden in this application.\n` +
      `4. LAW OF CARRYING THROUGH (the admin, 16 Aug: "sa nu mai intepeneasca... sa ofere solutia pina la ` +
      `deploy masurabil"): a PLAN is not a deed. On an execution request you NEVER end the turn after ` +
      `announcing steps or showing an analysis document — in the SAME turn you call the tools that start the ` +
      `work (build_software for build orders, the concrete tool otherwise), or you name the exact blocker. ` +
      `Think, decide, ACT — every turn. DONE means: PR merged, CI green, published, and MEASURED live ` +
      `(constructor_status / the live version) — never declare finished earlier.\n` +
      `5. LAW OF THE MEASURED DECISION (the admin, 19 Aug: "implementeaza-i masuratorile decizionale... sa ` +
      `nu se mai repete"): every remediation DECISION must be backed by a measurement that proves the CAUSE. ` +
      `An unmeasured cause is "nu stiu inca", not a fact — you may NOT attach an invented cause ("publish ` +
      `didn't run", "the model returned empty", "the file is missing") or a repair plan to a finding you did ` +
      `not measure. A short silence (e.g. 64s) is NOT proof of a hang; a stale log line is NOT proof a file ` +
      `is missing (check it exists first); "live behind" right after a merge is a deploy in progress, not a ` +
      `failed publish — measure before you name a cause. For a self-check (autoverificare): report ONLY the ` +
      `measured verdicts + the tool's measured plan; never invent causes or a separate repair plan, and never ` +
      `ask "shall I repair everything?" — for each finding, either it carries a MEASURED cause (act on that) ` +
      `or it needs a measurement first (TAKE it, name the exact one). Measure first IS the step; the fix comes ` +
      `after the measurement, never before it.\n`
    let systemPrompt = `${LEGILE_ADMINULUI}\n${CHARTER_CHAT_VOCE_LEGI}\n${SYSTEM_PROMPT}\n\n${inventarulMeu(isAdminUser)}`
    // Active "meserie" (role/persona), if the user has one enabled via
    // PUT /api/prefs — e.g. Influencer. Adds its instructions on top of the
    // default behavior; absent/unknown id means Kelion stays default.
    // (meserieId was read above, on the single trip to the database.)
    const meserie = meserieId != null ? getMeserie(meserieId) : undefined
    if (meserie) {
      systemPrompt += `\n\nACTIVE ROLE (${meserie.nume}): ${meserie.systemPromptAddon}`
    }
    // Language lock — the #1 rule. Kelion must never drift to another language.
    // userLang (the user's ESTABLISHED language, not the Google-account locale)
    // was resolved above. Using the account locale is why short/ambiguous
    // messages used to get answered in English.
    const langBase = userLang.toLowerCase().split('-')[0]
    const langName = LANG_LABELS[langBase]
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
    // BUCLA DE AUTO-ÎNVĂȚARE ÎNCHISĂ (Adrian, 3 aug, aprobat: „închide bucla —
    // creierul aplică lecțiile automat"). Lecțiile măsurate (tipare lente /
    // eșecuri repetate) intră SCURT în contextul creierului admin ca să le EVITE
    // → mai puține runde irosite, fără repetarea pașilor care pică → timpii scad
    // (dovada: rounds/ms scad în task_timings). Doar pe drumul adminului, din
    // cache (fără citire DB per tură — latență zero pe drumul cald).
    if (isAdminUser) {
      // Lecțiile — din măsurători (timpi) ȘI din reproșuri (corecțiile lui, L1h).
      // Ambele din cache (fără DB pe drumul cald).
      const lectii = [...lectiiCurente(), ...lectiiReprosuri()]
      if (lectii.length) {
        systemPrompt += `\n\nÎNVĂȚAT (aplică-le ca să fii mai rapid și să NU repeți greșeli): ${lectii.join(' ')}`
      }
      // L1h — ÎNVĂȚARE DIN FEEDBACK IMPLICIT: dacă tura asta e clar o CORECȚIE a
      // răspunsului dinainte („nu asta am cerut"), notăm reproșul (ce ceruse, ce
      // a făcut, cum l-a corectat) în registru — intră în lecțiile turelor VIITOARE
      // (pe asta modelul o vede oricum, e chiar mesajul omului). Doar owner
      // (corecțiile LUI contează pentru învățarea lui Kelion). Fire-and-forget.
      const nem = esteNemultumire(lastIncomingText)
      if (nem.da) {
        let idxAsist = -1
        for (let i = messages.length - 2; i >= 0; i--) {
          if (messages[i]?.role === 'assistant') { idxAsist = i; break }
        }
        if (idxAsist >= 0) {
          let cerere = ''
          for (let i = idxAsist - 1; i >= 0; i--) {
            if (messages[i]?.role === 'user') { cerere = String(messages[i]?.content ?? ''); break }
          }
          void noteazaRepros(cerere, String(messages[idxAsist]?.content ?? ''), lastIncomingText, nem.fel, new Date().toISOString()).catch(() => {})
        }
      }
    }
    // SPOKEN TURN (Aug 1 — the ONE-brain voice architecture): the reply leaves
    // through the Realtime voice, spoken VERBATIM. Same brain, same tools — only
    // the style bends toward the ear: short sentences, no markdown, no bullet
    // lists, no tables, no emoji, no URLs read aloud (say "I put it on the
    // monitor" instead). Still complete and honest — never dumbed down.
    if (req.body?.spoken === true) {
      systemPrompt +=
        `\n\nSPOKEN REPLY: this answer will be SPOKEN ALOUD, word for word, by the voice. ` +
        // LIMBA SE MENȚINE ȘI CÂND AUDE (Adrian, 4 aug: „nu menține limba când o
        // aude"): pe drumul vocal, reîntărim EXACT limba, ca stilul „pentru
        // ureche" să nu tragă răspunsul spre engleză.
        (langName ? `You speak EXCLUSIVELY in ${langName} — the same language throughout, never drifting to English or any other language just because this is a spoken turn. ` : '') +
        `Write it for the ear: short natural sentences (1–3 per thought), no markdown, no lists, ` +
        `no tables, no emoji, no headings. Numbers and dates in spoken form. If you show something ` +
        `on the monitor, say so in one short sentence — don't read URLs or code aloud. ` +
        `Be complete but concise: what matters most first.`
    }
    // VOCE AMBIENTALĂ — CREIERUL DECIDE ADRESAREA DIN AUDIO (Adrian, 5 aug: „tot
    // decis de creierul unic; dacă nu aude «Kelion» sau «Kei», să nu vorbească
    // neîntrebat"). Poarta de nume nu mai stă pe client (pe un transcript stâlcit);
    // creierul AUDE fraza brută și hotărăște singur. Acest bloc vine ULTIMUL, deci
    // bate regula „NEVER end a turn silently" DOAR pe cazul explicit de mai jos.
    if (voceAmbianta) {
      systemPrompt +=
        `\n\nAMBIENT VOICE MODE — YOU DECIDE IF YOU WERE ADDRESSED. This turn is a raw ` +
        `audio phrase captured from continuous listening near the device. There is NO ` +
        `transcript — you HEAR the audio yourself. Decide, from what you hear, whether it is ` +
        `addressed to YOU:\n` +
        `• ADDRESSED = the speaker said your name ("Kelion" or "Kei") as the first word, OR ` +
        `you just asked a question in your previous turn and this audio is the reply to it.\n` +
        `• NOT ADDRESSED = the speaker is talking to someone else, thinking aloud, background ` +
        `speech, or the audio is not clearly meant for you.\n` +
        `RULES (exactly):\n` +
        `1. If NOT addressed: output the token <TAC/> on the first line, then a newline, then ` +
        `one line "AUZIT: " followed by what you actually heard, verbatim. Nothing else — no ` +
        `words of your own, no tools, no explanation. You still stay SILENT (the <TAC/> overrides ` +
        `the "never end silently" rule); the AUZIT line is not spoken — it exists so a wrong ` +
        `silence can be SEEN in the log instead of vanishing. If you truly heard nothing ` +
        `intelligible, write "AUZIT: (neinteligibil)".\n` +
        `2. If addressed: START YOUR SPOKEN REPLY IMMEDIATELY, with the very first word. Do NOT ` +
        `write anything before it — no echo, no preamble, no label. Then, only AFTER you have ` +
        `finished speaking, put on a new line "AUZIT: " followed by the words you actually heard, ` +
        `verbatim. That echo is for the screen, it is never spoken, and it must come LAST.\n` +
        `WHY IT COMES LAST (this is the point): nothing can be said out loud until your first ` +
        `characters arrive. An echo written first makes the person wait for a whole transcription ` +
        `before hearing a single word from you. First the answer, then the echo.\n` +
        `WAKE WORD IS DECISIVE (Adrian, 6 aug — „nu aude"): if you clearly hear ` +
        `"Kelion" or "Kei" as, or near, the FIRST word, you ARE addressed — you MUST ` +
        `answer with the "AUZIT:" line and your reply, NEVER <TAC/>. A direct question ` +
        `right after your name is ALWAYS for you. Use <TAC/> ONLY when the speech is ` +
        `clearly aimed at someone else or is background chatter AND your name was NOT ` +
        `called. When your name is heard, staying silent is WRONG — do not be ` +
        `over-cautious. (The owner asked you not to speak UNPROMPTED — but being ` +
        `called by name IS the prompt.)`
    }
    // MODUL MAȘINĂ (Adrian, 11 aug; RESCRIS 13 aug — „când spune orice, trebuie
    // să fie executat acel orice"). La volan, Kelion răspunde SCURT și voce-first,
    // dar NU se mai suprimă nicio suprafață. Garda veche îi spunea creierului „nu
    // deschide harta/documentul, doar spune-l" — exact ruptura pe care ownerul a
    // cerut-o scoasă: vorbă fără faptă. Acum: ce spune că face, EXECUTĂ prin unealtă
    // (plasa-pereche din handleControl/ChatPanel a fost și ea scoasă). Vorbă = faptă.
    if (req.body?.carMode === true) {
      systemPrompt +=
        `\n\nCAR MODE (driving — voice-first). The user is at the wheel, so answer in ` +
        `SHORT spoken sentences and lead with the voice. Keep ALL your capabilities and ` +
        `tools. CRITICAL: whatever you SAY you are doing, you MUST actually do by calling ` +
        `the matching tool in this SAME turn — if you say you are opening the map, a ` +
        `document, a video or any panel, actually CALL the tool so it opens on the ` +
        `monitor. Never claim an action you did not perform. Speak the answer, but never ` +
        `withhold a surface the user asked for.`
    }
    // ACCOUNT STATE — Kelion must KNOW naturally who the user is (Adrian,
    // Jul 24: "during the audit it doesn't see that I'm logged into the Google
    // account"). Without this, the audit said "you are not connected" even
    // though the user was signed in with Google.
    // THE GUEST SPEAKER, PARSED ONCE — ȘI DEVREME (Adrian, Aug 1; mutat sus la
    // auditul din 9 aug): eticheta porții de voce vine în corpul cererii —
    // "guest:<id>:<name> (<relation>)" pentru un invitat aprobat,
    // "guest-pending:..." pentru unul în așteptare, "nevalidat" pentru o voce
    // care nu s-a potrivit cu amprenta. Înainte, parsarea era DUPĂ construcția
    // promptului, deci o tură de OASPETE în sesiunea adminului primea blocurile
    // de OWNER („acționează fără confirmare", identitatea de owner) — drepturi
    // decise pe cine deține SESIUNEA, nu pe cine VORBEȘTE.
    const speakerRaw = typeof req.body?.speaker === 'string' ? req.body.speaker : ''
    const guestMatch = /^guest(-pending)?:(\d+):(.+)$/.exec(speakerRaw)
    const guestPending = guestMatch?.[1] === '-pending'
    const guestId = guestMatch ? Number(guestMatch[2]) : 0
    const guestLabel = guestMatch?.[3] ?? ''
    // LOGAT = ADMIN, AUTORITAR (owner, 14 aug: „sunt logat, ca e logat admin — să
    // nu-mi mai dea fals"). O voce care NU se potrivește cu amprenta (fals-negativ
    // frecvent) NU mai retrage drepturile deținătorului LOGAT: doar un oaspete
    // CONFIRMAT (altă persoană recunoscută la microfon, `guest:…`) coboară tura la
    // „oaspete". Așa Kelion nu-i mai spune adminului logat „nu am acces pe admin".
    const turaDeOaspete = !!guestMatch
    systemPrompt +=
      `\n\nUSER ACCOUNT (silent context — NEVER announce or narrate this, just act on it): the user IS signed in via Google as ${user.email}` +
      `${user.role === 'admin' && !turaDeOaspete ? ' (the OWNER/admin of this app)' : ''}. ` +
      // "Connected to Gmail" = ONLY if there is a refresh token from the Connect
      // flow (the heavy scopes). Plain login gives an IDENTITY access token with
      // no Gmail rights — that does not mean connected (Adrian, Jul 24: "it says
      // I'm connected to Gmail but it can't fetch data").
      (user.googleRefreshToken
        ? 'Google services (Gmail, Calendar, Drive, Tasks, Contacts) are CONNECTED — use those tools directly when asked, without saying "you are connected".'
        : 'IMPORTANT: the heavy Google services (Gmail, Calendar, Drive, Tasks, Contacts) are NOT connected — you CANNOT read email/calendar/etc yet. If asked for any of them, do NOT claim they work or that you are connected; instead ask the user to press "Connect Gmail & Calendar" in the wallet menu once. Everything else works normally.') +
      ' NEVER proactively state whether the user is logged in or connected — the interface already shows it. Just answer what they asked.'
    // EYES ON F12 (Adrian, Jul 24: "it must have access to the logs"). RECENT
    // errors from the user's browser, sent by the client — Kelion diagnoses
    // from real symptoms, not guesses.
    const cerrs = recentClientErrors(user.email)
    if (cerrs.length > 0) {
      systemPrompt +=
        `\n\nBROWSER CONSOLE (the user's own F12 errors, last 15 min — REAL symptoms from their device; each line has a plain explanation of WHAT IT IS after "→". When the user asks "what is this error?", answer from THIS, plainly — never a generic "try again"):\n- ` +
        cerrs.slice(-8).map((l) => `${l} → ${explicaEroare(l).ceEste}`).join('\n- ')
    }
    // AUTODIAGNOSTIC (Adrian, 12 aug: „Kelion nu are sisteme să-i zică ce
    // probleme are"): pentru OWNER injectăm poza defectelor curente (erori de
    // server + ordine de build eșuate), fiecare cu „ce este". Sincron, din cache,
    // deci NU adaugă latență. Astfel, la „ce probleme ai?", răspunde din
    // cunoaștere — nu pretinde că totul e în regulă.
    // DREPTURILE DE ADMIN NU SE MAI PIERD NICĂIERI (owner, 14 aug, seara:
    // „kelion a pierdut drepturile de admin… fă ceva să nu se mai poată
    // pierde" + „nu are atribute de admin, nicăieri"). Până acum, o tură
    // etichetată „oaspete" pe sesiunea DE ADMIN tăia toate blocurile de owner
    // — iar o potrivire greșită de voce îl lăsa pe OWNER fără admin la el
    // acasă. De-acum sesiunea de admin ține blocurile ARMATE întotdeauna;
    // oaspetele confirmat primește doar prudența de mai jos (fără date
    // personale, confirmare la acțiuni grele), nu amputarea puterilor.
    if (user.role === 'admin' && turaDeOaspete) {
      systemPrompt +=
        `\n\nGUEST AT THE MIC (the voice gate matched a known guest: ${guestLabel || 'guest'}): the OWNER's session stays fully armed, but the person SPEAKING now may not be the owner. Do not reveal the owner's personal data on voice, and for destructive or costly actions ask the owner to confirm first.`
    }
    if (user.role === 'admin') {
      const probl = formateazaProbleme(problemeGlobaleCache())
      if (probl) {
        systemPrompt +=
          `\n\nYOUR OWN CURRENT PROBLEMS (self-diagnosis — real server errors + failed build orders, each with what it is). You KNOW these. If the owner asks what problems you have / what is broken, list them plainly and offer to fix, instead of claiming all is fine:\n${probl}`
      }
      // ACȚIUNE, NU VORBĂ (Adrian, 12 aug: „kelion trebuie să fie capabil să o
      // facă, nu tu"; ordinul cu avatarul a fost DISCUTAT, nu construit). Ordinele
      // implicite (fără cuvântul „construiește") plecau la vorbă — regula de mai
      // jos + rutarea din build_software le trimit acum la constructor.
      systemPrompt +=
        `\n\nOWNER TASKS = ACT, NOT TALK: when the owner gives you a task that changes THIS app (fix / add / move / adjust / repair / improve something in the product) — even without the word «construiește» — START it THIS turn: call build_software with a complete, self-contained order (or repo_write for a tiny single-file change), then tell him the order is queued and a PR will follow. Do NOT just describe how you would do it, do NOT promise to do it later, and NEVER claim it is done unless you actually queued the order or wrote the code this turn. Describing a change is not making it.`
      // OCHII DE ADMIN, MEREU DISPONIBILI (owner, 14 aug: „kelion spune că nu poate
      // vedea err din server, F12, și nu are acces pe admin" — deși LE ARE). Regula
      // „folosește-ți uneltele" stătea în blocul de LUCRU, tăiat pe turele de
      // conversație — de-aia pe un simplu „vezi erorile" răspundea „nu pot". Acum e
      // AICI, mereu-pornit pentru admin, ca să știe ce POATE citi și că trebuie s-o facă.
      systemPrompt +=
        `\n\nYOU ARE THE ADMIN WITH FULL READ ACCESS — ON EVERY TURN, including plain chat. You CAN see, and you MUST USE these whenever the owner asks about errors, logs, admin data, or «why doesn't X work»: server_logs (YOUR server-side errors/logs — the server F12), client_errors (the users' BROWSER F12 errors, on demand), admin_vezi (any Admin-panel section: finance, users, money-circuit…), db_query/db_tables (the database), read_source/search_source (your own code). The owner's RECENT browser (F12) errors are ALSO injected into your context under «BROWSER CONSOLE» — read them there. NEVER answer «I can't see the server errors», «I can't see F12», or «I don't have admin access» — you have all of these. If a tool returns nothing, say plainly «no errors in that window» — that is NOT «I can't see». You are logged-in as admin, and that alone gives you these powers: a voiceprint mismatch never removes them.`
    }
    // GPS must NEVER delay the reply: only synchronous cache reads happen here.
    // The place-name/IP lookups run in the background and are ready for the
    // next turn; the raw lat/lon (all the skills need) is injected immediately.
    // The location truth is resolved ONCE (resolveDeviceLocation) and shared
    // with the get_weather guard in runTool — prompt and tool can never
    // disagree about where the user is.
    const deviceLoc = resolveDeviceLocation(req.body?.coords, geoLookupCached(clientIp(req)))
    if (deviceLoc.gps) {
      const place = reverseGeocodeCached(deviceLoc.gps.lat, deviceLoc.gps.lon)
      systemPrompt +=
        `\n\nThe user's current device location (live GPS) is latitude ${deviceLoc.gps.lat.toFixed(5)}, longitude ${deviceLoc.gps.lon.toFixed(5)}` +
        (place ? ` — approximately ${place}.` : '.') +
        ` When the user says "here", "near me", "where am I", or asks about weather, places, directions or anything location-dependent without naming a place, use THIS location. For local weather, pass these exact lat/lon to get_weather (don't rely on a place name).`
    } else if (deviceLoc.approxPlace) {
      // GPS not available yet (permission not yet answered, denied, or the very
      // first turn racing the browser's fix) — fall back to a city-level guess
      // from the request IP (same lookup the visitor-analytics beacon uses) so
      // Kelion is never left with zero location awareness.
      systemPrompt +=
        `\n\nThe user's approximate location (from their network, precise GPS not yet available) is ${deviceLoc.approxPlace}. Use this ONLY as a rough fallback for "near me"/weather/local questions — mention it's approximate if precision matters, and prefer exact GPS the moment it's available.`
    } else {
      // NO LOCATION AT ALL (the "27° without GPS" fix): the void is DECLARED,
      // so the brain answers "I don't have your location" instead of quoting
      // live weather for an invented city.
      systemPrompt += LOCATION_NONE_PROMPT
    }

    // Kelion's built-in sense of "now" — the client's real local date/time, so he
    // always knows today's date and the current time without being asked.
    // The time anchor — shared formatting (services/timeContext.ts), no
    // duplication.
    // Ancora de timp e MEREU prezentă acum (4 aug): dacă browserul n-a trimis
    // ora, cade pe ceasul serverului — Kelion nu mai rămâne fără „acum".
    const nowCtx = formatNowContext(req.body?.now, req.body?.tz)
    systemPrompt +=
      `\n\nCURRENT DATE & TIME: right now it is ${nowCtx.human} (timezone ${nowCtx.tzName}). You ALWAYS know the current date and time — when the user directly asks what time or date it is, or if you know it, ANSWER with this exact value, confidently, never deny knowing it. Otherwise use it silently only when relevant (scheduling, "today", "tomorrow"). When you state a clock time, ALWAYS write it numerically (e.g. "15:04"), never spelled out in words. Just don't volunteer or narrate it unprompted (e.g. in greetings) when the user hasn't asked.`

    // Owner-only (REWRITTEN Jul 25 — real incident: Adrian asked for a repair
    // and Kelion only TALKED about "taking care of it" without executing
    // anything; the old instruction "you sent it to be built" predated the real
    // tools and taught him exactly that anti-behavior). Now: EXECUTE, do not
    // promise.
    if (user.role === 'admin' && !turaDeOaspete) {
      systemPrompt +=
        // BLOCURILE DE LUCRU (reparat, PR, runbook, constructor, clipuri) NU
        // pleacă pe o tură de conversație — acolo sunt doar greutate. Vin
        // înapoi, întregi, în clipa în care se cere o acțiune sau creierul
        // escaladează prin `ask_brain`.
        (turaCurata ? '' : `\n\nOWNER — ACT, DON'T DEFER: you are talking to Adrian, your owner, and you are FULLY AUTONOMOUS with REAL tools. When he asks for a repair, a change, or an operation: DO IT NOW, in this conversation, with your tools — read_source/search_source to find the cause; repo_write + repo_open_pr + repo_merge_pr to SHIP the fix yourself (your merge auto-deploys to production); run_runbook for operations (diagnostic, restart-app, publish-master, loguri-app...). THE COMPLETE AUTONOMY FLOW for a code fix: (1) read_source/search_source to find the cause; (2) repo_write to write the fix on a branch; (3) ruleaza_portile to verify your change passes all gates (tsc, tests, lint, hardcodari) — this is MANDATORY before merge, the merge tool REFUSES without a recent passing gate run; (4) repo_open_pr to open the PR; (5) repo_merge_pr to merge it (auto-deploys to production); (6) runbook_status or list_updates to VERIFY the deploy landed live. NEVER stop at step 2 — a fix that is written but not merged and deployed is NOT done. If the gates fail at step 3, fix what failed and re-run them before merging. As you work, narrate CONCRETELY what you are doing: which file and line, which branch, the PR number, the Actions link — so Adrian can watch the work happen. NEVER say "I'll have it built", "I've sent it to be fixed" or "my developer will handle it" — there is no other developer, YOU are the builder now. Use log_unsupported_request ONLY for things genuinely impossible with all your tools. If a fix is too big for one turn, state the exact steps and START step 1 immediately (worst case: request_repair to file the order durably) — never a dead end, never an empty reassurance. IF YOU SAY YOU WILL ANALYSE, ANALYSE — ON SCREEN (Adrian, 31 Jul: "when he says he will analyse, he must FACTUALLY open the monitor and show what he is doing"). The words "analizez", "mă uit", "verific", "let me look into it" are a PROMISE, and until now they were where turns died: it sounded like work, and he was left staring at an empty screen. From now on, the moment you say any of them, IN THE SAME TURN: (1) call show_document FIRST with what you are about to look at, so the monitor lights up before the waiting starts; (2) actually call the tools (read_source, search_source, db_query, system_health, runbook_log — whatever fits); (3) call show_document AGAIN with what you FOUND — file and line, the log excerpt, the query result. If you have nothing to look with, say so plainly instead of promising. Never announce an analysis you do not immediately perform and display. MAKE YOUR WORK VISIBLE: you CAN see your own internal processes — runbook_status (latest runs of your workflows) and runbook_log (the full real log of a run) — and you CAN display them: call show_document (title + text) to put your progress and results ON THE MONITOR while you work (what you started, run status, the relevant log excerpt, the deploy proof). Never tell the owner "I can't see my internal processes" or "I can't show this on the monitor" — you have both tools; use them. ANSWER WHAT HE ASKED — DON'T RAMBLE SYSTEM STATUS (Adrian, 3 aug: „bate câmpii" — every reply opened with the same system-problems monologue instead of answering): answer EXACTLY what Adrian asked and ONLY that. Do NOT open replies with unsolicited system status, health, deploy state, failed build orders, or reserve/limit reports, and do NOT call system_health or constructor_status on your own initiative unless he ASKS about status/health/builds, or it is directly needed to carry out what he asked. Surface a system problem ONLY when it directly blocks the request he just made — then in ONE short sentence, after doing the task — or when he explicitly asks how things are, in which case say them briefly and, if he wants, repair them with your own tools (no permission question). Never lead an answer with problems he did not ask about. SELF-INSTALL WHAT YOU LACK (never stop at "I don't have that library/tool"): when a task needs a dependency you don't have — an npm package, or a system tool — ADD it yourself the DURABLE way, through the constructor: order build_software to add the npm package to backend/package.json (or the system package to the Dockerfile's apt-get line), which builds with tests and opens a PR; once it merges, the image rebuilds and the dependency is LIVE and permanent (it survives redeploys). For a tiny change you may instead use repo_write on package.json/Dockerfile + repo_open_pr directly. Say which package and why, order it, then finish the task once it is deployed. NEVER run an ad-hoc live "apt install"/"npm install" on the server as the way to gain a capability — that is ephemeral and unsafe; the package.json/Dockerfile route is the only permanent, auditable one. Only say you cannot when a thing is truly impossible, not merely missing a package.`)
      // NO CONFIRMATIONS TO THE OWNER (Adrian, Jul 31). The general rule above
      // ("confirm only before irreversible ones") is written for public users.
      // Here it is the owner: if he asked for something, the request IS the
      // approval — asking him again is wasted time, not safety. The only thing
      // still asked about is what he did NOT request: collateral deletion, a
      // destructive step you inferred yourself. That is not a security
      // confirmation; it is avoiding something nobody asked you to do.
      systemPrompt +=
        (turaCurata ? '' : `\n\nOWNER — NO CONFIRMATIONS: this overrides the general "confirm before irreversible actions" rule, which is for public users. When the owner asks for something, the request IS the authorisation: send, delete, merge, restart, run the runbook — DO IT, then report what you did. Never answer with "shall I proceed?", "are you sure?", "do you want me to?" or any other permission question about the thing he just asked for. Also never ask him to unlock, authenticate, or confirm his identity in chat — being in this conversation already proves he is the owner. The ONE exception is an action he did NOT ask for: if carrying out his request would additionally destroy something he never mentioned (dropping a table to fix a query, deleting files to free space, force-pushing over work), name that specific side effect in one sentence and ask about THAT alone — never about the request itself. Same for the health check: if system_health reports problems, say them briefly and repair them; don't ask permission first.`)
      // THE UPDATE CHANNEL: Kelion knows from the prompt WHAT it received at the
      // latest deploy (local file, cached on first read — zero latency cost).
      const upd = await latestUpdateSummary().catch(() => '')
      if (upd) {
        systemPrompt +=
          `\n\nYOUR LATEST UPDATES (the newest commits you received at the most recent deploy, newest first):\n${upd}\nWhen the owner asks what's new, what changed, or what update you received, answer from this list — and call list_updates for the fuller recent history. Never claim you don't know what your updates were.`
      }
      systemPrompt +=
        `\n\nPROMO CLIPS (owner only): when the owner asks for a promo clip ("filmuleț", "clip", "reclamă") about a subject, standard lengths are 15, 30 or 60 seconds — but ANY duration up to 10 minutes (600 seconds) is supported; use exactly what the owner asks for. The result must look PROFESSIONAL: a spoken script plus a shot list of live demo scenes that showcase what Kelion can do, timed to the narration; during recording the script text is NOT displayed (voice only, clean frame, admin interface hidden, site address watermarked). Step 1: WRITE the spoken script in chat, sized to the requested length (about 35 words for 15s, 75 for 30s, 150 for 60s — roughly 150 words per minute for longer clips), briefly list the planned scenes. Step 2: IN THE SAME TURN — his request for a clip IS the authorisation, never stop to ask for a "da" — if the shot list includes an image scene, FIRST call generate_image to create it, THEN call prepare_promo_clip with the script and the scenes (kind avatar/map/weather/image; avatar at second 0, scenes timed to match the words; image scenes use the /api/image/ URL from generate_image). Then tell the owner to press the pulsing red Rec button and pick the screen — everything else is automatic. If the owner asks for changes, revise and ask again. If no duration is given, ask which of 15, 30 or 60 seconds. CLIP LANGUAGE: the spoken script is written in WHATEVER language the owner asks the clip to be in (English, Spanish, Japanese — any language; you CAN do this, it is fully supported, the narration voice follows automatically via the tool's lang parameter). If no language is mentioned, use the owner's language. This is like a requested translation: your own commentary around the script stays in the owner's language, but the script content itself is in the clip's language. SERIA DE EPISOADE: clipurile sunt o SERIE (ep1, ep2…). ÎNAINTE să scrii un clip nou, cheamă episoade_promo ca să vezi ce ai filmat deja și unde ai rămas, și CONTINUĂ de acolo (fiecare clip pregătit se salvează automat ca episodul următor). Când ownerul întreabă „unde am rămas / ce am filmat / ce episoade am", cheamă episoade_promo și spune-i.`
    }
      // PREZENTĂRI (owner, 23 aug 2026: „prezentari nu merge, nu face corect
      // cu imagini, cu scris, nu intreaba limba, nr de sliduri etc"):
      // Kelion TREBUIE să întrebe ÎNAINTE de a crea: limbă, număr de slide-uri,
      // dacă vrea imagini. Nu creează din prima — cere preferințele.
      systemPrompt +=
        `\n\nPREZENTĂRI (create_presentation): CAND userul cere o prezentare/prezentare/slides/deck, NU o creezi din prima. ÎNTREABĂ ÎNTÂI: (1) În ce LIMBĂ vrei prezentarea? (dacă nu specifică, întreabă — nu presupune). (2) Câte SLIDE-URI vrei? (dacă nu specifică, sugerează un număr rezonabil pentru subiect și întreabă). (3) Vrei IMAGINI pe slide-uri? Dacă da, ce fel — diagrame, foto, grafice? (dacă vrea imagini, folosește câmpul image_url per slide cu URL-uri publice, sau cheamă generate_image ca să creezi imagini pentru slide-uri). După ce userul răspunde, construiești conținutul bine structurat ÎN LIMBA aleasă și apelezi create_presentation cu title, language, și slides (fiecare cu title, body, optional image_url, optional layout). FIECARE slide are conținut real, bine scris — nu placeholder-uri.`
      // FORMULARE (owner, 23 aug 2026: „trebuie sa fie in stare sa identifice
      // subiectul necesar si sa crieze automat un set de intrebari care acopera
      // complet subiectul"):
      // Kelion identifică SUBIECTUL din cerere, generează AUTOMAT un set COMPLET
      // de întrebări care acoperă tot subiectul, cu tipul potrivit per întrebare.
      systemPrompt +=
        `\n\nFORMULARE (create_form): CAND userul cere un formular/form/sondaj/chestionar/înscriere, IDENTIFICĂ subiectul din cerere și GENEREAZĂ AUTOMAT un set COMPLET de întrebări care ACOPERĂ ÎNTREGUL subiect — nu 2-3 întrebări vagi, ci un set thorough, bine structurat. ALEGE tipul potrivit pentru fiecare întrebare: text (nume, date scurte), paragraph (feedback detaliat, comentarii), multiple_choice (o singură alegere), checkboxes (multi-selecție), dropdown (liste lungi), scale (evaluări 1-5), date (date calendaristice), time (ore). Pentru multiple_choice/checkboxes/dropdown, genereazi TU opțiunile relevante pentru subiect. ÎNTREABĂ userul DOAR ce nu a specificat: limba (dacă nu e clar), scopul (sondaj/înscriere/feedback/quiz), și numărul aproximativ de întrebări (sugerează tu un număr comprehensive pentru subiect). Scrie TOATE întrebările și opțiunile ÎN LIMBA userului. Exemplu: „fă-mi un formular de feedback pentru un curs" → identifici: feedback curs → generezi 8-12 întrebări: scale (calitate curs, instructor, materiale), paragraph (ce ți-a plăcut, ce poți îmbunătăți), multiple_choice (ai recomanda cursul?), text (nume, optional).`

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
    }
    // ȚEAVA DE REȚEA (12 aug, owner: „test care vede ce țeavă se folosește"):
    // clientul raportează treapta detectată. Creierul o ȘTIE — poate răspunde la
    // „ce țeavă am?" cu adevărul măsurat (nu inventează), iar pe țeavă slabă/medie
    // își scurtează răspunsul și nu deschide pagini grele/video nechemat.
    // MINIM 4G (owner, 13 aug: „nu cred că e realizabil 3G… treci 4G minim"). Nu
    // mai SUPRIMĂM nimic pe conexiune slabă — ruptura „vorbă fără faptă" e scoasă și
    // aici: ce spune Kelion că face, face (deschide harta/video/document oricum).
    // Rămâne DOAR raportarea măsurată + nota onestă că experiența completă e pentru 4G+.
    const retea = req.body?.retea
    if (retea === 'slab' || retea === 'mediu') {
      systemPrompt +=
        `\n\nNETWORK: the user's connection is measured as ${retea === 'slab' ? 'WEAK (2G / data-saver)' : 'MEDIUM (3G)'}, ` +
        `below the app's recommended minimum of 4G. If they ask "what connection am I on / ce țeavă am", answer with ` +
        `THIS measured value (never guess) and you MAY note that the full experience (fast voice, 3D avatar, live ` +
        `visuals) is built for 4G+. But do EVERYTHING they ask anyway — open the map, the video, the document, any ` +
        `surface they request; NEVER withhold or refuse one because of the connection. What you say you do, you do.`
    }
    // ANCORA CENTRULUI DE TRANZACȚIONARE (10 aug, ownerul: „trebuie chatul
    // real, conștient... să răspundă tuturor întrebărilor tehnice"): cât tabul
    // de trading e deschis, fiecare tură primește CIFRELE de pe ecran, iar
    // regulile de mentor (riscul întâi, doar pe real) intră în prompt. Rândul
    // NIVELURI din răspuns se desenează pe graficul lui (frame {niveluri}).
    const piata = isAdminUser ? req.body?.tranzactii : undefined
    if (piata?.simbol) {
      systemPrompt +=
        `\n\nCENTRUL DE TRANZACȚIONARE E PE ECRAN — ancora REALĂ a clipei: simbol ${String(piata.simbol).slice(0, 20)}, ` +
        `preț ${Number(piata.pret) || 'necunoscut'}, interval ${String(piata.interval ?? '?').slice(0, 6)}, sursă ${String(piata.sursa ?? '?').slice(0, 60)}. ` +
        `Ești mentorul lui de trading, cu riscul ÎNTÂI: răspunzi la ORICE întrebare tehnică de tranzacționare (cum funcționează platformele, tipuri de ordine, indicatori, strategii, mărimea poziției, management de risc, când intri/ieși) — pe înțeles, SCURT, doar pe cifre REALE (cele de pe ecran sau surse de net cu link și dată; ce nu ai măsurat spui că nu ai de unde ști). NU promiți câștiguri, NU spui „sigur", NU plasezi ordine. ` +
        `Când dai niveluri concrete pe simbolul de pe ecran (intrare/ieșire/stop/țintă/suport/rezistență), încheie răspunsul cu rândul mașină-citibil, pe rând separat: NIVELURI: intrare=…; stop=…; tinta=…; suport=…; rezistenta=… — doar cele care există; rândul se DESENEAZĂ pe graficul lui. ` +
        `ARATĂ, NU DOAR SPUNE: ori de câte ori explici ceva pe grafic, CHEAMĂ unealta arata_pe_grafic ca să-l DESENEZI, cu una sau mai multe din: «puncte» (preț REAL + tip + etichetă) = POINTERI-linie; «zone» (pret1+pret2+tip+etichetă) = BANDĂ colorată între două prețuri („zona de acumulare 63.000–63.500"); «sageti» (directie sus/jos + unde cursor/ultima + etichetă) = SĂGEATĂ fix pe o lumânare reală („uite respingerea aici"); «trend» (pret1→pret2) = LINIE DE TREND prin două prețuri. Totul fix pe cifrele REALE de pe ecran, ca omul să VADĂ exact la ce te referi. Ca să ștergi tot ce ai desenat, cheamă cu curata:true.`
      // MOUSE-UL PE GRAFIC (10 aug, ownerul: „kelion trebuie să vadă când pun
      // mouse-ul exact peste orice poziție din grafic"). Iframe-ul graficului
      // trimite lumânarea de sub cursor; o punem în ancoră ca s-o „vadă" exact.
      const pv = piata.peste
      if (pv && (typeof pv.c === 'number' || typeof pv.o === 'number')) {
        const nr = (x?: number | null): string => (typeof x === 'number' && Number.isFinite(x) ? String(x) : '—')
        // `.toISOString()` pe o Dată invalidă aruncă RangeError — deci un `pv.t`
        // numeric aiurea ar fi rupt tura (nu doar trading-ul). Verificăm întâi.
        const dp = typeof pv.t === 'number' ? new Date(pv.t) : null
        const cand = dp && !Number.isNaN(dp.getTime()) ? dp.toISOString().slice(0, 16).replace('T', ' ') : String(pv.t ?? '?').slice(0, 24)
        systemPrompt +=
          `\n\nMOUSE-UL E EXACT PESTE un punct din grafic (îl VEZI acum, nu ghici): lumânarea ${cand} — O ${nr(pv.o)}, H ${nr(pv.h)}, L ${nr(pv.l)}, C ${nr(pv.c)}, volum ${nr(pv.vol)}, MA20 ${nr(pv.ma20)}, EMA50 ${nr(pv.ema50)}. Dacă te întreabă „ce e aici / peste ce sunt / ce arată punctul ăsta / ce lumânare e asta", răspunde pe ACESTE cifre.`
      }
    }
    if (!(Array.isArray(screen) && screen.length > 0)) {
      // THE EMPTY MONITOR (Adrian, Jul 27, live proof: "open YouTube on the
      // monitor" → "there is nothing on the monitor" instead of execution):
      // empty is the normal starting state, not an obstacle to report.
      systemPrompt +=
        `\n\nMONITOR STATE: the monitor is currently EMPTY — its normal starting state, never an obstacle and never something to report. A command like "deschide/pune/arată pe monitor X" (open/put/show X on the monitor) is an ORDER to open X right now with the matching tool (youtube_search for videos/music, maps_search, get_weather, browser_open, show_document, generate_image...). NEVER answer that there is nothing on the monitor, and never call browser navigation tools (browser_click/browser_read/browser_type) before something is actually open.`
    }

    // Memory agent (recall): inject the durable facts Kelion has learned about
    // this user so the conversation is continuous across sessions. Read above
    // (the single trip to the database).
    systemPrompt += memRecall
    // N val 2d: memoria SEPARATĂ de trading, doar cât Centrul e ancorat (șir gol
    // altfel). Astfel conversația normală „își amintește" ce ați discutat pe
    // simbolul de pe ecran, nu doar butonul Analiză.
    systemPrompt += memRecallTrading
    // MEMORIA UNIFICATĂ voce↔scris (9 aug, ownerul: „trebuie să preia și din
    // audio sau invers din scris istoricul, indiferent modalitatea"). Creierul
    // scris construia contextul DOAR din array-ul clientului (turele de pe
    // ecran) — orb la ce se vorbise în sesiunea live (salvat în DB, dar nu în
    // array). Aici lipim turele din DB care NU-s în transcriptul curent (de
    // regulă cele VORBITE), deduplicat, ca să nu mai spună „n-am căutat nimic"
    // după ce a căutat prin voce. Invers mergea deja (calea vocală citește DB).
    systemPrompt += memorieUnificata(istoricDb, messages, 12, ro)

    // ── BIOMETRICS (voice + face) — account holder vs. someone else ──────────
    // Adrian: "nothing directly in chat, everything in parallel, so it doesn't
    // slow down the chat". Therefore: (1) descriptors are extracted 100%
    // client-side (zero server cost); (2) the two reference reads run IN
    // PARALLEL (one DB round trip, not two serial ones); (3) enrollment writes
    // are fire-and-forget (NOT awaited — `void`), so they add no ms to the
    // reply path.
    const vf = req.body?.voiceFeatures
    const fd = req.body?.faceDescriptor
    const hasVoice = !!(vf?.vector?.length && vf?.meta)
    const hasFace = Array.isArray(fd) && fd.length >= 64
    if (hasVoice || hasFace) {
      const isOwnerByEmail = user.email.toLowerCase() === config.adminEmail.toLowerCase()
      // Reference reads — in parallel (not serial).
      const [storedVoice, storedFace] = await Promise.all([
        hasVoice ? getVoiceprint(user.email) : Promise.resolve(null),
        hasFace ? getFaceprint(user.email) : Promise.resolve(null),
      ])

      // VOICE — account holder vs. someone else. We compare against the
      // holder's OWN reference (not "any nearby voiceprint in the DB"). A STABLE
      // reference: fixes the old bug that overwrote it on every turn with the
      // current voice → if someone else spoke, the holder's reference became
      // corrupted. Now we save ONLY on the first voice (enrollment) or when the
      // current voice matches (fine adaptation).
      if (hasVoice && vf) {
        const gender = inferGender(vf.meta.pitchMedian ?? vf.meta.pitchMean)
        const hasRef = !!storedVoice?.features?.length
        const refDist = hasRef ? vectorDistance(vf.vector, storedVoice!.features) : Infinity
        // ONE threshold for holder and guests alike (services/voiceMatch.ts).
        const isAccountHolder = refDist < VOICE_MATCH_THRESHOLD
        if (!hasRef || isAccountHolder) {
          void saveVoiceprint(
            {
              email: user.email,
              name: user.name || storedVoice?.name || user.email.split('@')[0],
              gender,
              isAdmin: isOwnerByEmail,
              features: vf.vector,
              featureMeta: vf.meta,
              audioClip: typeof vf.clip === 'string' ? vf.clip : '',
            },
            // Adaptation (blend + stable gender) — never a blind overwrite.
            { adapt: hasRef && isAccountHolder },
          )
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

      // FACE — when the camera is on, the frontend AUTOMATICALLY captures (on
      // voice, with no button) the speaker's face and sends the 128-d
      // descriptor. Same stable-reference discipline as voice; the standard
      // face-api threshold = 0.6.
      if (hasFace && fd) {
        const hasFaceRef = !!storedFace?.descriptor?.length
        const fDist = hasFaceRef ? faceDistance(fd, storedFace!.descriptor) : Infinity
        const isFaceHolder = fDist < 0.6
        // AL DOILEA FACTOR PENTRU CARD (Adrian, 5 aug): un MATCH real al feței
        // ownerului (nu prima înrolare) deschide fereastra de 15 min a feței —
        // exact ca vocea în realtime.ts. Cardul M6 cere AMBELE ferestre + admin.
        if (isOwnerByEmail && hasFaceRef && isFaceHolder) marcheazaFata(user.email)
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

      // TOTAL DISCRETION (Adrian, Jul 14: "everything that needs calibrating
      // Kelion does throughout the chat, automatically, without buttons or chat
      // about it, very discreetly"). The biometric clues above are INTERNAL,
      // SILENT context.
      systemPrompt +=
        '\n\nINDICII INTERNE (TĂCUTE) — DISCREȚIE ABSOLUTĂ: informația de mai sus despre voce/față ' +
        '(cine vorbește, gen, titular/altcineva, „fața recunoscută") e DOAR pentru tine, ca să te ' +
        'comporți potrivit. NU o pomeni NICIODATĂ cu voce tare: nu spune că recunoști vocea sau fața, ' +
        'că identifici, calibrezi, înveți sau „vezi" cine e, nu descrie persoana și nu comenta camera. ' +
        'Folosește-o strict discret (ex. prudență cu datele personale dacă e altcineva). Zero cuvinte despre procedură.'
    }

    // CONTINUITY BETWEEN SESSIONS (#20): if the last conversation was a long
    // time ago, Kelion KNOWS this is a reunion (not a continuous thread) and
    // greets naturally with continuity. Pure DB — the timestamp read in
    // parallel above, zero cost.
    // istoricDb vine ASC (cel mai vechi primul) → cel mai RECENT e ultimul rând.
    const ultimSalvat = istoricDb.at(-1)
    const lastSavedAt = ultimSalvat?.created_at ? new Date(ultimSalvat.created_at).getTime() : 0
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
    // PHOTO ≠ SIGHT — TWO separate paths (Adrian, Jul 24: "don't mix them"):
    //   1. THE UPLOADED PHOTO (explicit attachment) — always analyzed, alone;
    //      before, the camera frames REPLACED it if the camera was on.
    //   2. THE CAMERA (continuous sight) — frames go out ONLY when the user
    //      asks something visual (VISION_INTENT: "can you see me", "what do
    //      you see", "describe", etc.).
    const reqImageSource = (req.body as any)?.imageSource || (imageIsAttachment ? 'chat' : 'camera')
    const attachedPhoto = imageIsAttachment && image ? [image] : []
    const camView = camFrames.length > 0 ? camFrames : !imageIsAttachment && image ? [image] : []
    // Read by selectedBrainModel — forces the step with real sight (see there).
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
        // KELION VEDE CÂND NU VEDE (Adrian, 12 aug): a cerut ceva vizual în scris
        // și n-a existat niciun cadru (camera oprită / captura picată) → nu mai
        // cade tăcut, se notează ca simptom ca autovindecarea să ajungă la el.
        if (attachedPhoto.length === 0 && camView.length === 0 && VISION_INTENT.test(lm.content)) {
          void recordSimptomLive('fara-vedere', `scris: cerere vizuală fără cadru — „${lm.content.slice(0, 100)}"`).catch(() => {})
        }
        if (toSend.length > 0) {
          turnHasImage = true
          const strip = (s: string): string => (s.includes(',') ? s.slice(s.indexOf(',') + 1) : s)
          const isChatImage = attachedPhoto.length > 0 || reqImageSource === 'chat'
          const imagePrefix = isChatImage ? '[Imagine trimisă de utilizator în chat]' : '[Cadru preluat automat de cameră]'
          params[lastIdx] = {
            role: 'user',
            content: [
              ...toSend.map((f) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: strip(f) },
              })),
              { type: 'text', text: imagePrefix + '\n' + lm.content },
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
    // THE JUL 10 FREEZE: while the brain thinks (legitimately 60–80s), NOT ONE
    // byte left the wire — Cloudflare cuts the silent connection (QUIC reset on
    // /api/chat, 524 on /resume after 100s), the turn dies, and the app waits
    // forever for a dead turn (chat "ignores"). The safety net: every 15s of
    // silence we send a commented SSE heartbeat — it keeps the connection alive
    // through Cloudflare and does not translate into text or control frames on
    // the client.
    let lastByteAt = Date.now()
    // A TURN NEVER ENDS IN SILENCE (Adrian, Jul 30: "reply = nothing").
    // `sawVisible` becomes true on ANY output the human actually sees: brain
    // text, a surface frame (monitor/card/doc/app/image/build/nav/promo/
    // gesture/voice), or a device action. PURE-protocol frames
    // ({turn}/{heard}/{lang}/{receipt}/{ping}/{desync}) and the heartbeat do NOT
    // count — they leave even when the brain has not said a word. If nothing was
    // seen by the end, we write an honest message: a silent error is still an
    // error (rule no. 1), not "nothing". The interceptor is the right place — it
    // sees ALL writes (text, tools, agents, voice) without touching every call
    // site.
    let sawVisible = false
    // While the INSTANT ack is being written (heavy admin turn), the chunk is
    // a receipt, not the reply — it must NOT flip `sawVisible` (see
    // conteazaCaVizibil above). Plain flag around a synchronous write.
    let ackInstantZbor = false
    // ── BARA DE EXECUȚIE PE MONITOR (owner, 14 aug: „să arate fiecare pas pe
    // monitor pe care îl întreprinde, cu bara de evoluție de la 0 la 100%
    // actualizată live") ────────────────────────────────────────────────────
    // Fiecare unealtă chemată pe o tură de EXECUȚIE = un pas REAL, emis pe loc
    // ca frame {executie}. Procentul urcă asimptotic spre 95% cu fiecare pas
    // (numărul total de pași nu se știe dinainte — a-l pretinde ar fi cifră
    // inventată, regula #1); 100% se scrie O SINGURĂ dată, la închiderea REALĂ
    // a turei (interceptorul de end), nu dintr-o afirmație.
    let pasiExecutie = 0
    // A SURFACE ON THE MONITOR this turn (Adrian, Aug 2 — "TOT pe monitor"): the
    // auto-preview post-step at the end of the turn must never duplicate what a
    // tool already pushed. The interceptor sees every write, so it is the one
    // place that knows for sure. Surface frames: {monitor} (with a NON-empty
    // url — the empty one is a screen CLEAR), {doc}, {app}, {card}, {build}.
    let surfaceShown = false
    reply.raw.write = ((chunk: unknown, ...rest: unknown[]) => {
      lastByteAt = Date.now()
      if (typeof chunk === 'string' && chunk.length > 0) {
        if (!sawVisible) sawVisible = conteazaCaVizibil(chunk, ackInstantZbor)
        if (!surfaceShown) surfaceShown = eCadruDeSuprafata(chunk)
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
      // Bara de execuție se închide la sfârșitul REAL al turei: 100% înseamnă
      // „tura s-a încheiat" (rezultatul — bun sau eșec cinstit — e în text și
      // în pași), niciodată un „gata" declarat înainte de vreme.
      if (pasiExecutie > 0 && !reply.raw.writableEnded && !reply.raw.destroyed) {
        pasiExecutie = 0
        try {
          reply.raw.write(`${CTRL}${JSON.stringify({ executie: { pas: 'Tura încheiată', procent: 100, gata: true } })}${CTRL}`)
        } catch { /* progresul nu are voie să omoare închiderea turei */ }
      }
      finishTurn(user.email, turnId)
      return (rawEnd as (...a: unknown[]) => unknown)(...args)
    }) as typeof reply.raw.end
    // Client gone (tab closed, network dropped) without end(): stop the pulse
    // anyway.
    reply.raw.on('close', () => clearInterval(pingTimer))
    // Announce the turn id FIRST so the client can resume from the very start.
    reply.raw.write(`${CTRL}${JSON.stringify({ turn: turnId })}${CTRL}`)
    // The language the client follows (recognizer + local mirror): the admin is
    // ALWAYS ro-RO (locked), the rest get the detected switch. Idempotent on
    // the client (applyLang only changes when it differs), so it does not
    // disturb the microphone.
    if (announceLang) reply.raw.write(`${CTRL}${JSON.stringify({ lang: announceLang })}${CTRL}`)

    // Persist the user's new message (last turn).
    const lastTurn = messages.at(-1)
    const lastUserText = lastTurn?.role === 'user' ? lastTurn.content : ''
    // JURNALUL OPERAȚIONAL: un task are un UUID separat de turn, dar poartă
    // aceeași corelare. Scrierile sunt serializate ca evenimentele să nu ajungă
    // invers când modelul cheamă mai multe unelte; output-ul brut nu pleacă
    // niciodată spre DB, numai nume/cod/stare normalizate.
    const sarcinaOperationalaId = randomUUID()
    let lantJurnalOperational: Promise<unknown> = inregistreazaSarcinaOperationala({
      id: sarcinaOperationalaId,
      userEmail: user.email,
      turnId,
      objective: lastUserText || (voceAmbianta ? '(mesaj vocal)' : '(mesaj fără text)'),
      metadata: {
        source: 'chat',
        spoken: req.body?.spoken === true,
        ambientVoice: voceAmbianta,
        // Originea vocală a ușii (JARVIS pasul 4): fără marcajul ăsta, o faptă
        // făcută cu VOCEA apărea în jurnal identic cu una scrisă — dovada
        // scoasă la provocare nu putea spune „asta ai cerut-o vorbind".
        usaCreierului: eUsaCreierului,
        continuareUsa: req.body?.continuareUsa === true,
      },
    })
    const scrieJurnalOperational = async (scriere: () => Promise<unknown>): Promise<void> => {
      lantJurnalOperational = lantJurnalOperational
        .then(scriere)
        .catch((eroare) => console.error('[jurnal operațional] eveniment pierdut:', String(eroare).slice(0, 160)))
      await lantJurnalOperational
    }
    await scrieJurnalOperational(() => tranzitioneazaSarcinaOperationala({
      taskId: sarcinaOperationalaId,
      stare: 'interpreting',
      code: 'context_prepared',
      metadata: { source: 'chat' },
    }))
    // (Vorbitorul — speakerRaw/guestMatch/nevalidat — e parsat SUS, înaintea
    // construcției promptului: blocurile de OWNER se decid pe el, audit 9 aug.)
    // PROGRESS BAR ON BRAIN ENTRY — ONE {heard} for EVERYONE (admin, demo,
    // public, paying): the server confirms exactly the text handed to the brain
    // on this turn, and the UI band displays it. It is not a local echo — if
    // the band does not change when you speak, the voice died BEFORE the brain.
    // VOCE AMBIENTALĂ: NU confirmăm încă „ce-am auzit" și NU salvăm mesajul
    // userului — nu știm încă dacă i se adresează creierului. Creierul decide din
    // audio; dacă e adresat, scrie {heard: <ce a auzit>} devreme în stream și
    // salvăm atunci; dacă tace (<TAC/>), nu apare nimic și nu se salvează nimic.
    if (!voceAmbianta) {
      reply.raw.write(`${CTRL}${JSON.stringify({ heard: lastUserText.slice(0, 500) })}${CTRL}`)
      // ușa creierului: tura reală o salvează ruta vocală, la verdict (vezi sus)
      if (lastTurn?.role === 'user' && !eUsaCreierului) void saveMessage(user.email, 'user', lastTurn.content)
    }

    // THE GUEST CONTEXT FOR THE BRAIN (only the model sees it — the saved
    // bubble and the {heard} band stay the guest's clean words).
    if (guestMatch && messages.at(-1)?.role === 'user') {
      const last = messages[messages.length - 1]
      last.content =
        (guestPending
          ? `[NOTĂ DE SISTEM — vorbitorul este un OASPETE NOU: ${guestLabel}. Amprenta lui a fost salvată NEAPROBATĂ. Prezintă-te politicos, răspunde-i la întrebare, apoi ROAGĂ-L pe titular (în aceeași cameră) să confirme dacă păstrezi vocea și relația — se confirmă cu unealta approve_guest_voice. INTERZIS: orice acțiune administrativă, financiară sau distructivă în această tură.]\n\n`
          : `[NOTĂ DE SISTEM — vorbitorul este un OASPETE APROBAT al titularului: ${guestLabel}. Răspunde-i normal, în limba lui, dar cu drepturi de oaspete: INTERZIS orice acțiune administrativă, financiară sau distructivă; pentru așa ceva cere-i să-l cheme pe titular.]\n\n`) +
        last.content
      // The guest's photo: if the camera caught a face on this turn, it becomes
      // the guest's portrait in Admin → Amprente.
      if (guestId && typeof req.body?.facePhoto === 'string' && req.body.facePhoto)
        void attachGuestPhoto(guestId, req.body.facePhoto)
    }

    // IN CHAT, THE ADMIN SESSION IS ENOUGH (Adrian, Jul 31: "if I logged in as
    // admin, Kelion must no longer ask for any kind of security confirmation in
    // chat").
    //
    // What it was before: the Jul 27 lock required a SECOND factor (voiceprint
    // or typed secret, separate 12h cookie) for the admin tools to appear in
    // chat. Without it, the signed-in admin talked to Kelion like any ordinary
    // user — and found out only when Kelion "couldn't" read a file.
    //
    // What remains protected, and why it is fine for it to fall HERE: the lock
    // still guards `/api/admin/*` (the panel) and the voice gate — voice truly
    // needs the voiceprint, because anyone near the microphone can speak. Chat
    // does not: to write in it as admin you must already have his session.
    //
    // What we lose, written down so it is not lost: a stolen session cookie now
    // reaches the destructive chat tools directly, without a second factor.
    // The trade-off is the owner's, explicitly requested, with the risk stated.
    //
    // THE GUEST EXCEPTION (Adrian, Aug 1): a turn the voice gate labelled as
    // GUEST runs inside the holder's session, but the person at the microphone
    // is NOT the holder — so this turn gets ZERO admin powers, whoever is
    // logged in. (guestMatch is parsed above, before the save.)
    const isAdmin = user.role === 'admin' && !guestMatch

    // The turn's model is chosen HERE (before the tool list): on the CHAT step,
    // the model also gets the ask_brain tool so it can escalate whatever it
    // judges heavy itself; on the WORK step it does not (that would be
    // recursive — it IS the brain).
    const brainSel = await selectedBrainModel(user.email, lastUserText, modelChoiceKv, turnHasImage, voceAmbianta)
    const orChatModel = brainSel?.model ?? null
    const heavyTurn = brainSel?.heavy ?? false
    // ESCALADARE MODEL LA MIJLOCUL TUREI (owner, 20 aug: „modelul ușor/greu"):
    // obiect MUTABIL citit de orchestrator pe fiecare rundă. Când ușa `ask_brain`
    // decide „e greu" pornind de pe treapta UȘOARĂ, setează aici modelul greu +
    // gândirea adâncă — și restul turei urcă de fapt la creierul puternic, nu doar
    // deschide uneltele (golul măsurat: până acum `ask_brain` rămânea pe flash-lite).
    const escaladare: { model?: string; reasoning?: 'low' | 'medium' | 'high' } = {}

    // ── SINGLE PATH: DIRECT BRAIN FOR EVERYONE ───────────────────────────────
    // The Gemini orchestrator (chat/brain, with automatic escalation) answers
    // for EVERYONE — admin, free users and paying clients (paywall guaranteed
    // above) — instantly, with all tools. The real cost is debited from paying
    // clients' credits (debitWallet at the end of the turn); the admin is exempt.

    const NOTE_TOOLS = [SAVE_NOTE_TOOL, LIST_NOTES_TOOL, DELETE_NOTE_TOOL, LIST_MEMORIES_TOOL, CAUTA_ISTORIC_TOOL, DOVADA_FAPTELOR_TOOL, FORGET_MEMORY_TOOL]
    // UȘA DE ESCALADARE pe FAZA de vorbire, nu pe treapta de model (8 aug,
    // ownerul: „verifică de ce nu știe să escaladeze să ceară acces la unelte").
    // Vechea condiție (pe heavyTurn) lăsa turele VOCALE fără ușă: ele sunt
    // „heavy" ca MODEL (decid adresarea), dar ușoare ca unelte — deci o cerere
    // rostită care avea nevoie de o unealtă grea n-avea NICIO cale de
    // escaladare. Pe faza de decizie ușa nu are sens (inventarul e deja plin).
    const escalationTools = incarcatura.faza === 'vorbire' ? [ASK_BRAIN_TOOL] : []
    // SELF-EXTENSION: the dynamic tools APPROVED by the owner (active instantly,
    // without redeploy) + `propose_tool` so it can propose new ones.
    const dynTools = (await dynamicToolDefs().catch(() => [])) as unknown as Tool[]
    const dynNames = await dynamicToolNames().catch(() => new Set<string>())
    const rawTools: Tool[] = isAdmin
      ? // ORDINEA CONTEAZĂ la plafonul furnizorului de 64 (Adrian, 3 aug: „nu e
        // conștient de tot inventarul lui"). Cu 80 de unelte, 16 se taie din COADĂ.
        // Deci punem PRIMELE uneltele fără de care zice „nu pot" (memorie, mâini,
        // sursă, dezvoltator, DB, sănătate) și lăsăm la coadă pe cele ocazionale
        // (rol, cost, promo, secrete, cerințe, card, voci-invitați) — ele se taie
        // primele, nu uneltele de aur. Vezi plafonul de mai jos.
        [
          ...googleTools,
          ...escalationTools,
          // Bază + vedere
          SHOW_TOOL, SHOW_DOCUMENT_TOOL, GET_MONITOR_TOOL, OBSERVATII_VIZUALE_TOOL, EVENIMENTE_SONORE_TOOL, STARE_EMOTIONALA_TOOL, GOLESTE_MONITOR_TOOL, RUN_WEB_TOOL, IMAGE_TOOL, VIDEO_TOOL, VEDE_VIDEO_TOOL, TARIFE_TOOL, STUDIO_TOOL, OPEN_APP_VIEW_TOOL,
          // L1e: procesare de date tabelare (CSV/JSON) — capabilitate generală, în zona de aur.
          PROCESEAZA_DATE_TOOL,
          // Messenger Kelion↔Kelion: „apelează-l pe X" (conversațional, gold zone).
          APELEAZA_USER_TOOL,
          // Pointerii de indicație pe grafic — DOAR când Centrul de Tranzacționare
          // e deschis (altfel n-are pe ce desena); „arate clar pe monitor ce zice".
          ...(piata?.simbol ? [ARATA_GRAFIC_TOOL] : []),
          // Memorie + mâini (browser) — NU se mai taie
          ...NOTE_TOOLS,
          ...BROWSER_TOOLS,
          // Delegarea către cei 33 de agenți specialiști — creierul pune agentul
          // la lucru direct (Adrian, 4 aug). În zona care NU se taie la plafon.
          // + crearea unui agent NOU când lipsește tipul (Adrian, 10 aug).
          CHEAMA_AGENT_TOOL, AGENT_NOU_TOOL,
          // Sursă + putere de dezvoltator + DB/sănătate + operațiuni („de aur")
          LIST_SOURCE_TOOL, READ_SOURCE_TOOL, SEARCH_SOURCE_TOOL,
          REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL,
          BUILD_SOFTWARE_TOOL, PANOU_COD_TOOL, CONSTRUCTOR_STATUS_TOOL, CONSTRUCTOR_MANAGE_TOOL, CONSTRUCTOR_COMMAND_TOOL, AUTOVERIFICARE_TOOL,
          // Jules — agentul asincron oficial Google (3 aug, cheia pusă de owner).
          JULES_REPOS_TOOL, JULES_TASK_TOOL, JULES_STATUS_TOOL,
          DB_TABLES_TOOL, DB_QUERY_TOOL, SYSTEM_HEALTH_TOOL, SERVER_OPS_TOOL, SERVER_LOGS_TOOL, CLIENT_ERRORS_TOOL,
          LIST_APP_VERSIONS_TOOL, LIST_DB_BACKUPS_TOOL, SAVE_APP_VERSION_TOOL, RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL, REQUEST_REPAIR_TOOL,
          LIST_UPDATES_TOOL, READ_INBOX_TOOL, PROPOSE_TOOL,
          // LEGATE LA CREIER (5 aug, ordinul repetat „leagă TOT la creier"): astea
          // aveau executor real în adminTools.ts + erau în bucla de noapte, dar
          // NU erau oferite creierului din chat/voce — deci nu le putea chema.
          // În zona de aur (memoria de proiect + vederea/schimbarea adminului +
          // observabilitatea măsurată = fix ce cerea ownerul, nu se taie la plafon).
          ADMIN_VEZI_TOOL, ADMIN_SCHIMBA_TOOL,
          MEMORIE_PUNE_TOOL, MEMORIE_IA_TOOL, MEMORIE_LISTA_TOOL, STARE_MASURATA_TOOL,
          // SUITA DE MĂSURARE (8 aug): comandate în promptul de sistem (chat.ts
          // „ÎNAINTE SĂ SCHIMBI COD: rulează ruleaza_portile"; „de unde știi →
          // jurnal_masuratori"), cu executor real în adminTools.ts și oferite pe
          // voce+bucla de noapte prin TOATE_UNELTELE_ADMIN — dar UITATE din
          // rawTools-ul scris de mână al chatului (10 aug). Fără ruleaza_portile,
          // repo_open_pr/repo_merge_pr REFUZAU structural pe calea chatului
          // (dovadaPortilor() nu putea fi satisfăcută). Zona de aur, nu se taie.
          RULEAZA_PORTILE_TOOL, JURNAL_MASURATORI_TOOL, VANEAZA_BUGURI_TOOL,
          // ── COADĂ: se taie prima la plafon (ocazionale) ──
          SET_ROLE_TOOL, LOG_GAP_TOOL, COST_TOOL, PROMO_TOOL, EPISOADE_PROMO_TOOL,
          SECRET_PUNE_TOOL, SECRET_LISTA_TOOL, SECRET_PUBLICA_TOOL,
          CERINTA_NOUA_TOOL, CERINTE_LISTA_TOOL, CERINTA_PRIORITATE_TOOL,
          CARD_STARE_TOOL, CARD_COMPLETEAZA_TOOL, CARD_GATA_TOOL,
          ALLOW_GUEST_VOICE_TOOL, APPROVE_GUEST_VOICE_TOOL, FORGET_GUEST_TOOL,
        ]
      : [...googleTools, ...escalationTools, SHOW_TOOL, SHOW_DOCUMENT_TOOL, GET_MONITOR_TOOL, OBSERVATII_VIZUALE_TOOL, EVENIMENTE_SONORE_TOOL, STARE_EMOTIONALA_TOOL, GOLESTE_MONITOR_TOOL, RUN_WEB_TOOL, IMAGE_TOOL, VIDEO_TOOL, TARIFE_TOOL, STUDIO_TOOL, OPEN_APP_VIEW_TOOL, PROCESEAZA_DATE_TOOL, APELEAZA_USER_TOOL, SET_ROLE_TOOL, LOG_GAP_TOOL, PROPOSE_TOOL, ...NOTE_TOOLS, ...BROWSER_TOOLS, ALLOW_GUEST_VOICE_TOOL, APPROVE_GUEST_VOICE_TOOL, FORGET_GUEST_TOOL]
    // THE PROVIDER'S 64-TOOL CEILING (Aug 1 — live 400 "at most 64 tools are
    // allowed", every turn died): (1) DEDUPE by name — open_app_view was
    // registered twice (once alone, once inside BROWSER_TOOLS), and any future
    // pairing is absorbed here; (2) the self-proposed dynamic tools fill only
    // the slots left under the ceiling — a burst of approvals can never kill
    // the whole conversation again; (3) if the BASE alone ever reaches the
    // ceiling, we trim from the tail (the rarest tools) and log it loudly,
    // so the chat degrades instead of dying.
    // UNELTE COMPLETE PE GEMINI (Adrian, 3 aug: „nu are unelte complete" /
    // „leagă-i toate uneltele nativ de Gemini, tot ce are nevoie"). Plafonul 64
    // era al API-ului VECHI (OpenRouter, 400 „at most 64 tools", 1 aug) și tăia
    // ~16 unelte din coada adminului LA FIECARE TURĂ. Gemini acceptă 128 de
    // declarații de funcții — pe creierul google-direct intră TOT inventarul,
    // netăiat. Plafonul 64 rămâne doar pentru drumul OpenRouter (rezerva).
    // ── FAZELE (Adrian, 8 aug): „chatul este doar chat, depistarea cerinței
    // este depistarea cerinței, decizia ce unealtă se face cu creierul" ───────
    //
    // MĂSURAT înainte de tăietura asta: la FIECARE tură plecau ~3.900 tokeni de
    // prompt + până la 128 de scheme de unelte (~11.300 tokeni) — adică ~15.000
    // de tokeni ÎNAINTE ca omul să spună un cuvânt. Se vede direct în cifre:
    // Gemini singur răspunde în 482 ms (măsurat pe cheia lui, pe VPS), dar tura
    // aplicației a durat 1619 ms. Restul e citit degeaba. Și nu doar încetinea:
    // decizia „mi se vorbește mie?" stătea îngropată printre 128 de scheme.
    //
    // Acum tura CONVERSAȚIONALĂ (inclusiv cea care decide adresarea pe voce)
    // primește doar uneltele de aur — lista e DEJA ordonată mai jos, cu cele
    // fără de care zice „nu pot" în față și ocazionalele la coadă. Când chiar se
    // cere o acțiune, sau când modelul escaladează singur prin `ask_brain`,
    // tura de lucru primește TOT inventarul, netăiat, ca până acum.
    //
    // Ce se pierde, spus pe față: dacă ceri prin conversație ceva ce cere o
    // unealtă rară, ea vine în runda a doua — acolo e mai lent, în rest e mai
    // rapid peste tot. E schimbul pe care l-a ales ownerul, cu cifrele în față.
    // ── CE ARE VOIE PE TURA DE CONVERSAȚIE (Adrian, 8 aug: „scoate verificarea
    // sistemului la fiecare început de frază, îmi bagă cel puțin 8 secunde de
    // delay" → „se scoate din chat") ─────────────────────────────────────────
    //
    // MĂSURAT de ce erau 8 secunde: `system_health` face două apeluri la GitHub
    // (timeout 10 s fiecare) ȘI sondează endpointul FIECĂRUI buton din Admin, cu
    // timeout 8 s. Sunt în paralel, deci ~8 s în cel mai rău caz — exact cifra
    // reclamată. Nu are ce căuta pe drumul unei fraze rostite.
    //
    // Lista e ANUME, pe nume, nu „primele N din inventar": ordinea inventarului
    // e făcută pentru plafonul furnizorului, iar acolo primele 23 sunt uneltele
    // Google — o tăiere oarbă la 12 lăsa conversația cu Gmail și Calendar, dar
    // FĂRĂ monitor, notițe sau memorie. (Prima variantă de azi făcea exact asta;
    // se vedea doar numărând, nu citind.)
    //
    // Ce NU e aici se poate cere oricând: modelul cheamă `ask_brain` și tura de
    // lucru primește tot inventarul. Costul e o rundă în plus, DOAR când chiar e
    // nevoie — nu 8 secunde la fiecare frază.
    // Lista uneltelor de pe faza de vorbire vine din `fazeChat.ts`, împreună cu
    // motivul pentru care fiecare intrare e acolo. Aici nu se mai scrie nicio
    // listă: două liste ar diverge, iar prima care ar diverge tăcut ar fi cea
    // care lasă `system_health` să calce iar pe drumul unei fraze.
    const PLAFON_UNELTE_USOR = UNELTE_VORBIRE.length
    // EXCEPȚIA TRIERII (JARVIS pasul 3): runda de CONTINUARE a ușii vocale NU
    // e „acțiune" — fapta poate fi DEJA făcută în runda 1, iar șablonul rundei
    // conține el însuși „fă"/„pune", deci regexul de intenție s-ar aprinde pe
    // propriul nostru text, nu pe vorbele omului. Forțarea uneltei aici =
    // emailul trimis de 2 ori (clasa B#2, demonstrată de verificator).
    const cereActiune = (hasActionIntent(lastUserText) || turnHasImage) && req.body?.continuareUsa !== true
    // ACȚIUNE CERUTĂ EXPLICIT ≠ „e o imagine în tură" (C6 al marii verificări):
    // imaginea rămâne motiv de fază grea/inventar plin (cereActiune), dar
    // forțarea uneltei de faptă, detectorul de îngheț și verdictul final de
    // jurnal cer INTENȚIE de acțiune în vorbele omului — altfel „uite poza,
    // ce e asta?" forța memorie_pune/generate_image și scria `failed` fals
    // pe o descriere corectă.
    const actiuneCerutaExplicit = cereActiune && hasActionIntent(lastUserText)
// Gemini acceptă 128 unelte; Ollama cloud / altele — plafon 64 (sigur pe tool schema).
    const PLAFON_FURNIZOR = plafonUnelteFurnizor(orChatModel)
    // Tura de voce e „grea" ca MODEL (decide adresarea — vezi selectedBrainModel),
    // dar rămâne UȘOARĂ ca unelte: n-are de executat nimic, are de hotărât dacă
    // i se vorbește. Cele două axe sunt independente și e important să rămână așa.
    // VOCE = SCRIS COMPLET, DOAR OWNER (owner, 19 aug). Tura ușoară (unelte puține)
    // NU se aplică pe o frază rostită de owner: el capătă TOT inventarul, ca la scris,
    // ca să comute/repare/publice din prima frază. `isAdmin` exclude deja oaspetele
    // (rol admin && !guestMatch), deci un oaspete pe voce rămâne pe tura ușoară.
    // Sondele scumpe (system_health) rămân doar OFERITE, nu auto-rulate — cele 8s de
    // pe 8 aug veneau din APELAREA lor, nu din oferirea schemei.
    const turaUsoara = incarcatura.faza === 'vorbire' && !(isAdmin && !!audio)
    const MAX_PROVIDER_TOOLS = turaUsoara ? PLAFON_UNELTE_USOR : PLAFON_FURNIZOR
    const seenNames = new Set<string>()
    const baseTools: Tool[] = []
    for (const t of rawTools) {
      if (seenNames.has(t.name)) continue
      seenNames.add(t.name)
      baseTools.push(t)
    }
    // PE TURA UȘOARĂ, `ask_brain` MERGE PRIMUL. În ordinea de mai sus stă după
    // uneltele Google — la plafon 12 ar fi fost tăiat exact unealta care face
    // tura ușoară sigură (fără ea, ce nu încape în cele 12 n-ar mai avea cum să
    // fie cerut deloc, și am fi construit chiar defectul „zice că nu poate").
    // Gardul de rulare (`permisaLaVorbire`) e al DOILEA filtru, intenționat: dacă
    // cineva adaugă mâine o unealtă scumpă în lista de vorbire, tot nu trece.
    const tools: Tool[] = turaUsoara
      ? baseTools.filter((t) => permisaLaVorbire(t.name))
      : baseTools.slice(0, MAX_PROVIDER_TOOLS)
    console.log(
      `[FAZĂ] ${incarcatura.faza.toUpperCase()}: ${tools.length}/${baseTools.length} unelte, ` +
        `instrucțiuni de lucru: ${incarcatura.instructiuniDeLucru ? 'da' : 'nu'} — ${incarcatura.motiv}`,
    )
    if (!turaUsoara && baseTools.length > MAX_PROVIDER_TOOLS) {
      // Numim EXACT ce s-a tăiat — după reordonare astea trebuie să fie doar
      // ocazionalele din coadă (rol/cost/promo/secrete/cerințe/card/invitați),
      // niciodată uneltele de aur. Dacă apar aici repo/db/health, ordinea s-a stricat.
      const taiate = baseTools.slice(MAX_PROVIDER_TOOLS).map((t) => t.name).join(', ')
      console.error(`[chat] ${baseTools.length} unelte > plafon ${MAX_PROVIDER_TOOLS} — tăiate din coadă: ${taiate}`)
    }
    // Pe tura UȘOARĂ uneltele dinamice NU se lipesc (audit 9 aug: se împingeau
    // DUPĂ filtrul permisaLaVorbire și ocoleau lista albă a fazei de vorbire) —
    // rămân disponibile prin ask_brain, care comută pe inventarul plin.
    for (const t of turaUsoara ? [] : dynTools) {
      if (tools.length >= MAX_PROVIDER_TOOLS) break
      if (!seenNames.has(t.name)) {
        seenNames.add(t.name)
        tools.push(t)
      }
    }
    // INVENTARUL PLIN pentru escaladare (Adrian, 8 aug: „din chat, fără să care
    // după el, trebuie să știe să IASĂ, să ia funcția sau unealta, să rezolve
    // și să aducă rezultatul"). Tura ușoară pleacă cu 13 unelte; când modelul
    // cheamă `ask_brain`, lista turei se comută PE LOC pe asta — aceeași listă
    // pe care ar fi primit-o o tură de lucru, cu același plafon de furnizor.
    const uneltePline: Tool[] = (() => {
      const vazute = new Set<string>()
      const plin: Tool[] = []
      for (const t of [...baseTools, ...dynTools]) {
        if (vazute.has(t.name) || t.name === 'ask_brain') continue // ușa nu se re-oferă: e deja deschisă
        vazute.add(t.name)
        if (plin.length >= PLAFON_FURNIZOR) break
        plin.push(t)
      }
      return plin
    })()
    // Un Host de loopback (calea VOCALĂ cheamă /api/chat prin 127.0.0.1) nu e
    // NICIODATĂ baza linkurilor de ecran — harta/imaginile ar pleca spre
    // browserul omului ca https://127.0.0.1:8080/... și n-ar afișa NIMIC,
    // mereu (10 aug, ownerul: „nu poate afișa hărți"; detalii în bazaPublica).
    const baseUrl = bazaPublica(req.headers.host)
    // Voice from the first sentence on the API path too (clients): every
    // broadcast piece enters the pipe; synthesis runs in parallel with the text
    // still flowing.
    // SINGLE-VOICE RULE (Adrian, Jul 26): if the client has the full-duplex
    // session active, the written turn stays WRITTEN only — zero synthesis, zero
    // {audio} frames.
    const voice =
      req.body?.serverVoiceOff === true
        ? { feed: (_t: string): void => {}, fed: (): boolean => false, finish: async (): Promise<void> => {} }
        // Preferința de voce vine din starea sesiunii (citită o dată) — era A
        // TREIA interogare pe `user_prefs` în ACEEAȘI tură, serială, chiar
        // înainte de apelul la creier. Zero drumuri la DB aici acum.
        : createVoiceStream(reply, userLang, prefs.voicePref)
    let assistantText = ''
    // O TENTATIVĂ NU ESTE O FAPTĂ: păstrăm separat apelurile și rezultatele
    // normalizate. Poarta poate folosi exclusiv rezultatele reușite/verificate.
    const unelteIncercate: string[] = []
    const doveziUnelte: DovadaUnealta[] = []
    // AFIȘARE ≠ FAPTĂ (owner, 13 aug: „doar afișează un card, nu execută").
    // Uneltele DOAR-afișare: un apel la ele NU înseamnă că a executat cererea —
    // gardele din orchestrator nu le socotesc drept faptă. (Declarat aici, în
    // afara try-ului, ca și catch-ul de eroare să poată judeca faptele.)
    // click_monitor SCOS din listă (tensiunea (g), închisă pe ordinul
    // „finalizeaza tot", 22 aug): apasă ELEMENTE REALE — inclusiv butoane de
    // admin — deci re-apăsarea la reluare NU e nevinovată și apelul E faptă.
    // goleste_monitorul a IEȘIT din afișaj (vânătorul din 22 aug, măsurat pe
    // captura ownerului: clasificat „doar-afișare", nu conta ca faptă →
    // POARTA ACȚIUNII îi prescria modelului chiar refuzul „oprește-l manual").
    // Golirea ecranului EXECUTĂ ceva cerut — e faptă (vezi UNELTE_FAPTA).
    const UNELTE_AFISAJ = new Set([
      'show_document', 'show_on_screen', 'open_app_view',
      'zoom_monitor', 'arata_pe_grafic',
    ])
    // DB_QUERY: numele singur nu spune dacă e citire sau scriere (tensiunea
    // (e), închisă pe același ordin: SQL-ul decide, cu predicatul ÎNTĂRIT din
    // brainCapabilities — verificatorul a demonstrat că prefixul singur minte
    // (WITH+INSERT, EXPLAIN ANALYZE, „select 1; update"). Citirea = reluabilă
    // (cazul fondator al plasei — db_query ×18 — trăiește); scrierea = efect
    // extern (nu se re-execută, omul e avertizat); neparsabil = scriere.
    let dbQueryAScris = false
    // EFECT EXTERN = ce nu are voie să se execute de două ori (verdictele
    // agenților lot B: gardul anti-re-execuție pe „orice unealtă" omora cazul
    // fondator al plasei — db_query ×18 + sinteză goală rămânea fără plasă — și
    // lăsa turele escaladate fără nicio reluare, fiindcă și ask_brain arma
    // flag-ul). O unealtă are efect extern dacă NU e: citire verificată
    // independentă (grupaExecutieUnealta → undefined), comutatorul intern pur
    // ask_brain (zero efect în lume), sau doar-afișare (cardul re-desenat
    // identic nu dublează nimic).
    const eUnealtaCuEfectExtern = (nume: string): boolean =>
      grupaExecutieUnealta(nume) === 'efect' && nume !== 'ask_brain' && !UNELTE_AFISAJ.has(nume)
    // Contorul gardului anti-re-execuție: DOAR tentativele cu efect extern.
    const unelteEfectIncercate: string[] = []
    // CE A VĂZUT DEJA OMUL PE ECRAN (agenții de debug, 3 aug, verdict REAL):
    // când un model pică DUPĂ ce a curs text, catch-ul lipea „Încearcă din nou"
    // direct peste jumătatea de răspuns și salva în istoric DOAR sufixul —
    // ecranul și istoricul divergeau. Acumulatorul ăsta ține exact ce a curs,
    // ca la eșec să (1) separăm sufixul de text și (2) istoricul = ecranul.
    let ecranPartial = ''
    // Poarta de adresare (voce ambientală) — declarată AICI, în afara try-ului,
    // ca și catch-ul să o poată consulta: pana de creier pe o tură neadresată
    // se stinge cu {ignored}, nu cu bulă rostită (audit 9 aug).
    let gateDecided = !voceAmbianta
    // POARTA DE NUME PE TEXT (owner, 23 aug 2026: „numele lui e cheia care
    // deschide chatul sau orice cerinta" — repetat de 10000 de ori).
    // Pe VOCE există deja turaAdresata; pe TEXT poarta era bypassed.
    // Acum: fără „Kelion" la început → {ignored}, ca pe voce.
    // Excepții: ușa creierului (eUsaCreierului — tur formulat de modelul live,
    // nu de om) și continuarea ușii (continuareUsa). Visitor chat e rută
    // separată (/api/visitor-chat/send) — nu trece pe aici, deci e exempt.
    if (!voceAmbianta && !eUsaCreierului && !req.body?.continuareUsa && lastUserText && !numeStrigat(lastUserText)) {
      reply.raw.write(`${CTRL}${JSON.stringify({ ignored: true, reason: 'name_required' })}${CTRL}`)
      await scrieJurnalOperational(() => tranzitioneazaSarcinaOperationala({
        taskId: sarcinaOperationalaId,
        stare: 'expired',
        code: 'text_gate_no_name',
        metadata: { ambientVoice: false, nameWasHeard: false },
      }))
      reply.raw.end()
      console.log(`[TEXT] tura ${turnId.slice(0, 8)}: tăcere — fără nume la început. TEXT: „${lastUserText.slice(0, 60)}"`)
      return
    }
    // THE BRAIN CLOCK (admin): the first real word measures speed; the bar moves
    // to "Composing the reply". Once per turn, only for the admin (his telemetry).
    let firstWordMarked = false
    const noteFirstWord = (): void => {
      if (firstWordMarked || !isAdmin) return
      firstWordMarked = true
    }
    // Provider cost accumulated across the turn (brain calls + paid tools). This
    // is the REAL counter; the old `inTokens/outTokens/usageUsd` had remained
    // untouched ever since cost started arriving ready-calculated from the
    // provider (usage.cost).
    const usage = { usd: 0 }

    // ── THE BRAIN — 100% Gemini direct (extirparea OpenRouter/OpenAI, 3 aug) ──
    // One single brain: the Gemini tier chosen by selectedBrainModel. All tools
    // + persona + memory identical; streaming → instant first word. No Gemini
    // key = no brain → honest message in catch.
    // THE TURN CLOCK (Aug 2 — the latency mission): one line at the end of the
    // turn says how long the WHOLE brain section took, on which model, in how
    // many rounds. Together with the per-round [TIMP] lines in the
    // orchestrator, a slow turn is decomposed, not guessed.
    const tCreier = Date.now()
    // Segmentul INVIZIBIL până azi: cât a costat pregătirea turei (sesiune, KV,
    // amprente, prompt, unelte) ÎNAINTE ca creierul să fie chemat. [TIMP] măsoară
    // doar creierul; fără linia asta, o pregătire lentă nu se vedea nicăieri.
    if (voceAmbianta) console.log(`[CONTOR-SERVER] sosire → creier: ${tCreier - tSosire} ms (pregătirea turei)`)
    let planFaraExecutieDetectat = false
    try {
      if (!orChatModel) throw new Error('brain_not_configured: GEMINI_API_KEY missing')
      const orMsgs: OrMessage[] = [{ role: 'system', content: systemPrompt }]
      for (const p of params) {
        const role = p.role === 'assistant' ? 'assistant' : 'user'
        if (typeof p.content === 'string') {
          if (p.content) orMsgs.push({ role, content: p.content })
          continue
        }
        // SIGHT (Adrian, Jul 24: "I upload a picture but it doesn't see it...
        // it doesn't call the camera"): the image blocks were in Anthropic
        // format and this line DISCARDED the whole message (non-string content
        // → ''). Now we convert to OpenAI multimodal format (image_url with a
        // data URL) — the model really sees the picture and camera frames; the
        // turn's text is preserved.
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
        // Un singur trace, ÎNAINTEA tuturor ramurilor: unele unelte (get_monitor,
        // propose_tool etc.) se rezolvă inline și nu ajung la runTool.
        console.log(`[tool] ${name} (${isAdminUser ? 'admin' : 'user'})`)
        let input: unknown = {}
        try {
          input = JSON.parse(argsJson || '{}')
        } catch {
          input = {}
        }
        // FIECARE PAS PE MONITOR — LA ORICE UNEALTĂ (owner, 14 aug „să arate
        // fiecare pas" + 22 aug, pe captura cu știrile: „trebuie sa apara o
        // clepsidra care arata ca cauta"): numele pasului vine din inventarul
        // de capabilități (o singură sursă), procentul urcă asimptotic
        // (totalul nu se știe dinainte) și 100% îl scrie DOAR interceptorul
        // de end, la închiderea reală a turei. Gardul vechi `if (cereActiune)`
        // e SCOS: o căutare de știri fără verb de acțiune nu arăta NIMIC cât
        // lucra — omul stătea în fața unui ecran mut, exact ce a măsurat.
        {
          pasiExecutie += 1
          const capabilitate = CAPABILITIES.find((c) => c.name === name)
          // Ownerul, 21:42 („trebuie sa apara la text generare sau reparare sa
          // sti ce face"): întâi CE FACE, pe românește — numele tehnic al
          // uneltei rămâne în paranteză, pentru depanare, nu în capul frazei.
          const pas = capabilitate ? `${capabilitate.does} (${name})` : name
          const procent = Math.min(95, Math.round(1000 * (1 - Math.pow(0.8, pasiExecutie))) / 10)
          try {
            reply.raw.write(`${CTRL}${JSON.stringify({ executie: { pas, procent } })}${CTRL}`)
          } catch { /* progresul nu are voie să omoare tura */ }
        }
        // CĂUTAREA SE TAXEAZĂ DOAR LA SUCCES (agenții de debug, 3 aug: costul se
        // adăuga NECONDIȚIONAT, înainte de rulare — o căutare picată
        // (search_unavailable) tot îl costa pe user). Serper nu taxează un apel
        // eșuat, deci nici noi: contorizăm DUPĂ, doar dacă rezultatul nu e eroare.
        const eCautare = name === 'web_search' || name === 'youtube_search' || name === 'image_search'
        // NOTE: generate_image is NO LONGER charged a hand-typed flat rate here
        // — its REAL cost (OpenRouter usage.cost) is booked inside runTool,
        // where the generation's own response is known. Charging it here too
        // would double-count and, worse, book an invented figure as fact.
        // SELF-EXTENSION: Kelion proposes a new tool (stays 'pending' until the
        // owner approves it with one click in admin → active instantly).
        if (name === 'propose_tool') {
          // SHARED executor with voice (services/adminTools.ts) — no duplication.
          const out = await execUserScopedTool(name, input as Record<string, unknown>, user.email, isAdminUser)
          if (out !== null) return out
        }
        // CITEȘTE MONITORUL (10 aug): întoarce conținutul REAL al ecranului,
        // trimis de client în corpul cererii — nu ghicit, nu inventat.
        if (name === 'get_monitor') {
          const tab = Array.isArray(screen) ? screen : []
          const listaTaburi = tab.length
            ? tab.map((s) => `${s.kind}${s.title ? ` ("${s.title}")` : ''}${s.active ? ' — ACTIV' : ''}`).join(', ')
            : '(niciun tab deschis — monitorul e gol)'
          const c = req.body?.monitorContent
          const activ = c
            ? {
                fel: c.kind ?? 'necunoscut',
                titlu: (c.title ?? '').slice(0, 200),
                url: (c.url ?? '').slice(0, 500) || undefined,
                continut: (c.text ?? '').slice(0, 8000) || undefined,
                mouse: c.mouse,
              }
            : null
          // Punctul EXACT de sub cursor pe graficul de trading (când e deschis) —
          // iframe-ul îl trimite, aici îl dăm brainului la vedere (ownerul, 10 aug).
          const pg = req.body?.tranzactii?.peste
          const graficSubCursor = pg && (typeof pg.c === 'number' || typeof pg.o === 'number')
            ? { moment: pg.t, O: pg.o, H: pg.h, L: pg.l, C: pg.c, volum: pg.vol, MA20: pg.ma20, EMA50: pg.ema50 }
            : undefined
          return JSON.stringify({
            taburi_deschise: listaTaburi,
            tab_activ: activ ?? '(nimic afișat sau conținut necitibil de pe acest tab)',
            mouse_pozitie: activ?.mouse ? `x: ${activ.mouse.x}, y: ${activ.mouse.y}, indică: ${activ.mouse.indicator}` : 'necunoscută',
            grafic_sub_cursor: graficSubCursor,
            nota: activ?.continut
              ? 'Conținutul de mai sus e ce vede omul ACUM pe ecran — răspunde din el.'
              : activ?.url
                ? 'Tabul activ afișează un URL/o suprafață media; nu are text de citit — descrie ce e după titlu/URL.'
                : 'Nimic de citit pe monitor acum.',
          })
        }

        // VEDEREA CONTINUĂ (22 aug): ultimele observații vizuale ale lui Kelion
        if (name === 'observatii_vizuale') {
          const { observatiiRecente, numarObservatii } = await import('../services/vedereContinua.js')
          const obs = observatiiRecente()
          const total = numarObservatii()
          if (obs.length === 0) return JSON.stringify({ observatii: [], nota: 'Nu am observații vizuale recente — vederea continuă nu e activă sau nu a detectat mișcare.' })
          return JSON.stringify({
            total_observatii: total,
            observatii: obs.map((o) => ({
              acum: `${Math.round((Date.now() - o.ts) / 1000)}s în urmă`,
              miscare: o.miscare,
              locatie: o.lat ? `${o.lat.toFixed(4)}, ${o.lon?.toFixed(4)}` : 'necunoscută',
            })),
            nota: 'Acestea sunt observațiile vizuale continue din ultimele 5 minute — ce a văzut Kelion din mediu.',
          })
        }

        // AUZUL AMBIENTAL (22 aug): evenimentele sonore detectate de Kelion
        if (name === 'evenimente_sonore') {
          const { evenimenteSonoreRecente, evenimenteUrgente } = await import('../services/auzAmbiental.js')
          const ev = evenimenteSonoreRecente()
          const urg = evenimenteUrgente()
          if (ev.length === 0) return JSON.stringify({ evenimente: [], nota: 'Nu am evenimente sonore recente — auzul ambiental nu e activ sau nu s-a detectat nimic.' })
          return JSON.stringify({
            total: ev.length,
            urgente: urg.length,
            evenimente: ev.map((e) => ({
              acum: `${Math.round((Date.now() - e.ts) / 1000)}s în urmă`,
              tip: e.tip,
              intensitate: e.intensitate,
              frecventa: e.frecventaDominanta,
              urgent: ['alarma', 'spargere', 'plans'].includes(e.tip),
            })),
            nota: urg.length > 0 ? 'ATENȚIE: evenimente URGENTE detectate — alarmă, spargere sau plâns.' : 'Acestea sunt evenimentele sonore din ultimele 10 minute.',
          })
        }

        // STAREA EMOȚIONALĂ (22 aug): emoția detectată din expresia facială
        if (name === 'stare_emotionala') {
          const { stariEmotionaleRecente, emotieDominanta, ultimaStareEmotionala } = await import('../services/memorieEmotionala.js')
          const stari = stariEmotionaleRecente()
          const dominanta = emotieDominanta()
          const ultima = ultimaStareEmotionala()
          if (stari.length === 0) return JSON.stringify({ stare: 'neutru', nota: 'Nu am detecții emoționale recente — camera/detecția facială nu e activă.' })
          return JSON.stringify({
            curenta: ultima?.emotie ?? 'neutru',
            intensitate: ultima?.intensitate ?? 0,
            dominanta_10min: dominanta ?? 'neutru',
            istoric: stari.map((s) => ({
              acum: `${Math.round((Date.now() - s.ts) / 1000)}s în urmă`,
              emotie: s.emotie,
              intensitate: s.intensitate,
            })),
            nota: 'Adaptează-ți tonul la starea emoțională: calm/empatic la supărat, energic la vesel, concis la stresat.',
          })
        }

        if (name === 'get_mouse_position') {
          const c = req.body?.monitorContent
          if (c?.mouse) {
            return JSON.stringify({
              x: c.mouse.x,
              y: c.mouse.y,
              indica: c.mouse.indicator,
              nota: `Mouse-ul se află la poziția (${c.mouse.x}, ${c.mouse.y}) și indică: ${c.mouse.indicator}`
            })
          }
          return JSON.stringify({
            eroare: 'Nu s-a putut citi poziția mouse-ului de pe monitor.'
          })
        }

        // ── GARDA ANTI-BÂLBĂ PE GENERĂRILE PLĂTITE (owner, 14 aug, capturile
        // serii: vocea lui românească transcrisă ca italiană stricată — „Come
        // te per sai generati immagine?" — iar creierul a luat bâlba drept
        // comandă și A ARS BANI pe două imagini necerute, ba una era o captură
        // FALSĂ de aplicație) ───────────────────────────────────────────────
        // Regula deterministă: pe o tură VORBITĂ, dacă limba transcriptului nu
        // e limba STABILITĂ a omului, generarea plătită NU pornește — refuz cu
        // îndemnul cinstit „repetă sau scrie comanda". Turele SCRISE nu trec pe
        // aici (ce scrii cu mâna e comanda ta). Doar uneltele care costă bani.
        const GENERARI_PLATITE = new Set(['generate_image', 'generate_video', 'create_presentation'])
        // Semnalul de „tură vorbită" e PREZENȚA audio-ului nativ (doar vocea îl
        // are — chiar sursa transcrierii), nu flagul `spoken`: paritatea
        // scris/vorbit (caleUnica.test) cere ca `spoken` să rămână DOAR stil.
        if (GENERARI_PLATITE.has(name) && typeof req.body?.audio === 'string' && req.body.audio.length > 0) {
          const auzit = detectSpeechLang(lastUserText, null)
          const bazaAuzit = (auzit ?? '').toLowerCase().split('-')[0]
          const bazaOm = (userLang ?? 'en').toLowerCase().split('-')[0]
          if (bazaAuzit && bazaAuzit !== bazaOm) {
            return JSON.stringify({
              error: 'transcript_suspect',
              motiv: `Nu pornesc o generare plătită pe o frază auzită în altă limbă (${auzit}) decât a ta (${bazaOm}) — probabil transcriere greșită. Roagă omul să repete clar sau să SCRIE comanda.`,
            })
          }
        }
        // ── POARTA MONITORULUI (owner, 14 aug: „fără comandă clară să nu facă
        // nimic pe monitor") ────────────────────────────────────────────────
        // click_monitor apasă ELEMENTE REALE din aplicație (elementFromPoint +
        // .click() în ChatPanel) — o halucinație a creierului ar putea apăsa
        // orice buton, inclusiv din admin. De-aia acțiunile pe monitor rulează
        // DOAR când tura curentă a omului conține o comandă clară: fie un verb
        // de acțiune general (hasActionIntent — „deschide", „apasă pe meniu"),
        // fie verbul specific de click/zoom. Fără comandă → refuz cinstit, iar
        // frame-ul de control NU pleacă spre ecran. Cititul (get_monitor,
        // get_mouse_position) rămâne liber — a privi nu e a face.
        const COMANDA_MONITOR_RE =
          /(clic|click|apas[ăa]|\btap\b|zoom|m[ăa]re[șs]te|mic[șs]oreaz[ăa]|apropie|dep[ăa]rteaz[ăa]|mai\s+(mare|mic|aproape)|scroll|deruleaz[ăa])/i
        const comandaClaraMonitor = (): boolean =>
          hasActionIntent(lastUserText) || COMANDA_MONITOR_RE.test(lastUserText)

        if (name === 'click_monitor') {
          if (!comandaClaraMonitor()) {
            return JSON.stringify({
              succes: false,
              mesaj: 'Refuzat: nu fac nimic pe monitor fără o comandă clară a omului în tura curentă. Întreabă-l întâi ce vrea apăsat.'
            })
          }
          const args = input as { x?: number; y?: number }
          const x = args.x ?? 0
          const y = args.y ?? 0
          try {
            reply.raw.write(`${CTRL}${JSON.stringify({ clickMonitor: { x, y } })}${CTRL}`)
          } catch {}
          return JSON.stringify({
            succes: true,
            mesaj: `S-a trimis comanda de click la coordonatele (${x}, ${y}) pe monitor.`
          })
        }

        if (name === 'zoom_monitor') {
          if (!comandaClaraMonitor()) {
            return JSON.stringify({
              succes: false,
              mesaj: 'Refuzat: nu schimb nimic pe monitor fără o comandă clară a omului în tura curentă.'
            })
          }
          const args = input as { level?: number; direction?: string }
          const level = args.level ?? 1.2
          const direction = args.direction ?? 'in'
          try {
            reply.raw.write(`${CTRL}${JSON.stringify({ zoomMonitor: { level, direction } })}${CTRL}`)
          } catch {}
          return JSON.stringify({
            succes: true,
            mesaj: `S-a trimis comanda de zoom (${direction}, nivel ${level}) pe monitor.`
          })
        }

        // POINTERI DE INDICAȚIE PE GRAFIC (10 aug): Kelion desenează pe graficul
        // din Centrul de Tranzacționare exact la ce se referă. Frame-ul {semne}
        // pleacă la client, care îl trece în iframe. Doar admin + Centru deschis.
        if (name === 'arata_pe_grafic') {
          const simbol = String(req.body?.tranzactii?.simbol ?? '').trim()
          if (!isAdminUser || !simbol) {
            return JSON.stringify({ succes: false, mesaj: 'Pointerii se pun doar când Centrul de Tranzacționare e deschis pe ecran (admin).' })
          }
          const inp = input as { puncte?: unknown; zone?: unknown; sageti?: unknown; trend?: unknown; curata?: unknown }
          // Curățare explicită: golește TOT ce a desenat pe grafic.
          if (inp.curata === true) {
            try {
              reply.raw.write(`${CTRL}${JSON.stringify({ semne: { simbol, lista: [], zone: [], sageti: [], trend: [] } })}${CTRL}`)
            } catch {}
            return JSON.stringify({ succes: true, mesaj: `Am curățat graficul ${simbol} (pointeri + zone + săgeți + trend).` })
          }
          const lista = curataSemne(inp.puncte)
          const zone = curataZone(inp.zone)
          const sageti = curataSageti(inp.sageti)
          const trend = curataTrend(inp.trend)
          if (!lista.length && !zone.length && !sageti.length && !trend.length) {
            return JSON.stringify({ succes: false, mesaj: 'Nimic de desenat — dă puncte / zone / săgeți / trend cu cifre REALE din graficul de pe ecran (sau curata:true ca să ștergi).' })
          }
          try {
            reply.raw.write(`${CTRL}${JSON.stringify({ semne: { simbol, lista, zone, sageti, trend } })}${CTRL}`)
          } catch {}
          const bucati: string[] = []
          if (lista.length) bucati.push(`${lista.length} pointer(i): ${lista.map((p) => `${p.tip} ${p.pret}${p.text ? ` (${p.text})` : ''}`).join('; ')}`)
          if (zone.length) bucati.push(`${zone.length} zonă/zone: ${zone.map((z) => `${z.tip} ${z.jos}–${z.sus}${z.text ? ` (${z.text})` : ''}`).join('; ')}`)
          if (sageti.length) bucati.push(`${sageti.length} săgeată/săgeți (${sageti.map((s) => `${s.directie} pe ${s.unde}${s.text ? ` „${s.text}"` : ''}`).join('; ')})`)
          if (trend.length) bucati.push(`o linie de trend ${trend[0].pret1}→${trend[0].pret2}${trend[0].text ? ` (${trend[0].text})` : ''}`)
          return JSON.stringify({ succes: true, mesaj: `Am desenat pe graficul ${simbol} — ${bucati.join(' · ')}.` })
        }
        // APPROVED DYNAMIC TOOL: generic execution through a safe HTTP call.
        // NICIODATĂ peste un executor REAL (C4 al marii verificări): o unealtă
        // dinamică aprobată cu numele „send_email" ar fi UMBRIT executorul
        // adevărat — argumentele reale (destinatar, corp) plecau la un URL
        // extern, modelul vedea schema adevărată dar execuția era alta, iar
        // poarta faptelor o număra drept dovadă. Inventarul fix are prioritate.
        if (dynNames.has(name) && !allCapabilityNames().includes(name)) {
          return await runDynamicTool(name, input as Record<string, unknown>)
        }
        // UȘA DE ESCALADARE CHIAR DESCHIDE UNELTELE (8 aug, ownerul: „nu știe
        // să escaladeze să ceară acces la unelte… dacă nu are acces la unealtă
        // sau funcție intră în blocaj"). Măsurat în cod ce era înainte: aici se
        // chema `brainComplete` — o completare de TEXT, zero unelte; „expertul"
        // primea cererea și răspundea din cap, iar cu modelul unic era ACELAȘI
        // model — deci escaladarea nu aducea nimic, doar un al doilea apel fără
        // mâini. Fix blocajul reclamat. Acum: lista turei se comută PE LOC pe
        // inventarul plin (runOrchestrator dă array-ul prin REFERINȚĂ către
        // fiecare rundă, deci runda următoare pleacă cu el), modelul cheamă
        // unealta potrivită și aduce REZULTATUL; la finalul turei accesul se
        // închide singur — tura următoare o ia iar de la zero, prin fazaTurei.
        if (name === 'ask_brain') {
          const request = String((input as { request?: string }).request ?? '').trim()
          if (tools.length < uneltePline.length) {
            tools.length = 0
            tools.push(...uneltePline)
            for (const t of uneltePline) toolNamesThisTurn.add(t.name)
            console.log(`[FAZĂ] ESCALADARE ask_brain: inventar comutat la ${tools.length} unelte pentru restul turei${request ? ` — „${request.slice(0, 120)}"` : ''}`)
          }
          // ȘI URCĂ CREIERUL, nu doar uneltele (owner, 20 aug — golul măsurat:
          // până acum `ask_brain` deschidea uneltele dar rămânea pe flash-lite).
          // Dacă tura a pornit UȘOARĂ, escaladăm la creierul greu + gândire adâncă
          // pentru restul turei; orchestratorul citește `escaladare` pe fiecare rundă.
          if (!heavyTurn && !escaladare.model) {
            const modelGreu = alegeModelOrchestrator({ modelChat: orChatModel, creierDublu: config.creierDublu, turaGrea: true, modelProfund: config.modelCreierProfund })
            if (modelGreu && modelGreu !== orchestratorModel) {
              escaladare.model = modelGreu
              escaladare.reasoning = 'high'
              console.log(`[FAZĂ] ESCALADARE ask_brain: creier URCAT la ${modelGreu} + gândire adâncă pentru restul turei`)
            }
          }
          return JSON.stringify({
            escaladat: true,
            unelte_disponibile_acum: tools.length,
            mesaj:
              'Acces acordat la TOT inventarul, DOAR pentru tura asta. Cheamă ACUM unealta potrivită și adu rezultatul — el e răspunsul. ' +
              'Dacă spui că analizezi, cheamă uneltele și arată pe monitor (show_document) ce ai găsit. Nu promite — fă.',
          })
        }
        const block = { type: 'tool_use', id: `call_${++callN}`, name, input } as unknown as ToolUseBlock
        if (eCautare) {
          const out = await runTool(
            block, isAdmin, token, reply, baseUrl, user.email,
            req.headers.cookie ?? '', usage,
            (speechPref || isAdminUser) && langName ? langName : '',
            deviceLoc,
          )
          // Eroare declarată de unealtă → nu s-a căutat nimic → $0 (regula #1:
          // nu inventăm nici măcar un cost). Orice altceva = căutare reală, taxată.
          const aEsuat = /"error"\s*:/.test(out.slice(0, 200))
          if (!aEsuat) {
            usage.usd += SERPER_USD_PER_CALL
            // REAL ACCOUNTING (QA audit Jul 24, A1): without recordCost, the
            // Money tab never saw the cost of search/images/brain.
            void recordCost(user.email, 'search', SERPER_USD_PER_CALL)
          }
          return out
        }
        return runTool(
          block, isAdmin, token, reply, baseUrl, user.email,
          req.headers.cookie ?? '', usage,
          (speechPref || isAdminUser) && langName ? langName : '',
          deviceLoc,
        )
      }
      // Toate căile orchestratorului (apeluri native și markup reparat) trec
      // prin acest înveliș. O unealtă este încercată înainte de execuție, dar
      // devine dovadă numai DUPĂ ce rezultatul ei a fost clasificat.
      const executaUnealtaCuDovada = async (name: string, argsJson: string): Promise<string> => {
        unelteIncercate.push(name)
        if (name === 'db_query') {
          let scrie = true
          try {
            scrie = !eSqlDeCitire(String((JSON.parse(argsJson || '{}') as { sql?: unknown }).sql ?? ''))
          } catch {
            /* SQL neparsabil = tratat ca scriere (direcția sigură) */
          }
          if (scrie) {
            dbQueryAScris = true
            unelteEfectIncercate.push(name)
          }
        } else if (eUnealtaCuEfectExtern(name)) unelteEfectIncercate.push(name)
        await scrieJurnalOperational(async () => {
          const tranzitie = await tranzitioneazaSarcinaOperationala({
            taskId: sarcinaOperationalaId,
            stare: 'executing',
            capability: name,
            code: 'tool_attempted',
          })
          if (!tranzitie.ok) return
          await noteazaEvenimentOperational({
            taskId: sarcinaOperationalaId,
            kind: 'tool_attempted',
            capability: name,
            outcomeState: 'attempted',
            code: 'tool_attempted',
          })
        })
        try {
          const rezultat = await execTool(name, argsJson)
          const dovada = clasificaRezultatUnealta(name, rezultat)
          doveziUnelte.push(dovada)
          await scrieJurnalOperational(async () => {
            await noteazaEvenimentOperational({
              taskId: sarcinaOperationalaId,
              kind: 'tool_result',
              capability: name,
              outcomeState: dovada.stare,
              code: dovada.cod,
            })
            if (dovada.stare === 'succeeded' || dovada.stare === 'verified') {
              await tranzitioneazaSarcinaOperationala({
                taskId: sarcinaOperationalaId,
                stare: 'verifying',
                capability: name,
                code: dovada.stare === 'verified' ? 'effect_verified' : 'technical_success',
              })
            }
          })
          return rezultat
        } catch (eroare) {
          const rezultat = `tool_error: ${eroare instanceof Error ? eroare.message : String(eroare)}`
          const dovada = clasificaRezultatUnealta(name, rezultat)
          doveziUnelte.push(dovada)
          await scrieJurnalOperational(() => noteazaEvenimentOperational({
            taskId: sarcinaOperationalaId,
            kind: 'tool_result',
            capability: name,
            outcomeState: dovada.stare,
            code: dovada.cod,
          }))
          throw eroare
        }
      }
      // FĂRĂ ACK-UL „Am preluat sarcina" (Adrian, 5 aug: „scoate-i «am preluat
      // sarcina»"). Pe tura de acțiune a adminului nu mai plecă nicio frază de
      // preluare — răspunsul e direct rezultatul real (sau un mesaj onest). Kelion
      // nu mai vorbește ca să anunțe că se apucă; execută și răspunde.
      // GEMINI-ONLY (3 aug — extirparea totală OpenRouter): nu mai există niciun
      // „secundar" pe alt furnizor. Modelul turei e treapta Gemini aleasă de
      // selectedBrainModel; pe tura ușoară e deja gemini-2.5-flash (măsurat pe
      // payload-ul real: 1.2s runda 1 + 1.0s runda 2).
      // CREIER DUBLU (owner, 13 aug: „două creiere, o singură voce"). Pe turele
      // GRELE comutăm de pe fața rapidă (flash) pe creierul din spate = inteligență
      // reală (Gemini Pro; thinking `high` se aplică automat mai jos fiindcă e
      // google-direct). Flag STINS → rămâne fața rapidă, EXACT ca azi. Turele
      // ușoare rămân MEREU pe fața rapidă (primul cuvânt sub 1s). Holder-ul cald +
      // orchestrarea vocii unice = etapa 2.
      // `let`, nu `const`: dacă creierul PROFUND se epuizează, plasa de mai jos îl
      // comută pe fața rapidă (orChatModel) pentru o ultimă încercare — reasignabil.
      // creierDublu → Gemini profund; ușor → orChatModel (flash).
      let orchestratorModel = alegeModelOrchestrator({
        modelChat: orChatModel,
        creierDublu: config.creierDublu,
        turaGrea: heavyTurn,
        modelProfund: config.modelCreierProfund,
      })
      await scrieJurnalOperational(() => tranzitioneazaSarcinaOperationala({
        taskId: sarcinaOperationalaId,
        stare: 'planning',
        code: 'brain_started',
        metadata: { phase: incarcatura.faza, actionRequested: cereActiune },
      }))
      // ── VEDEREA E NATIVĂ (3 aug — extirparea OpenRouter a îngropat și
      // „vederea delegată") ────────────────────────────────────────────────────
      // Orice creier al aplicației e Gemini (google-direct/*), care VEDE nativ:
      // toGeminiPayload duce blocurile image_url (data-URI) ca inline_data.
      // Pasul de „descriere pentru creierul orb" (describeScene pe un model
      // străin, lent) a dispărut odată cu modelele oarbe din pool-ul OpenRouter.
      // AUDIO NATIV → CREIER (Adrian, 3 aug): atașăm vocea BRUTĂ a frazei la
      // ultimul mesaj user, ca bloc `audio_url`. Gemini o aude nativ
      // (toGeminiPayload → inline_data audio); transcriptul Chirp rămâne în
      // mesaj ca text — același orMsgs, creier unic.
      if (audio) {
        // AUDIO PE O TURĂ USER PROASPĂTĂ LA COADĂ (Adrian, 6 aug — „nu mă aude",
        // măsurat live: scrisul mergea, vocea nu). BUG-ul: `asiguraPurtatorAudio`
        // adaugă purtătorul {user, ''}, dar bucla de mai sus (linia cu
        // `if (p.content)`) ARUNCĂ TĂCUT mesajele cu text gol — deci purtătorul
        // dispărea, iar audio-ul se lipea de o tură user VECHE (sau de niciuna),
        // conversația se termina cu ASSISTANT, și creierul nu auzea fraza →
        // `<TAC/>` → tură stinsă, fără răspuns, fără eroare. Reparăm exact aici:
        // dacă ULTIMA tură din payload e user, atașăm audio-ul pe ea; altfel
        // ÎMPINGEM o tură user nouă DOAR cu audio. Așa creierul aude MEREU fraza
        // curentă la coadă, iar payload-ul se termină pe user. (Bucla înapoi
        // veche lega audio-ul de un tur vechi — de-aia părea „surd".)
        const audioBloc = { type: 'audio_url', audio_url: { url: audio } }
        const ultim = orMsgs[orMsgs.length - 1]
        if (ultim && ultim.role === 'user') {
          const c = ultim.content
          ultim.content = (
            typeof c === 'string'
              ? c
                ? [audioBloc, { type: 'text', text: c }]
                : [audioBloc]
              : [audioBloc, ...(c as { type: string; [k: string]: unknown }[])]
          ) as OrMessage['content']
        } else {
          orMsgs.push({ role: 'user', content: [audioBloc] as unknown as OrMessage['content'] })
        }
      }
      let textFlowed = false
      // ── POARTA DE ADRESARE A CREIERULUI (voce ambientală) ────────────────────
      // Pe o tură ambientală, primele caractere ale răspunsului decid totul:
      //   • încep cu `<TAC/>`  → creierul NU e adresat → tura se stinge (taced).
      //   • încep cu `AUZIT: X` → e adresat; X = ce a auzit (→ {heard}), iar restul
      //     e răspunsul rostit. Reținem stream-ul pe client până se decide, ca să
      //     nu se scurgă nici sentinela, nici linia AUZIT. Pe turele ne-vocale
      //     poarta e deschisă din start (gateDecided = true).
      let gateBuf = ''
      // (gateDecided trăiește lângă ecranPartial, în afara try-ului — catch-ul
      // îl consultă la pană ca să stingă tura neadresată cu {ignored}.)
      let taced = false
      let userEcho = ''
      // Coada reținută cât timp mai poate fi începutul marcajului de ecou.
      let coadaEcou = ''
      let ecouInchis = false
      /** Câte caractere de la sfârșitul lui `s` sunt un început valid al lui
       *  `marcaj`. Zero dacă niciunul — atunci nu se reține nimic. */
      const potrivirePartiala = (s: string, marcaj: string): number => {
        const max = Math.min(s.length, marcaj.length - 1)
        for (let n = max; n > 0; n--) {
          if (marcaj.slice(0, n).toLowerCase() === s.slice(s.length - n).toLowerCase()) return n
        }
        return 0
      }
      const emitHeard = (txt: string): void => {
        reply.raw.write(`${CTRL}${JSON.stringify({ heard: txt.slice(0, 500) })}${CTRL}`)
      }
      // Decide din bufferul acumulat. Întoarce textul DE EMIS (răspunsul, fără
      // linia AUZIT), sau '' cât încă strânge / dacă tace. Setează gateDecided,
      // taced, userEcho.
      const SENTINELA_TAC = '<TAC/>'
      const decideVoiceGate = (): string => {
        const trimmed = gateBuf.replace(/^\s+/, '')
        if (!trimmed) return '' // doar spații încă
        // Sentinela <TAC/> — cât prefixul încă se potrivește, mai așteptăm.
        // TOLERANT LA VARIANTE (auditul 15 aug: potrivirea byte-exactă lăsa
        // „<tac/>"/„<TAC />" să se EMITĂ și să se ROSTEASCĂ pe tură neadresată):
        // comparația e case-insensitive, iar mai jos o plasă prinde și forma
        // cu spații, odată sosită întreagă.
        const capat = trimmed.slice(0, SENTINELA_TAC.length).toUpperCase()
        if (SENTINELA_TAC.startsWith(capat)) {
          if (trimmed.length < SENTINELA_TAC.length) return '' // prefix parțial, mai vine
          if (capat === SENTINELA_TAC) {
            // O TĂCERE TREBUIE SĂ SPUNĂ CE A AUZIT (Adrian, 8 aug, din jurnalul
            // lui): înainte, `<TAC/>` stingea tura fără nicio urmă, deci un fals
            // „nu mi se vorbea" arăta EXACT ca zgomot de fond ignorat corect.
            // Restul bufferului poartă acum linia AUZIT; o culegem, n-o rostim.
            taced = true
            gateDecided = true
            const dupa = trimmed.slice(SENTINELA_TAC.length)
            const mt = /AUZIT:\s*(.*)/i.exec(dupa)
            if (mt) userEcho = mt[1].split('\n')[0].trim()
            return ''
          }
        }
        // ── AICI STĂTEA ÎNTÂRZIEREA PÂNĂ LA PRIMUL SUNET (Adrian, 8 aug:
        // „există o întârziere nejustificată de la întrebare la primul sunet") ──
        //
        // Vechiul protocol cerea creierului să scrie PRIMA linia
        // „AUZIT: <tot ce ai spus>", și poarta aștepta newline-ul ei (sau 240 de
        // caractere) ca să se deschidă. Adică nimic nu se putea rosti până nu
        // termina de transcris ce-ai zis — o frază întreagă de așteptare, la
        // FIECARE tură, degeaba: ecoul e pentru ecran, nu se rostește niciodată.
        //
        // Plasa pentru variantele cu spații („<TAC />", „< tac / >") sosite
        // întregi: prefixul strict de mai sus nu le prinde, dar tot tăcere
        // înseamnă — nu se emit și nu se rostesc (auditul 15 aug).
        const mtac = /^<\s*tac\s*\/?\s*>/i.exec(trimmed)
        if (mtac) {
          taced = true
          gateDecided = true
          const dupa = trimmed.slice(mtac[0].length)
          const mt = /AUZIT:\s*(.*)/i.exec(dupa)
          if (mt) userEcho = mt[1].split('\n')[0].trim()
          return ''
        }
        // Acum ecoul vine ULTIMUL, iar poarta se deschide în clipa în care
        // bufferul nu mai poate fi `<TAC/>` — adică după 1-2 caractere. Primul
        // cuvânt pleacă spre gură imediat ce creierul îl scrie.
        gateDecided = true
        emitHeard('') // ecoul REAL vine la sfârșit; ecranul îl primește atunci
        return trimmed
      }
      // FAKE TOOL-CALL MARKUP, NEVER SHOWN NOR SPOKEN (Adrian, Aug 1 —
      // screenshot: „<|tool_call|>call:system_health()<|tool_call|>” displayed
      // raw in the bubble). Small free models sometimes EMIT tool-call syntax
      // as plain text. Everything between the markers is dropped from the
      // stream AND from the voice, and logged whole for diagnosis.
      // THE TURN'S TOOL NAMES feed the display stripper (Aug 2 — live
      // screenshot: a bare line `get_weather` above the real answer): a
      // standalone line that is EXACTLY a typed call of a tool that EXISTS
      // this turn never reaches the user — stream, final text and voice.
      // The set comes from the tools offered, never hardcoded.
      const toolNamesThisTurn = new Set(tools.map((t) => t.name))
      // (UNELTE_AFISAJ e declarat sus, lângă doveziUnelte — și catch-ul de
      // eroare judecă acum faptele, deci lista trăiește în afara try-ului.)
      // FORȚARE PE UNEALTA DE EXECUȚIE (owner, 13 aug: „îl scoți de pe auto, îl pui
      // pe obligatoriu să cheme unealta CORECTĂ"): pe runda 1 a turelor de ACȚIUNE
      // ale ownerului, forțăm o unealtă de FAPTĂ (lista ∩ cele oferite) — niciodată
      // una de afișare. Lista NU trebuie exhaustivă: dacă unealta corectă lipsește
      // de aici, modelul o poate chema oricum pe runda 2 (AUTO). Restrângerea e doar
      // o plasă contra „card fals în loc de execuție".
      const UNELTE_FAPTA = [
        'build_software', 'cerinta_noua', 'repo_write', 'repo_open_pr', 'repo_merge_pr',
        'constructor_command', 'constructor_manage', 'list_app_versions', 'list_db_backups', 'save_app_version', 'run_runbook', 'request_repair',
        'panou_cod', 'cheama_agent', 'secret_pune', 'secret_publica', 'send_email',
        'create_doc', 'edit_doc', 'create_sheet', 'edit_sheet', 'create_calendar_event',
        'add_task', 'browser_open', 'browser_type', 'browser_click', 'generate_image',
        'generate_video', 'memorie_pune', 'db_query',
        // Vânătorul 22 aug: pe „oprește/închide monitorul" runda forțată nu
        // AVEA VOIE să cheme unealta de închidere → modelul era împins spre
        // refuzul „oprește-l manual". Golirea ecranului e faptă cerută.
        'goleste_monitorul',
      ].filter((n) => toolNamesThisTurn.has(n))
      // Auto-armare: DOAR când e clar o cerere de ACȚIUNE a ownerului — nu pe
      // simpla prezență a unei imagini (C6; vezi actiuneCerutaExplicit, sus).
      const forteazaFapta = isAdmin && cereActiune && actiuneCerutaExplicit
      let markupStrip = makeToolMarkupStripper(
        (swallowed) => console.error('[TOOL MARKUP — hidden from user]', swallowed.slice(0, 300)),
        toolNamesThisTurn,
      )
      // GARDUL DE LIMBĂ PE SCRIS (auditul 15 aug, confirmat de 2 verificatori):
      // incidentul din 14 aug („chatul îl traduce în rusă") era reparat DOAR pe
      // voce — scrisul n-avea niciun gard determinist, doar instrucțiunea, iar
      // limbaRaspuns.ts constată negru pe alb că instrucțiunile nu țin singure.
      // Același detector ca la voce, activ doar pe lacătul românesc (ca la
      // voce: gardDeLimba = ro-RO). Începutul se strânge până se poate judeca;
      // străin + necerut + omul nu scria el însuși limba aia → tura se suprimă
      // cu o notă cinstită, iar replica străină NU intră nici în istoric.
      let limbaScrisaDecisa = !ro
      let limbaScrisaSuprimata = false
      let limbaScrisaBuf = ''
      // C2 al marii verificări: acumulatoarele de STREAM trăiesc în afara
      // buclei de reîncercări — fără resetul ăsta, fragmentele reținute din
      // încercarea picată („Bun" sub pragul gardului de limbă, „<TA" în
      // poarta de ecou) se lipeau de răspunsul încercării următoare pe ecran
      // și în gura vocii („BunSalut! …"). Se cheamă la ÎNCEPUTUL fiecărei
      // încercări și în plase — fragmentele încercării moarte se aruncă.
      const resetStareStream = (): void => {
        gateBuf = ''
        coadaEcou = ''
        limbaScrisaBuf = ''
        markupStrip = makeToolMarkupStripper(
          (swallowed) => console.error('[TOOL MARKUP — hidden from user]', swallowed.slice(0, 300)),
          toolNamesThisTurn,
        )
      }
      const NOTA_LIMBA = 'Mi-a scăpat începutul răspunsului în altă limbă și l-am oprit. Pune-mi, te rog, întrebarea încă o dată.'
      const runBrainOnce = (): ReturnType<typeof runOrchestrator> => runOrchestrator(
        orchestratorModel,
        orMsgs,
        tools as unknown as AnthropicTool[],
        executaUnealtaCuDovada,
        {
          // AUTONOMIE COMPLETĂ (owner, 23 aug 2026: „trebuie să gestioneze
          // complet, până la deploy"): pe o tură de execuție admin, flow-ul
          // complet e: read_source → repo_write → ruleaza_portile → repo_open_pr
          // → repo_merge_pr → runbook_status → verificare live. Asta e 6-7
          // unelte, iar dacă porțile pică și trebuie reparat, sunt mai multe.
          // Default de 6 runde nu ajunge → modelul se oprea la jumătate, cu
          // cod scris dar nemerged → „nu e autonom". Pe tura de acțiune admin:
          // 12 runde (destule pentru reparat + verificat + deploy).
          maxRounds: (isAdmin && !turaCurata) ? 12 : 6,
          maxTokens: 5000,
          // REAL REASONING on the heavy turn (Jul 25): the work model THINKS
          // internally before answering; the thinking does not flow into text —
          // only the final reply. On the light turn: none, so the first word
          // stays instant (under 1s, the latency rule).
          // EXTENDED THINKING (Adrian, 5 aug: „la creier adaugi Extended Thinking").
          // Pe turele GRELE (analiză, cod, mate, raționament lung), creierul Pro
          // gândește ADÂNC: reasoning 'high' → thinkingLevel:'high' + podea de
          // output 8192 (geminiDirect). Pe turele ușoare rămâne fără gândire
          // extinsă, ca prima vorbă să fie rapidă. (:free/OpenRouter nu mai există.)
          reasoning: heavyTurn ? (orchestratorModel.startsWith(GEMINI_DIRECT_PREFIX) ? 'high' : 'medium') : undefined,
          // Escaladarea la mijloc: ask_brain o setează, orchestratorul o citește pe rundă.
          escaladare,
          // THE DEED GATE (Adrian, Jul 27): on the admin's turns, if Kelion
          // ASSERTS a deed without calling the tool, it is mechanically obliged
          // to execute or retract — it no longer stays at the declarative stage.
          // Garda de execuție (owner, 13 aug: „gărzile să deosebească afișare de
          // faptă"): show_document NU dezarmează poarta faptei; iar dacă tura de
          // acțiune se închide fără o unealtă de faptă, e forțat o dată să execute
          // sau să spună cinstit „nu pot" (poarta acțiunii, prinde și cardul tăcut).
          deedGate: isAdmin,
          uneltAfisaj: UNELTE_AFISAJ,
          grupExecutie: grupaExecutieUnealta,
          actiuneCeruta: forteazaFapta,
          // FORȚAREA E ÎNAPOI, DAR ÎNGUSTĂ (owner, 13 aug, anulează frâna din 29
          // iul). Regresia din iulie venea din a forța ORICE unealtă pe aproape
          // orice verb. Acum: forțăm DOAR pe turele clare de acțiune ale ownerului
          // (`forteazaFapta`), și DOAR spre uneltele de EXECUȚIE (`UNELTE_FAPTA`),
          // niciodată spre afișare — deci nu mai poate bifa cererea cu un card fals.
          forceToolsFirstRound: forteazaFapta,
          forceToolNames: UNELTE_FAPTA,
          onText: (txt) => {
            let clean = markupStrip.push(txt)
            if (!clean) return
            // ECOUL DE LA SFÂRȘIT NU SE ROSTEȘTE. Vine ultimul (vezi poarta), pe
            // linia lui. Reținem coada cât timp încă poate fi începutul lui
            // „\nAUZIT:" — cel mult 7 caractere de întârziere, nu o frază.
            if (voceAmbianta && gateDecided && !taced) {
              coadaEcou += clean
              const p = coadaEcou.search(/\n\s*AUZIT\s*:/i)
              if (p !== -1) {
                userEcho = coadaEcou.slice(p).replace(/^\s*\n?\s*AUZIT\s*:\s*/i, '').split('\n')[0].trim()
                clean = coadaEcou.slice(0, p)
                coadaEcou = ''
                ecouInchis = true
              } else {
                const tine = potrivirePartiala(coadaEcou, '\nAUZIT:')
                clean = tine > 0 ? coadaEcou.slice(0, coadaEcou.length - tine) : coadaEcou
                coadaEcou = tine > 0 ? coadaEcou.slice(coadaEcou.length - tine) : ''
              }
              if (ecouInchis && !clean) return
              if (!clean) return
            }
            // POARTA DE ADRESARE (voce ambientală): reținem primele caractere până
            // creierul decide. Dacă tace (<TAC/>) nu se scurge nimic; dacă e
            // adresat, emitem doar RĂSPUNSUL (fără linia AUZIT, dusă deja în {heard}).
            if (!gateDecided) {
              gateBuf += clean
              const emis = decideVoiceGate()
              if (!gateDecided) return // încă strânge — nu s-a decis
              if (taced) return // creierul nu era adresat — tăcere totală
              if (!emis) return
              clean = emis
            } else if (taced) {
              return
            }
            // Gardul de limbă pe scris (vezi declarația de sus): primele
            // caractere se strâng până se poate judeca începutul.
            if (!limbaScrisaDecisa) {
              limbaScrisaBuf += clean
              const strans = limbaScrisaBuf.trim()
              if (strans.length < 12 && !/[.!?\n]/.test(limbaScrisaBuf)) return // încă strânge
              limbaScrisaDecisa = true
              const straina = inceputStrain(strans)
              if (straina && !aCerutAltaLimba(lastUserText) && inceputStrain(lastUserText) !== straina) {
                limbaScrisaSuprimata = true
                console.error(`[CHAT] replică scrisă suprimată (începe în ${straina}): „${strans.slice(0, 100)}"`)
                textFlowed = true
                ecranPartial += NOTA_LIMBA
                noteFirstWord()
                reply.raw.write(NOTA_LIMBA)
                voice.feed(NOTA_LIMBA)
                return
              }
              clean = limbaScrisaBuf // se varsă întreg ce s-a strâns
              limbaScrisaBuf = ''
            } else if (limbaScrisaSuprimata) {
              return // restul replicii străine nu se emite și nu se rostește
            }
            textFlowed = true
            ecranPartial += clean // oglinda exactă a ecranului, pentru catch
            noteFirstWord()
            reply.raw.write(clean)
            voice.feed(clean)
          },
        },
      )
      // ── GEMINI-ONLY, FĂRĂ ROTAȚIE PE ALȚI FURNIZORI (3 aug — extirparea
      // totală OpenRouter, ordinul repetat al ownerului) ────────────────────────
      // Vechea plasă (rotația tăcută pe pool-ul :free din catalogul OpenRouter +
      // rezerva plătită + cursa pe 3 modele) A DISPĂRUT cu totul: nu mai există
      // alt furnizor pe care să cadă tura. Ce rămâne: până la 3 încercări pe
      // ACELAȘI creier Gemini (slotul + coada dispecerului absorb aglomerația;
      // eșecurile se notează pentru telemetrie), iar dacă toate pică, tura se
      // încheie CINSTIT cu mesajul neutru din catch — niciodată pe alt creier.
      let r: Awaited<ReturnType<typeof runBrainOnce>> | null = null
      let lastBrainErr: unknown = null
      // (CURSA a fost EXTIRPATĂ de tot: ajunsese deja „doar Gemini, fără
      // rivali OpenRouter" prin auditul din 3 aug, iar cu un singur concurent
      // o cursă nu mai e cursă — calea secvențială de mai jos e ACELAȘI creier
      // Gemini, cu unelte. services/cursa.ts a fost șters.)
      const MAX_INCERCARI_GEMINI = 3
      // MODELUL EFECTIV al rundelor (registrul backend #1): `ask_brain` poate urca
      // tura LA MIJLOC prin `escaladare`, iar orchestratorul citește
      // `escaladare.model` pe FIECARE rundă — deci sloturile, telemetria eșecurilor
      // și plasele trebuie să vorbească despre modelul care CHIAR rulează, nu
      // despre cel de pornire (înainte: slotul se ținea pe flash cât rundele
      // loveau profundul nepăzit, iar plasa „urc la profund" re-încerca exact
      // modelul care tocmai murise).
      const modelEfectiv = (): string => escaladare.model || orchestratorModel
      // REGISTRUL BACKEND #2 — FĂRĂ RE-EXECUȚIA UNELTELOR: o „reîncercare" e
      // runBrainOnce DE LA ZERO — dacă încercarea eșuată a apucat să CHEME unelte
      // (email, ordin de build, bani), reluarea le-ar executa A DOUA oară.
      // Odată armat, nici bucla, nici plasele nu mai reiau — tura iese pe drumul
      // onest de jos, cu faptele o singură dată.
      let faptaInIncercareEsuata = false
      // FĂRĂ RICOȘEU ÎNTRE PLASE (agentul de logică, F4): plasa profund→rapid
      // seta orchestratorModel = orChatModel, ceea ce APRINDEA condiția plasei
      // rapid→profund → a 5-a chemare a unui model deja epuizat, cu un log care
      // mințea („fața rapidă a întors gol de 3×" după O încercare). O singură
      // plasă pe tură — care pică, pică cinstit.
      let plasaRulata = false
      let slotTinut: string | null = null
      try {
        for (let attempt = 0; attempt < MAX_INCERCARI_GEMINI && !r; attempt++) {
          resetStareStream()
          // Take a slot on the EFFECTIVE Gemini model; if it's busy, wait in the
          // dispatcher's queue for a slot on the SAME model.
          const modelIncercare = modelEfectiv()
          const unelteLaStart = unelteEfectIncercate.length
          if (!iaSlotDacaLiber(modelIncercare)) {
            const tinut = await asteaptaLaCoada(async () => [modelIncercare], new Set<string>())
            if (!tinut) break // queue full or waited too long — the honest error below
          }
          slotTinut = modelIncercare
          try {
            const cand = await runBrainOnce()
            // A reply made ONLY of fake tool markup counts as EMPTY — retry
            // instead of showing/saying garbage or nothing. `sawVisible` here =
            // a SURFACE a tool already pushed this turn (map/doc/build frame) —
            // the instant ack no longer flips it (conteazaCaVizibil).
            const textCurat = stripToolMarkup(cand.text, undefined, toolNamesThisTurn).trim()
            // GARDUL DETERMINIST ANTI-NEGARE (Adrian, 5 aug: „kelion îmi zice
            // că nu are unelte"; „asta e un soft — ce cablezi, aia face").
            // Un răspuns care NEAGĂ uneltele, când tura chiar i le-a oferit,
            // e marfă stricată: NU pleacă la om — rotim, ca la răspunsul gol.
            // Doar dacă nu a curs deja text (streaming) — ce-a plecat, a plecat.
            // VINOVATUL LA MOMENTUL EȘECULUI: escaladarea ask_brain poate muta
            // rundele pe alt model ÎN TIMPUL încercării — sinteza moare pe modelul
            // EFECTIV de acum, nu pe cel pe care s-a luat slotul la start.
            const modelVinovat = modelEfectiv()
            if (!textFlowed && textCurat && neagaUneltele(textCurat)) {
              console.error(`[CHAT NEGARE] ${modelVinovat} și-a negat uneltele — nu trimit minciuna, reîncerc`)
              noteazaEsuare(modelVinovat)
            } else if (!textFlowed && textCurat && deflecteazaConstructor(textCurat) && !aAlocatConstructie(new Set(cand.toolsCalled))) {
              // GARDUL ANTI-DEFLECTARE (Adrian, 5 aug: „kelion nu alocă
              // constructorului cererile — spune că echipa de dezvoltare repară.
              // Care e echipa de dezvoltare?"). Nu există niciuna — el e
              // constructorul. Dacă amână spre o „echipă" FĂRĂ să fi chemat o
              // unealtă de construcție, e marfă stricată: aruncă + reîncearcă
              // (promptul deja îi spune să construiască; codul îl forțează).
              console.error(`[CHAT DEFLECTARE] ${modelVinovat} a amânat spre o „echipă" inexistentă fără să aloce la constructor — reîncerc`)
              noteazaEsuare(modelVinovat)
            } else if (textCurat || textFlowed || sawVisible) { r = cand; break }
            // Logul nu promite o reîncercare pe care break-ul de faptă o anulează.
            console.error(`[CHAT MUTE] ${modelVinovat} returned empty${unelteEfectIncercate.length > unelteLaStart ? ' — unelte cu efect deja chemate, NU reiau' : ` — reîncercare ${attempt + 1}/${MAX_INCERCARI_GEMINI}`}`)
            noteazaEsuare(modelVinovat)
          } catch (ge) {
            lastBrainErr = ge
            if (textFlowed) throw ge // partial text already at the user — no retry
            const errMsg = String(ge)
            const is503OrHighDemand = errMsg.includes('503') || /high demand/i.test(errMsg) || /UNAVAILABLE/i.test(errMsg)
            const modelVinovat = modelEfectiv() // sinteza a murit pe modelul efectiv de ACUM
            const potiRelua = attempt + 1 < MAX_INCERCARI_GEMINI && unelteEfectIncercate.length === unelteLaStart
            if (potiRelua) {
              console.warn(`[brain] ${modelVinovat} failed (${errMsg.slice(0, 120)}) — reîncercare ${attempt + 1}/${MAX_INCERCARI_GEMINI}`)
              const basePauza = is503OrHighDemand ? 1000 : 800
              const pauzaMs = Math.min(basePauza * Math.pow(2, attempt) + Math.floor(Math.random() * 400), 3000)
              await new Promise((res) => setTimeout(res, pauzaMs))
            } else {
              console.error(`[brain] ${modelVinovat} failed (${errMsg.slice(0, 120)}) — ${unelteEfectIncercate.length > unelteLaStart ? `${unelteEfectIncercate.length - unelteLaStart} unelte cu efect deja chemate în încercarea asta: NU reiau (efectele s-ar dubla)` : `încercări epuizate (${MAX_INCERCARI_GEMINI}/${MAX_INCERCARI_GEMINI})`}`)
            }
            noteazaEsuare(modelVinovat)
          } finally {
            elibereazaSlot(slotTinut)
            slotTinut = null
          }
          // Fapte cu EFECT deja făcute în încercarea eșuată → gata cu reluările
          // (vezi declarația faptaInIncercareEsuata de sus). Plasele citesc flag-ul.
          if (!r && unelteEfectIncercate.length > unelteLaStart) {
            faptaInIncercareEsuata = true
            break
          }
        }
      } finally {
        if (slotTinut) elibereazaSlot(slotTinut)
      }
      // ── PLASA CREIERULUI PROFUND (owner, 13 aug: „e urgent ca kelion să lucreze
      // real") ──────────────────────────────────────────────────────────────────
      // Creierul profund (Pro) e mai deștept, dar și mai expus la rate-limit/eroare.
      // Dacă s-a epuizat (`!r`) ȘI nimic n-a curs încă la om (`!textFlowed`), cădem
      // O SINGURĂ dată pe fața rapidă (flash) — o tură de EXECUȚIE nu mai moare pe
      // mesajul neutru; măcar răspunde. Rulează DOAR pe calea deja pierdută, deci nu
      // poate strica o tură care mergea (dacă și asta pică, se aruncă eroarea de jos,
      // exact ca înainte).
      // Trupul comun al ambelor plase (profund→rapid și rapid→profund): ia un
      // slot pe modelul DEJA comutat, o singură încercare, acceptă doar ce se
      // vede. Scris O DATĂ — două copii ar fi divergat (și jscpd le refuză).
      const incearcaPlasa = async (): Promise<void> => {
        let slotPlasa: string | null = null
        try {
          // Slotul pe modelul EFECTIV (plasele golesc escaladarea înainte să mă
          // cheme, deci de regulă e chiar orchestratorModel — dar regula rămâne una).
          const modelPlasa = modelEfectiv()
          if (iaSlotDacaLiber(modelPlasa)) slotPlasa = modelPlasa
          else if (await asteaptaLaCoada(async () => [modelPlasa], new Set<string>())) slotPlasa = modelPlasa
          if (slotPlasa) {
            resetStareStream()
            const cand = await runBrainOnce()
            const textCurat = stripToolMarkup(cand.text, undefined, toolNamesThisTurn).trim()
            if (textCurat || textFlowed || sawVisible) r = cand
          }
        } catch (ge) {
          lastBrainErr = ge
        } finally {
          if (slotPlasa) elibereazaSlot(slotPlasa)
        }
      }
if (!r && !textFlowed && !faptaInIncercareEsuata && orChatModel && orChatModel !== orchestratorModel) {
        const modelProfund = orchestratorModel
        orchestratorModel = orChatModel // runBrainOnce + reasoning citesc valoarea nouă
        escaladare.model = undefined // golim escaladarea, ca rezerva rapidă să câștige (altfel ar reurca la greu)
        escaladare.reasoning = undefined
        plasaRulata = true // comutarea de mai sus aprindea condiția plasei oglindite → ricoșeu înapoi pe profund
        console.error(`[CREIER PROFUND EPUIZAT] ${modelProfund} → cad pe fața rapidă ${orchestratorModel}`)
        await incearcaPlasa()
      }
      // ── PLASA OGLINDITĂ: FAȚA RAPIDĂ EPUIZATĂ → O URCARE PE CREIERUL PROFUND
      // (owner, 15 aug, prins LIVE cu captura + F12: tura lui a păginat db_query
      // de ~18 ori, apoi sinteza pe flash a STAT 37s pe server și a întors GOL —
      // `[CHAT MUTE] gemini-3.7-flash returned empty` ×3 → omul a primit
      // „încearcă mai târziu"). Plasa de sus acoperă DOAR sensul profund→rapid;
      // sensul ăsta lipsea: o tură pornită pe flash care s-a dovedit GREA din
      // mers (unelte multe, context mare) murea fără să fi atins vreodată
      // inteligența reală. Urcăm O SINGURĂ dată, doar pe calea deja pierdută
      // (!r && !textFlowed) — o tură care mergea nu poate fi stricată de plasă. */
      if (!r && !textFlowed && !faptaInIncercareEsuata && !plasaRulata && config.modelCreierProfund && orchestratorModel === orChatModel) {
        const profund = `google-direct/${config.modelCreierProfund}`
        if (modelEfectiv() === profund) {
          // REGISTRUL BACKEND #1 + #3: tura a rulat DEJA pe profund și a murit
          // acolo — fie a pornit GREA (orChatModel e chiar profundul: pe turele
          // grele work = modelUnic = modelCreierProfund, deci plasa veche
          // „profund !== modelRapid" era MOARTĂ — același string, nicio plasă,
          // mesajul neutru), fie a URCAT prin `ask_brain` și sinteza a picat pe
          // profund. „Urc pe creierul profund" ar re-încerca exact modelul care
          // tocmai a picat, cu un log care minte. Sensul cinstit rămas: golim
          // escaladarea și cădem O dată pe o FAȚĂ RAPIDĂ REALĂ — modelul rapid
          // al turei dacă e altul decât profundul, altfel a treia treaptă:
          // modelRapidDirect() (fața rapidă a sistemului).
          const rapidReal = orchestratorModel !== profund ? orchestratorModel : modelRapidDirect()
          if (rapidReal !== profund) {
            orchestratorModel = rapidReal // runBrainOnce + reasoning citesc valoarea nouă
            escaladare.model = undefined
            escaladare.reasoning = undefined
            console.error(`[PROFUNDUL EPUIZAT] ${profund} a picat → cad pe fața rapidă ${rapidReal}`)
            await incearcaPlasa()
          }
        } else if (profund !== orchestratorModel) {
          const modelRapid = orchestratorModel
          orchestratorModel = profund // runBrainOnce + reasoning citesc valoarea nouă
          // Golim escaladarea: un `escaladare.model` rămas (alt model greu) ar
          // câștiga în orchestrator peste `profund` și logul de mai jos ar minți.
          escaladare.model = undefined
          escaladare.reasoning = undefined
          console.error(`[FAȚA RAPIDĂ EPUIZATĂ] ${modelRapid} a întors gol/eroare de ${MAX_INCERCARI_GEMINI}× → urc pe creierul profund ${orchestratorModel}`)
          await incearcaPlasa()
        }
      }
      if (!r) throw (lastBrainErr ?? new Error('brain_gemini_exhausted'))
      markupStrip.flush() // held marker fragments: logged, never shown
      // Pe voce, textul asistentului e DOAR corpul rostit — poarta a scos linia
      // „AUZIT:" și sentinela din r.text, iar ce-a rămas e deja în ecranPartial.
      if (!voceAmbianta) assistantText += stripToolMarkup(r.text, undefined, toolNamesThisTurn)
      // Replica suprimată de gardul de limbă NU intră în istoric (assistantText
      // vine din r.text — textul ÎNTREG al modelului, nu doar ce s-a emis);
      // se ține nota cinstită, care chiar s-a văzut pe ecran.
      if (limbaScrisaSuprimata) assistantText = NOTA_LIMBA
      // ── POARTA FAPTELOR (owner, 16 aug: „acest soft e doar o minciuna…
      // raspunde de ce"; captura 05:54 — creierul recunoaște „am mințit
      // afirmând că am generat clipul"). Vorbele se verifică pe MĂSURĂTOARE:
      // rezultatele reușite/verificate din tura asta. Pretenție fără faptă =
      // demascată pe loc, pe ecran ȘI în istoric — pentru ORICE model.
      if (!voceAmbianta) {
        const nedovedite = pretentiiFaraFapta(assistantText, doveziUnelte)
        if (nedovedite.length) {
          // Pe runda de CONTINUARE a trierii, „pretenția" poate fi RELATAREA
          // cinstită a faptei din runda 1 (dovezile au rămas în tura aceea) —
          // verdictul dur „e FALSĂ" ar minți el însuși. Acolo: varianta
          // cinstită „nu pot verifica" (Legea #1), nu demascarea.
          const demascare = req.body?.continuareUsa === true ? textulNuPotVerifica(nedovedite) : textulDemascarii(nedovedite)
          try {
            reply.raw.write(demascare)
          } catch {
            /* demascarea nescrisă pe stream rămâne în istoric */
          }
          assistantText += demascare
          console.error(`[POARTA FAPTELOR] pretenții fără faptă: ${nedovedite.join('; ')} | încercate: ${unelteIncercate.join(',') || 'niciuna'} | rezultate: ${doveziUnelte.map((d) => `${d.nume}:${d.stare}`).join(',') || 'niciunul'}`)
          // Nota porții devine EVENIMENT durabil în jurnalul operațional
          // (JARVIS pasul 4): pe tura ușii, textul demascării nu intra nicăieri
          // durabil (saveMessage e sărit pe eUsaCreierului mai jos) — rămânea
          // doar în inelul de log din memorie. Acum dovada provocării există
          // și poate fi scoasă cu dovada_faptelor.
          await scrieJurnalOperational(() => noteazaEvenimentOperational({
            taskId: sarcinaOperationalaId,
            kind: 'facts_gate',
            outcomeState: 'observed',
            code: req.body?.continuareUsa === true ? 'claims_unverifiable' : 'claims_without_deed',
            reason: nedovedite.join('; '),
          }))
        }
        // ── ÎNGHEȚUL-PLAN (owner, 16 aug: „sa nu mai intepeneasca... sa ofere
        // solutia pina la deploy masurabil"). Tură de EXECUȚIE + ZERO unelte +
        // limbaj de plan = fix înghețul de 5 luni. Se demască pe ecran și în
        // istoric — legea ducerii la capăt, mecanic, pentru orice model.
        planFaraExecutieDetectat = planFaraExecutie(assistantText, doveziUnelte, actiuneCerutaExplicit)
        if (planFaraExecutieDetectat) {
          try {
            reply.raw.write(TEXT_PLAN_FARA_EXECUTIE)
          } catch {
            /* demascarea nescrisă pe stream rămâne în istoric */
          }
          assistantText += TEXT_PLAN_FARA_EXECUTIE
          console.error('[POARTA FAPTELOR] plan fără execuție — tura de acțiune s-a oprit fără nicio unealtă')
        }
      }
      usage.usd += r.costUsd
      // REAL ACCOUNTING (QA audit Jul 24, A1): the BRAIN cost enters cost_events
      // for ALL users (including admin) — the Money tab showed 0 under "Brain"
      // because recordCost was not called anywhere on the chat path.
      // COMUTATOR DE CREIER (23 aug 2026): costul merge pe provider-ul real
      // (openai pentru openai/*, gemini pentru google-direct/*).
      const brainCostKind = r.model.startsWith('openai/') ? 'openai' : 'gemini'
      void recordCost(user.email, brainCostKind, r.costUsd)
      const totalMs = Date.now() - tCreier
      console.log(`[TIMP] tura ${turnId.slice(0, 8)}: creier=${orchestratorModel}, runde=${r.rounds}, total=${totalMs}ms`)
      // EVIDENȚA TIMPILOR (Adrian, 3 aug): măsurabil + din el învață bucla din spate.
      void recordTiming({ email: user.email, kind: 'chat', model: orchestratorModel, ms: totalMs, ok: true, rounds: r.rounds })
      // ── VOCE AMBIENTALĂ: verdictul de adresare ────────────────────────────────
      // Poarta poate să nu fi apucat să decidă în stream (răspuns foarte scurt) →
      // decidem acum pe tot ce-a venit. La ambiguitate → tăcere (ordinul: „să nu
      // vorbească neîntrebat").
      if (voceAmbianta && !gateDecided) {
        const trimmed = gateBuf.replace(/^\s+/, '')
        const mAuzit = /^\s*AUZIT:\s*([\s\S]*)$/i.exec(trimmed)
        gateDecided = true
        if (mAuzit) {
          userEcho = mAuzit[1].split('\n')[0].trim()
          emitHeard(userEcho)
          const nl = trimmed.indexOf('\n')
          const corp = nl === -1 ? '' : trimmed.slice(nl + 1).trim()
          if (corp) { textFlowed = true; ecranPartial += corp; reply.raw.write(corp) }
        } else if (!trimmed || SENTINELA_TAC.startsWith(trimmed.slice(0, SENTINELA_TAC.length).toUpperCase()) || /^<\s*tac\s*\/?\s*>/i.test(trimmed)) {
          taced = true // sentinela (parțială, în orice variantă) sau nimic → tăcere
        } else {
          emitHeard(''); textFlowed = true; ecranPartial += trimmed; reply.raw.write(trimmed)
        }
      }
      // ── SFÂRȘIT DE TURĂ VOCALĂ: coada reținută + ecoul real ─────────────
      // Dacă marcajul de ecou n-a mai venit (creierul n-a scris „AUZIT:"),
      // coada reținută e text normal și TREBUIE scrisă — altfel s-ar pierde
      // ultimele caractere ale răspunsului, tăcut. Iar dacă ecoul a venit, îl
      // trimitem ACUM la ecran; până aici ecranul a arătat gol, dar omul a auzit
      // răspunsul din prima secundă — schimbul e exact ăsta.
      if (voceAmbianta && gateDecided && !taced) {
        if (coadaEcou) {
          textFlowed = true
          ecranPartial += coadaEcou
          reply.raw.write(coadaEcou)
          voice.feed(coadaEcou)
          coadaEcou = ''
        }
        if (userEcho) emitHeard(userEcho)
      }
      // Pe voce, corpul rostit e în ecranPartial (poarta l-a scos curat).
      if (voceAmbianta && !taced) {
        assistantText = ecranPartial
        // CĂȚELUL PE REZERVA VOCALĂ (C3 al marii verificări): blocul de la
        // `if (!voceAmbianta)` sare poarta faptelor pe EXACT calea folosită
        // când sesiunea Live e moartă (Chirp) — „am trimis emailul" rostit
        // prin rezervă nu se demasca nicăieri. Nota intră în ISTORIC și pe
        // ecranul turei (assistantText), NU în gura care a vorbit deja —
        // varianta onestă „nu pot verifica" (§8: nota nu se rostește).
        const nedoveditePeVoce = pretentiiFaraFapta(assistantText, doveziUnelte)
        if (nedoveditePeVoce.length) {
          const nota = textulNuPotVerifica(nedoveditePeVoce)
          assistantText += nota
          try {
            reply.raw.write(nota)
          } catch {
            /* nescrisă pe stream — rămâne în istoric */
          }
          console.error(`[POARTA FAPTELOR][REZERVA VOCALĂ] pretenții nedovedite (nu pot verifica): ${nedoveditePeVoce.join('; ')} | rezultate: ${doveziUnelte.map((d) => `${d.nume}:${d.stare}`).join(',') || 'niciunul'}`)
          await scrieJurnalOperational(() => noteazaEvenimentOperational({
            taskId: sarcinaOperationalaId,
            kind: 'facts_gate',
            outcomeState: 'observed',
            code: 'claims_unverifiable_voice_fallback',
            reason: nedoveditePeVoce.join('; '),
          }))
        }
      }
      // Creierul a hotărât că NU i se vorbea → tura se stinge: {ignored}, fără
      // rostire (poarta a reținut tot), fără salvare. Clientul șterge bulele.
      if (voceAmbianta && taced) {
        // Dacă în ce-a auzit e numele lui, tăcerea e GREȘITĂ — și trebuie să se
        // vadă ca atare în jurnal, nu îngropată printre tăcerile corecte.
        // (Poarta deterministă de nume a fost scoasă de pe client pe 7 aug, cu
        // avertismentul scris în handoff că „un fals <TAC/> poate înghiți tăcut
        // o frază adresată". Măsurătoarea ownerului din 8 aug l-a confirmat.)
        const gresita = numeStrigat(userEcho)
        // Ce s-a auzit pleacă la ecran ÎNAINTE de stingere — clientul păstrează
        // bula omului cu textul auzit (Adrian: „nu ignora ce aude").
        if (userEcho) emitHeard(userEcho)
        reply.raw.write(`${CTRL}${JSON.stringify({ ignored: true })}${CTRL}`)
        await scrieJurnalOperational(() => tranzitioneazaSarcinaOperationala({
          taskId: sarcinaOperationalaId,
          stare: 'expired',
          code: gresita ? 'voice_gate_false_negative' : 'turn_not_addressed',
          metadata: { ambientVoice: true, nameWasHeard: gresita },
        }))
        reply.raw.end()
        console.log(
          gresita
            ? `[VOCE] tura ${turnId.slice(0, 8)}: TĂCERE GREȘITĂ — a auzit numele și tot a tăcut. AUZIT: „${userEcho}"`
            : `[VOCE] tura ${turnId.slice(0, 8)}: tăcere — nu i se vorbea. AUZIT: „${userEcho || '(n-a spus ce a auzit)'}"`,
        )
        // BANII NU SE PIERD PE TĂCERE (audit 9 aug, critică): creierul + uneltele
        // au costat și pe tura tăcută, iar return-ul de aici sărea peste debit —
        // fundalul vorbit continuu (majoritatea turelor ambientale tac) consuma
        // pe gratis, repetabil. Ownerul nu se debitează niciodată (PR #648).
        if (usage.usd > 0 && !isOwnerEmail(user.email)) void debitWallet(user.email, usage.usd, `chat-tac:${turnId.slice(0, 8)}`)
        return
      }
      // Voce adresată: salvăm mesajul userului = ce a auzit creierul (ecou precis,
      // din voce — nu un transcript stâlcit de STT). {heard} a plecat deja în stream.
      if (voceAmbianta) {
        void saveMessage(user.email, 'user', userEcho.trim() || (ro ? '(mesaj vocal)' : '(voice message)'))
      }
    } catch (e) {
      // The brain failed — honest, never silent. No Kimi/GLM safety net
      // (removed).
      const errMsg = e instanceof Error ? e.message : String(e)
      // COSTUL RUNDELOR DEJA PLĂTITE vine agățat de eroare (orchestrator, audit
      // 9 aug) — se adună în usage ÎNAINTE de orice ieșire de mai jos, ca și
      // debitul și registrul să-l vadă.
      const costPierdut = e instanceof Error ? Number((e as Error & { costUsd?: number }).costUsd ?? 0) : 0
      if (costPierdut > 0) {
        usage.usd += costPierdut
        const errCostKind = (orChatModel ?? '').startsWith('openai/') ? 'openai' : 'gemini'
        void recordCost(user.email, errCostKind, costPierdut)
      }
      // Măsoară + debitează pe eroare — O SINGURĂ sursă (jscpd, 10 aug), folosită
      // pe ambele ramuri de eșec (tura ambientală și eroarea generală). Timpul se
      // notează (bucla din spate învață din el); uneltele deja rulate se
      // debitează (nu pe gratis), dar OWNERUL niciodată (PR #648).
      const inchideEroare = (): void => {
        void recordTiming({ email: user.email, kind: 'chat', ms: Date.now() - tCreier, ok: false })
        if (usage.usd > 0 && !isOwnerEmail(user.email)) void debitWallet(user.email, usage.usd, `chat-err:${turnId.slice(0, 8)}`)
      }
      // TURA AMBIENTALĂ MOARE TĂCUT, CA-N CONTRACT (audit 9 aug): la o pană de
      // creier pe o frază de fundal NEADRESATĂ (poarta n-a decis), nu se scrie
      // nicio bulă „Încearcă din nou" și nu se murdărește istoricul — clientul
      // primește {ignored} exact ca la <TAC/>; cauza rămâne în jurnal, iar
      // uneltele deja rulate tot se debitează (nu pe gratis).
      if (voceAmbianta && !gateDecided) {
        reply.raw.write(`${CTRL}${JSON.stringify({ ignored: true })}${CTRL}`)
        await scrieJurnalOperational(() => tranzitioneazaSarcinaOperationala({
          taskId: sarcinaOperationalaId,
          stare: 'expired',
          code: 'turn_not_addressed',
          metadata: { ambientVoice: true, brainUnavailable: true },
        }))
        reply.raw.end()
        console.error('[CHAT ERROR pe tură ambientală neadresată — stinsă cu {ignored}]', errMsg)
        inchideEroare()
        return
      }
      const low = errMsg.toLowerCase()
      // Diagnostic classification — LOG ONLY (429 vs 402 vs refusal matters to
      // us in the server log, never to the user; Adrian, Aug 1).
      const isRateLimit =
        low.includes('429') || /rate.?limit|resourceexhausted|too many requests/.test(low) || low.includes('quota')
      const isQuota = !isRateLimit && (low.includes('402') || low.includes('insufficient'))
      const isRefusal = low.includes('refusal')
      // USER-FACING MESSAGES STAY NEUTRAL (Adrian, Aug 1): paying users must
      // NEVER read about models, rate limits, quotas or money. The rotation
      // above absorbs single-model failures; if we land here the whole pool
      // failed — the human hears only a neutral "try again". Details stay in
      // the server log (console.error below).
      // RĂSPUNS PARȚIAL ≠ RĂSPUNS MORT (agenții de debug, 3 aug, verdict REAL):
      // dacă textul deja a curs, sufixul se SEPARĂ de el (nu se lipește în
      // aceeași propoziție) și spune cinstit că s-a întrerupt — iar istoricul
      // salvează ecranul ÎNTREG (parțial + notă), nu doar sufixul.
      // REGISTRUL BACKEND #4 — MESAJ ONEST PE EROARE NE-TRANZITORIE: „Încearcă
      // din nou în câteva secunde" promite că repetarea ajută — minte când cauza
      // NU trece de la sine (cerere refuzată/nevalidă, cheie/permisiune, model
      // inexistent — cazul măsurat: modelul pensionat care a tăcut ZILE întregi
      // tot cu „încearcă din nou"). Clasificarea rămâne DOAR pe server (regula
      // din 1 aug: userul nu citește despre modele/cote/bani) — omul primește
      // tot un mesaj neutru, dar unul care nu-l minte cu falsă speranță.
      const eNetranzitorie =
        !isRateLimit &&
        (isRefusal ||
          // `not[_ ]found` (statusul Google / „not found"), NU `not.?found` —
          // acela prindea și ENOTFOUND (pană DNS/rețea TRANZITORIE, agentul F5a).
          /invalid.?argument|permission.?denied|api.?key|failed.?precondition|not[_ ]found|unsupported|safety|prohibited|blocklist/.test(low) ||
          /\b40[034]\b/.test(low))
      // REGISTRUL #2, PARTEA OMULUI (verdictele agenților lot B): mașina nu mai
      // dublează faptele la retry — dar „încearcă din nou" îl INVITA pe om să
      // retrimită o tură ale cărei fapte s-au executat DEJA (email trimis, ordin
      // creat). Dacă o unealtă cu EFECT EXTERN a reușit în tura moartă, omul
      // e avertizat cinstit, fără niciun detaliu tehnic (regula 1 aug).
      const fapteDejaExecutate = doveziUnelte.some(
        (d) => (d.stare === 'succeeded' || d.stare === 'verified') &&
          (d.nume === 'db_query' ? dbQueryAScris : eUnealtaCuEfectExtern(d.nume)),
      )
      let spoken = ecranPartial.trim()
        ? (ro
            ? '\n\n[Răspunsul s-a întrerupt aici — cere-mi să continui.]'
            : '\n\n[The reply was cut off here — ask me to continue.]')
        : fapteDejaExecutate
          ? (ro
              ? 'Am apucat să execut o parte din ce ai cerut înainte de întrerupere — verifică rezultatul înainte să repeți cererea.'
              : 'Part of what you asked was already carried out before the interruption — check the result before repeating the request.')
          : eNetranzitorie
            ? (ro
                ? 'Cererea asta nu a putut fi dusă la capăt — repetată neschimbată, ar pica la fel. Reformuleaz-o sau cere altceva.'
                : 'This request could not be completed — retried unchanged it would fail the same way. Rephrase it or ask for something else.')
            : ro
              ? 'Încearcă din nou în câteva secunde.'
              : 'Try again in a few seconds.'
      // CREDITUL MORT SPUS PE FAȚĂ, DOAR ADMINULUI (9 aug, capturile ownerului:
      // sold AI Studio −£1.32, card refuzat la auto-reîncărcare — iar Kelion
      // inventa scuze („nu ești logat ca admin") peste turele care mureau pe
      // cotă). Userii plătitori RĂMÂN pe mesajul neutru (regula din 1 aug: nu
      // citesc despre modele/cote/bani); OWNERUL are nevoie de cauza reală ca
      // să știe CE să repare. Sonda geminiLive() (ping generateContent, cache
      // 5 min) desparte creditul epuizat de o limită de viteză trecătoare.
      if (isAdminUser && isRateLimit) {
        const g = await geminiLive().catch(() => null)
        const cauza =
          g?.ok && !g.serving && g.reason === 'depleted'
            ? '[CREDIT GOOGLE EPUIZAT] Google refuză generarea: soldul AI Studio e sub zero, iar cardul de auto-reîncărcare a fost refuzat. Reîncarcă la aistudio.google.com → Billing; până atunci creierul nu poate răspunde.'
            : g?.ok && !g.serving && g.reason === 'quota'
              ? '[COTĂ GEMINI ATINSĂ] Limita de cereri pe minut e atinsă — nu e problemă de credit; reîncearcă în circa un minut.'
              : null
        if (cauza) spoken = `${ecranPartial.trim() ? '\n\n' : ''}${cauza}`
      }
      reply.raw.write(spoken)
      // ȘI CU VOCE (auditul 15 aug): bula de eroare apărea DOAR ca text — omul
      // pe voce rămânea în tăcere totală, iar audio-ul deja sintetizat al
      // începutului de replică se pierdea nevărsat. Mesajul se rostește, iar
      // finish() varsă și cozile pending înainte de închidere.
      voice.feed(spoken)
      await voice.finish().catch(() => {})
      await scrieJurnalOperational(() => tranzitioneazaSarcinaOperationala({
        taskId: sarcinaOperationalaId,
        stare: 'failed',
        code: 'chat_processing_failed',
        metadata: { partialResponse: Boolean(ecranPartial.trim()) },
      }))
      reply.raw.end()
      void saveMessage(user.email, 'assistant', ecranPartial.trim() ? ecranPartial + spoken : spoken)
      console.error('[CHAT ERROR]', errMsg, { isRateLimit, isQuota, isRefusal })
      // Timpul măsurat + banii pe uneltele deja rulate (nu pe gratis), ownerul
      // niciodată — aceeași sursă unică inchideEroare (vezi mai sus).
      inchideEroare()
      return
    }


    // ── FINAL TURN ──
    // CENTRUL DE TRANZACȚIONARE — bucla închisă (10 aug): nivelurile din
    // răspunsul chatului REAL se extrag AICI, cu parserul testat și cu prețul
    // real în mână, și pleacă spre browser ca frame {niveluri} — ChatPanel le
    // pasează în iframe, pagina le desenează. Schimbul intră și în memoria
    // separată 'tranzactii' (promisiunea „memoria doar-admin" ținută pe drum viu).
    if (piata?.simbol && assistantText.trim()) {
      const niv = extrageNiveluri(assistantText, Number(piata.pret) || undefined)
      if (niv.length) {
        reply.raw.write(`${CTRL}${JSON.stringify({ niveluri: { simbol: String(piata.simbol), lista: niv } })}${CTRL}`)
      }
      const zi = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const intrebarea = (messages.at(-1)?.content ?? '').slice(0, 300)
      void addMemory(
        config.adminEmail,
        `[tranzactii-chat ${zi}] ${String(piata.simbol).slice(0, 20)} Î: ${intrebarea} | R: ${assistantText.slice(0, 600)}`,
        'tranzactii',
      ).catch(() => {})
    }
    // TOTUL PE MONITOR (Adrian, Aug 2, 10:13 — the monitor is the PRIMARY
    // display surface): when the brain did NOT push any surface this turn but
    // its final answer still carries an obviously displayable payload (a URL,
    // an image link, map coordinates, a markdown table, a code block), the
    // monitor gets ONE sensible visual of it — deterministic, no extra model
    // call. Never duplicates what show_document/show_on_screen/a screen_url
    // tool already pushed (surfaceShown). Since Aug 19 („totul pe monitor"),
    // plain prose itself becomes a {doc} (autoPreviewFrame branch 6) — the
    // old claim „never fires on plain prose" was rotten and is corrected.
    // See services/monitorAutoPreview.ts.
    if (!surfaceShown && assistantText.trim()) {
      const preview = autoPreviewFrame(assistantText)
      if (preview) {
        reply.raw.write(`${CTRL}${JSON.stringify(preview)}${CTRL}`)
        console.log('[monitor] auto-preview: the answer carried a displayable payload the brain did not show')
      }
    }
    // ── GESTUL PE SITUAȚIE (Adrian, 5 aug: „folosește gesturile greșit, fără
    // logică — o logică clară pe subiect/situație"). Un SINGUR gest pe tură, ales
    // DETERMINIST de ce a făcut Kelion acum: arată pe ecran → arată cu mâna;
    // salut/rămas-bun → salut; cere să aștepți → stai puțin; a reușit →
    // entuziasm; se scuză → dezamăgire; îi mulțumești → mulțumire; altfel NIMIC.
    // `surfaceShown` include și auto-preview-ul de mai sus (interceptorul de
    // write l-a marcat). Trece prin aceeași poartă (pauză + fără repetiție) și
    // respectă gesturile dezactivate de Adrian. Vine DUPĂ text, deci gestul se
    // potrivește pe replica întreagă, nu pe o ghiceală de la începutul turei.
    const gestSituatie = gestPentruSituatie({
      userText: lastIncomingText,
      replyText: assistantText,
      aAratat: surfaceShown,
    })
    if (gestSituatie) {
      const clipSituatie = GESTURE_SEMANTIC_CLIP[gestSituatie] ?? gestSituatie
      if (!gestureOff.has(clipSituatie) && allowAutoGesture(user.email, gestSituatie)) {
        reply.raw.write(`${CTRL}${JSON.stringify({ gesture: gestSituatie })}${CTRL}`)
      }
    }
    // NEVER SILENCE (Adrian, Jul 30: "reply = nothing", "it does nothing").
    // The last safety net, after ALL paths: if the turn produced nothing
    // visible — no text, no surface — the human gets an honest message, not a
    // void. A silent error remains an error (rule no. 1); silence is the worst
    // reply, because it cannot be told apart from "the app is dead".
    if (!sawVisible) {
      // NEUTRAL HERE TOO (Adrian, Aug 1): no "brain", no "model", no Settings
      // instructions for paying users — the human hears only "try again".
      // The technical detail stays in the server log below.
      const mut = ro
        ? 'Încearcă din nou în câteva secunde.'
        : 'Try again in a few seconds.'
      reply.raw.write(mut)
      void saveMessage(user.email, 'assistant', mut)
      console.error('[CHAT MUTE] the turn ended with nothing visible', {
        model: orChatModel,
        user: user.email,
      })
      // ȘI CA SIMPTOM VIU (12 aug): pe backend console.error intră doar în log,
      // nu în self-heal. Pe semnalul `!sawVisible` deja calculat (zero fals
      // pozitive — turele de acțiune au `sawVisible`), chatul mut pe SCRIS devine
      // un simptom la care autovindecarea ajunge, exact ca vocea.
      void recordSimptomLive('chat-mut', `scris: tura s-a terminat fără nimic vizibil (model ${orChatModel})`).catch(() => {})
    }
    await voice.finish()
    const finalOperational = rezumaStareFinalaSarcinaOperationala({
      // pe INTENȚIA explicită, nu pe simpla prezență a imaginii (C6):
      // descrierea corectă a unei poze fără unelte nu e o acțiune ratată.
      cereActiune: actiuneCerutaExplicit,
      dovezi: doveziUnelte,
      planFaraExecutie: planFaraExecutieDetectat,
    })
    await scrieJurnalOperational(() => tranzitioneazaSarcinaOperationala({
      taskId: sarcinaOperationalaId,
      stare: finalOperational.stare,
      code: finalOperational.cod,
      metadata: {
        actionRequested: cereActiune,
        visibleResponse: sawVisible,
        toolAttempts: unelteIncercate.length,
        toolResults: doveziUnelte.length,
      },
    }))
    reply.raw.end()

    // Persist the assistant's reply.
    // (ușa creierului: tura reală — transcrierea rostită — o salvează ruta
    // vocală la verdict; aici s-ar dubla și ar scăpa ture apoi suprimate.)
    if (assistantText && !eUsaCreierului) {
      void saveMessage(user.email, 'assistant', assistantText)
      // Memory agent (learn): durable facts about this user, learned from this turn.
      // Fire-and-forget — zero latency on the reply path.
      // CRITICAL FIX (Jul 24 audit): the arguments were reversed — 'kelion'
      // arrived as userMsg and the reply as the agent name → memory retained
      // NOTHING anymore.
      void learnFromTurn(user.email, lastUserText, assistantText, 'kelion')
    }

    // Debit the real provider cost from the wallet — CUSTOMERS ONLY.
    // The Jul 25 "everyone pays, even the admin" rule DIED on Aug 2 (PR #648,
    // live proof: the admin's own testing drained £5.73 of voice in one
    // morning from his own wallet): usage is still RECORDED for the Money tab
    // (recordCost above), never DEBITED from the owner — the users' credits
    // pay, the free provider tier is his margin. This chat path had kept the
    // old rule after realtime.ts was fixed — the same hole, one screen over.
    {
      const cost = usage.usd
      if (cost > 0 && !isOwnerEmail(user.email)) {
        void debitWallet(user.email, cost, `chat:${turnId.slice(0, 8)}`)
      }
    }
    },
  )
}

// Pornește constructorul ÎN FUNDAL, acum — ca ordinul să nu aștepte bucla de
// autonomie. O SINGURĂ sursă (jscpd, 10 aug): folosit la build_software ȘI la
// retry. Best-effort: nu blochează, nu aruncă.
function porneculLucratorulConstructor(): void {
  // CONSTRUCTORUL E DEVIN, PUNCT (owner, 22 aug: „am cerut devin peste tot in
  // constructor… sa-i stergi de tot [pe Aider+Ollama]") — ramura veche care
  // trezea prin spawn lucrătorul local de pe VPS A FOST ȘTEARSĂ cu toată
  // mașinăria lui. Fără cheia Devin, tick-ul e inert prin
  // design și ordinul rămâne în coadă — diagnosticul o spune cu roșu, nu se
  // construiește pe ascuns cu altceva.
  // PORNIRE IMEDIATĂ (22 aug, „Devin full funcțional"): dispecerul Devin trăia
  // DOAR în trecerea buclei de autonomie, iar pauza dintre treceri urcă la 60
  // de minute pe „nimic de făcut" — ordinul owner-ului putea zăcea în coadă o
  // ORĂ înainte ca Devin să fie măcar pornit. Ordinul e „doar la comandă", deci
  // comanda îl și pornește: un tick în fundal, chiar acum (idempotent — UN job
  // pe rând, tick-ul concurent cu bucla nu poate porni două sesiuni pe același
  // ordin: claimNextBuildJob e atomic pe rând).
  if (config.devinKey) {
    void import('../services/devinConstructor.js')
      .then(({ tickDispecerDevin }) => tickDispecerDevin())
      .catch((e) => console.error('[devin] tick imediat:', String(e).slice(0, 160)))
  }
}

// ── runTool helper (extracted from the main handler for clarity) ────────────
async function runTool(
  block: ToolUseBlock,
  isAdmin: boolean,
  token: string,
  reply: { raw: { write(c: string): void } },
  baseUrl: string,
  email: string,
  /** The requester's session — we pass it to the admin routes so they can do
   *  their own admin check (we do not bypass it). */
  cookie: string,
  // The turn's usage accumulator: image generation adds its REAL cost here
  // (booked where the provider's own usage.cost is known, not estimated
  // upfront). Other costs are accounted outside runTool.
  usage: { usd: number },
  _langName: string,
  // The turn's location truth (resolveDeviceLocation) — the get_weather guard
  // fills/refuses location-less calls from it. One source with the prompt.
  loc: DeviceLocation,
): Promise<string> {
  const args = block.input as Record<string, unknown>
  // The SHARED queue of all browser actions (open/click/type/read/back/
  // scroll/key/click_at): on success it sends the locally served SCREENSHOT to
  // the monitor (embeddable — not the external URL the iframe refused, Jul 24
  // audit P1-4), then returns the raw result. It was copied into 8 cases; here
  // it happens once (permanent principle: unique, no duplicates).
  const browserResult = (result: BrowserResult): string => {
    if (!('error' in result)) {
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: result.shotUrl, title: result.title } })}${CTRL}`)
      // OCHII PE PAGINĂ (9 aug, ownerul: „sistemul nu dă lui Kelion poza reală
      // pentru analiză"): captura pleca DOAR pe monitor, iar modelul primea un
      // URL pe care nu-l poate privi — „citește captura" din descrierea uneltei
      // era o minciună structurală. Acum base64-ul iese din textul rezultatului
      // (să nu umfle jurnalul/istoricul cu 100KB de text) și pleacă pe marcajul
      // OCHI — orchestratorul îl lipește ca IMAGINE reală în conversație.
      const { shotB64, ...faraOchi } = result
      return shotB64 ? `${JSON.stringify(faraOchi)}${OCHI_MARCAJ}${shotB64}` : JSON.stringify(faraOchi)
    }
    return JSON.stringify(result)
  }

  // The SHARED admin tools (chat ∩ voice) — UNIQUE dispatch, shared with voice
  // (services/adminTools.ts). No duplication (§1 uniqueness / risk audit #4):
  // argument extraction + invocation live in one place, not copied into chat
  // and realtime. The admin gate remains HERE; execution is in the shared
  // source.
  // USER-bound tools (memory, journals, mail, costs, updates, tool proposal):
  // SHARED executor with voice — the admin gate is inside it.
  if (USER_SCOPED_TOOLS.has(block.name)) {
    const scoped = await execUserScopedTool(block.name, args, email, isAdmin)
    if (scoped !== null) return scoped
  }
  if (SHARED_ADMIN_TOOLS.has(block.name)) {
    if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
    // `email`/`baseUrl` are mandatory for the card tools: the browser belongs
    // to the user, and the gate is "I recognized your voice now". Without
    // them, the card would always be refused, with a false reason ("I did not
    // recognize you").
    // `cookie` goes onward for admin_vezi/admin_schimba: the tools do not
    // bypass the admin gate, they USE it — they request the routes with his
    // session.
    const shared = await execSharedAdminTool(block.name, args, { email, baseUrl, cookie })
    if (shared !== null) return shared
  }

  switch (block.name) {
    // ── DELEGAREA: creierul pune agentul specialist la lucru (Adrian, 4 aug) ──
    // Când creierul alege să delege, chemăm agentul respectiv (creierul Gemini
    // cu pălăria specialistului, services/agentiKelion.ts) și întoarcem răspunsul
    // lui. Costul sub-apelului intră în usage.usd (cost REAL al turei, ca la
    // imagini). Un id necunoscut nu inventează — spune care sunt valizi.
    case 'cheama_agent': {
      // Logica unică e în agentiKelion.ts (executaCheamaAgent) — aici doar
      // contabilizăm costul pe tura curentă (audit 9 aug: costul se DEBITA dar
      // nu se ÎNREGISTRA — Money tab orb la agenți). isAdmin = memoria lui
      // Kelion pentru specialist doar când vorbește ownerul.
      const r = await executaCheamaAgent(String(args.agent ?? ''), String(args.sarcina ?? ''), isAdmin)
      usage.usd += r.costUsd
      if (r.costUsd > 0) void recordCost(email, 'gemini', r.costUsd)
      return r.json
    }
    case 'agent_nou': {
      // Creează un specialist NOU când lipsește tipul (Adrian, 10 aug) — logica
      // unică în agentiKelion.ts (executaAgentNou); instant, scriere în DB.
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      return executaAgentNou(String(args.nume ?? ''), String(args.rol ?? ''), args.doarAdmin === true)
    }
    // ── THE PANEL: THREE PROPOSE, THE BRAIN CHOOSES (Adrian, Jul 31) ─────────
    // Steps are written ON THE MONITOR as they happen, not at the end: they
    // take minutes, and the analysis gate says clearly that the work must be
    // SEEN while it is being done, not narrated afterward.
    case 'panou_cod': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      const sarcina = String(args.sarcina ?? '').trim()
      if (sarcina.length < 10) return JSON.stringify({ error: 'sarcina_prea_scurta' })
      const pasi: string[] = []
      const peMonitor = (pas: string): void => {
        pasi.push(`${new Date().toISOString().slice(11, 19)}  ${pas}`)
        reply.raw.write(
          `${CTRL}${JSON.stringify({ monitor: { kind: 'doc', title: 'Worker panel', text: pasi.join('\n') } })}${CTRL}`,
        )
      }
      const r = await ruleazaPanou(sarcina, peMonitor)
      return JSON.stringify({
        ok: r.ok,
        motiv: r.motiv,
        pornit: r.pornit,
        lipsa: r.lipsa,
        castigator: r.castigator,
        judecata: r.judecata,
        pr: r.pr,
        // Only the facts measured per worker — not the logs, which would drown
        // the turn.
        propuneri: r.propuneri.map((p) => ({
          lucrator: p.lucrator, model: p.model, aSchimbat: p.aSchimbat,
          fisiere: p.fisiere, adaugate: p.adaugate, sterse: p.sterse,
          testeTrec: p.testeTrec, secunde: p.secunde, motiv: p.motiv, branch: p.branch,
        })),
      })
    }
    case 'build_software': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      const order = String(args.order ?? '').trim()
      if (order.length < 8) return JSON.stringify({ error: 'ordin_prea_scurt' })
      // POARTA DE CALITATE ȘI PE CALEA DIN CHAT (owner, 14 aug: „vreau să nu mai
      // eșueze niciun ordin"). Pe panou poarta exista (13 aug); AICI lipsea — un
      // ordin vag/imposibil dat prin Kelion intra în coadă și murea DUPĂ ce ardea
      // bani și încercări. Un ordin condamnat se respinge LA UȘĂ, cu motivul, iar
      // Kelion îi spune ownerului CE lipsește ca să-l reformuleze — nu-l îngroapă.
      {
        const { evalueazaOrdin } = await import('../services/evalOrdinConstructor.js')
        const ev = evalueazaOrdin(order)
        if (!ev.trece) {
          return JSON.stringify({
            error: 'ordin_respins',
            motiv: ev.motiv,
            message: `Nu l-am pus în coadă — ar fi murit acolo: ${ev.motiv}. Reformulează ordinul cu ce/unde/cum se verifică și îl preiau.`,
          })
        }
      }
      // Creierul (Gemini) gândește MAI ÎNTÂI — Devin pornește cu un plan
      // anexat, nu cu ordinul gol. Legătura bidirecțională: constructorul
      // pornește din gândirea creierului și raportează înapoi PR-ul în chat.
      const { planificaOrdinConstructor } = await import('../services/devinConstructor.js')
      const orderCuPlan = await planificaOrdinConstructor(order)
      const jobId = await createBuildJob(email, orderCuPlan)
      if (!jobId) return JSON.stringify({ error: 'db_indisponibil' })

      // Trigger the constructor worker immediately in the background so the order executes right away
      porneculLucratorulConstructor()

      // OPEN THE LIVE PANEL ON THE MONITOR (Stage 4b): from the moment it is
      // taken on, Adrian sees Received→step→Done/Failed on the monitor (the
      // panel subscribes to /api/constructor/live). A control frame, like
      // {monitor}/{card}.
      reply.raw.write(`${CTRL}${JSON.stringify({ build: { open: true } })}${CTRL}`)
      // THE SHORT ACKNOWLEDGMENT PHRASE (Adrian, Jul 28: "remove «getting on
      // it, checking and executing» — it needs a short phrase: order taken").
      // The instruction to the model is explicit: acknowledge in 3-4 words, no
      // long promises.
      return JSON.stringify({
        ok: true,
        job: jobId,
        message: `Am preluat cerința (ordin #${jobId}).`,
        speak_rule: 'Confirmă EXACT atât: „Am preluat cerința." — nimic în plus, fără „mă apuc/verific/execut", fără explicații despre lucrător/PR/email.',
      })
    }
    case 'constructor_status': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      // null = coada necitibilă (auditul admin, 3 aug): unealta o SPUNE, nu
      // raportează o coadă goală pe care n-a citit-o (regula #1).
      const jobs = await listBuildJobs(12)
      if (!jobs) return JSON.stringify({ error: 'coada_necitibila', message: 'Nu pot citi coada ordinelor — citirea din baza de date a picat.' })
      // DIAGNOSTIC AUTONOM (owner, 19 aug: „nu are autonomie… sa faca asta"):
      // pe lângă lista ordinelor, Kelion măsoară SINGUR de ce (nu) repară — puls
      // sesiune Devin + dispecerul backend + coada build_jobs — și raportează
      // verdictul, pe server, fără să depindă de owner. Rulează pe calea CHAT ȘI
      // pe voce (paritatea din brainCapabilities).
      const { diagnosticConstructorViu } = await import('../services/diagnosticConstructor.js')
      const diagnostic = await diagnosticConstructorViu(Date.now()).catch((e) => ({ error: String((e as Error)?.message ?? e).slice(0, 120) }))
      return JSON.stringify({
        // CINE e constructorul — MĂSURAT din config, nu din memoria modelului
        // (owner, 22 aug: a întrebat „e Devin prezent?" și modelul a răspuns cu
        // Jules pentru că niciun răspuns de unealtă nu purta numele lui Devin).
        constructor: config.devinKey
          ? 'DEVIN (extern, ACTIV — cheia e pusă; ordinele pleacă prin build_software, rezultatul e un PR pe care ownerul îl aprobă)'
          : 'NIMENI nu construiește — cheia Devin NU e pusă, dispecerul e inert (mașinăria locală a fost ȘTEARSĂ pe 22 aug)',
        // `progress` = the constructor's current step (Stage 4) — Kelion can
        // speak it ("now compiling", "opening the PR") instead of "working…".
        // `ci` = the verdict of the INDEPENDENT verification (Stage 6): "Done,
        // verified by CI (green)" — not on the worker's word.
        jobs: jobs.map((j) => ({ id: j.id, status: j.status, order: j.orderText.slice(0, 160), progress: j.progress, ci: j.ci, pr: j.prUrl, branch: j.branch, tokens: j.tokens, updated: j.updatedAt })),
        diagnostic, // { sanatos, verdict, probleme[], masuratori } — DE CE (nu) repară
      })
    }
    // STĂPÂNIREA ORDINELOR (Adrian, 3 aug): șterge / șterge-în-grup / reia
    // (modifică) / anulează. Admin-only, ca și celelalte unelte de constructor.
    case 'constructor_manage': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      const action = String(args.action ?? '').trim()
      switch (action) {
        case 'delete': {
          const id = Number(args.id)
          if (!Number.isInteger(id) || id <= 0) return JSON.stringify({ error: 'id_lipsa' })
          const ok = await deleteBuildJob(id)
          return JSON.stringify(ok ? { ok: true, sters: id } : { ok: false, error: 'inexistent', id })
        }
        case 'delete_group': {
          const scope = String(args.scope ?? 'failed')
          if (!['failed', 'done', 'failed_done', 'all'].includes(scope))
            return JSON.stringify({ error: 'scope_invalid' })
          const n = await deleteBuildJobsByScope(scope as 'failed' | 'done' | 'failed_done' | 'all')
          return JSON.stringify({ ok: true, sterse: n, scope })
        }
        case 'retry': {
          const id = Number(args.id)
          if (!Number.isInteger(id) || id <= 0) return JSON.stringify({ error: 'id_lipsa' })
          const order = args.order != null ? String(args.order) : undefined
          const job = await retryBuildJob(id, order)
          if (job) {
            // Trigger the constructor worker immediately in the background so the retried order executes right away
            porneculLucratorulConstructor()
          }
          return JSON.stringify(
            job
              ? { ok: true, repus: job.id, stare: job.status, modificat: Boolean(order && order.trim()) }
              : { ok: false, error: 'nu_poate_fi_repus', id },
          )
        }
        case 'cancel': {
          const id = Number(args.id)
          if (!Number.isInteger(id) || id <= 0) return JSON.stringify({ error: 'id_lipsa' })
          const ok = await cancelBuildJob(id)
          return JSON.stringify(ok ? { ok: true, anulat: id } : { ok: false, error: 'nimic_de_oprit', id })
        }
        default:
          return JSON.stringify({ error: 'actiune_necunoscuta', action })
      }
    }

    case 'constructor_command': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      const cmd = String(args.cmd ?? '').trim()
      if (!cmd) return JSON.stringify({ error: 'comanda_goala' })
      const { exec } = await import('child_process')
      return new Promise<string>((resolve) => {
        exec(cmd, { timeout: 60000 }, (error, stdout, stderr) => {
          resolve(JSON.stringify({
            ok: !error,
            stdout: stdout || '',
            stderr: stderr || '',
            error: error ? error.message : null
          }))
        })
      })
    }

    // ── AUTOVERIFICAREA LIVE, REALĂ (owner, 19 aug: „eu vreau real") ──────────
    // Kelion se probează pe el însuși PE SERVER, cu execuție reală (citirile chiar
    // rulează; efectele NU se execută). Întoarce totalurile MĂSURATE + doar cele
    // care NU merg (cu de ce + recomandare) — creierul le raportează ownerului.
    case 'autoverificare': {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only' })
      const { autoverificareLive, decideDinMasuratori, formatMonitorAutoverificare } = await import('../services/autoverificare.js')
      const raport = await autoverificareLive()
      const problematice = raport.functii
        .filter((f) => f.verdict !== 'merge')
        .map((f) => ({ functie: f.functie, tip: f.tip, verdict: f.verdict, deCe: f.deCe, recomandare: f.recomandare }))
      // MĂSURĂTORILE DECIZIONALE (LEGEA 5): planul e DERIVAT din verdictele măsurate,
      // nu inventat. Ce n-are cauză clară de cod → „măsoară întâi", cu pasul numit.
      const plan = decideDinMasuratori(raport.functii)
      // AFIȘARE OBLIGATORIE PE MONITOR (owner, 19 aug: „după ce-i ceri, trebuie să
      // afișeze OBLIGATORIU rezultatele pe monitor"). O scrie EXECUTORUL, server-side,
      // nu la alegerea modelului — deci apare garantat, nu doar rostit.
      const doc = formatMonitorAutoverificare(raport, plan)
      reply.raw.write(`${CTRL}${JSON.stringify({ doc: { title: doc.title, text: doc.text } })}${CTRL}`)
      return JSON.stringify({
        masurat: true,
        afisatPeMonitor: true,
        total: raport.total,
        merg: raport.merg,
        stricate: raport.stricate,
        nepotverifica: raport.nepotverifica,
        problematice,
        plan,
        nota: 'Rezultatele sunt DEJA afișate pe monitor (obligatoriu). Raportează DOAR aceste verdicte măsurate + planul. NU inventa cauze/reparații; pentru „masoara_intai" pasul e măsurătoarea numită, nu o reparație.',
      })
    }

    case 'show_document': {
      const title = String(args.title ?? 'Document')
      const text = String(args.text ?? '')
      if (!text.trim()) return JSON.stringify({ error: 'empty' })
      reply.raw.write(`${CTRL}${JSON.stringify({ doc: { title, text } })}${CTRL}`)
      return JSON.stringify({ shown: true })
    }

    // L1e: PROCESARE DE DATE TABELARE (CSV/JSON). Parsează → agregare SAU profil
    // măsurat → tabelul + rezultatul pe monitor (suprafața {doc}, deci
    // surfaceShown se marchează singur). Totul PUR: valorile care nu-s clar
    // numerice rămân text, ce nu se poate calcula e „—", nimic inventat.
    case 'proceseaza_date': {
      const date = String(args.date ?? '')
      const format = (['auto', 'csv', 'json'].includes(String(args.format)) ? String(args.format) : 'auto') as 'auto' | 'csv' | 'json'
      try {
        const tabel = parseTabel(date, format)
        if (!tabel.randuri.length) return JSON.stringify({ error: 'gol', mesaj: 'Datele nu conțin niciun rând.' })
        const titlu = String(args.titlu ?? `Date (${tabel.format.toUpperCase()}, ${tabel.randuri.length} rânduri)`)
        const operatie = args.operatie ? (String(args.operatie) as Operatie) : undefined
        // Corpul documentului: tabelul + (agregarea CERUTĂ sau profilul măsurat).
        let sectiune: string
        let rezumatModel: Record<string, unknown>
        if (operatie) {
          const rez = agrega(tabel, {
            operatie,
            valoare: args.valoare ? String(args.valoare) : undefined,
            grupeaza_dupa: args.grupeaza_dupa ? String(args.grupeaza_dupa) : undefined,
          })
          sectiune = formatAgregare(rez)
          rezumatModel = { operatie, valoare: rez.valoare, grupeaza_dupa: rez.grupeaza_dupa, rezultate: rez.rezultate.slice(0, 50) }
        } else {
          const p = profil(tabel)
          sectiune = formatProfil(p)
          rezumatModel = { profil: p }
        }
        const doc = `${sectiune}\n\n${'─'.repeat(40)}\nDATE\n${formatDoc(tabel)}`
        reply.raw.write(`${CTRL}${JSON.stringify({ doc: { title: titlu, text: doc } })}${CTRL}`)
        // Modelului îi dăm rezultatul COMPACT (nu tot tabelul) — el îl spune scurt.
        return JSON.stringify({
          shown: true,
          format: tabel.format,
          randuri: tabel.randuri.length,
          coloane: tabel.coloane,
          ...rezumatModel,
        })
      } catch (e) {
        // Eroare NUMITĂ (date invalide, coloană inexistentă, prea multe rânduri) —
        // nu prăbușire, nu verdict fals. Modelul o spune omului pe înțeles.
        const mesaj = e instanceof EroareDate ? e.message : e instanceof Error ? e.message.slice(0, 120) : 'date invalide'
        return JSON.stringify({ error: 'date_invalide', mesaj })
      }
    }

    case 'goleste_monitorul': {
      // Un singur cadru care curăță TOT: paginile/aplicațiile din workspace și
      // imaginea generată — stări diferite în client, o singură comandă aici.
      reply.raw.write(`${CTRL}${JSON.stringify({ golesteMonitor: true })}${CTRL}`)
      return JSON.stringify({ golit: true })
    }

    case 'show_on_screen': {
      const url = String(args.url ?? '')
      const title = String(args.title ?? '')
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title } })}${CTRL}`)
      return JSON.stringify({ shown: true, url, title })
    }

    // MESSENGER KELION↔KELION (Adrian, 11 aug) — „apelează-l pe X". Rezolvă ținta,
    // verifică prezența, sună la ea. Frame-ul {apel} pornește la APELANT interfața
    // „sun pe…"; celălalt primește invitația pe WS-ul lui de prezență. Merge din
    // chat scris ȘI din voce (prin ușa creierului), în mașină și acasă.
    case 'apeleaza_user': {
      const cine = String(args.user ?? '').trim()
      if (!cine) return JSON.stringify({ error: 'lipsa_user', message: 'Spune-mi pe cine să sun (nume sau email).' })
      const rez = await sunaUtilizator(email, cine)
      if (rez.ok) {
        reply.raw.write(`${CTRL}${JSON.stringify({ apel: { stare: 'suna', callId: rez.callId, cu: rez.cu } })}${CTRL}`)
        return JSON.stringify({ ok: true, message: `Îl sun pe ${rez.cu?.nume || rez.cu?.email}. Sună la el acum — așteaptă să răspundă.` })
      }
      if (rez.motiv === 'ambiguu') {
        const lista = (rez.candidati ?? []).map((c) => c.name || c.email).join(', ')
        return JSON.stringify({ error: 'ambiguu', candidati: rez.candidati, message: `Sunt mai mulți care se potrivesc: ${lista}. Pe care dintre ei?` })
      }
      if (rez.motiv === 'offline') {
        return JSON.stringify({ error: 'offline', message: `${rez.cu?.nume || cine} nu e online acum, nu-l pot suna.` })
      }
      if (rez.motiv === 'user_negasit') {
        return JSON.stringify({ error: 'user_negasit', message: `Nu găsesc un utilizator Kelion pe nume „${cine}".` })
      }
      return JSON.stringify({ error: 'apel_esuat', message: 'Nu pot porni apelul acum.' })
    }

    case 'run_web_app': {
      const title = String(args.title ?? 'Aplicație')
      const html = String(args.html ?? '')
      if (!html.trim()) return JSON.stringify({ error: 'empty_html' })
      // Runs in the client, inside an isolated frame (srcdoc + sandbox) — see
      // Stage.
      reply.raw.write(`${CTRL}${JSON.stringify({ app: { title, html } })}${CTRL}`)
      return JSON.stringify({ running: true, title, savable: true })
    }

    // (Gesturile NU mai sunt o unealtă a creierului — freestyle-ul emoțional
    // nimerea des greșit, „fără logică". Acum le alege DETERMINIST situația
    // turei, în blocul „GESTUL PE SITUAȚIE" de la finalul turei. Comenzile
    // directe rămân prin interpretGestureCommand.)

    // SWITCHING THE MESERIE (QA Jul 24): the user asks through chat, Kelion
    // changes it immediately; the new persona takes effect from the next turn
    // (the persona is built per-turn from getMeserieActiva).
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

    // ACCESS TO THE APP TABS from WRITTEN chat (Jul 24 audit — it existed only
    // on voice). Emits the {nav} frame; the client translates it into the
    // kelion:navigate event, and Stage opens the panel (the admin stays gated
    // there).
    case 'open_app_view': {
      const view = String(args.view ?? '').trim().toLowerCase()
      const section = String(args.section ?? '').trim()
      // P28 (auditul aplicațiilor — RUPTURA #2): schema promitea `cv` din
      // 13 aug, dar lista de aici îl refuza cu unknown_view — Kelion chema
      // exact valoarea din propria schemă și primea o eroare inexplicabilă.
      if (!['settings', 'wallet', 'contact', 'admin', 'trading', 'home', 'cv'].includes(view)) {
        return JSON.stringify({ error: 'unknown_view' })
      }
      if ((view === 'admin' || view === 'trading') && !isAdmin) return JSON.stringify({ error: 'admin_only' })
      // Cadrul {nav} e ACUM în CADRE_ECRAN (routes/vocalLive.ts) — deci
      // deschiderea/închiderea de pagini merge și pe VOCE, nu doar scris.
      reply.raw.write(`${CTRL}${JSON.stringify({ nav: { view, section } })}${CTRL}`)
      return JSON.stringify({ opened: view, section: section || null })
    }

    case 'generate_image': {
      const prompt = String(args.prompt ?? '')
      if (!prompt) return JSON.stringify({ error: 'no_prompt' })
      // ZIDUL EXTRA-SERVICIILOR (owner, 14 aug): imaginea are tarif din meniu
      // (1 credit implicit, TARIF_IMAGINE în env); pică generarea → ramburs.
      const taxaImg = await taxeazaServiciu(email, 'imagine', isAdmin)
      if (!taxaImg.ok) return JSON.stringify({ error: 'plata_serviciului', motiv: taxaImg.motiv })
      const result = await generateImage(prompt)
      if ('error' in result) {
        await taxaImg.ramburseaza().catch(() => {})
        return JSON.stringify({ error: result.error })
      }
      // THE REAL COST, BOOKED WHERE IT IS KNOWN (the owner's rule: "show real,
      // stop fabricating"): the generation's own usage.cost from OpenRouter,
      // booked as 'image' — a MEASUREMENT (db.ts COSTURI_MASURATE). The flat
      // IMAGE_USD_PER_CALL rate is reached ONLY when the provider didn't
      // itemize, under the separate 'image_est' kind, so the masurat/estimat
      // split never confuses an estimate with a measurement.
      if (result.costUsd > 0) {
        usage.usd += result.costUsd
        void recordCost(email, 'image', result.costUsd)
      } else {
        usage.usd += IMAGE_USD_PER_CALL
        void recordCost(email, 'image_est', IMAGE_USD_PER_CALL)
      }
      const imageUrl = `${baseUrl}/api/image/${result.id}`
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: imageUrl, title: 'Generated image' } })}${CTRL}`)
      return JSON.stringify({
        shown: true, url: imageUrl,
        taxat: taxaImg.scazutGbp > 0 ? `£${taxaImg.scazutGbp.toFixed(2)} scăzuți din creditul tău` : undefined,
      })
    }

    case 'studioul_de_clipuri': {
      const plan = planStudio(
        String(args.idee ?? ''),
        args.reteta ? String(args.reteta) : undefined,
        args.cale === 'platit' ? 'platit' : 'gratis',
        new Date(),
      )
      // P32 (owner, 21:44: „se preia textul automat si incepe generarea"):
      // scenariul pregătit pleacă și către CLIENT ca frame — butonul 🎬 din
      // meniul Aplicații îl preia automat, iar omul are și „Copiază".
      if (!('error' in plan)) {
        const scenariu = plan.promptVeo ?? plan.promptFlow ?? ''
        if (scenariu)
          reply.raw.write(`${CTRL}${JSON.stringify({ scenariu: { text: scenariu, nume: plan.numeFisier, cale: plan.cale } })}${CTRL}`)
      }
      return JSON.stringify(plan)
    }

    case 'lista_tarife': {
      // O singură sursă (tarife.ts): cifra afișată = cifra taxată, mereu.
      const meniu = meniulDeTarife().map((t) => ({ ...t, lire: lirePentru(t.cheie) }))
      return JSON.stringify({
        tarife: meniu,
        video_activ: cheiaTarifVideo(),
        nota: 'prețurile sunt FINALE (profit inclus); video_activ e singura calitate care se generează acum',
      })
    }

    case 'generate_video': {
      const prompt = String(args.prompt ?? '')
      if (!prompt) return JSON.stringify({ error: 'no_prompt' })
      // ZIDUL EXTRA-SERVICIILOR (owner, 14 aug: meniu de prețuri cu profitul
      // copt înăuntru): clipul se taxează ÎNAINTE de a costa banii ownerului
      // la Google; dacă generarea pică DUPĂ taxare, banii se întorc singuri.
      const taxa = await taxeazaServiciu(email, cheiaTarifVideo(), isAdmin)
      if (!taxa.ok) {
        // P29 (owner, 15 aug: „eu vreau sa platesc, sau clientul, de ce nu ma
        // duce spre plata"): lipsa banilor NU mai e fundătură — pagina de
        // reîncărcare se deschide pe monitorul lui, iar creierul spune prețul.
        reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: '/credite', title: 'Credits' } })}${CTRL}`)
        return JSON.stringify({
          error: 'plata_serviciului', motiv: taxa.motiv,
          pas: 'Pagina de credite e DEJA pe monitorul lui — spune-i prețul serviciului și că de acolo reîncarcă (card sau cod).',
        })
      }
      // Ecranul NU mai tace cât Google coace clipul (owner, 21:20: „nu
      // afiseaza nimic pe ecran ca ar genera ceva"): pasul pornește PE LOC,
      // apoi bătaia de inimă a așteptării la fiecare 5s — bara de execuție
      // arată secundele, nu o tăcere de 1-3 minute.
      reply.raw.write(`${CTRL}${JSON.stringify({ executie: { pas: '🎬 Generez clipul la Google (durează 1-3 minute)…', procent: 5 } })}${CTRL}`)
      // Al treilea argument (P29 + ownerul, 21:29: „nu mai bine il faci sa
      // genereze? nu ma mai umple de butoane"): aprobarea conștientă E chiar
      // CEREREA — clientul care a plătit tariful ACUM și-a finanțat clipul,
      // iar ADMINUL care cere cu gura lui un clip și-a dat singur aprobarea
      // (mai conștientă decât orice buton). Comutatorul 🎬 rămâne DOAR peste
      // ce cheltuie nesupravegheat (timerul de promovare).
      const result = await genereazaVideo(prompt, Number(args.seconds ?? 8), taxa.scazutGbp > 0 || isAdmin, (sec) => {
        // procentul crește cu timpul tipic (~3 min), plafonat sub 95 — cinstit:
        // nu declarăm „aproape gata" ce nu putem măsura, doar că lucrează.
        const procent = Math.min(94, 5 + Math.round((sec / 180) * 90))
        reply.raw.write(`${CTRL}${JSON.stringify({ executie: { pas: `🎬 Clipul se generează la Google… ${sec}s`, procent } })}${CTRL}`)
      })
      // The refusal (no key / payment not consciously enabled) travels to the
      // brain VERBATIM — it contains the measured price, so the person hears
      // the real reason, not a generic "failed".
      if ('error' in result) {
        await taxa.ramburseaza().catch(() => {})
        // Bara nu rămâne agățată pe un refuz — se închide cu adevărul.
        reply.raw.write(`${CTRL}${JSON.stringify({ executie: { pas: '🎬 Generarea NU a pornit — motivul, mai jos', procent: 100, gata: true } })}${CTRL}`)
        // Refuzul de plată nu lasă omul cu mâna goală (owner: „prin google
        // flow"): calea GRATUITĂ se dă de fiecare dată, cu pași concreți.
        if (String(result.error).startsWith('video_platit_neaprobat'))
          return JSON.stringify({
            error: result.error,
            alternativa_gratuita:
              'Google Flow (labs.google/flow) — video GRATUIT cu contul lui Google: dă-i promptul gata scris ' +
              'și pașii (deschide labs.google/flow → New project → lipește promptul → Generate).',
          })
        return JSON.stringify({ error: result.error })
      }
      // The cost is the official list price × the real seconds generated —
      // Google does not itemize per call, so this is the exact bill by their
      // published rate, booked as its own kind to stay distinguishable.
      usage.usd += result.costUsd
      void recordCost(email, 'video', result.costUsd)
      const videoUrl = `${baseUrl}/api/video/${result.id}`
      // P22 („orice clip se salveaza cu nume sugestiv data ora"): titlul
      // cardului = numele de fișier sugestiv — butonul „Salvează" din monitor
      // îl pune în Download exact sub numele ăsta.
      const numeVideo = numeClip('Clip', prompt, new Date())
      reply.raw.write(`${CTRL}${JSON.stringify({ executie: { pas: '🎬 Clipul e gata — îl pun pe monitor', procent: 100, gata: true } })}${CTRL}`)
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: videoUrl, title: numeVideo } })}${CTRL}`)
      // PREȚUL SE SPUNE (owner, 14 aug: „i se arată și prețul, și se
      // încasează") — suma scăzută intră în rezultat ca Kelion s-o spună omului.
      return JSON.stringify({
        shown: true, url: videoUrl, secunde: result.secunde, costUsd: result.costUsd,
        nume_fisier: `${numeVideo}.mp4`,
        taxat: taxa.scazutGbp > 0 ? `£${taxa.scazutGbp.toFixed(2)} scăzuți din creditul tău` : undefined,
      })
    }

    case 'vede_video': {
      const url = String(args.url ?? '')
      if (!url) return JSON.stringify({ error: 'no_url' })
      const { vedeVideoYoutube, fisaCaText } = await import('../services/vedeVideo.js')
      const fisa = await vedeVideoYoutube(url)
      // Refuzul (link nesuportat încă / cheie / plafon) merge la creier VERBATIM —
      // omul aude motivul real și pasul următor, nu un „failed" generic.
      if ('error' in fisa) return JSON.stringify({ error: fisa.error })
      const text = fisaCaText(url, fisa)
      // Costul REAL (tokenii din usageMetadata, tariful public) — în jurnal.
      if (fisa.costUsd > 0) {
        usage.usd += fisa.costUsd
        void recordCost(email, 'video-vazut', fisa.costUsd)
      }
      // CATALOGHEAZĂ (videoteca, sub scut) + ÎNVAȚĂ (memoria de lungă durată).
      const { salveazaVideoInvatat } = await import('../db.js')
      void salveazaVideoInvatat(email, url, fisa.titlu, text, fisa.tokeni, fisa.costUsd)
      void learnFromTurn(email, `[a cerut să văd clipul] ${url}`, text.slice(0, 1500), 'kelion').catch(() => {})
      return JSON.stringify({ fisa: text, tokeni: fisa.tokeni, costUsd: fisa.costUsd })
    }

    // The 8 browser actions: the call differs, the queue is shared
    // (browserResult — see the note at the top of runTool). VISIBLE BROWSER
    // (Jul 24 audit, P1-4): the monitor gets the locally served SCREENSHOT
    // (embeddable), not the external URL.
    case 'browser_open': {
      const url = String(args.url ?? '')
      if (!url) return JSON.stringify({ error: 'no_url' })
      return browserResult(await browserOpen(email, baseUrl, url))
    }
    case 'browser_click':
      return browserResult(await browserClick(email, baseUrl, Number(args.index ?? 0)))
    case 'browser_type':
      return browserResult(await browserType(email, baseUrl, Number(args.index ?? 0), String(args.text ?? ''), Boolean(args.submit)))
    case 'browser_read':
      return browserResult(await browserRead(email, baseUrl))
    case 'browser_back':
      return browserResult(await browserBack(email, baseUrl))
    case 'browser_scroll':
      return browserResult(await browserScroll(email, baseUrl, String(args.direction ?? 'down') as 'up' | 'down'))
    case 'browser_key':
      return browserResult(await browserKey(email, baseUrl, String(args.key ?? '')))
    case 'browser_click_at':
      return browserResult(await browserClickAt(email, baseUrl, Number(args.x ?? 0), Number(args.y ?? 0)))
    case 'browser_close': {
      await browserClose(email)
      // The browser closed → clear the monitor (empty url = free screen).
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: '', title: '' } })}${CTRL}`)
      return JSON.stringify({ closed: true })
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



    case 'episoade_promo': {
      if (!isAdmin) return JSON.stringify({ error: 'unauthorized' })
      const lista = await citesteEpisoade(config.adminEmail)
      return JSON.stringify({ episoade: lista, rezumat: rezumaEpisoade(lista) })
    }
    case 'prepare_promo_clip': {
      if (!isAdmin) return JSON.stringify({ error: 'unauthorized' })
      // Clip preparation comes from the SHARED source (services/promo.ts) — the
      // same one voice uses, so §1 is respected without duplication.
      const built = await buildPromo(args)
      if ('error' in built) return JSON.stringify({ error: built.error })
      // JURNALUL SERIEI (11 aug): fiecare clip pregătit se salvează ca EPISOD
      // auto-numerotat, ca Kelion să știe ce a filmat și unde a rămas. Numărul
      // episodului intră și în numele fișierului („subiect_epN") și în frame.
      const episod = await adaugaEpisod(config.adminEmail, {
        subiect: built.promo.subject,
        rezumat: String(built.promo.script).replace(/\s+/g, ' ').trim().slice(0, 200),
        durata: built.promo.duration,
        data: new Date().toISOString().slice(0, 10),
      }).catch(() => null)
      const promoCuEp = episod ? { ...built.promo, ep: episod.ep } : built.promo
      // ARMING THE RECORDER: the `{promo}` frame is the one ChatPanel waits for
      // (c.promo?.script → armPromo) in order to arm the Rec button.
      reply.raw.write(`${CTRL}${JSON.stringify({ promo: promoCuEp })}${CTRL}`)
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: built.monitorUrl, title: `Promo${episod ? ` ep${episod.ep}` : ''}: ${built.promo.subject}` } })}${CTRL}`)
      return JSON.stringify({ armed: true, shown: true, url: built.monitorUrl, episod: episod ? episod.ep : undefined })
    }

    default: {
      // GOOGLE PHOTOS (Picker) — au nevoie de email + baseUrl, pe care
      // runGoogleTool nu le are; se rezolvă aici, cu tokenul aceluiași om.
      if (block.name === 'photos_alege') {
        const { photosAlege } = await import('../services/googlePhotos.js')
        return photosAlege(email, token)
      }
      if (block.name === 'photos_adu') {
        const { photosAdu } = await import('../services/googlePhotos.js')
        return photosAdu(email, token, baseUrl)
      }
      if (block.name === 'youtube_urca') {
        const { youtubeUrca } = await import('../services/googleYouTube.js')
        const a = (block.input ?? {}) as Record<string, unknown>
        return youtubeUrca(token, String(a.video_id ?? ''), String(a.title ?? ''), String(a.description ?? ''))
      }
      if (block.name === 'business_vezi') {
        const { businessVezi } = await import('../services/googleBusiness.js')
        return JSON.stringify(await businessVezi(token, baseUrl))
      }
      // Google tools are handled by the googleTools router.
      if (googleTools.some((t) => t.name === block.name)) {
        // THE get_weather GUARD (the "27° without GPS" fix): a location-less
        // weather call is filled deterministically — device GPS first, the
        // approximate IP place second — and REFUSED with an honest message
        // when the turn has no location at all. The model can no longer
        // geocode a hallucinated "locația mea" and quote it as real.
        if (block.name === 'get_weather') {
          const guarded = weatherArgsWithLocation(block.input, loc)
          if ('errorJson' in guarded) return guarded.errorJson
          block = { ...block, input: guarded.input }
        }
        // TARIFUL PREZENTĂRII (owner, 14 aug — Slides e extra-serviciu ales):
        // taxare înainte de consum, ramburs dacă crearea pică — ca la video.
        let taxaPrez: Awaited<ReturnType<typeof taxeazaServiciu>> | null = null
        if (block.name === 'create_presentation') {
          taxaPrez = await taxeazaServiciu(email, 'prezentare', isAdmin)
          if (!taxaPrez.ok) return JSON.stringify({ error: 'plata_serviciului', motiv: taxaPrez.motiv })
        }
        const result = await runGoogleTool(block.name, block.input, token)
        if (taxaPrez?.ok && /"error"/.test(result)) await taxaPrez.ramburseaza().catch(() => {})
        // AUTOMATIC DISPLAY: tools that return `screen_url` (map, route,
        // weather, video) must APPEAR on the monitor from a SINGLE call — the
        // brain does not always make the second `show_on_screen`, so the user
        // used to see "I showed the map" with nothing on screen. We emit the
        // {monitor} frame from the result.
        try {
          const p = JSON.parse(result) as { screen_url?: string; location?: string; origin?: string }
          if (p.screen_url) {
            const url = p.screen_url.startsWith('/') ? `${baseUrl}${p.screen_url}` : p.screen_url
            reply.raw.write(
              `${CTRL}${JSON.stringify({ monitor: { url, title: p.location || p.origin || '' } })}${CTRL}`,
            )
          }
        } catch {
          /* non-JSON result or no screen_url — nothing to display */
        }
        return result
      }
      return JSON.stringify({ error: `unknown_tool: ${block.name}` })
    }
  }
}
