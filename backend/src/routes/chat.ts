import type { FastifyInstance } from 'fastify'
import { config, roleFor } from '../config.js'
import type {
  Tool,
  MessageParam,
  ToolUseBlock,
} from '../services/brain-types.js'
import { getSessionUser, setSession, type SessionUser } from '../session.js'
import {
  googleTools,
  runGoogleTool,
  refreshGoogleAccessToken,
  reverseGeocodeCached,
  } from '../services/google.js'
import {
  saveMessage,
  recordCost,
  recordTiming,
  getBalance,
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
} from '../db.js'
import { getMeserie } from '../services/meserii.js'
import { resolveModel, taskDifficulty, ESCALATE_AT, ESCALATE_TOP_AT, hasActionIntent, type OrMessage, type AnthropicTool } from '../services/brainContract.js'
import { stripToolMarkup, makeToolMarkupStripper } from '../services/toolMarkup.js'
import {
  iaSlotDacaLiber,
  elibereazaSlot,
  asteaptaLaCoada,
  noteazaEsuare,
} from '../services/dispecer.js'
import { runOrchestrator } from '../services/orchestrator.js'
import { autoPreviewFrame } from '../services/monitorAutoPreview.js'
import { GEMINI_DIRECT_PREFIX, geminiDirectAvailable } from '../services/geminiDirect.js'
import { brainComplete } from '../services/brain.js'
import { ruleazaPanou } from '../services/panouLucratori.js'
import { dynamicToolDefs, dynamicToolNames, runDynamicTool } from '../services/dynamicTools.js'
import { SERPER_USD_PER_CALL, IMAGE_USD_PER_CALL } from '../services/cost.js'
import { recallMemories, learnFromTurn } from '../services/agents.js'
import { inventarulMeu } from '../services/brainCapabilities.js'
import { lectiiCurente } from '../services/autoInvatare.js'
import { generateImage } from '../services/image.js'
import { genereazaVideo } from '../services/video.js'
import { trackSpeechLang, LANG_LABELS } from '../services/lang.js'
import { interpretDeviceCommand, deviceAck, interpretGestureCommand, gestureAck, gestPentruSituatie } from '../services/commands.js'
import { geoLookupCached, clientIp } from './demo.js'
import { synthesize } from '../services/tts.js'
import { getVoicePref } from '../db.js'
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
  type BrowserResult,
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
import { recentClientErrors } from './clientErrors.js'
import { neagaUneltele } from '../services/negareUnelte.js'
import { execSharedAdminTool, SHARED_ADMIN_TOOLS, execUserScopedTool, USER_SCOPED_TOOLS } from '../services/adminTools.js'
import { formatNowContext } from '../services/timeContext.js'
import { buildPromo } from '../services/promo.js'
import { LIST_SOURCE_TOOL, READ_SOURCE_TOOL, SEARCH_SOURCE_TOOL, DB_TABLES_TOOL, DB_QUERY_TOOL, SYSTEM_HEALTH_TOOL, BROWSER_TOOLS, OPEN_APP_VIEW_TOOL, COST_TOOL, LIST_UPDATES_TOOL, SERVER_LOGS_TOOL, READ_INBOX_TOOL, LOG_GAP_TOOL, LIST_MEMORIES_TOOL, FORGET_MEMORY_TOOL, SECRET_PUNE_TOOL, SECRET_LISTA_TOOL, SECRET_PUBLICA_TOOL, CERINTA_NOUA_TOOL, CERINTE_LISTA_TOOL, CERINTA_PRIORITATE_TOOL, CARD_STARE_TOOL, CARD_COMPLETEAZA_TOOL, CARD_GATA_TOOL, PANOU_COD_TOOL, ALLOW_GUEST_VOICE_TOOL, APPROVE_GUEST_VOICE_TOOL, FORGET_GUEST_TOOL, JULES_REPOS_TOOL, JULES_TASK_TOOL, JULES_STATUS_TOOL, CHEAMA_AGENT_TOOL } from '../services/brainToolDefs.js'
import { gasesteAgentViu, cheamaAgent, rosterViu } from '../services/agentiKelion.js'
// Re-exported for the voice route, which takes its tool definitions from chat.js
// (single source — SINGLE BRAIN §1, no duplication).
export { SECRET_PUNE_TOOL, SECRET_LISTA_TOOL, SECRET_PUBLICA_TOOL }
export { CERINTA_NOUA_TOOL, CERINTE_LISTA_TOOL, CERINTA_PRIORITATE_TOOL }
import { latestUpdateSummary } from '../services/updates.js'

// THE BRAIN — Gemini direct, UNIC (extirparea totală OpenRouter + OpenAI, 3 aug).
// The selectable chat model is read from KV (same source as /api/models/selection):
// the model CHOSEN by the user, otherwise the tier default. Returns NULL only if
// NO brain exists at all (no Gemini key) → honest message.
async function selectedBrainModel(
  email: string,
  text: string,
  kvRaw?: string | null,
  needsVision = false,
): Promise<{ model: string; heavy: boolean } | null> {
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
  const difficulty = taskDifficulty(text)
  // ECONOMIC AND HONEST SPLIT (Adrian, Jul 27: "cheap chat is fine, but where a
  // thought-out answer is needed you send it through the brain"): simple talk →
  // cheap model (fast, nearly free); WHEN thinking OR an ACTION is needed (owner
  // asks "repair/publish/show/open/build...") → the brain that actually
  // EXECUTES, not narrates. "Always Fable 5" was removed: it burned credit
  // (OpenRouter went negative on Jul 27) and that's not what he asked for. The
  // top only on extreme difficulty.
  const isOwner = roleFor(email) === 'admin'
  const heavy = needsVision || difficulty >= ESCALATE_AT || (isOwner && hasActionIntent(text))
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
    let ownerModel: string | null = null
    if (sel.work) {
      console.log(`[BRAIN] owner: ignoring the saved selection (${sel.work}) — the "I don't do manual" order; keeping the default`)
      ownerModel = await resolveModel('work', null)
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
      ownerModel = await resolveModel('work', null)
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
  const geminiWork = !sel.work && geminiDirectAvailable()
  const model = top
    ? await resolveModel('top')
    : heavy
      ? geminiWork
        ? `${GEMINI_DIRECT_PREFIX}${config.geminiModel}`
        : await resolveModel('work', sel.work)
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
      title: { type: 'string', description: 'Short caption for the panel header.' },
    },
    required: ['url'],
  },
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
      text: { type: 'string', description: 'The full document content (plain text or markdown).' },
    },
    required: ['title', 'text'],
  },
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

// Video generation — Veo through the Gemini key. Veo has NO free tier
// (measured on Google's pricing page, Aug 2 2026), so services/video.ts
// refuses structurally unless the owner consciously set VIDEO_ALLOW_PAID=1 —
// the constructor's own paid-guard pattern. The refusal message carries the
// measured price, so Kelion can tell the person exactly why and how much.
const VIDEO_TOOL: Tool = {
  name: 'generate_video',
  description:
    'Generate a short video clip (4-8 seconds) from a text description and show it on the user\'s monitor. Use when the user asks for a video/animation/clip. This COSTS real money per second (Veo has no free tier) — if the tool refuses because payment is not enabled, tell the user honestly, including the price from the refusal.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed English description of the video to generate.' },
      seconds: { type: 'number', description: 'Clip length in seconds: 4, 6 or 8 (default 8).' },
    },
    required: ['prompt'],
  },
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
import {
  RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL,
  REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL,
  REQUEST_REPAIR_TOOL,
} from '../services/brainToolDefs.js'
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
    "ADMIN ONLY. Queue a BUILD ORDER for your own constructor: any software, feature, change or improvement the owner asks for that is too big to ship in this conversation with repo_write (multi-file work, needs build+tests). A worker on your server clones the repo, writes the code, runs the build and tests, then opens a PR — the owner merges it. Pass the order COMPLETE and self-contained (what to build, where, acceptance criteria) — the worker only sees this text. For small single-file fixes prefer repo_write; for ops use run_runbook. ROUTING RULE: the constructor receives ONLY an explicit build/repair order for the app — NEVER an ordinary question or chat request (a place, the weather, a fact, a conversation): those you ANSWER yourself, in this conversation, with your own tools.",
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
    "HEAVY requests only — deep analysis, architecture, coding, math, long multi-step reasoning, anything that needs an expert brain. Pass the user's full request with context; you get back the expert's answer to deliver (rephrase naturally in the conversation's language, keep it complete).",
  input_schema: {
    type: 'object',
    properties: {
      request: { type: 'string', description: "The user's full request, with any needed context." },
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

// U+001F (unit separator) brackets a JSON control frame the frontend strips out
// of the text stream (never shown, never spoken), e.g.
// \x1f{"monitor":{"url":"...","title":"..."}}\x1f
const CTRL = String.fromCharCode(31)

// DID THE PERSON SEE ANYTHING? (Adrian, Jul 30: "reply = nothing")
//
// Two kinds of things go on the wire: visible text and control frames
// (`CTRL{...}CTRL`). Some frames are PURE protocol — {turn}, {heard}, {lang},
// {receipt}, {ping}, {desync} — and they leave on EVERY turn, including one in
// which the brain didn't utter a word. The rest (monitor, card, doc, app, image,
// build, nav, promo, gesture, audio, device, paywall) are surfaces or actions:
// the person really sees something happening.
//
// So "the turn produced something visible" = non-empty text OR at least one
// non-protocol frame.
const CADRE_PROTOCOL = /"(turn|heard|lang|receipt|ping|desync)"\s*:/
export function areCevaDeVazut(chunk: string): boolean {
  const cadru = new RegExp(`${CTRL}[^${CTRL}]*${CTRL}`, 'g')
  if (chunk.replace(cadru, '').trim() !== '') return true
  for (const f of chunk.match(cadru) ?? []) if (!CADRE_PROTOCOL.test(f)) return true
  return false
}

// THE INSTANT ACK IS NOT THE ANSWER (Adrian, Aug 2 — written localization
// request → „Am preluat sarcina" → then NOTHING).
//
// The admin's heavy-turn ack (below, "Am preluat sarcina. ") leaves BEFORE the
// brain runs — by design, so the first word is instant. But the write
// interceptor counted it as "something visible", and that single count killed
// TWO safety nets in the same turn:
//
//   1. THE SILENT ROTATION accepted an EMPTY brain answer as a successful turn
//      (`... || sawVisible` below — the ack had already "shown" something, so
//      an empty completion broke out of the rotation loop instead of moving
//      to the next model). Live proof in the server journal: `[tool]
//      lookup_address (admin)` fired for his request, the final text came
//      back empty, and the turn closed on the spot — while non-heavy turns
//      (where no ack had flowed) rotated correctly: `[CHAT MUTE] ... returned
//      empty — silent rotation`.
//   2. THE NEVER-SILENCE NET at the end of the turn stayed off (same poisoned
//      flag), so not even the honest "try again" reached him.
//
// The result looked EXACTLY like the message had been swallowed by a task
// queue: the pickup phrase, then the void. The ack is a receipt, not a reply
// — it never counts as visible content. Every taken-on turn must produce a
// real answer or an honest message; never silence after „am preluat".
export function conteazaCaVizibil(chunk: string, esteAckInstant: boolean): boolean {
  return !esteAckInstant && areCevaDeVazut(chunk)
}

// A SURFACE FRAME (Adrian, Aug 2 — "TOT pe monitor"): {monitor} with a real
// url, {doc}, {app}, {card} or {build} — what the end-of-turn auto-preview
// checks so it never duplicates a visual the tools already pushed. The empty
// {monitor:{url:''}} frame is a screen CLEAR, not a surface.
const CADRU_SUPRAFATA = /"(doc|app|card|build)"\s*:|"monitor"\s*:\s*\{[^{]*"url"\s*:\s*"[^"]/
export function eCadruDeSuprafata(chunk: string): boolean {
  const cadru = new RegExp(`${CTRL}[^${CTRL}]*${CTRL}`, 'g')
  for (const f of chunk.match(cadru) ?? []) if (CADRU_SUPRAFATA.test(f)) return true
  return false
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
// Synthesis runs SERIALLY (sentence order = audio order); the speaking ceiling
// stays at 4000 characters (Adrian, Jul 10: "audio output at least 1 minute").
function createVoiceStream(
  reply: { raw: { write(c: string): void } },
  lang: string | undefined,
  /** The voice chosen by this user (C4). Unknown or missing → the app's voice. */
  voicePref: string | null,
): { feed(t: string): void; fed(): boolean; finish(): Promise<void> } {
  let pending = '' // arrived text, not yet sent to synthesis
  let spoken = 0 // characters already spoken (the 4000 ceiling)
  let any = false
  let chain: Promise<void> = Promise.resolve()
  const speak = (text: string): void => {
    if (!text || spoken >= 4000) return
    const t = text.slice(0, 4000 - spoken)
    spoken += t.length
    chain = chain.then(async () => {
      try {
        // The user-chosen voice, so the written reply sounds like the live voice (C4).
        const r = await synthesize(t, lang, { voice: voicePref })
        if (r.ok) {
          reply.raw.write(`${CTRL}${JSON.stringify({ audio: r.audio.toString('base64') })}${CTRL}`)
        }
      } catch {
        /* one lost piece doesn't stop the rest of the voice */
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

// Language names (for the language lock — the brain listens to an explicit NAME
// far more reliably than a locale code) come from the SINGLE source
// `LANG_LABELS` (services/lang.ts). An identical copy used to live here —
// removed (single source, no duplicates).

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Coords {
  lat: number
  lon: number
}

// ── THE LOCATION TRUTH, ONE SOURCE (the "câte grade sunt în locația mea → 27°
// fără GPS" incident) ────────────────────────────────────────────────────────
// The owner asked for the weather "in my location" and got 27° for a place the
// model had INVENTED: on a turn with no device GPS and the IP-geo cache still
// cold, NOTHING in the context said "you have no location" — the get_weather
// description only said "pass the user's lat/lon (given in your context)", so
// the model filled the hole from its own memory and quoted live weather for a
// guessed city as if it were the user's. Resolved ONCE here, then read by BOTH
// consumers: the system-prompt block below (what the brain knows) and the
// get_weather guard in runTool (what the tool is allowed to run with).
export interface DeviceLocation {
  /** Exact coordinates from the device GPS (req.body.coords), null when absent/invalid. */
  gps: { lat: number; lon: number } | null
  /** City-level "City, Region, Country" from the request IP ('' when unknown). */
  approxPlace: string
}

export function resolveDeviceLocation(
  coords: Coords | undefined,
  geo: { city?: string; region?: string; country?: string } | null,
): DeviceLocation {
  const gps =
    coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)
      ? { lat: coords.lat, lon: coords.lon }
      : null
  const approxPlace = gps
    ? ''
    : [geo?.city, geo?.region, geo?.country].filter(Boolean).join(', ')
  return { gps, approxPlace }
}

// The honest void, DECLARED. When neither GPS nor the IP estimate exists, the
// brain must KNOW it has no location — otherwise it manufactures one (that is
// exactly where the 27° came from). No invented default, ever.
export const LOCATION_NONE_PROMPT =
  `\n\nLOCATION: you do NOT have the user's location on this turn — the device did not share its GPS and no network estimate exists. ` +
  `For "my location" / "here" / local-weather questions, say honestly that you don't have their location and ask them to allow location access on the device. ` +
  `NEVER guess a city, place or coordinates, and NEVER quote weather, distances or "near me" results for an invented spot.`

// THE get_weather GUARD (deterministic — the model's good will is not enough):
// a location-less call is filled from the DEVICE GPS first, then from the
// IP-level approximation; with neither, the tool REFUSES and tells the model to
// answer honestly instead of geocoding a hallucinated place name.
export function weatherArgsWithLocation(
  input: unknown,
  loc: DeviceLocation,
): { input: Record<string, unknown> } | { errorJson: string } {
  const a = (input ?? {}) as Record<string, unknown>
  const hasCoords =
    a.lat !== undefined &&
    a.lon !== undefined &&
    Number.isFinite(Number(a.lat)) &&
    Number.isFinite(Number(a.lon))
  const hasPlace = typeof a.location === 'string' && a.location.trim().length > 0
  if (hasCoords || hasPlace) return { input: a }
  // "Locația mea" → the device GPS, exactly as the owner asked.
  if (loc.gps) return { input: { ...a, lat: loc.gps.lat, lon: loc.gps.lon } }
  // Rough IP fallback — labelled approximate in the prompt, better than nothing.
  if (loc.approxPlace) return { input: { ...a, location: loc.approxPlace } }
  return {
    errorJson: JSON.stringify({
      error: 'location_unavailable',
      message:
        "The user's location is not available on this turn: the device did not share GPS and no network estimate exists. Answer honestly that you don't have their location and ask them to allow location access — never guess a city or coordinates, never quote weather for an invented spot.",
    }),
  }
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
      // GUEST SPEAKER (Adrian, Aug 1): the voice gate (realtime.ts) recognised
      // the speaker as a GUEST of this account — "guest:<id>:<name> (<relation>)"
      // or "guest-pending:<id>:<name> (<relation>)". A guest turn gets ZERO
      // admin powers, even inside the holder's logged-in session.
      speaker?: string
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

    // THE BRAIN is 100% Gemini direct (extirparea OpenRouter/OpenAI, 3 aug).
    // If the key is missing, the streaming safety net returns a clear error in
    // the user's language — which is why there is no longer a 503
    // "brain_not_configured" guard here.
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
    const [storedPref, meserieId, memRecall, lastSavedRow, disabledGestures, modelChoiceKv] = await Promise.all([
      getSpeechLang(user.email),
      getMeserieActiva(user.email),
      recallWithDeadline,
      // Continuity between sessions (#20): the timestamp of the last saved
      // message — pure DB, in parallel with the rest (zero added latency).
      getRecentHistory(user.email, 1).catch(() => []),
      // GESTURES disabled by Adrian from the admin panel — anything NOT checked
      // does NOT appear at all (Adrian, Jul 13): we filter the tool + prompt
      // with this list.
      getDisabledGestures().catch(() => [] as string[]),
      // FLUENCY (A5): the user's model choice read HERE, in parallel — not as
      // yet another serial DB trip right before the brain call.
      loadKv(`model_choice:${userKey(user.email)}`).catch(() => null),
    ])
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
    if (committedLang) void setSpeechLangPref(user.email, committedLang)
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
    if (
      config.revolut.payLink &&
      user.role !== 'admin' &&
      (await getBalance(user.email)) <= 0
    ) {
      reply.hijack()
      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' })
      const paywallTurnId = randomUUID()
      startTurn(user.email, paywallTurnId)
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
      finishTurn(user.email, paywallTurnId)
      reply.raw.end()
      return
    }

    // Instant command (device or gesture): immediate reply, WITHOUT a model
    // call — a {device|gesture} control frame that the client executes
    // verbatim, plus a short ack. The same stream shape as a normal turn (the
    // {turn} receipt first) so delivery ticking and resume keep working. The
    // two were identical blocks — a single source here (unique, no duplicates).
    const instantCommand = (frameKey: 'device' | 'gesture', value: unknown, ack: string): void => {

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      const cmdTurnId = randomUUID()
      startTurn(user.email, cmdTurnId)
      const payload =
        `${CTRL}${JSON.stringify({ turn: cmdTurnId })}${CTRL}` +
        `${CTRL}${JSON.stringify({ [frameKey]: value })}${CTRL}` +
        ack
      reply.raw.write(appendTurn(user.email, cmdTurnId, payload))
      finishTurn(user.email, cmdTurnId)
      if (lastIncomingText) void saveMessage(user.email, 'user', lastIncomingText)
      if (ack) void saveMessage(user.email, 'assistant', ack)
      reply.raw.end()
    }

    // Camera / monitor tabs: a {device} frame.
    if (deviceCmd) {
      instantCommand('device', deviceCmd, deviceAck(deviceCmd, ro))
      return
    }
    // Avatar gesture, interpreted on the server: a {gesture} frame.
    if (gestureCmd) {
      instantCommand('gesture', gestureCmd, gestureAck(gestureCmd, ro))
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
    let systemPrompt = `${SYSTEM_PROMPT}\n\n${inventarulMeu(isAdminUser)}`
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
      const lectii = lectiiCurente()
      if (lectii.length) {
        systemPrompt += `\n\nÎNVĂȚAT DIN MĂSURĂTORI (aplică-le ca să fii mai rapid și să NU repeți greșeli): ${lectii.join(' ')}`
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
    // ACCOUNT STATE — Kelion must KNOW naturally who the user is (Adrian,
    // Jul 24: "during the audit it doesn't see that I'm logged into the Google
    // account"). Without this, the audit said "you are not connected" even
    // though the user was signed in with Google.
    systemPrompt +=
      `\n\nUSER ACCOUNT (silent context — NEVER announce or narrate this, just act on it): the user IS signed in via Google as ${user.email}` +
      `${user.role === 'admin' ? ' (the OWNER/admin of this app)' : ''}. ` +
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
        `\n\nBROWSER CONSOLE (the user's own F12 errors, last 15 min — REAL symptoms from their device; use them to diagnose "why doesn't X work" and say plainly what is failing):\n- ` +
        cerrs.slice(-8).join('\n- ')
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
    if (user.role === 'admin') {
      systemPrompt +=
        `\n\nOWNER — ACT, DON'T DEFER: you are talking to Adrian, your owner, and you are FULLY AUTONOMOUS with REAL tools. When he asks for a repair, a change, or an operation: DO IT NOW, in this conversation, with your tools — read_source/search_source to find the cause; repo_write + repo_open_pr + repo_merge_pr to SHIP the fix yourself (your merge auto-deploys to production); run_runbook for operations (diagnostic, restart-app, publish-master, loguri-app...). As you work, narrate CONCRETELY what you are doing: which file and line, which branch, the PR number, the Actions link — so Adrian can watch the work happen. NEVER say "I'll have it built", "I've sent it to be fixed" or "my developer will handle it" — there is no other developer, YOU are the builder now. Use log_unsupported_request ONLY for things genuinely impossible with all your tools. If a fix is too big for one turn, state the exact steps and START step 1 immediately (worst case: request_repair to file the order durably) — never a dead end, never an empty reassurance. IF YOU SAY YOU WILL ANALYSE, ANALYSE — ON SCREEN (Adrian, 31 Jul: "when he says he will analyse, he must FACTUALLY open the monitor and show what he is doing"). The words "analizez", "mă uit", "verific", "let me look into it" are a PROMISE, and until now they were where turns died: it sounded like work, and he was left staring at an empty screen. From now on, the moment you say any of them, IN THE SAME TURN: (1) call show_document FIRST with what you are about to look at, so the monitor lights up before the waiting starts; (2) actually call the tools (read_source, search_source, db_query, system_health, runbook_log — whatever fits); (3) call show_document AGAIN with what you FOUND — file and line, the log excerpt, the query result. If you have nothing to look with, say so plainly instead of promising. Never announce an analysis you do not immediately perform and display. MAKE YOUR WORK VISIBLE: you CAN see your own internal processes — runbook_status (latest runs of your workflows) and runbook_log (the full real log of a run) — and you CAN display them: call show_document (title + text) to put your progress and results ON THE MONITOR while you work (what you started, run status, the relevant log excerpt, the deploy proof). Never tell the owner "I can't see my internal processes" or "I can't show this on the monitor" — you have both tools; use them. ANSWER WHAT HE ASKED — DON'T RAMBLE SYSTEM STATUS (Adrian, 3 aug: „bate câmpii" — every reply opened with the same system-problems monologue instead of answering): answer EXACTLY what Adrian asked and ONLY that. Do NOT open replies with unsolicited system status, health, deploy state, failed build orders, or reserve/limit reports, and do NOT call system_health or constructor_status on your own initiative unless he ASKS about status/health/builds, or it is directly needed to carry out what he asked. Surface a system problem ONLY when it directly blocks the request he just made — then in ONE short sentence, after doing the task — or when he explicitly asks how things are, in which case say them briefly and, if he wants, repair them with your own tools (no permission question). Never lead an answer with problems he did not ask about. SELF-INSTALL WHAT YOU LACK (never stop at "I don't have that library/tool"): when a task needs a dependency you don't have — an npm package, or a system tool — ADD it yourself the DURABLE way, through the constructor: order build_software to add the npm package to backend/package.json (or the system package to the Dockerfile's apt-get line), which builds with tests and opens a PR; once it merges, the image rebuilds and the dependency is LIVE and permanent (it survives redeploys). For a tiny change you may instead use repo_write on package.json/Dockerfile + repo_open_pr directly. Say which package and why, order it, then finish the task once it is deployed. NEVER run an ad-hoc live "apt install"/"npm install" on the server as the way to gain a capability — that is ephemeral and unsafe; the package.json/Dockerfile route is the only permanent, auditable one. Only say you cannot when a thing is truly impossible, not merely missing a package.`
      // NO CONFIRMATIONS TO THE OWNER (Adrian, Jul 31). The general rule above
      // ("confirm only before irreversible ones") is written for public users.
      // Here it is the owner: if he asked for something, the request IS the
      // approval — asking him again is wasted time, not safety. The only thing
      // still asked about is what he did NOT request: collateral deletion, a
      // destructive step you inferred yourself. That is not a security
      // confirmation; it is avoiding something nobody asked you to do.
      systemPrompt +=
        `\n\nOWNER — NO CONFIRMATIONS: this overrides the general "confirm before irreversible actions" rule, which is for public users. When the owner asks for something, the request IS the authorisation: send, delete, merge, restart, run the runbook — DO IT, then report what you did. Never answer with "shall I proceed?", "are you sure?", "do you want me to?" or any other permission question about the thing he just asked for. Also never ask him to unlock, authenticate, or confirm his identity in chat — being in this conversation already proves he is the owner. The ONE exception is an action he did NOT ask for: if carrying out his request would additionally destroy something he never mentioned (dropping a table to fix a query, deleting files to free space, force-pushing over work), name that specific side effect in one sentence and ask about THAT alone — never about the request itself. Same for the health check: if system_health reports problems, say them briefly and repair them; don't ask permission first.`
      // THE UPDATE CHANNEL: Kelion knows from the prompt WHAT it received at the
      // latest deploy (local file, cached on first read — zero latency cost).
      const upd = await latestUpdateSummary().catch(() => '')
      if (upd) {
        systemPrompt +=
          `\n\nYOUR LATEST UPDATES (the newest commits you received at the most recent deploy, newest first):\n${upd}\nWhen the owner asks what's new, what changed, or what update you received, answer from this list — and call list_updates for the fuller recent history. Never claim you don't know what your updates were.`
      }
      systemPrompt +=
        `\n\nPROMO CLIPS (owner only): when the owner asks for a promo clip ("filmuleț", "clip", "reclamă") about a subject, standard lengths are 15, 30 or 60 seconds — but ANY duration up to 10 minutes (600 seconds) is supported; use exactly what the owner asks for. The result must look PROFESSIONAL: a spoken script plus a shot list of live demo scenes that showcase what Kelion can do, timed to the narration; during recording the script text is NOT displayed (voice only, clean frame, admin interface hidden, site address watermarked). Step 1: WRITE the spoken script in chat, sized to the requested length (about 35 words for 15s, 75 for 30s, 150 for 60s — roughly 150 words per minute for longer clips), briefly list the planned scenes. Step 2: IN THE SAME TURN — his request for a clip IS the authorisation, never stop to ask for a "da" — if the shot list includes an image scene, FIRST call generate_image to create it, THEN call prepare_promo_clip with the script and the scenes (kind avatar/map/weather/image; avatar at second 0, scenes timed to match the words; image scenes use the /api/image/ URL from generate_image). Then tell the owner to press the pulsing red Rec button and pick the screen — everything else is automatic. If the owner asks for changes, revise and ask again. If no duration is given, ask which of 15, 30 or 60 seconds. CLIP LANGUAGE: the spoken script is written in WHATEVER language the owner asks the clip to be in (English, Spanish, Japanese — any language; you CAN do this, it is fully supported, the narration voice follows automatically via the tool's lang parameter). If no language is mentioned, use the owner's language. This is like a requested translation: your own commentary around the script stays in the owner's language, but the script content itself is in the clip's language.`
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
    // PHOTO ≠ SIGHT — TWO separate paths (Adrian, Jul 24: "don't mix them"):
    //   1. THE UPLOADED PHOTO (explicit attachment) — always analyzed, alone;
    //      before, the camera frames REPLACED it if the camera was on.
    //   2. THE CAMERA (continuous sight) — frames go out ONLY when the user
    //      asks something visual (VISION_INTENT: "can you see me", "what do
    //      you see", "describe", etc.).
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
    // THE GUEST SPEAKER, PARSED ONCE (Adrian, Aug 1): the voice gate's label
    // travels in the request body — "guest:<id>:<name> (<relation>)" for an
    // approved guest, "guest-pending:..." for one awaiting the holder's
    // confirmation. Parsed BEFORE the save, so everything below (the brain
    // note, the admin strip) uses it.
    const speakerRaw = typeof req.body?.speaker === 'string' ? req.body.speaker : ''
    const guestMatch = /^guest(-pending)?:(\d+):(.+)$/.exec(speakerRaw)
    const guestPending = guestMatch?.[1] === '-pending'
    const guestId = guestMatch ? Number(guestMatch[2]) : 0
    const guestLabel = guestMatch?.[3] ?? ''
    // PROGRESS BAR ON BRAIN ENTRY — ONE {heard} for EVERYONE (admin, demo,
    // public, paying): the server confirms exactly the text handed to the brain
    // on this turn, and the UI band displays it. It is not a local echo — if
    // the band does not change when you speak, the voice died BEFORE the brain.
    reply.raw.write(`${CTRL}${JSON.stringify({ heard: lastUserText.slice(0, 500) })}${CTRL}`)
    if (lastTurn?.role === 'user') void saveMessage(user.email, 'user', lastTurn.content)

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
    const brainSel = await selectedBrainModel(user.email, lastUserText, modelChoiceKv, turnHasImage)
    const orChatModel = brainSel?.model ?? null
    const heavyTurn = brainSel?.heavy ?? false

    // ── SINGLE PATH: DIRECT BRAIN FOR EVERYONE ───────────────────────────────
    // The Gemini orchestrator (chat/brain, with automatic escalation) answers
    // for EVERYONE — admin, free users and paying clients (paywall guaranteed
    // above) — instantly, with all tools. The real cost is debited from paying
    // clients' credits (debitWallet at the end of the turn); the admin is exempt.

    const NOTE_TOOLS = [SAVE_NOTE_TOOL, LIST_NOTES_TOOL, DELETE_NOTE_TOOL, LIST_MEMORIES_TOOL, FORGET_MEMORY_TOOL]
    // ask_brain ONLY on the chat step — on work it would be recursive (it IS the
    // brain).
    const escalationTools = heavyTurn ? [] : [ASK_BRAIN_TOOL]
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
          SHOW_TOOL, SHOW_DOCUMENT_TOOL, RUN_WEB_TOOL, IMAGE_TOOL, VIDEO_TOOL, OPEN_APP_VIEW_TOOL,
          // Memorie + mâini (browser) — NU se mai taie
          ...NOTE_TOOLS,
          ...BROWSER_TOOLS,
          // Delegarea către cei 33 de agenți specialiști — creierul pune agentul
          // la lucru direct (Adrian, 4 aug). În zona care NU se taie la plafon.
          CHEAMA_AGENT_TOOL,
          // Sursă + putere de dezvoltator + DB/sănătate + operațiuni („de aur")
          LIST_SOURCE_TOOL, READ_SOURCE_TOOL, SEARCH_SOURCE_TOOL,
          REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL,
          BUILD_SOFTWARE_TOOL, PANOU_COD_TOOL, CONSTRUCTOR_STATUS_TOOL, CONSTRUCTOR_MANAGE_TOOL,
          // Jules — agentul asincron oficial Google (3 aug, cheia pusă de owner).
          JULES_REPOS_TOOL, JULES_TASK_TOOL, JULES_STATUS_TOOL,
          DB_TABLES_TOOL, DB_QUERY_TOOL, SYSTEM_HEALTH_TOOL, SERVER_LOGS_TOOL,
          RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL, REQUEST_REPAIR_TOOL,
          LIST_UPDATES_TOOL, READ_INBOX_TOOL, PROPOSE_TOOL,
          // ── COADĂ: se taie prima la plafon (ocazionale) ──
          SET_ROLE_TOOL, LOG_GAP_TOOL, COST_TOOL, PROMO_TOOL,
          SECRET_PUNE_TOOL, SECRET_LISTA_TOOL, SECRET_PUBLICA_TOOL,
          CERINTA_NOUA_TOOL, CERINTE_LISTA_TOOL, CERINTA_PRIORITATE_TOOL,
          CARD_STARE_TOOL, CARD_COMPLETEAZA_TOOL, CARD_GATA_TOOL,
          ALLOW_GUEST_VOICE_TOOL, APPROVE_GUEST_VOICE_TOOL, FORGET_GUEST_TOOL,
        ]
      : [...googleTools, ...escalationTools, SHOW_TOOL, SHOW_DOCUMENT_TOOL, RUN_WEB_TOOL, IMAGE_TOOL, VIDEO_TOOL, OPEN_APP_VIEW_TOOL, SET_ROLE_TOOL, LOG_GAP_TOOL, PROPOSE_TOOL, ...NOTE_TOOLS, ...BROWSER_TOOLS, ALLOW_GUEST_VOICE_TOOL, APPROVE_GUEST_VOICE_TOOL, FORGET_GUEST_TOOL]
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
    const MAX_PROVIDER_TOOLS = orChatModel?.startsWith(GEMINI_DIRECT_PREFIX) ? 128 : 64
    const seenNames = new Set<string>()
    const baseTools: Tool[] = []
    for (const t of rawTools) {
      if (seenNames.has(t.name)) continue
      seenNames.add(t.name)
      baseTools.push(t)
    }
    const tools: Tool[] = baseTools.slice(0, MAX_PROVIDER_TOOLS)
    if (baseTools.length > MAX_PROVIDER_TOOLS) {
      // Numim EXACT ce s-a tăiat — după reordonare astea trebuie să fie doar
      // ocazionalele din coadă (rol/cost/promo/secrete/cerințe/card/invitați),
      // niciodată uneltele de aur. Dacă apar aici repo/db/health, ordinea s-a stricat.
      const taiate = baseTools.slice(MAX_PROVIDER_TOOLS).map((t) => t.name).join(', ')
      console.error(`[chat] ${baseTools.length} unelte > plafon ${MAX_PROVIDER_TOOLS} — tăiate din coadă: ${taiate}`)
    }
    for (const t of dynTools) {
      if (tools.length >= MAX_PROVIDER_TOOLS) break
      if (!seenNames.has(t.name)) {
        seenNames.add(t.name)
        tools.push(t)
      }
    }
    const baseUrl = `https://${req.headers.host ?? 'kelionai.app'}`
    // Voice from the first sentence on the API path too (clients): every
    // broadcast piece enters the pipe; synthesis runs in parallel with the text
    // still flowing.
    // SINGLE-VOICE RULE (Adrian, Jul 26): if the client has the full-duplex
    // session active, the written turn stays WRITTEN only — zero synthesis, zero
    // {audio} frames.
    const voice =
      req.body?.serverVoiceOff === true
        ? { feed: (_t: string): void => {}, fed: (): boolean => false, finish: async (): Promise<void> => {} }
        : createVoiceStream(reply, userLang, await getVoicePref(user.email).catch(() => null))
    let assistantText = ''
    // CE A VĂZUT DEJA OMUL PE ECRAN (agenții de debug, 3 aug, verdict REAL):
    // când un model pică DUPĂ ce a curs text, catch-ul lipea „Încearcă din nou"
    // direct peste jumătatea de răspuns și salva în istoric DOAR sufixul —
    // ecranul și istoricul divergeau. Acumulatorul ăsta ține exact ce a curs,
    // ca la eșec să (1) separăm sufixul de text și (2) istoricul = ecranul.
    let ecranPartial = ''
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
        let input: unknown = {}
        try {
          input = JSON.parse(argsJson || '{}')
        } catch {
          input = {}
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
        // APPROVED DYNAMIC TOOL: generic execution through a safe HTTP call.
        if (dynNames.has(name)) {
          return await runDynamicTool(name, input as Record<string, unknown>)
        }
        // MODEL-DECIDED ESCALATION: the same path as voice — full persona + the
        // turn's language, an answer from the brain with internal reasoning. The
        // REAL cost enters usage → debited at the end of the turn like any call.
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
      // FIRST WORD UNDER 1s ON ACTION TURNS TOO (Adrian, Jul 27, live proof:
      // 37s until the first word — the deed gate made it execute ALL tools
      // before saying a word). On the admin's action turn, the acknowledgment
      // leaves INSTANTLY; the tools run immediately after.
      if (isAdmin && heavyTurn) {
        // The wording requested by Adrian (Jul 30, second time): "task taken
        // on", not "getting on it — checking and executing". The first says the
        // job is IN his hands; the second described what he was about to do,
        // which is not what the human cares about.
        const ackText = ro ? 'Am preluat sarcina. ' : 'Task taken on. '
        noteFirstWord()
        // PLAIN text only — the write interceptor above frames EVERY chunk as
        // SSE (appendTurn). Passing appendTurn() output here DOUBLE-framed it:
        // the human saw „id: 5 data: Am preluat sarcina." (Adrian, Aug 1,
        // live screenshot) instead of the sentence.
        // A RECEIPT, NOT THE REPLY (Aug 2): the ack must not count as
        // "something visible" for this turn — otherwise an empty brain answer
        // behind it is accepted as success and the human gets the pickup
        // phrase, then the void (see conteazaCaVizibil above).
        ackInstantZbor = true
        reply.raw.write(ackText)
        ackInstantZbor = false
        voice.feed(ackText)
        assistantText += ackText
      }
      // GEMINI-ONLY (3 aug — extirparea totală OpenRouter): nu mai există niciun
      // „secundar" pe alt furnizor. Modelul turei e treapta Gemini aleasă de
      // selectedBrainModel; pe tura ușoară e deja gemini-2.5-flash (măsurat pe
      // payload-ul real: 1.2s runda 1 + 1.0s runda 2).
      const orchestratorModel = orChatModel
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
        for (let i = orMsgs.length - 1; i >= 0; i--) {
          if (orMsgs[i].role !== 'user') continue
          const audioBloc = { type: 'audio_url', audio_url: { url: audio } }
          const c = orMsgs[i].content
          const nou =
            typeof c === 'string'
              ? c
                ? [audioBloc, { type: 'text', text: c }]
                : [audioBloc]
              : [audioBloc, ...(c as { type: string; [k: string]: unknown }[])]
          orMsgs[i] = { ...orMsgs[i], content: nou as OrMessage['content'] }
          break
        }
      }
      let textFlowed = false
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
      const markupStrip = makeToolMarkupStripper(
        (swallowed) => console.error('[TOOL MARKUP — hidden from user]', swallowed.slice(0, 300)),
        toolNamesThisTurn,
      )
      const runBrainOnce = (): ReturnType<typeof runOrchestrator> => runOrchestrator(
        orchestratorModel,
        orMsgs,
        tools as unknown as AnthropicTool[],
        execTool,
        {
          maxTokens: 5000,
          // REAL REASONING on the heavy turn (Jul 25): the work model THINKS
          // internally before answering; the thinking does not flow into text —
          // only the final reply. On the light turn: none, so the first word
          // stays instant (under 1s, the latency rule).
          // THE FREE BRAIN FREEZE (Adrian, Jul 27: "I asked it for an action and
          // it freezes"): the :free model thinks IN SILENCE for tens of seconds
          // before the first word → it looks dead. On :free/gemini we force
          // SHORT thinking ('low'); on paid models it stays 'medium'.
          reasoning: heavyTurn ? (orchestratorModel.startsWith(GEMINI_DIRECT_PREFIX) || orchestratorModel.endsWith(':free') ? 'low' : 'medium') : undefined,
          // THE DEED GATE (Adrian, Jul 27): on the admin's turns, if Kelion
          // ASSERTS a deed without calling the tool, it is mechanically obliged
          // to execute or retract — it no longer stays at the declarative stage.
          deedGate: isAdmin,
          // WE NO LONGER FORCE the tool (Adrian, Jul 29: "it doesn't listen to
          // the request, does what it wants, as if certain things were
          // hardcoded"). THE REAL CAUSE: ACTION_INTENT caught almost ANY common
          // verb (show/put/search/open/check/do/read/write...), and
          // tool_choice:'required' OBLIGED it to call a tool even when you only
          // wanted an answer → "does what it wants". The forcing was exactly the
          // hardcoding that deafened the brain to the request. Now the brain
          // (still capable — heavy escalates the model) DECIDES by itself whether
          // and which tool to call, LISTENING to what you asked. The deed gate
          // (deedGate) remains the safety net: it cannot declare a deed without
          // having done it.
          forceToolsFirstRound: false,
          onText: (txt) => {
            const clean = markupStrip.push(txt)
            if (!clean) return
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
      let slotTinut: string | null = null
      try {
        for (let attempt = 0; attempt < MAX_INCERCARI_GEMINI && !r; attempt++) {
          // Take a slot on the Gemini model; if it's busy, wait in the
          // dispatcher's queue for a slot on the SAME model.
          if (!iaSlotDacaLiber(orchestratorModel)) {
            const tinut = await asteaptaLaCoada(async () => [orchestratorModel], new Set<string>())
            if (!tinut) break // queue full or waited too long — the honest error below
          }
          slotTinut = orchestratorModel
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
            if (!textFlowed && textCurat && neagaUneltele(textCurat)) {
              console.error(`[CHAT NEGARE] ${orchestratorModel} și-a negat uneltele — nu trimit minciuna, reîncerc`)
              noteazaEsuare(orchestratorModel)
            } else if (textCurat || textFlowed || sawVisible) { r = cand; break }
            console.error(`[CHAT MUTE] ${orchestratorModel} returned empty — reîncercare ${attempt + 1}/${MAX_INCERCARI_GEMINI}`)
            noteazaEsuare(orchestratorModel)
          } catch (ge) {
            lastBrainErr = ge
            if (textFlowed) throw ge // partial text already at the user — no retry
            console.error(`[brain] ${orchestratorModel} failed (${String(ge).slice(0, 120)}) — reîncercare ${attempt + 1}/${MAX_INCERCARI_GEMINI}`)
            noteazaEsuare(orchestratorModel)
          } finally {
            elibereazaSlot(slotTinut)
            slotTinut = null
          }
        }
      } finally {
        if (slotTinut) elibereazaSlot(slotTinut)
      }
      if (!r) throw (lastBrainErr ?? new Error('brain_gemini_exhausted'))
      markupStrip.flush() // held marker fragments: logged, never shown
      assistantText += stripToolMarkup(r.text, undefined, toolNamesThisTurn)
      usage.usd += r.costUsd
      // REAL ACCOUNTING (QA audit Jul 24, A1): the BRAIN cost enters cost_events
      // for ALL users (including admin) — the Money tab showed 0 under "Brain"
      // because recordCost was not called anywhere on the chat path.
      // PASTILA GEMINI (Adrian, 3 aug): tot creierul e google-direct → totul se
      // contabilizează sub 'gemini' și alimentează pastila din bară.
      void recordCost(user.email, 'gemini', r.costUsd)
      const totalMs = Date.now() - tCreier
      console.log(`[TIMP] tura ${turnId.slice(0, 8)}: creier=${orchestratorModel}, runde=${r.rounds}, total=${totalMs}ms`)
      // EVIDENȚA TIMPILOR (Adrian, 3 aug): măsurabil + din el învață bucla din spate.
      void recordTiming({ email: user.email, kind: 'chat', model: orchestratorModel, ms: totalMs, ok: true, rounds: r.rounds })
    } catch (e) {
      // The brain failed — honest, never silent. No Kimi/GLM safety net
      // (removed).
      const errMsg = e instanceof Error ? e.message : String(e)
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
      const spoken = ecranPartial.trim()
        ? (ro
            ? '\n\n[Răspunsul s-a întrerupt aici — cere-mi să continui.]'
            : '\n\n[The reply was cut off here — ask me to continue.]')
        : ro
          ? 'Încearcă din nou în câteva secunde.'
          : 'Try again in a few seconds.'
      reply.raw.write(spoken)
      reply.raw.end()
      void saveMessage(user.email, 'assistant', ecranPartial.trim() ? ecranPartial + spoken : spoken)
      console.error('[CHAT ERROR]', errMsg, { isRateLimit, isQuota, isRefusal })
      // EVIDENȚA TIMPILOR — și eșecul se măsoară (bucla din spate învață din el).
      // `orchestratorModel` e local blocului try; aici, pe eșec, notăm doar durata.
      void recordTiming({ email: user.email, kind: 'chat', ms: Date.now() - tCreier, ok: false })
      // MONEY IS NOT LOST ON ERROR (Jul 27 audit): the tools already run in this
      // turn (searches, images, ask_brain) COST money — the return from here
      // used to skip the debit and the user consumed for free, repeatably.
      // The OWNER is never debited (PR #648) — recorded, yes; charged, no.
      if (usage.usd > 0 && !isOwnerEmail(user.email)) void debitWallet(user.email, usage.usd, `chat-err:${turnId.slice(0, 8)}`)
      return
    }


    // ── FINAL TURN ──
    // TOTUL PE MONITOR (Adrian, Aug 2, 10:13 — the monitor is the PRIMARY
    // display surface): when the brain did NOT push any surface this turn but
    // its final answer still carries an obviously displayable payload (a URL,
    // an image link, map coordinates, a markdown table, a code block), the
    // monitor gets ONE sensible visual of it — deterministic, no extra model
    // call. Never duplicates what show_document/show_on_screen/a screen_url
    // tool already pushed (surfaceShown), never fires on plain prose
    // (autoPreviewFrame returns null). See services/monitorAutoPreview.ts.
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
    }
    await voice.finish()
    reply.raw.end()

    // Persist the assistant's reply.
    if (assistantText) {
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
  // Journal trace for EVERY tool called (Jul 25 incident: "it does nothing" —
  // without this trace, diagnosis required querying the database).
  console.log(`[tool] ${block.name} (${isAdmin ? 'admin' : 'user'})`)

  // The SHARED queue of all browser actions (open/click/type/read/back/
  // scroll/key/click_at): on success it sends the locally served SCREENSHOT to
  // the monitor (embeddable — not the external URL the iframe refused, Jul 24
  // audit P1-4), then returns the raw result. It was copied into 8 cases; here
  // it happens once (permanent principle: unique, no duplicates).
  const browserResult = (result: BrowserResult): string => {
    if (!('error' in result)) {
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: result.shotUrl, title: result.title } })}${CTRL}`)
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
      // Rosterul VIU (4 aug): și agenții puși de owner din admin sunt chemabili.
      const a = await gasesteAgentViu(String(args.agent ?? '').trim())
      if (!a) return JSON.stringify({ error: 'agent_necunoscut', valizi: (await rosterViu()).map((x) => x.id) })
      const sarcina = String(args.sarcina ?? '').trim()
      if (!sarcina) return JSON.stringify({ error: 'sarcina_goala' })
      try {
        // Blindat (4 aug): pe calea creierului, specialistul primește și memoria
        // lui Kelion când vorbește ownerul (isAdmin) — nu și pentru vizitatori.
        const r = await cheamaAgent(a, sarcina, isAdmin)
        usage.usd += r.costUsd
        return JSON.stringify({ agent: a.id, nume: a.nume, raspuns: r.text })
      } catch (e) {
        return JSON.stringify({ error: 'agent_a_esuat', detaliu: e instanceof Error ? e.message.slice(0, 200) : String(e) })
      }
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
      const jobId = await createBuildJob(email, order)
      if (!jobId) return JSON.stringify({ error: 'db_indisponibil' })
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
      return JSON.stringify({
        // `progress` = the constructor's current step (Stage 4) — Kelion can
        // speak it ("now compiling", "opening the PR") instead of "working…".
        // `ci` = the verdict of the INDEPENDENT verification (Stage 6): "Done,
        // verified by CI (green)" — not on the worker's word.
        jobs: jobs.map((j) => ({ id: j.id, status: j.status, order: j.orderText.slice(0, 160), progress: j.progress, ci: j.ci, pr: j.prUrl, branch: j.branch, tokens: j.tokens, updated: j.updatedAt })),
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
      const result = await generateImage(prompt)
      if ('error' in result) return JSON.stringify({ error: result.error })
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
      return JSON.stringify({ shown: true, url: imageUrl })
    }

    case 'generate_video': {
      const prompt = String(args.prompt ?? '')
      if (!prompt) return JSON.stringify({ error: 'no_prompt' })
      const result = await genereazaVideo(prompt, Number(args.seconds ?? 8))
      // The refusal (no key / payment not consciously enabled) travels to the
      // brain VERBATIM — it contains the measured price, so the person hears
      // the real reason, not a generic "failed".
      if ('error' in result) return JSON.stringify({ error: result.error })
      // The cost is the official list price × the real seconds generated —
      // Google does not itemize per call, so this is the exact bill by their
      // published rate, booked as its own kind to stay distinguishable.
      usage.usd += result.costUsd
      void recordCost(email, 'video', result.costUsd)
      const videoUrl = `${baseUrl}/api/video/${result.id}`
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: videoUrl, title: 'Generated video' } })}${CTRL}`)
      return JSON.stringify({ shown: true, url: videoUrl, secunde: result.secunde, costUsd: result.costUsd })
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



    case 'prepare_promo_clip': {
      if (!isAdmin) return JSON.stringify({ error: 'unauthorized' })
      // Clip preparation comes from the SHARED source (services/promo.ts) — the
      // same one voice uses, so §1 is respected without duplication.
      const built = await buildPromo(args)
      if ('error' in built) return JSON.stringify({ error: built.error })
      // ARMING THE RECORDER: the `{promo}` frame is the one ChatPanel waits for
      // (c.promo?.script → armPromo) in order to arm the Rec button.
      reply.raw.write(`${CTRL}${JSON.stringify({ promo: built.promo })}${CTRL}`)
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: built.monitorUrl, title: `Promo: ${built.promo.subject}` } })}${CTRL}`)
      return JSON.stringify({ armed: true, shown: true, url: built.monitorUrl })
    }

    default: {
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
        const result = await runGoogleTool(block.name, block.input, token)
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
