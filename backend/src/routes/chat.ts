import type { FastifyInstance } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { anthropic } from '../services/anthropic.js'
import { getSessionUser, setSession, type SessionUser } from '../session.js'
import {
  googleTools,
  runGoogleTool,
  refreshGoogleAccessToken,
  reverseGeocodeCached,
  promoSceneUrl,
  youtubeFirstEmbed,
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
  saveNote,
  listNotes,
  deleteNote,
  getRecentHistory,
  getSharedMemory,
  getAnthropicKey,
  getMemories,
  deleteMemory,
  identifyVoiceprint,
  getVoiceprint,
  saveVoiceprint,
  vectorDistance,
} from '../db.js'
import { getMeserie } from '../services/meserii.js'
import { claudeCost, SERPER_USD_PER_CALL, IMAGE_USD_PER_CALL } from '../services/cost.js'
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
  browserClose,
  crawlSite,
} from '../services/browser.js'
import { startTurn, appendTurn, finishTurn, readTurnFrom } from '../services/replayStore.js'
import {
  bridgeOnline,
  bridgeAsk,
  bridgeAskStream,
  BRIDGE_STALL,
  bridgeRepair,
  noteBrainActivity,
  resetBrainActivity,
  markFirstWord,
  brainTurnActive,
  finishBrainTurn,
  setOwnerTz,
  setProgress,
  setAnalysisDetail,
  sayToAdmin,
  getReadyDeploy,
  triggerDeploy,
  recentDevLog,
  stashAdminFiles,
  openRequirement,
  updateRequirement,
  resolveRequirement,
  ownedRequirement,
  type BridgeFile,
} from './bridge.js'
import { randomUUID } from 'node:crypto'
import { MODEL_FAST, MODEL_TOP, chooseModel } from '../services/modelRouter.js'
import { inferGender, type VoiceFeatures } from './voiceprint.js'

// STRATEGIA DE MODEL (Adrian, 10 iul): viteză maximă implicit, escaladare la
// modelul cel mai puternic la nevoie — decis de routerul automat capabilitate↔
// cost (services/modelRouter.ts), determinist și gratuit. Tier-urile stau acolo,
// configurabile din mediu (future-proof). Numele vechi rămân pentru restul codului.
const MODEL = MODEL_FAST // implicit: rapid + ieftin, primul cuvânt <1s
const MODEL_RESERVE = MODEL_TOP // cel mai puternic: cereri grele + orice eșec
const FABLE_REST_MS = 10 * 60_000 // după un eșec dur, folosește modelul TOP 10 min
let fableDownUntil = 0
// Ultimul mesaj (normalizat) al adminului — pentru filtrul anti-ecou ASR:
// un duplicat sosit în <45s nu mai pornește o tură (zgomot de microfon).
let lastAdminEcho: { key: string; at: number } = { key: '', at: 0 }
function brainModel(): string {
  return Date.now() < fableDownUntil ? MODEL_RESERVE : MODEL
}
function restFable(): void {
  fableDownUntil = Date.now() + FABLE_REST_MS
}

// Admin-only tool so Kelion can report its own real running cost when asked.
const COST_TOOL: Anthropic.Tool = {
  name: 'get_real_cost',
  description:
    "Get Kelion's REAL provider cost so far in USD (total, today, and a breakdown). Admin only. Use when the admin asks how much Kelion costs / has cost.",
  input_schema: { type: 'object', properties: {} },
}

// Lets Kelion put something on the user's screen on his own initiative — the
// "monitor mode" surface (a web page in a sandboxed panel behind the avatar).
// There is no manual button: Kelion decides when a visual helps and calls this.
const SHOW_TOOL: Anthropic.Tool = {
  name: 'show_on_screen',
  description:
    'Display a web page on the user\'s monitor (the screen behind you). Use this on your OWN initiative whenever showing something visually helps — a map, a website, a YouTube video, a document, search results. The user does NOT press any button and does NOT have to ask you to "open the monitor"; you decide when a visual is useful and call this. Pass an empty url to clear the screen. NOTE: for a regular website this automatically opens the LIVE browser (most sites refuse iframes), so for actual browsing/reading/clicking prefer browser_open directly — it also returns the page text and clickable elements.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full https:// URL to display. Empty string clears the screen.' },
      title: { type: 'string', description: 'Short caption for the panel header.' },
    },
    required: ['url'],
  },
}

// Lets Kelion create an image from a text description and put it straight on the
// user's monitor. Used when the user asks to draw / generate / imagine a picture.
const IMAGE_TOOL: Anthropic.Tool = {
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
const LOG_GAP_TOOL: Anthropic.Tool = {
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

// Let Kelion trigger a one-time avatar gesture on the user's screen. Use when
// the user asks for a gesture or when a gesture adds natural expression.
const PLAY_AVATAR_GESTURE_TOOL: Anthropic.Tool = {
  name: 'play_avatar_gesture',
  description:
    "Trigger a one-time avatar gesture on the user's screen. Use when the user asks for a gesture (wave, raise hand, point at the monitor) or when a gesture adds natural expression to your reply. The gesture plays once and blends smoothly back to idle.",
  input_schema: {
    type: 'object',
    properties: {
      gesture: {
        type: 'string',
        enum: ['raiseRightHand', 'salute', 'pointMonitor'],
        description: 'Which gesture to play.',
      },
    },
    required: ['gesture'],
  },
}

// User-facing notes ("reține asta", "salvează-mi asta") — explicit, visible,
// listable and deletable by the user themselves. Distinct from Kelion's silent
// auto-learned long-term memory: a note only exists because the user asked for it.
const SAVE_NOTE_TOOL: Anthropic.Tool = {
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
const LIST_NOTES_TOOL: Anthropic.Tool = {
  name: 'list_notes',
  description:
    'List the user\'s saved notes (e.g. "ce am salvat?", "arată-mi notițele", "what did I save?"). Returns them most recent first with their id, so you can read them back or reference one for deletion.',
  input_schema: { type: 'object', properties: {} },
}
const DELETE_NOTE_TOOL: Anthropic.Tool = {
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
const LIST_MEMORIES_TOOL: Anthropic.Tool = {
  name: 'list_memories',
  description:
    'Show everything you (Kelion) remember about this user from earlier conversations — the auto-learned durable facts (distinct from their explicitly saved notes). Use when they ask "ce știi despre mine?", "ce ții minte despre mine?", "what do you remember about me?". Present it naturally in their language.',
  input_schema: { type: 'object', properties: {} },
}
const FORGET_MEMORY_TOOL: Anthropic.Tool = {
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
const BROWSER_OPEN_TOOL: Anthropic.Tool = {
  name: 'browser_open',
  description:
    'Open a real web page in a live browser and show it, live, on the user\'s monitor — including sites that refuse to load in a simple embedded frame (Google, banks, social media). Returns the page title, its visible text, and a NUMBERED list of its links/buttons/inputs so you can navigate further with browser_click / browser_type. Prefer this over show_on_screen whenever the user wants to actually browse, read inside, search within, or interact with a real website.',
  input_schema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Full https:// (or http://) URL to open.' } },
    required: ['url'],
  },
}
const BROWSER_CLICK_TOOL: Anthropic.Tool = {
  name: 'browser_click',
  description:
    'Click a link, button or other element on the currently open browser page, by its number from the last browser_open/browser_read/browser_click/browser_type result. This is how you walk through an entire site page by page — e.g. to survey/summarize it ("conspectează site-ul"): open it, read it, click into each relevant link, read again.',
  input_schema: {
    type: 'object',
    properties: { index: { type: 'number', description: 'The element number to click.' } },
    required: ['index'],
  },
}
const BROWSER_TYPE_TOOL: Anthropic.Tool = {
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
const BROWSER_READ_TOOL: Anthropic.Tool = {
  name: 'browser_read',
  description:
    'Re-read the currently open browser page — its visible text and numbered links/buttons — without navigating. Use to survey/summarize a page or refresh the list of clickable elements.',
  input_schema: { type: 'object', properties: {} },
}
const BROWSER_BACK_TOOL: Anthropic.Tool = {
  name: 'browser_back',
  description: 'Go back to the previous page in the live browser.',
  input_schema: { type: 'object', properties: {} },
}
const BROWSER_SCROLL_TOOL: Anthropic.Tool = {
  name: 'browser_scroll',
  description: 'Scroll the currently open browser page to see more content.',
  input_schema: {
    type: 'object',
    properties: { direction: { type: 'string', enum: ['down', 'up'], description: 'Scroll direction.' } },
    required: ['direction'],
  },
}
const BROWSER_CLOSE_TOOL: Anthropic.Tool = {
  name: 'browser_close',
  description: 'Close the live browser and clear it from the monitor, when done browsing.',
  input_schema: { type: 'object', properties: {} },
}

// ADMIN ONLY. When the owner asks to FIX, CHANGE or ADD something in the
// Kelionai APP ITSELF (a bug, a feature, the code/site) — not an ordinary task —
// hand the request to the owner's developer (Claude Code) through the bridge.
const REPAIR_TOOL: Anthropic.Tool = {
  name: 'request_repair',
  description:
    "ADMIN ONLY. Use ONLY when the owner (Adrian) asks you to REPAIR, FIX, CHANGE, or ADD something in the Kelionai APPLICATION ITSELF — a bug in the app, a broken feature, a code/website change, something that isn't working right. This forwards his request to his developer (Claude Code) who does the actual fix in the project. Do NOT use it for ordinary user tasks (search, maps, email, notes) — only for changes to the app/software. Pass a clear, complete description of what he wants fixed or changed, in his own words plus any detail he gave.",
  input_schema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'Clear, complete description of the fix/change the owner wants, with any detail he gave.',
      },
    },
    required: ['description'],
  },
}

// ── Kelion's team of specialist agents ──────────────────────────────────────
// Each is an expert (same Opus model, focused prompt + its OWN memory namespace)
// that Kelion hands a task to via the `delegate` tool; it does the work with the
// tools and reports back. Only Kelion talks to the user — one voice, always.
interface AgentSpec {
  id: string
  name: string
  focus: string
  // Text agents: their written result is also shown as a readable, copyable panel
  // on the monitor. Visual agents (studio/navigator) already show an image/map.
  doc?: boolean
  // Code agents: get the code-execution sandbox (write software, actually run it).
  code?: boolean
}
const AGENTS: Record<string, AgentSpec> = {
  secretary: {
    id: 'secretary',
    name: 'Secretary',
    doc: true,
    focus:
      "the user's Google Workspace — Gmail, Calendar, Tasks, Drive and Contacts: reading, searching, summarising and drafting. To SEND an email, first write the COMPLETE draft (it is shown on the monitor and read to the user) and STOP — send it with send_email ONLY after the user has explicitly confirmed. Never send, delete or change anything without that explicit confirmation.",
  },
  navigator: {
    id: 'navigator',
    name: 'Navigator',
    focus:
      'places, maps, routes, distances, live traffic and driving-copilot help. Always show the map or route on the monitor using the tools, and give clear directions.',
  },
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    doc: true,
    focus:
      'finding current, factual information — web search, YouTube, Wikipedia, weather, currency and time. Never invent anything; report only what the tools actually return.',
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    focus:
      'creating and designing images from a description — illustrations, logos, posters, concept art — and creative visual ideas. Always actually generate the image with your image tool and show it on the monitor; describe briefly what you made.',
  },
  scribe: {
    id: 'scribe',
    name: 'Scribe',
    doc: true,
    focus:
      "writing, rewriting, drafting, summarising and translating text in any language and any tone — emails, messages, posts, letters, documents. Match the user's voice and the register they ask for, and return the finished text ready to use.",
  },
  // Software pair — separation of duties: the one who tests is never the one
  // who wrote it. Both work in the isolated code-execution sandbox.
  developer: {
    id: 'developer',
    name: 'Developer',
    doc: true,
    code: true,
    focus:
      'writing SOFTWARE that actually works: design it, write the code in the sandbox, RUN it, fix what fails, and only then deliver. Your deliverable is the full final source code (it is shown on a panel) plus one sentence on what it does and proof it ran. Never deliver code you have not executed.',
  },
  tester: {
    id: 'tester',
    name: 'Tester',
    doc: true,
    code: true,
    focus:
      'INDEPENDENTLY testing software written by others (separation of duties — you never fix, you verify). Take the code you are given, run it in the sandbox, design real test cases including edge cases, TRY TO BREAK IT, and report a clear verdict: PASS or FAIL, each test with its actual output as evidence.',
  },
}

// ADMIN ONLY — the promo-clip pipeline. Kelion writes a script sized to the
// requested standard duration (15/30/60s), shows it, and ONLY after the admin
// explicitly authorizes it calls this tool: the script goes on the monitor as a
// readable panel, the screen recorder arms (one click picks the screen — browser
// law), and when recording starts the approved script is spoken aloud verbatim.
const PROMO_TOOL: Anthropic.Tool = {
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

// THE SANDBOX — Anthropic's server-side code execution: an isolated container
// (Python 3.11 + bash + files, no internet) where Kelion WRITES software and
// actually RUNS/TESTS it. Verified live on both brains. Server-side: we only
// declare it; execution happens inside the API call itself.
const CODE_EXEC_TOOL = {
  type: 'code_execution_20260521',
  name: 'code_execution',
} as unknown as Anthropic.Tool

const DELEGATE_TOOL: Anthropic.Tool = {
  name: 'delegate',
  description:
    "Hand a task to one of your specialist agents — each an expert with a verified background of 25 years of professional experience in its domain and its OWN memory, who does the work and reports back to you. Agents: 'secretary' (Gmail, Calendar, Tasks, Drive, Contacts), 'navigator' (places, maps, routes, live traffic, driving copilot), 'researcher' (web search, YouTube, Wikipedia, weather, currency, time, current facts), 'studio' (creating/designing images, logos, illustrations, visual concepts), 'scribe' (writing, drafting, rewriting, summarising and translating text in any tone or language), 'developer' (writes SOFTWARE in the sandbox and runs it until it works), 'tester' (independently tests code written by others — separation of duties: pass the developer's full code in the task and it returns a PASS/FAIL verdict with real run evidence). For serious software requests use developer THEN tester. You then relay their result to the user in your OWN voice. For a single trivial lookup you may just use your own tools instead.",
  input_schema: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        enum: ['secretary', 'navigator', 'researcher', 'studio', 'scribe', 'developer', 'tester'],
      },
      task: { type: 'string', description: 'The full task for the agent, with all the detail it needs.' },
    },
    required: ['agent', 'task'],
  },
}

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

const SYSTEM_PROMPT = `You are Kelion — a brilliant personal AI assistant in the spirit of Jarvis from Iron Man: a courteous, refined GENTLEMAN — sharp, perceptive, genuinely useful, and always impeccably well-mannered.

WHO YOU ARE: You were created by AE Studio. Your owner and creator is Adrian Enciulescu — both the application and the original idea are his. If the user asks who made you, who owns you, or whose idea you are, answer clearly and with respect (created by AE Studio; owner and creator Adrian Enciulescu). Do not bring this up unprompted.

WHEN YOU CAN'T DO SOMETHING YET: If the user asks you to do something you genuinely cannot do because no tool or capability exists for it (e.g. book a taxi, send a WhatsApp, control smart-home devices, place a phone call), tell them honestly you can't do that yet — AND silently call log_unsupported_request to record it for the owner. Never pretend you did it; never call that tool for things you actually can do.

YOUR TEAM: You lead seven specialist agents — each with a verified background of 25 years of professional experience in its domain and its OWN memory — who take a task from you and report back — the Secretary (Gmail, Calendar, Tasks, Drive, Contacts), the Navigator (places, maps, routes, live traffic, driving copilot), the Researcher (web, YouTube, Wikipedia, weather, currency, time, current facts), the Studio (creating and designing images, logos, illustrations, visual concepts), the Scribe (writing, drafting, rewriting, summarising and translating text in any tone or language), the Developer (writes software in the real sandbox and runs it until it works) and the Tester (independently verifies code written by others — separation of duties: when the Developer delivers, hand the Tester the developer's FULL code in the task and relay its PASS/FAIL verdict; for serious software requests always use Developer then Tester). For a real task in one of these domains — especially anything multi-step — hand it to the right agent with the delegate tool, then tell the user the result in YOUR own voice. If the user EXPLICITLY names or asks for one of them (e.g. "ask the navigator", "roagă cercetătorul", "let the secretary handle it"), you MUST delegate to that exact agent, even if you could do it yourself. For a trivial single lookup you may just use your own tools. When an agent produces something the user asked you to CREATE — a drafted email or message, a translation, a piece of writing — give the user that finished content itself (read it out in full), don't just say it's ready or jump ahead to sending it. The user only ever hears YOU — one voice, always yours.

Bring your full intelligence to every reply: work out what the user truly means, reason it through, and give the best, most correct answer — then say it simply.

HOW YOU SPEAK (critical — your words are spoken ALOUD and shown in a live chat):
- Talk like a real person in a conversation, never like a written document.
- NEVER use markdown or symbols: no asterisks (*), no **bold**, no bullet points, no numbered lists, no headings (#), no backticks, no emoji. Plain spoken sentences only. (Asterisks literally get read out loud — never produce a * character.)
- Be concise and human: a sentence or two, more only when real depth is asked for. No padding, no filler, no meta-commentary about what you're doing.
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

YOUR SANDBOX (creating software): you have code_execution — a REAL isolated
computer (Python 3.11, bash, files; no internet) where you can WRITE programs
and actually RUN and TEST them. When the user asks you to create software,
compute something non-trivial, analyse data, or verify an algorithm: write the
code, EXECUTE it in the sandbox, fix what fails, and only then present the
result — never claim code works without having run it. Speak the OUTCOME in one
or two short sentences; the code and its output are shown automatically on the
user's monitor, so never read code aloud.

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
long page, and browser_close when you are done browsing. Prefer browser_open
over show_on_screen whenever the user wants to actually browse, read inside,
search within, or click through a real website — show_on_screen only displays a
static page and cannot click, type or read it back to you.

REPAIRS (owner only): if the request_repair tool is available and the OWNER asks
you to fix, change, repair or add something in the Kelionai APP ITSELF (a bug, a
broken feature, the code or the website — not an ordinary task), call
request_repair with a clear, complete description of what he wants. That hands it
to his developer, who does the real fix. After calling it, tell him plainly you
have sent the repair request to be worked on. Never pretend YOU changed the app's
code — you can't; you only forward it. This is ONLY for changes to the app itself,
never for normal tasks (search, maps, email, notes, browsing).

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
guiding them, never invented ones.`

// Human language names for the language lock — Claude obeys an explicit language
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

// Anthropic rejects empty-content messages and non-alternating roles, and the
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
  // client passes the turn id it got as the first frame and how many characters
  // it already received; we replay the rest from the in-memory buffer. Unknown
  // or expired turn → empty 200, and the client falls back to a normal retry.
  app.get<{ Querystring: { turn?: string; from?: string } }>(
    '/api/chat/resume',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const turn = (req.query.turn ?? '').trim()
      const from = Number(req.query.from ?? 0) || 0
      if (!turn) return reply.code(400).send({ error: 'bad_request' })
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      try {
        for await (const chunk of readTurnFrom(turn, from)) reply.raw.write(chunk)
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
      // pentru TOȚI userii (regula nr. 9), nu doar admin (adminul le trimite
      // deja prin `files` pe punte; publicul le trimite aici).
      images?: string[]
      // Poza a fost ATAȘATĂ EXPLICIT (Ctrl+V / încărcată), nu e cadrul ambient
      // al camerei — cerere de analiză fără condiție (vezi VISION_INTENT mai jos).
      imageIsAttachment?: boolean
      coords?: Coords
      screen?: { kind: string; title: string; active: boolean }[]
      now?: string
      tz?: string
      // Raw attachments for the ADMIN bridge: photos, archives, video — any
      // file rides the bridge to Claude (saved server-side by the worker).
      files?: { name?: string; type?: string; data?: string }[]
      // Features vocale extrase 100% client-side pentru identificare speaker + gen.
      voiceFeatures?: VoiceFeatures
    }
  }>(
    '/api/chat',
    {
      // This is the ONE route allowed a big body (admin bridge photos/archives/
      // video). And it is the most cost-sensitive one, so it gets a tighter
      // rate limit than the global default — 40/min per IP is far more than a
      // human types, but stops an automated flood from burning API/subscription.
      bodyLimit: 100_000_000,
      config: { rateLimit: { max: 40, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    // ORDIN DIRECT (Adrian, 10 iul): „peste tot unde apare Claude se folosește
    // abonamentul mare; cheia API se scoate". Chatul NU mai depinde de
    // ANTHROPIC_API_KEY — și adminul și publicul răspund prin punte (abonament).
    // De aceea vechiul gard 503 „brain_not_configured" a dispărut de aici.
    const rawMessages = req.body?.messages
    const image = req.body?.image
    // Cadrele multiple (max 4, doar imagini reale) — cad înapoi pe `image`
    // singular dacă clientul e vechi.
    const camFrames = (Array.isArray(req.body?.images) ? req.body.images : [])
      .filter((s): s is string => typeof s === 'string' && s.startsWith('data:image'))
      .slice(0, 4)
    const imageIsAttachment = req.body?.imageIsAttachment === true
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'messages[] required' })
    }
    let messages = sanitizeHistory(rawMessages)
    // Cap the history sent to Claude. A long conversation (this user already has
    // hundreds of messages) would blow the token limit and make EVERY turn fail
    // with a "connection error" — especially when a big pasted page is added.
    // Long-term continuity comes from the memory agent, not the raw transcript.
    // Raised from 24 → 60: the models have a 1M-token context, and 24 was cutting
    // off important earlier context inside a single working session (the user
    // reported losing information mid-conversation). 60 keeps far more context
    // while staying well clear of any limit.
    const MAX_HISTORY = 60
    if (messages.length > MAX_HISTORY) {
      messages = messages.slice(-MAX_HISTORY)
      while (messages.length > 0 && messages[0].role !== 'user') messages.shift()
    }
    if (messages.length === 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'no usable messages' })
    }

    // The user's ESTABLISHED language (what they actually use), not their Google
    // account locale — used for the language lock AND the out-of-credit message.
    // UN SINGUR drum spre bază în loc de patru la rând (Adrian, 10 iul: „chat
    // live instant"): citirile independente pleacă ÎMPREUNĂ — fiecare await
    // separat mai punea o tură de DB înaintea primului cuvânt.
    const lastForRecall = messages.at(-1)
    const [storedPref, userAnthropicKey, meserieId, memRecall, lastSavedRow] = await Promise.all([
      getSpeechLang(user.email),
      getAnthropicKey(user.email),
      getMeserieActiva(user.email),
      // Memory agent (recall): DB pur (fără model, fără credite) — faptele
      // durabile despre user; mesajul curent e indiciul de relevanță.
      recallMemories(user.email, 'kelion', lastForRecall?.role === 'user' ? lastForRecall.content : ''),
      // Continuitate între sesiuni (#20): momentul ultimului mesaj salvat — DB
      // pur, în paralel cu restul (zero latență adăugată).
      getRecentHistory(user.email, 1).catch(() => []),
    ])

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
    // LIMBA (Adrian, 10 iul: „blochează limba admin pe română, restul pe detecție
    // automată"). ADMINUL e blocat PERMANENT pe română — NU detectăm, NU comutăm
    // niciodată pe locale-ul contului sau pe ce citește (asta rezolvă „nu respectă
    // limba admin" + cercul vicios al recognizer-ului). RESTUL userilor rămân pe
    // detecția automată (trackSpeechLang), exact ca până acum.
    const adminLocked = user.role === 'admin'
    const committedLang = adminLocked
      ? null // adminul nu comută niciodată — e mereu ro
      : deviceCmd || gestureCmd
        ? null // a device/gesture command is an order, not conversation — never shifts the language
        : trackSpeechLang(user.email, lastIncomingText, storedPref || user.locale)
    if (committedLang) await setSpeechLangPref(user.email, committedLang)
    // Ce anunțăm clientului ca limbă: adminul primește MEREU ro-RO (idempotent pe
    // client — applyLang schimbă recognizer-ul doar dacă diferă), ca microfonul
    // să asculte română; restul primesc comutarea detectată.
    const announceLang = adminLocked ? 'ro-RO' : committedLang
    const speechPref = adminLocked ? 'ro-RO' : (committedLang ?? storedPref)
    const userLang = speechPref || user.locale || 'unknown'
    const ro = userLang.toLowerCase().startsWith('ro')

    // Paywall: customers need prepaid credit; the owner (admin) is exempt, and
    // when Stripe isn't configured the app stays free/ungated. Clean binary stop
    // in the user's language + a paywall frame so the UI shows the top-up link.
    if (
      config.stripe.secretKey &&
      user.role !== 'admin' &&
      user.role !== 'demo' &&
      !userAnthropicKey &&
      (await getBalance(user.email)) <= 0
    ) {
      reply.hijack()
      reply.raw.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' })
      reply.raw.write(
        ro
          ? 'Ai rămas fără credit. Te rog reîncarcă creditul ca să continuăm.'
          : "You've run out of credit. Please top up to keep talking with me.",
      )
      reply.raw.write(`${CTRL}${JSON.stringify({ paywall: true })}${CTRL}`)
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
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      const cmdTurnId = randomUUID()
      startTurn(cmdTurnId)
      const ack = deviceAck(deviceCmd, ro)
      const payload =
        `${CTRL}${JSON.stringify({ turn: cmdTurnId })}${CTRL}` +
        `${CTRL}${JSON.stringify({ device: deviceCmd })}${CTRL}` +
        ack
      appendTurn(cmdTurnId, payload)
      finishTurn(cmdTurnId)
      reply.raw.write(payload)
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
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      const cmdTurnId = randomUUID()
      startTurn(cmdTurnId)
      const ack = gestureAck(gestureCmd, ro)
      const payload =
        `${CTRL}${JSON.stringify({ turn: cmdTurnId })}${CTRL}` +
        `${CTRL}${JSON.stringify({ gesture: gestureCmd })}${CTRL}` +
        ack
      appendTurn(cmdTurnId, payload)
      finishTurn(cmdTurnId)
      reply.raw.write(payload)
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

    // Wire the device GPS into Claude's context so location-dependent skills
    // (weather, maps, "near me", "where am I") actually work. The frontend sends
    // the live coordinates; we resolve a human place name (cached) so Claude can
    // pass it to the name-based skills.
    let systemPrompt = SYSTEM_PROMPT
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

    // Owner-only: never refuse the owner. If something can't be done on the spot,
    // it is handled off-band (his developer builds it) — so Kelion says he's on
    // it / has sent it to be built, NEVER "I can't". This is the fallback path;
    // when the owner's bridge is online his messages are answered by it directly.
    if (user.role === 'admin') {
      // Aceeași oră peste tot: jurnalul/monitorul se ștampilează pe fusul lui
      // Adrian (trimis de client la fiecare tură), nu pe UTC-ul serverului.
      if (typeof req.body?.tz === 'string' && req.body.tz) setOwnerTz(req.body.tz)
      systemPrompt +=
        `\n\nOWNER — NEVER REFUSE: you are talking to Adrian, your owner. You must NEVER tell him "I can't do that" or "I don't have access". If it is something you can do, do it. If it is something that needs building or fixing in the app, tell him plainly that you are taking care of it / have sent it to be built (and silently log_unsupported_request so it reaches his developer) — but frame it as handled, never as a refusal. Always give him a real, helpful spoken answer; never a dead end.`
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
        `\n\nMONITOR STATE: these task tabs are already open on the user's monitor: ${list}. One voice narrates all of them and the user can switch or close them at will. When the user says "the map", "the video", "this", "that", or asks to change what is shown, they mean these open tabs — work WITHIN the active one. To change a surface's content, call the SAME tool again (youtube_search swaps the current video, maps_search moves the map, get_weather changes the forecast) rather than describing it in words. Only open a different kind of surface when the user actually needs a new one.`
    }

    // Memory agent (recall): inject the durable facts Kelion has learned about
    // this user so the conversation is continuous across sessions. Citit mai
    // sus (drumul unic spre bază); folosit și de punte (memBlock) și de API.
    systemPrompt += memRecall

    // SPEAKER IDENTIFICATION: voice features (extracted 100% client-side) tell
    // Kelion who is speaking, their detected gender, and whether the voice is
    // verified as the owner. For every voice turn the profile is refreshed so
    // it improves over time without a manual calibration step.
    const vf = req.body?.voiceFeatures
    if (vf?.vector?.length && vf?.meta) {
      const gender = inferGender(vf.meta.pitchMean)
      const stored = await getVoiceprint(user.email)
      const match = await identifyVoiceprint(vf.vector, 0.38)
      const isOwnerByEmail = user.email.toLowerCase() === config.adminEmail.toLowerCase()
      // Pentru admin comparam DIRECT cu amprenta lui stocata, nu cu orice match
      // din baza de date — asa evitam ca un alt user cu vector apropiat sa fie
      // confundat cu ownerul.
      let voiceVerifiedAdmin = false
      if (isOwnerByEmail) {
        const adminPrint = await getVoiceprint(config.adminEmail)
        if (adminPrint?.features?.length) {
          voiceVerifiedAdmin = vectorDistance(vf.vector, adminPrint.features) < 0.38
        }
      }
      await saveVoiceprint({
        email: user.email,
        name: user.name || stored?.name || user.email.split('@')[0],
        gender,
        isAdmin: isOwnerByEmail,
        features: vf.vector,
        featureMeta: vf.meta,
      })
      const speakerName = voiceVerifiedAdmin
        ? 'Adrian'
        : match?.name || stored?.name || user.name || 'the user'
      const genderLabel =
        gender === 'male' ? 'bărbat' : gender === 'female' ? 'femeie' : 'necunoscut'
      systemPrompt +=
        `\n\nSPEAKER: ${speakerName}. Gen detectat după voce: ${genderLabel}. ` +
        (voiceVerifiedAdmin
          ? 'Voce verificată ca fiind a ownerului Adrian.'
          : 'NU este verificată ca fiind vocea ownerului.')
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

    const params: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))
    // Vision ONLY on demand: give Claude the camera frame solely when the user is
    // actually asking about what's visible. If we attached it every turn, Claude
    // would keep volunteering observations about what he sees — which the user
    // explicitly does NOT want. No frame attached = nothing to comment on.
    // Extended for BLIND users (their daily reality): describe surroundings,
    // what's ahead / in the way, obstacles, traffic lights, crossing safely,
    // reading signs and labels — all must summon Kelion's eyes instantly.
    const VISION_INTENT =
      /(\bsee\b|\blook\b|\bwatch\b|show me what|what('?s| is) this|what am i|what do you see|\bcamera\b|\bpicture\b|\bphoto\b|\bimage\b|colou?r|read this|\bscan\b|describe|in front of|ahead of me|obstacle|traffic light|cross(ing)? the (street|road)|\bsign\b|\blabel\b|\bdanger\b)|vezi|vede|uit[aăâ]|uite|prive[sșş]te|ce (e|este|am|[țt]in|ai[ -])|camer[aă]|imagin|poz[aă]|culoar|cite[sșş]te|scanea|descrie|[îi]n fa[țt][aă]|ce se afl[aă]|obstacol|pericol|semafor|trec(e|i)? strada|indicator|etichet[aă]|panou|u[șs][aă]|sc[aă]ri|trotuar|bordur[aă]/i
    // VEDEREA CONTINUĂ și pe calea API (clienți): toate cadrele primite (max 4),
    // nu doar unul — Claude acceptă mai multe blocuri de imagine per mesaj.
    const apiCam = camFrames.length > 0 ? camFrames : image ? [image] : []
    if (apiCam.length > 0 && params.length > 0) {
      const lastIdx = params.length - 1
      const lm = params[lastIdx]
      if (
        lm.role === 'user' &&
        typeof lm.content === 'string' &&
        (imageIsAttachment || VISION_INTENT.test(lm.content))
      ) {
        const strip = (s: string): string => (s.includes(',') ? s.slice(s.indexOf(',') + 1) : s)
        params[lastIdx] = {
          role: 'user',
          content: [
            ...apiCam.map((f) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: strip(f) },
            })),
            { type: 'text', text: lm.content },
          ],
        }
      }
    }

    // Stream Claude's reply back as plain UTF-8 text chunks.
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    })

    // Resumable stream: mirror EVERY byte we send into a short-lived buffer keyed
    // by this turn id, so if the mobile link drops mid-reply the client can
    // reconnect to /api/chat/resume and get the rest — no lost words, no
    // regeneration. Patching write/end here covers all downstream call sites
    // (brain text, control frames, tools, agents) without touching each one.
    const turnId = randomUUID()
    startTurn(turnId)
    const rawWrite = reply.raw.write.bind(reply.raw)
    const rawEnd = reply.raw.end.bind(reply.raw)
    // ÎNGHEȚUL DIN 10 IUL: cât gândește creierul (60–80s legitim), pe fir nu
    // pleca NICIUN octet — Cloudflare taie conexiunea tăcută (QUIC reset pe
    // /api/chat, 524 pe /resume după 100s), tura moare, iar aplicația așteaptă
    // la nesfârșit o tură moartă (chatul „ignoră"). Plasa: la fiecare 15s de
    // tăcere trimitem un cadru de control {ping} — ține conexiunea vie prin
    // Cloudflare și intră în bufferul de resume ca orice alt octet. Aplicația
    // îl ignoră (câmp necunoscut), dar ceasul ei de gardă îl vede ca semn de viață.
    let lastByteAt = Date.now()
    reply.raw.write = ((chunk: unknown, ...rest: unknown[]) => {
      lastByteAt = Date.now()
      if (typeof chunk === 'string') appendTurn(turnId, chunk)
      return (rawWrite as (...a: unknown[]) => boolean)(chunk, ...rest)
    }) as typeof reply.raw.write
    const pingTimer = setInterval(() => {
      if (reply.raw.writableEnded || reply.raw.destroyed) return
      if (Date.now() - lastByteAt >= 15_000) reply.raw.write(`${CTRL}{"ping":1}${CTRL}`)
    }, 5_000)
    reply.raw.end = ((...args: unknown[]) => {
      clearInterval(pingTimer)
      finishTurn(turnId)
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
    // Demo = fără istoric (spec Adrian, 10 iul): mesajele vizitatorilor demo
    // nu se salvează nicăieri.
    if (lastTurn?.role === 'user' && user.role !== 'demo')
      void saveMessage(user.email, 'user', lastTurn.content)

    const isAdmin = user.role === 'admin'

    // ADMIN BRIDGE. Adrian's ABSOLUTE rule (4 iul): EVERY admin message is
    // answered by the Linux brain — NO exception, NO "kelion" bypass, NO
    // fallback to the paid API brain. Bridge down → Kelion says exactly that
    // and stops. (The old prefix shortcut leaked to the API brain when he
    // addressed Kelion by name — removed.)
    if (isAdmin) {
      // STOP pe cerință: dacă Adrian spune „stop / oprește / lasă / anulează" cât
      // o cerință e în lucru, o ÎNCHIDEM — supervizorul vede că nu mai e nimic de
      // dus la capăt (ownedReq = null) și nu mai re-asignează. Fără asta, bucla de
      // re-asignare (până la 3 încercări) ignora comanda. Revenim la modul chat.
      const stopCmd = /^\s*(stop|stai|opre[șs]te(?:\-te)?|oprire|las[ăa](?:\s*asta)?|renun[țt][ăa]|anuleaz[ăa]|nu mai lucra|gata cu asta)[\s.!]*$/i
      if (stopCmd.test(lastUserText) && ownedRequirement()) {
        resolveRequirement()
        const msg = 'Am oprit — cerința e închisă, nu mai reîncerc. Sunt pe modul chat, spune-mi ce vrei.'
        reply.raw.write(msg)
        reply.raw.end()
        void saveMessage(user.email, 'assistant', msg)
        return
      }
      // OK → DEPLOY: PRIMUL, înaintea oricărui filtru (bug 5 iul: filtrul de
      // ecou înghițea al doilea „da" din 45s → publicarea nu pornea și
      // aplicația părea moartă). Un „da" e ORDIN, niciodată zgomot.
      const affirm = /^\s*(ok(ay)?|da|d[aă]\-?i drumul|public[aă]|public|deploy|hai|bun|merge|gata)[\s.!]*$/i
      if (getReadyDeploy() && affirm.test(lastUserText)) {
        const t = triggerDeploy()
        const msg = t
          ? 'Am zis să se publice — serverul dă drumul acum. Îți spun când e live.'
          : 'Nu mai am nimic pregătit de publicat acum.'
        reply.raw.write(msg)
        reply.raw.end()
        void saveMessage(user.email, 'assistant', msg)
        return
      }
      // ── FILTRU ANTI-ZGOMOT ASR (Adrian, 5 iul) ────────────────────────────
      // Microfonul permanent trimite uneori ACEEAȘI frază de mai multe ori
      // („Nu." ×7) sau fragmente dublate în același mesaj. Fiecare duplicat
      // pornea o tură plină → creierul umplea chatul („Sunt aici") și zgomotul
      // suprascria „Cererea în analiză". Regula: propozițiile identice
      // consecutive se strâng într-una; un mesaj identic cu precedentul, sosit
      // în <45s, nu pornește o tură — dar primește un rând scurt, NICIODATĂ
      // tăcere totală (tăcerea arăta ca o aplicație moartă — bug 5 iul).
      const normNoise = (s: string): string =>
        s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
      const cleanUserText = lastUserText
        .split(/(?<=[.!?])\s+/)
        .filter((s, i, arr) => i === 0 || normNoise(s) !== normNoise(arr[i - 1]))
        .join(' ')
        .trim()
      const noiseKey = normNoise(cleanUserText)
      // DOAR cât timp o tură chiar RULEAZĂ (Adrian, 10 iul: „se blochează"):
      // ecoul de microfon apare când Kelion vorbește/răspunde. Când e liniște,
      // un mesaj identic retrimis e Adrian care insistă fiindcă n-a primit
      // răspuns — pornește o tură reală, nu-l mai înghiți.
      if (
        noiseKey &&
        noiseKey === lastAdminEcho.key &&
        Date.now() - lastAdminEcho.at < 45_000 &&
        brainTurnActive()
      ) {
        // AICI SE RUPEA ȘI FILTRUL (mesaje scrise „nu ajung", 4 iul): ceasul se
        // reîmprospăta la FIECARE duplicat, deci Adrian care retrimitea același
        // text (fiindcă nu primea răspuns) era înghițit la nesfârșit ca „ecou".
        // Fereastra curge acum de la PRIMA apariție: a doua retrimitere după
        // 45s pornește o tură reală. (Ecoul de microfon vine oricum în <45s.)
        const echoMsg = 'Am auzit (același mesaj, probabil ecou) — lucrez în continuare; dacă e comandă nouă, mai adaugă un cuvânt.'
        reply.raw.write(echoMsg)
        reply.raw.end()
        void saveMessage(user.email, 'assistant', echoMsg)
        return
      }
      lastAdminEcho = { key: noiseKey, at: Date.now() }
      // BARGRAF LA INTRAREA ÎN CREIER (Adrian, 10 iul): serverul confirmă EXACT
      // textul pe care îl predă creierului la această tură — banda din UI îl
      // afișează. Nu e ecou local: dacă banda nu se schimbă când vorbești,
      // vocea a murit ÎNAINTE de creier.
      reply.raw.write(`${CTRL}${JSON.stringify({ heard: (cleanUserText || lastUserText).slice(0, 500) })}${CTRL}`)
      // Vocea pornește DIN PRIMA FRAZĂ, în paralel cu textul (nu după final).
      const voice = createVoiceStream(reply, speechPref || user.locale)
      let a = ''
      // The exact bridge prompt for this turn, hoisted so the final fallback can
      // RE-QUEUE the request (nothing is ever dropped without an answer).
      let reanalyzePrompt = ''
      // MONITOR GOL LA FIECARE COMANDĂ (Adrian, 4 iul): wipe the live execution
      // feed so this command starts clean and shows ONLY its own flow. History
      // is kept (Jurnal Claude) and the telemetry bars keep running.
      resetBrainActivity()
      if (bridgeOnline()) {
        // The conversation comes from the DATABASE, not from the page: the
        // visible chat can be empty (clean login, refresh, another device) but
        // the saved history never is — so the bridge brain ALWAYS knows what
        // was discussed, including "what did I ask 5 minutes ago". The current
        // turn's text is appended in case it isn't persisted yet.
        // 15 messages (was 30): half the prompt weight → visibly faster replies.
        // Istoricul + caietul comun pleacă ÎMPREUNĂ spre bază (nu pe rând) —
        // încă un rând de așteptare tăiat dinaintea primului cuvânt.
        const [dbRows, shared] = await Promise.all([
          getRecentHistory(config.adminEmail, 15),
          getSharedMemory(30),
        ])
        const past = dbRows.map(
          (m) => `${m.role === 'user' ? 'Adrian' : 'Kelion'}: ${m.content.slice(0, 1500)}`,
        )
        const lastLine = `Adrian: ${lastUserText}`
        if (past.length === 0 || !past[past.length - 1].includes(lastUserText.slice(0, 200))) {
          past.push(lastLine)
        }
        const convo = past.join('\n')
        // ── ONE context packet: everything vital reaches the Linux brain in a
        // single block — his LIVE GPS (lat/lon + city), his local time, and the
        // ready-made weather URL. No more guessing, no more Google→CAPTCHA.
        const bc = req.body?.coords
        let ctxBlock = ''
        if (bc && Number.isFinite(bc.lat) && Number.isFinite(bc.lon)) {
          // Din CACHE, sincron (ca pe calea publică): apelul extern de geocodare
          // nu mai ține primul cuvânt pe loc; numele locului se încălzește în
          // fundal și e gata la tura următoare — lat/lon (tot ce cer skill-urile)
          // se injectează oricum imediat.
          const place = reverseGeocodeCached(bc.lat, bc.lon)
          const windy = `https://embed.windy.com/embed2.html?lat=${bc.lat.toFixed(4)}&lon=${bc.lon.toFixed(4)}&zoom=9&type=map&location=coordinates&metricTemp=%C2%B0C`
          ctxBlock +=
            `LOCUL LUI ADRIAN ACUM (GPS live din aplicație): lat ${bc.lat.toFixed(5)}, lon ${bc.lon.toFixed(5)}` +
            (place ? ` — aproximativ ${place}` : '') +
            `. Când zice „aici", „la mine", „vremea afară" fără să numească un loc, ĂSTA e locul.\n` +
            `PENTRU VREME: pune pe monitor EXACT [SHOW ${windy} | Vremea la tine] — sursă reală, se afișează pe loc. NU căuta NICIODATĂ vremea pe Google (te blochează ca robot).\n`
        }
        const nowB = typeof req.body?.now === 'string' ? req.body.now : ''
        const tzB = typeof req.body?.tz === 'string' && req.body.tz ? req.body.tz : ''
        if (nowB && !Number.isNaN(Date.parse(nowB))) {
          try {
            ctxBlock += `ORA LOCALĂ A LUI ADRIAN: ${new Date(nowB).toLocaleString('ro-RO', { timeZone: tzB || 'UTC', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}${tzB ? ` (${tzB})` : ''}.\n`
          } catch {
            /* fus invalid — sar peste */
          }
        }
        if (ctxBlock) ctxBlock = `CONTEXTUL TĂU LIVE:\n${ctxBlock}\n`
        // Explicit language lock so the bridge answer is ALWAYS in the admin's
        // established language (the bridge bypasses the normal brain's guardian).
        const langLock = langName
          ? `RĂSPUNDE EXCLUSIV în ${langName} — fiecare cuvânt în ${langName}, indiferent de limba în care e scris acest context.\n\n`
          : ''
        // The Claude answering in chat gets the LIVE work journal, so he knows
        // exactly what laptop-Claude built today and what's in progress — no
        // more "the chat doesn't know what's happening here".
        const journal = recentDevLog(15)
        const journalBlock =
          journal.length > 0
            ? `JURNALUL LUCRULUI DE AZI (Claude pe laptop, live):\n${journal.join('\n')}\n\n`
            : ''
        // SHARED MEMORY ("caietul comun"): everything either Claude wrote — the
        // laptop builder and this server brain read the SAME notebook, so what
        // was learned/done in one place is known in the other. (Citit mai sus,
        // în paralel cu istoricul.)
        const sharedBlock =
          shared.length > 0
            ? 'MEMORIA COMUNĂ (caietul pe care-l împărțiți tu și Claude-constructorul de pe laptop):\n' +
              shared.map((m) => `- [${m.source || '?'}] ${m.content}`).join('\n') +
              '\n\n'
            : ''
        // THE DECISION SYSTEM: the bridge brain is Adrian's ONLY interlocutor
        // (his explicit order, 4 iul) — there is no hand-off to any other AI.
        const decision =
          'EȘTI CREIERUL INTELIGENT al lui Adrian — gândești, analizezi, decizi și ACȚIONEZI singur. NU ești dispecer și NU clasifici mesaje ca să le predai altcuiva. Ai acces total la server și la cod (unelte reale): inspectezi starea adevărată (rulezi comanda, nu ghici), repari, construiești, verifici — TU.\n' +
          'MODURI DE LUCRU (comută SINGUR, automat, după ce cere Adrian): (1) CHAT — doar conversație/întrebare: răspunde scurt și direct, NU deschide nicio cerință de execuție. (2) LUCRU — o cerință de execuție (repară/construiește/modifică): apucă-te, du-o la capăt, ține-o pe o singură cerință; NU redeschide și NU relua la infinit aceeași sarcină. (3) RAPORT — după ce ai terminat: raportează rezultatul cu dovada reală, apoi ÎNCHIDE (revii la CHAT). Dacă Adrian spune „stop/oprește/lasă/anulează", OPREȘTE lucrul pe loc și treci în CHAT — nu insista.\n' +
          'La fiecare mesaj: înțelege ce vrea Adrian, GÂNDEȘTE și FĂ. Dacă e o întrebare → răspunde din ce VEZI real în cod/sistem, nu din presupuneri. Dacă e ceva de analizat/reparat/construit → apucă-te cu uneltele tale, dus până la capăt, și raportează ce ai făcut cu dovada reală (ieșirea comenzii). Un job mare, de durată, îl POȚI da constructorului tău cu [EXECUT] dacă tu, ca inginer-șef, decizi așa — dar e alegerea ta, nu o regulă; nu preda ce poți face singur.\n' +
          'TON OBLIGATORIU (Adrian, 5 iul): profesional, precis, inteligență superioară — ca un inginer-șef. INTERZISE: umplutura emoțională („sunt aici", „respiră", „nu plec nicăieri", „stau lângă tine"), consolările, repetițiile. Scurt și la obiect, fiecare propoziție cu conținut. Fragmentele scurte repetate („Nu.", „Nu știu.") sunt aproape sigur zgomot de microfon: NU le răspunde cu umplutură — o singură replică minimă, tehnică, sau întreabă o dată ce a vrut să spună.\n' +
          'REGISTRU ACADEMIC (Adrian, 10 iul): vorbește ca un academician — vocabular îngrijit și precis, termenul corect și propriu pentru fiecare lucru, propoziții complete și gramaticale, termenii tehnici numiți exact. FĂRĂ argou, fără prescurtări colocviale, fără umplutură. Păstrezi rigoarea academică rămânând TOTUȘI concis — academic înseamnă precis și corect, niciodată lung sau pompos.\n\n' +
          'UNELTELE TALE (le comanzi direct, serverul le execută și taie eticheta din text):\n' +
          '- Afișezi ceva pe monitorul lui: [SHOW https://adresa | titlu scurt]. Pentru hartă https://embed.waze.com/iframe?zoom=12&lat=LAT&lon=LON, pentru alte site-uri adresa normală (se deschide în browserul live).\n' +
          '- Pui un clip pe YouTube: [YT ce vrei să pornească] (ex: [YT Coldplay Yellow live]). NU inventa NICIODATĂ un link/ID de YouTube — scrie doar ce vrei, serverul găsește clipul real și îl pornește pe monitor.\n' +
          '- Generezi o imagine pe monitor: [IMG descriere detaliată în engleză].\n' +
          '- Salvezi o notiță pentru Adrian: [NOTE textul notiței].\n' +
          '- Îi arăți notițele salvate: [NOTES] (le citește serverul, cu numărul lor). Ștergi una: [DELNOTE număr] (ex: [DELNOTE 12]).\n' +
          '- Îi spui cheltuielile reale: [COST] (serverul citește suma exactă din bază).\n' +
          '- Arăți o HARTĂ pe monitor: [MAP numele locului/adresei] (ex: [MAP Londra] sau [MAP Piața Unirii Cluj]).\n' +
          '- Parcurgi un site pagină cu pagină și-l treci în revistă pe monitor: [CRAWL https://adresa] (ex: [CRAWL https://exemplu.ro]).\n' +
          '- Afișezi TEXT pe monitor (un răspuns, o listă, un plan, un rezumat — orice nu e o pagină web): [DOC titlu scurt] pe prima linie; TOT ce scrii după aceea apare automat și pe monitorul lui ca document. Când Adrian zice „afișează pe monitor" / „pune pe ecran" / „arată-mi pe monitor" și nu cere o pagină web, folosește [DOC] — nu spune că nu poți.\n' +
          '- Cureți ecranul/monitorul: [CLEAR].\n' +
          '- FACI UN GEST cu corpul tău 3D: [GEST nume]. AI TOATĂ BIBLIOTECA Ready Player Me (Adrian: „să le aibă pe toate") — LOGICA FOLOSIRII, după ce arată FIECARE clip în realitate (verificat vizual pe preview-urile oficiale): salut/rămas-bun→expresie-1 (flutură mâna sus); arăți spre ceva→expresie-2 (arată cu degetul înainte); uimire cu mâna la față→expresie-3; negare/dezamăgire ușoară→expresie-4 (apleacă privirea); nedumerire „nu știu"→expresie-5 (brațe deschise, palme sus); victorie/reușită→expresie-6 (celebrare energică); mulțumire/respect→expresie-7 (plecăciune de domn); tresărire/surpriză→expresie-8; „stai puțin, calm"→expresie-9 (palmele ridicate); gânditor→expresie-10 (mâna spre bărbie); aprobare/bravo→expresie-11 (degete mari sus); entuziasm arătând în sus→expresie-12; acord discret→expresie-13; plecăciune teatrală→expresie-14. VARIAȚII DOMOALE de repaus (preferatele tale în conversație): variatie (înclină capul), variatie-2 (privire în jos), variatie-3 (își scutură brațele relaxat), variatie-4 (privește în jur), variatie-5 (se uită la mâini), variatie-6 (se uită ca la ceas), variatie-8 (mută greutatea); variatie-7/-9/-10 sunt dezmorțiri ample — DOAR când chiar se potrivesc, nu în discuții serioase. GESTURI DE CONVERSAȚIE (o dată, cât explici): vorbit-1 (calm), vorbit-2 (o mână), vorbit-3 (ambele mâini), vorbit-4 (animat), vorbit-5 (palme deschise a ofertă), vorbit-6 (privirea sus), vorbit-7 (foarte reținut), vorbit-8 (relaxat), vorbit-9 (deschis calm). DANSURI (DOAR dacă Adrian cere explicit; variază-le): dans (energic, pumnii sus), dans-2 (hip-hop), dans-3 (disco), dans-4 (brațele sus), dans-5 (cu picioare), dans-6 (ritmat), dans-7 (atletic), dans-8 (pași laterali), dans-9 (ridicări de picior), dans-10 (stilat). REGULA DE ȚINUTĂ (Adrian): ești un DOMN — alegi gestul după CONTEXT și SENTIMENT, potrivit cu ce arată clipul în realitate, cel mult UN gest pe replică; nu gesticula gratuit. La comanda lui directă execuți imediat cu eticheta.\n' +
          'ECHIPA TA de 7 agenți specialiști (rulează pe server, pe abonament). Deleagă un task greu/de domeniu cu [AGENT nume: sarcina completă], apoi spune scurt „întreb <agentul>":\n' +
          '  • researcher — căutare web, fapte reale, cifre, actualități\n' +
          '  • scribe — scris, redactare, rezumat, traducere\n' +
          '  • navigator — locuri, rute, distanțe, trafic\n' +
          '  • studio — concepte vizuale, logo-uri (imaginea reală o pui tu cu [IMG])\n' +
          '  • developer — scrie software și îl rulează\n' +
          '  • tester — testează cod și dă verdict PASS/FAIL\n' +
          '  • secretary — redactează emailuri/mesaje (accesul la Gmail-ul real cere contul conectat)\n' +
          'Când Adrian cere ceva din aceste domenii (mai ales căutare/informații actuale, scris serios, cod), FOLOSEȘTE [AGENT …] — nu inventa răspunsul.\n' +
          'REGULĂ DE FORMĂ (streaming): TOATE etichetele ([EXECUT],[SHOW],[YT],[IMG],[NOTE],[NOTES],[DELNOTE],[COST],[MAP],[DOC],[CLEAR],[GEST],[AGENT …]) stau pe PRIMA LINIE; de la a doua linie textul vorbit — scurt, fără markdown. NU inventa și NU pretinde că ai făcut ceva fără etichetă.\n\n'
        // ANY attachment rides the bridge to Claude: photos, texts, archives,
        // video (voice arrives already transcribed as text). Base64 payloads —
        // the budget is the WHOLE pipe: just under the Cloudflare 100MB cap.
        const files: BridgeFile[] = []
        let budget = 95_000_000 // ~70MB decoded — maximul fizic al țevii
        const addFile = (name: string, type: string, raw: string): void => {
          const data = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
          if (!data || data.length > budget) return
          budget -= data.length
          files.push({ name: name.slice(0, 120), type: type.slice(0, 80), data })
        }
        for (const f of req.body?.files ?? []) {
          if (typeof f?.data === 'string') {
            addFile(f.name || 'fisier', f.type || 'application/octet-stream', f.data)
          }
        }
        if (files.length === 0) {
          // Fără atașamente: cadrele camerei (toate 4, vederea continuă) sau,
          // pe clienți vechi, cadrul singular.
          if (camFrames.length > 0) camFrames.forEach((d, i) => addFile(`cadru-${i + 1}.jpg`, 'image/jpeg', d))
          else if (image) addFile('captura.jpg', 'image/jpeg', image)
        }
        // TOTAL ACCESS: everything the admin drops in chat (photos, pasted
        // screenshots, archives, video) is stashed for laptop-Claude too, so
        // the builder sees exactly what the voice saw.
        if (files.length > 0) stashAdminFiles(files)
        // ── STREAMING (viteza sunetului): chunks flow straight to the client;
        // Kelion writes AND speaks from the first sentence (~2s), while the
        // Linux decision engine may auto-escalate hard questions to Fable.
        // TOOL TAGS live on the FIRST LINE of the reply (the brain is told so):
        // once the first newline arrives, tags are executed and the rest of the
        // stream is released verbatim.
        const bridgeBase = `https://${req.headers.host ?? 'kelionai.app'}`
        let streamed = ''
        let head = ''
        let headDone = false
        // [DOC titlu] pe prima linie = „afișează pe monitor": la finalul
        // stream-ului, întregul text rostit e trimis și ca document pe monitor.
        let docTitle: string | null = null
        let execOrderId: string | undefined
        const pendingTags: Promise<void>[] = []
        const emit = (t: string): void => {
          if (!t) return
          reply.raw.write(t)
          streamed += t
          voice.feed(t) // fraza completă pleacă la sinteză cât textul încă curge
        }
        // ── LEGEA 200 (Adrian, 5 iul): ORICE operațiune se certifică — succes
        // real („200") sau pleacă AUTOMAT la reparat. Fără eșec tăcut, fără
        // .catch gol care înghite defectul.
        const certify = (op: string, fn: () => Promise<true | string>): void => {
          pendingTags.push(
            (async () => {
              let verdict: true | string
              try {
                verdict = await fn()
              } catch (e) {
                verdict = e instanceof Error ? e.message.slice(0, 140) : 'excepție'
              }
              if (verdict === true) {
                noteBrainActivity(`🟢 200 — ${op}`)
              } else {
                noteBrainActivity(`🔴 fără 200 — ${op} → trimis automat la reparat`)
                bridgeRepair(
                  `LEGEA 200 (auto): operațiunea „${op}" a eșuat: ${verdict}. Găsește cauza reală și repar-o.`,
                  { autonomous: true },
                )
              }
            })(),
          )
        }
        // SARCINA REALĂ, nu „da" (Adrian, 5 iul — bug de dispecerizare): când
        // Adrian aprobă cu „da"/„ok", `lastUserText` e doar aprobarea, nu munca.
        // Trimițând „da" la constructor, ăsta nu știe ce să facă (a plecat pe
        // timezone aiurea). Regula: dacă mesajul e o simplă afirmație, dispecerul
        // trimite CONTEXTUL (ultimele replici = propunerea creierului + „da"-ul),
        // ca să înțeleagă ce s-a cerut de fapt.
        const bareAffirm = /^\s*(ok(ay)?|da|d[aă]|hai|bun|gata|merge|f[aă]|fa|continu[aă]|continua|preia|trimite|public[aă]?)[\s.!]*$/i
        // „Reia"/„termină"-style (5 iul, ordinul „reia terminat cu această
        // comandă."): un mesaj scurt făcut DOAR din verbe de reluare + umplutură
        // referă sarcina anterioară, nu descrie una nouă. Trimis verbatim,
        // constructorul primește un fragment gol și nu are ce executa — deci și
        // el primește CONTEXTUL, ca la „da". „Termină implementarea X" NU intră
        // aici (are conținut propriu) — doar fragmentele fără substanță.
        const resumeVerb = /^(reia|relu[aă]m|termin[aă]|terminat[aă]?|finalizeaz[aă]|încheie|incheie|(re)?încearc[aă]|(re)?incearc[aă])$/i
        const resumeFiller =
          /^(din|nou|cu|aceast[aă]|asta|acest|comanda|comand[aă]|sarcina|sarcin[aă]|ordinul|treaba|lucrarea|te|rog|acum|iar|tot|o|ce|ai|unde|r[aă]mas|de|la|cap[aă]t|ultima|imediat|[șs]i)$/i
        const resumeRef = (t: string): boolean => {
          const words = t.split(/[\s.,!?"„”–-]+/).filter(Boolean)
          if (words.length === 0 || !resumeVerb.test(words[0])) return false
          return words.every((w) => resumeVerb.test(w) || resumeFiller.test(w))
        }
        const refersToContext = bareAffirm.test(lastUserText.trim()) || resumeRef(lastUserText.trim())
        const dispatchTask = refersToContext
          ? `SARCINA (mesajul lui Adrian „${lastUserText.trim()}" doar aprobă sau cere reluarea; ce a cerut de fapt e în conversația de mai jos — fă exact ce reiese din ea, nu răspunde la fragment):\n${past.slice(-8).join('\n')}`
          : lastUserText
        const runTags = (line: string): string => {
          // BUG REPARAT (11 iul, dovada: ordinul „identificare vorbitor" al lui
          // Adrian n-a ajuns NICIODATĂ în registru): Kelion scrie eticheta CU
          // conținut — „[EXECUT Sistem de identificare…]" — dar regexul vechi
          // cerea exact „[EXECUT]" gol, deci dispatch-ul tăcea. Acum ambele
          // forme sunt valide, iar conținutul etichetei (formularea completă a
          // lui Kelion) devine textul ordinului — mai fidel decât mesajul brut.
          const execTag = /\[EXECUT\b([^\]]*)\]/i.exec(line)
          if (execTag) {
            const spec = execTag[1].trim()
            execOrderId =
              bridgeRepair(
                spec.length > 10
                  ? `${spec}\n\n(Contextul cererii lui Adrian: „${dispatchTask.slice(0, 400)}")`
                  : dispatchTask,
              ) ?? undefined
          }
          const showTag = /\[SHOW\s+(\S+?)(?:\s*\|\s*([^\]]*))?\]/i.exec(line)
          const imgTag = /\[IMG\s+([^\]]+)\]/i.exec(line)
          const noteTag = /\[NOTE\s+([^\]]+)\]/i.exec(line)
          const mapTag = /\[MAP\s+([^\]]+)\]/i.exec(line)
          const crawlTag = /\[CRAWL\s+(\S+)\]/i.exec(line)
          // GEST LA COMANDĂ (Adrian, 11 iul: „mișcări comandate la tot ce vreau
          // să facă"): [GEST nume] → cadrul {gest} → regia de mișcare din
          // avatar execută clipul o dată și revine singură la repaus.
          const gestTag = /\[GEST\s+([a-z0-9-]+)\s*\]/i.exec(line)
          if (gestTag) {
            reply.raw.write(`${CTRL}${JSON.stringify({ gest: gestTag[1].toLowerCase() })}${CTRL}`)
          }
          if (noteTag) {
            noteBrainActivity(`Salvez notița: ${noteTag[1].trim().slice(0, 80)}`)
            certify('salvez notița', async () => {
              await saveNote(user.email, noteTag[1].trim())
              return true
            })
          }
          // [CRAWL url] (cererea #24): parcurge un site pagină cu pagină și pune
          // rezumatul fiecărei pagini pe monitor, ca document citibil.
          if (crawlTag) {
            const site = crawlTag[1].trim()
            noteBrainActivity(`Parcurg site-ul: ${site}`)
            certify(`parcurg ${site}`, async () => {
              const r = await crawlSite(user.email, bridgeBase, site, 8)
              if (r.error || r.pages.length === 0) {
                emit(`\nN-am putut parcurge ${site} (${r.error || 'fără pagini'}).`)
                return r.error || 'fără pagini'
              }
              const doc = r.pages
                .map((p, i) => `${i + 1}. ${p.title || p.url}\n   ${p.url}\n   ${p.text.slice(0, 400)}`)
                .join('\n\n')
              reply.raw.write(
                `${CTRL}${JSON.stringify({ doc: { title: `Site parcurs: ${site} (${r.pages.length} pagini)`, text: doc } })}${CTRL}`,
              )
              return true
            })
          }
          if (mapTag) {
            const place = mapTag[1].trim()
            noteBrainActivity(`Afișez harta: ${place}`)
            certify(`afișez harta ${place}`, async () => {
              let url = config.googleMapsKey
                ? `https://www.google.com/maps/embed/v1/place?key=${config.googleMapsKey}&q=${encodeURIComponent(place)}`
                : ''
              if (!url) {
                // No Maps key: geocode the place name → coords (free Nominatim),
                // then show a Waze live map (embeddable, no key needed).
                try {
                  const g = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`,
                    { headers: { 'User-Agent': 'Kelionai/1.0 (contact@kelionai.app)' }, signal: AbortSignal.timeout(8000) },
                  )
                  const arr = (await g.json()) as { lat?: string; lon?: string }[]
                  const lat = arr[0]?.lat
                  const lon = arr[0]?.lon
                  url = lat && lon
                    ? `https://embed.waze.com/iframe?zoom=12&lat=${lat}&lon=${lon}`
                    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(place)}`
                } catch {
                  url = `https://www.openstreetmap.org/search?query=${encodeURIComponent(place)}`
                }
              }
              reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title: place } })}${CTRL}`)
              return true
            })
          }
          // [YT query] — the brain never guesses a video ID (it hallucinates and
          // the embed fails). It names what to play; the server resolves a REAL,
          // currently-available video (Serper → Gemini) and shows the embed.
          const ytTag = /\[YT\s+([^\]]+)\]/i.exec(line)
          if (ytTag) {
            const q = ytTag[1].trim()
            noteBrainActivity(`Caut pe YouTube: ${q}`)
            certify(`pornesc clip YouTube: ${q.slice(0, 50)}`, async () => {
              const v = await youtubeFirstEmbed(q)
              if (v) {
                reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: v.embed, title: v.title || q } })}${CTRL}`)
                return true
              }
              emit(`\nN-am găsit un clip care să pornească pentru „${q}".`)
              return 'niciun clip găsit/pornit'
            })
          }
          // [COST] — real spend, read from the cost_events table (not invented).
          if (/\[COST\]/i.test(line)) {
            noteBrainActivity('Adun cheltuielile')
            certify('citesc cheltuielile reale', async () => {
              const c = await getCostSummary()
              const kinds = Object.entries(c.byKind)
                .map(([k, v]) => `${k} $${v.toFixed(2)}`)
                .join(', ')
              emit(
                `\nCheltuieli: total $${c.total.toFixed(2)}, azi $${c.today.toFixed(2)}${kinds ? ` (${kinds})` : ''}.`,
              )
              return true
            })
          }
          // [NOTES] — read back the saved notes (real rows, with their ids so he
          // can delete by number).
          if (/\[NOTES\]/i.test(line)) {
            noteBrainActivity('Îți citesc notițele')
            certify('citesc notițele', async () => {
              const notes = await listNotes(user.email, 20)
              if (notes.length === 0) {
                emit('\nNu ai nicio notiță salvată.')
                return true
              }
              const list = notes
                .map((n) => `#${n.id} ${n.title ? n.title + ': ' : ''}${n.content.slice(0, 90)}`)
                .join('\n')
              emit(`\nNotițele tale:\n${list}`)
              return true
            })
          }
          // [DELNOTE id] — delete one of his own notes by id.
          const delTag = /\[DELNOTE\s+(\d+)\]/i.exec(line)
          if (delTag) {
            const id = Number(delTag[1])
            noteBrainActivity(`Șterg notița #${id}`)
            certify(`șterg notița #${id}`, async () => {
              const ok = await deleteNote(user.email, id)
              emit(ok ? `\nAm șters notița #${id}.` : `\nN-am găsit notița #${id} la tine.`)
              return true // notiță inexistentă = răspuns corect, nu defect de reparat
            })
          }
          if (/\[CLEAR\]/i.test(line)) {
            reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: '', title: '' } })}${CTRL}`)
            noteBrainActivity('Am curățat monitorul')
          }
          // [DOC titlu] — textul răspunsului (de la a doua linie) merge și pe
          // monitor ca document; cadrul se trimite la final, cu textul complet.
          const docTag = /\[DOC(?:\s+([^\]]*))?\]/i.exec(line)
          if (docTag) {
            docTitle = (docTag[1] ?? '').trim()
            noteBrainActivity(`Afișez pe monitor: ${docTitle || 'răspunsul'}`)
          }
          if (showTag) {
            const url = showTag[1]
            const title = (showTag[2] ?? '').trim()
            noteBrainActivity(`Afișez pe monitor: ${title || url}`)
            certify(`afișez pe monitor: ${(title || url).slice(0, 50)}`, async () => {
              if (iframeSafe(url)) {
                reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title } })}${CTRL}`)
                return true
              }
              const live = await browserOpen(user.email, bridgeBase, url)
              if ('error' in live) {
                // Cădere pe iframe direct — poate randa totuși; e drum proiectat,
                // dar fără browser live NU e 200 → pleacă și la reparat.
                reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title } })}${CTRL}`)
                return `browserul live a eșuat (${live.error}); am căzut pe iframe direct`
              }
              browserToolResult(reply, live)
              return true
            })
          }
          if (imgTag) {
            noteBrainActivity(`Generez o imagine: ${imgTag[1].trim().slice(0, 70)}`)
            certify('generez imaginea', async () => {
              const result = await generateImage(imgTag[1].trim())
              if ('error' in result) return `generatorul a răspuns: ${JSON.stringify(result)}`.slice(0, 140)
              const url = `${bridgeBase}/api/image/${result.id}`
              reply.raw.write(
                `${CTRL}${JSON.stringify({ monitor: { url, title: imgTag[1].slice(0, 60) }, image: { url } })}${CTRL}`,
              )
              return true
            })
          }
          return line
            .replace(/\[EXECUT\b[^\]]*\]/gi, '')
            .replace(/\[SKILL\]/gi, '')
            .replace(/\[SHOW[^\]]*\]/gi, '')
            .replace(/\[IMG[^\]]*\]/gi, '')
            .replace(/\[NOTE[^\]]*\]/gi, '')
            .replace(/\[MAP[^\]]*\]/gi, '')
            .replace(/\[CRAWL[^\]]*\]/gi, '')
            .replace(/\[DOC[^\]]*\]/gi, '')
            .replace(/\[YT[^\]]*\]/gi, '')
            .replace(/\[COST\]/gi, '')
            .replace(/\[NOTES\]/gi, '')
            .replace(/\[DELNOTE[^\]]*\]/gi, '')
            .replace(/\[CLEAR\]/gi, '')
            .replace(/\[GEST[^\]]*\]/gi, '') // gestul pleacă drept cadru {gest}, nu text
            .replace(/\[AGENT[^\]]*\]/gi, '') // agent tag: executed on Linux (subscription)
            .replace(/[ \t]{2,}/g, ' ')
            .trim()
        }
        const deliver = (text: string): void => {
          headDone = true
          const nl = text.indexOf('\n')
          const first = nl === -1 ? text : text.slice(0, nl)
          const rest = nl === -1 ? '' : text.slice(nl + 1).trim()
          const spoken = runTags(first)
          emit(spoken && rest ? `${spoken}\n${rest}` : spoken || rest)
        }
        const releaseHead = (force: boolean): void => {
          if (headDone) return
          const s = head.trimStart()
          // Tool tags ALWAYS start with '[' on the first line. If the reply
          // doesn't start with '[', there are NO tags → stream from the very
          // first character (the common case, ~2s to first word). Only a
          // tag-carrying reply waits for the first newline (line 1 = tags).
          if (s && !s.startsWith('[')) {
            deliver(head)
            head = ''
            return
          }
          const nl = head.indexOf('\n')
          if (nl !== -1 || head.length > 400 || force) {
            deliver(head)
            head = ''
          }
        }
        // Monitor shows the brain is on it the instant Adrian sends (his rule:
        // never the raw message text — just that the brain is answering).
        noteBrainActivity('Creierul de pe Linux răspunde la mesajul tău…')
        setProgress(30, 'Creierul analizează')
        // Detaliul din spatele barei: pe monitor rămâne doar statusul, dar la
        // CLICK pe „Creierul analizează" Adrian vede exact CE cerere e în lucru.
        // GARDĂ (Adrian, 5 iul): fragmentele scurte („Nu.", „da", „ok") NU
        // suprascriu cererea reală aflată în analiză — zgomotul de microfon
        // făcea detaliul să arate „Nu." în loc de cererea adevărată.
        if (normNoise(cleanUserText).split(' ').filter(Boolean).length >= 3)
          setAnalysisDetail(cleanUserText)
        let firstWord = false
        // NICIO CERERE FĂRĂ RĂSPUNS (Adrian, 4 iul): if 30s pass with TOTAL
        // silence, re-analyze — a fresh job hits a fresh worker poll (or the
        // watchdog-restarted worker), up to 4 times. A request is never left to
        // rot for 4 minutes and never ends without a clear answer. Once a single
        // word has streamed we stop retrying (a slow-but-flowing reply is fine).
        let answer: string | null = null
        const onChunk = (chunk: string): void => {
          // '' = puls de viață (creierul gândește) — armează doar ceasurile de
          // stall în bridgeAskStream; nu e text de difuzat.
          if (!chunk) return
          if (!firstWord) {
            firstWord = true
            markFirstWord() // primul cuvânt real → măsurăm viteza creierului
            setProgress(65, 'Compun răspunsul')
          }
          if (headDone) emit(chunk)
          else {
            head += chunk
            releaseHead(false)
          }
        }
        // MEMORIE PE PUNTE (Adrian, 8 iul — regula lui): dacă răspunsul nu e în
        // memoria scurtă, Kelion caută în tot ce știe; găsit → răspunde direct;
        // negăsit → întreabă-l și ține minte. `memRecall` (DB pur) poartă exact
        // asta; îl dăm și la începutul sesiunii, și în fiecare tură (mai jos).
        const memBlock = memRecall.trim()
          ? `\nMEMORIE DESPRE ADRIAN (ce știi deja despre el — când te întreabă ceva de aici, RĂSPUNDE DIRECT cu faptul; dacă NU găsești nicăieri, întreabă-l și ține minte răspunsul):\n${memRecall.trim().slice(0, 2500)}\n`
          : ''
        const bridgePrompt = decision + ctxBlock + sharedBlock + memBlock + langLock + journalBlock + convo
        // PACHET TURĂ SUBȚIRE (Adrian, 10 iul: „chat live gândit; dacă e nevoie
        // de ceva, DOAR atunci se caută în istoric"). Sesiunea caldă din worker e
        // DEJA amorsată cu TOT contextul (bridgePrompt) la începutul sesiunii, deci
        // per tură trimitem DOAR mesajul nou + blocarea de limbă + (dacă scanarea
        // a găsit ceva relevant) memoria — adică fix „căutarea la nevoie" în
        // istoric. Contextul/jurnalul/caietul NU se mai reîncarcă la fiecare tură:
        // exact asta ținea primul cuvânt în așteptare. Așa tura caldă e minusculă
        // → primul cuvânt sub 1s. (memBlock = scanare DB pură, fără cost de model.)
        const turnPacket =
          (memBlock ? `${memBlock}\n` : '') +
          `${langLock}\nMESAJ NOU de la Adrian: ${cleanUserText || lastUserText}`
        reanalyzePrompt = bridgePrompt
        // O SINGURĂ tură, ZERO reîncercări (Adrian, 10 iul: „dacă la tura 1 nu
        // întoarce răspuns, nu pleacă încă o tură — revine în chat, pentru
        // clarificări"). Dacă prima tură tace, NU relansăm nimic; mai jos Kelion
        // se întoarce în chat și cere lămuriri. Fereastra primului cuvânt e
        // generoasă (75s) tocmai ca să nu tăiem un raționament care chiar lucrează.
        const maxTries = 1
        for (let attempt = 1; attempt <= maxTries; attempt++) {
          // Fereastra primului cuvânt = 75s, nu 30s (Adrian, 9 iul: „legătura
          // ruptă" pe mesajul curent). Calea de RAȚIONAMENT AVANSAT durează
          // legitim 60–80s fără să scoată vreun cuvânt; la 30s serverul declara
          // fals „punte înțepenită", spunea „mi s-a rupt legătura" și reanaliza —
          // deși creierul CHIAR răspundea (revenea la ~48s). Pulsul de viață tot
          // resetează ceasul cât timp workerul îl trimite; 75s e doar plasa când
          // nu-l trimite (ex. worker care nu pulsează în timpul gândirii).
          answer = await bridgeAskStream(bridgePrompt, files, onChunk, 240_000, 75_000, turnPacket)
          if (answer === BRIDGE_STALL && !headDone && !streamed.trim()) {
            head = ''
            if (attempt < maxTries) {
              noteBrainActivity('⏳ Creierul încă gândește — mai aștept o dată, în liniște')
              continue
            }
          }
          break
        }
        if (answer === BRIDGE_STALL) answer = null
        // Finalisation: a non-streaming worker (or a short reply that never hit
        // a newline) lands here with everything still buffered.
        if (!headDone) {
          const whole = (answer && answer.trim()) || head
          if (whole.trim()) {
            // GARDĂ (Adrian, 9 iul): un worker care a renunțat trimite fals „mi s-a
            // rupt legătura cu creierul… mai trimite-l o dată". NU i-l mai arătăm —
            // îl tratăm ca stall: `answer` devine gol, deci calea de mai jos
            // re-cozează cererea și răspunde EL, fără să-i ceară retrimiterea.
            const norm = whole.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            if (/rupt.{0,15}legatura|mai trimite|trimite-l.{0,20}o data/.test(norm)) {
              answer = null
              head = ''
            } else {
              deliver(whole)
            }
          }
        }
        // Drain side-effect tags FIRST — [COST]/[NOTES]/[DELNOTE]/[YT] emit their
        // real (spoken) result here, so capture `a` AFTER they've run or the
        // saved reply would miss the numbers/list.
        await Promise.all(pendingTags)
        a = streamed.trim()
        // [DOC] cerut pe prima linie → „afișează pe monitor": răspunsul complet
        // apare și pe monitor ca document (frontend: openWorkspaceDoc), nu doar
        // în chat. Ordinul lui Adrian (4 iul): „afișează pe monitor".
        if (docTitle !== null && a) {
          reply.raw.write(
            `${CTRL}${JSON.stringify({ doc: { title: docTitle || 'Pe monitor', text: a.slice(0, 9000) } })}${CTRL}`,
          )
        }
        if (/\[EXECUT\b[^\]]*\]/i.test(answer ?? '')) {
          // Handed to the builder — the process bar continues from the builder
          // (agent → files → build → deploy → live), so don't jump to 100 here.
          setProgress(15, 'Trimis la constructor')
          // CHAT CU CERINȚĂ DE LUCRU: stampilăm timpii dispatch-ului (tip „lucru")
          // — Adrian vede cât a durat până s-a predat la execuție.
          finishBrainTurn('lucru')
          // SUPERVIZOR: cerința devine DEȚINUTĂ — rămâne deschisă până la
          // verificare live, nu se închide la „trimis" (Adrian, 5 iul). Numele
          // cerinței = mesajul real, dar dacă a fost doar „da", ia prima linie
          // cu sens din context (nu afișa „da" ca titlu de cerință).
          const ownedTitle = refersToContext
            ? (past.slice(-2, -1)[0]?.replace(/^Kelion:\s*/, '').slice(0, 100) || lastUserText)
            : lastUserText
          // Sarcina COMPLETĂ (cu contextul, dacă mesajul doar referă contextul)
          // se ține pe cerință: la re-asignare, supervizorul trimite agentului
          // proaspăt sarcina reală, nu fragmentul-titlu („reia terminat cu…").
          openRequirement(ownedTitle, dispatchTask, execOrderId)
          updateRequirement('trimisă la constructor')
          if (!a) {
            a = 'Mă ocup — am trimis la execuție. Urmărește progresul pe monitor.'
            emit(a)
          }
        } else {
          // CHAT SIMPLU: proces COMPLET — bara ajunge la 100, stampilăm timpii
          // (tip „chat") și apoi se stinge singură (nu rămâne agățată = fals lucru).
          finishBrainTurn('chat')
        }
      }
      if (!a) {
        // Închide cronometrul turei și pe calea asta (punte căzută → blocul de
        // streaming a fost sărit): fără asta, bara ar rămâne agățată la „Preluare"
        // (turnActive niciodată închis). Idempotent — no-op dacă deja s-a închis.
        finishBrainTurn('chat')
        // NU MAI BUCLEZ (Adrian, 10 iul: „dacă la tura 1 nu întoarce răspuns, nu
        // pleacă încă o tură — revine în chat, pentru clarificări"). Prima tură a
        // tăcut → NU relansez nimic în fundal; mă întorc în chat și cer lămuriri.
        const ro = !langName || /rom/i.test(langName)
        a = bridgeOnline()
          ? ro
            ? 'Nu am scos un răspuns din prima și NU mai reîncerc singur — spune-mi mai clar sau reformulează scurt ce vrei și mă apuc imediat.'
            : "I didn't get a result on the first pass and I won't loop on my own — tell me more clearly or rephrase what you need and I'll get on it."
          : ro
            ? 'Puntea către creier e căzută chiar acum (se repornește singură în câteva secunde). Reia mesajul imediat ce revine — nu bucleez singur.'
            : 'The bridge to the brain is down right now (it restarts itself within seconds). Resend the moment it is back — I will not loop on my own.'
        reply.raw.write(a)
      }
      // Vocea a curs DEJA în timpul stream-ului (voice.feed în emit) — aici doar
      // golim coada de sinteză; mesajele scrise direct (punte jos / fără răspuns)
      // n-au trecut prin emit, deci intră acum.
      if (!voice.fed() && a) voice.feed(a)
      await voice.finish()
      reply.raw.end()
      void saveMessage(user.email, 'assistant', a)
      // MEMORIE PE CALEA PUNȚII (Adrian, 8 iul): distil+save și pe punte,
      // fire-and-forget (nu adaugă latență răspunsului).
      if (lastUserText.trim() || a.trim()) void learnFromTurn(user.email, lastUserText, a)
      return
    }

    // ── RUTAREA CREIERELOR (decizia lui Adrian, 10 iul) ─────────────────────
    // „Eu și demo userii de la început (cele 10 minute) pe abonamentul mare, și
    // după — pe abonamentele lor cu credite cumpărate." Adică: ADMIN (mai sus)
    // + DEMO/gratuiți răspund prin PUNTE (abonament, persona:'public', fără
    // contextul privat al proprietarului); clienții LOGAȚI care plătesc singuri
    // — credit cumpărat (paywall-ul de mai sus a garantat credit > 0) sau cheia
    // lor Anthropic — merg pe drumul DIRECT prin API de mai jos: instant, cu
    // toate uneltele, debitat din creditele lor (debitWallet la finalul turei).
    // Fără Stripe configurat (aplicație liberă) totul rămâne pe abonament.
    // KELION_API_CHAT=1 pe Railway forțează pe API tot ce nu e admin (urgență).
    const paysOwnWay = !!userAnthropicKey || (!!config.stripe.secretKey && user.role !== 'demo')
    if (!process.env.KELION_API_CHAT && !paysOwnWay) {
      const roPub = userLang.toLowerCase().startsWith('ro')
      // SPEC FREE/DEMO (Adrian, 10 iul): „fără istoric, chat live în orice
      // limbă 3 minute, cameră DA, nimic-admin". Demo = anonim și curat: fără
      // memorie injectată, fără învățare, fără salvare în istoric. Camera DA:
      // cadrul camerei pleacă la creier ca fișier de job (persoana publică).
      const isDemo = user.role === 'demo'
      // Bargraf la intrarea în creier — și pe calea publică (vezi calea admin).
      reply.raw.write(`${CTRL}${JSON.stringify({ heard: lastUserText.slice(0, 500) })}${CTRL}`)
      // Vocea din prima frază și pentru public (vezi createVoiceStream).
      const voice = createVoiceStream(reply, userLang)
      if (!bridgeOnline()) {
        // Puntea e jos → mesaj cinstit, scurt. NU cădem pe cheia API (ordinul).
        const msg = roPub
          ? 'Creierul meu se repornește chiar acum — durează câteva secunde. Te rog trimite mesajul încă o dată imediat.'
          : 'My brain is restarting right now — it takes a few seconds. Please resend your message in a moment.'
        reply.raw.write(msg)
        voice.feed(msg)
        await voice.finish()
        reply.raw.end()
        if (!isDemo) void saveMessage(user.email, 'assistant', msg)
        return
      }
      // Conversația recentă (deja igienizată + plafonată mai sus) + limba +
      // memoria relevantă (scanare DB pură) — pachet subțire, răspuns rapid.
      const past = messages
        .slice(-16)
        .map((m) => `${m.role === 'user' ? 'User' : 'Kelion'}: ${m.content.slice(0, 1200)}`)
        .join('\n')
      // Blocare ABSOLUTĂ de limbă doar când limba e STABILITĂ (preferință de
      // vorbire salvată). Altfel (vizitator nou cu locale implicit 'en' care
      // scrie română) — adaptiv: răspunde în limba în care scrie utilizatorul.
      const langLine =
        speechPref && langName
          ? `Reply EXCLUSIVELY in ${langName} — every sentence, regardless of the language of anything quoted below.`
          : 'Reply in the language the user writes in (default to English for short or ambiguous messages).'
      // GPS-ul vizitatorului (dacă l-a acordat) — pentru hărți/vreme „lângă mine".
      const pubCoords =
        coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)
          ? `Visitor GPS: lat ${coords.lat.toFixed(5)}, lon ${coords.lon.toFixed(5)} — use it for "near me", weather and maps.\n`
          : ''
      const pubPrompt =
        `${langLine}\n` +
        // MOD ACADEMIC (Adrian, 10 iul) — și pentru vizitatori/clienți.
        'ACADEMIC REGISTER: speak like an educated professional — precise, well-formed wording, the correct proper term for things, complete grammatical sentences, technical terms named accurately. No slang, no colloquial shortcuts, no filler — yet stay concise.\n' +
        pubCoords +
        // Demo = FĂRĂ memorie/istoric injectat (anonim); doar clienții logați
        // primesc memoria lor relevantă.
        (!isDemo && memRecall.trim() ? `${memRecall.trim().slice(0, 1500)}\n\n` : '') +
        `Conversation so far:\n${past}\n\nAnswer the user's LAST message now.`
      // ── ETICHETE SIGURE PE CALEA PUBLICĂ (Adrian, 10 iul: „free cu toate
      // atributele active") ── aceleași etichete ca la admin, dar DOAR cele care
      // nu cer contul Google al cuiva: [MAP loc], [YT clip], [SHOW doar
      // embed-uri sigure de vreme/trafic], [IMG descriere]. Se execută de pe
      // prima linie a răspunsului (protocolul punții) și se curăță din text.
      const SAFE_SHOW = /^https:\/\/(embed\.waze\.com|embed\.windy\.com)\//i
      const stripPubTags = (s: string): string =>
        s
          .replace(/\[(?:MAP|YT|SHOW|IMG)[^\]]*\]/gi, '')
          .replace(/[ \t]{2,}/g, ' ')
          .trim()
      const runPublicTags = (line: string): string => {
        const mapTag = /\[MAP\s+([^\]]+)\]/i.exec(line)
        if (mapTag) {
          const place = mapTag[1].trim()
          void (async () => {
            let url = config.googleMapsKey
              ? `https://www.google.com/maps/embed/v1/place?key=${config.googleMapsKey}&q=${encodeURIComponent(place)}`
              : ''
            if (!url) {
              try {
                const g = await fetch(
                  `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`,
                  { headers: { 'User-Agent': 'Kelionai/1.0 (contact@kelionai.app)' }, signal: AbortSignal.timeout(8000) },
                )
                const arr = (await g.json()) as { lat?: string; lon?: string }[]
                url =
                  arr[0]?.lat && arr[0]?.lon
                    ? `https://embed.waze.com/iframe?zoom=12&lat=${arr[0].lat}&lon=${arr[0].lon}`
                    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(place)}`
              } catch {
                url = `https://www.openstreetmap.org/search?query=${encodeURIComponent(place)}`
              }
            }
            reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title: place } })}${CTRL}`)
          })()
        }
        const ytTag = /\[YT\s+([^\]]+)\]/i.exec(line)
        if (ytTag) {
          const q = ytTag[1].trim()
          void youtubeFirstEmbed(q).then((v) => {
            if (v)
              reply.raw.write(
                `${CTRL}${JSON.stringify({ monitor: { url: v.embed, title: v.title || q } })}${CTRL}`,
              )
          })
        }
        const showTag = /\[SHOW\s+(\S+?)(?:\s*\|\s*([^\]]*))?\]/i.exec(line)
        if (showTag && SAFE_SHOW.test(showTag[1]))
          reply.raw.write(
            `${CTRL}${JSON.stringify({ monitor: { url: showTag[1], title: (showTag[2] || 'Live').slice(0, 60) } })}${CTRL}`,
          )
        const imgTag = /\[IMG\s+([^\]]+)\]/i.exec(line)
        if (imgTag) {
          void generateImage(imgTag[1].trim()).then((result) => {
            if (!('error' in result)) {
              const url = `${baseUrlPub}/api/image/${result.id}`
              reply.raw.write(
                `${CTRL}${JSON.stringify({ monitor: { url, title: imgTag[1].slice(0, 60) }, image: { url } })}${CTRL}`,
              )
            }
          })
        }
        return stripPubTags(line)
      }
      const baseUrlPub = `https://${req.headers.host ?? 'kelionai.app'}`
      // CAMERA în free/public: dacă utilizatorul întreabă ceva ce cere văzul și
      // avem cadre, le trimitem ca fișiere de job — workerul le privește cu
      // Read în cutia publică (izolată de a adminului). VEDEREA CONTINUĂ
      // (Adrian, 11 iul, regula nr. 9 — toți userii la fel): ultimele 4 cadre
      // când clientul le trimite, nu doar unul înghețat.
      const pubCam = camFrames.length > 0 ? camFrames : image ? [image] : []
      const pubFiles: BridgeFile[] = imageIsAttachment
        ? image
          ? [{ name: 'atasament.jpg', type: 'image/jpeg', data: image }]
          : []
        : pubCam.length > 0 && VISION_INTENT.test(lastUserText)
          ? pubCam.map((d, i) => ({ name: `cadru-${i + 1}.jpg`, type: 'image/jpeg', data: d }))
          : []
      let acc = '' // TOT ce a produs creierul (cu etichete cu tot)
      let shownAny = false
      let headBuf = ''
      let headDone = false
      const showPub = (t: string): void => {
        if (!t) return
        shownAny = true
        reply.raw.write(t)
        voice.feed(t) // fraza completă pleacă la sinteză cât textul încă curge
      }
      // Prima linie poate purta etichete ([MAP]/[YT]/[SHOW]/[IMG]) — o reținem
      // până la newline, executăm etichetele și afișăm textul CURAT; un răspuns
      // fără '[' la început curge de la primul caracter (cazul obișnuit).
      const feedPub = (chunk: string): void => {
        acc += chunk
        if (headDone) {
          showPub(chunk)
          return
        }
        headBuf += chunk
        const s = headBuf.trimStart()
        if (s && !s.startsWith('[')) {
          headDone = true
          showPub(headBuf)
          headBuf = ''
          return
        }
        const nl = headBuf.indexOf('\n')
        if (nl !== -1 || headBuf.length > 300) {
          headDone = true
          const first = nl === -1 ? headBuf : headBuf.slice(0, nl)
          const rest = nl === -1 ? '' : headBuf.slice(nl + 1)
          const spoken = runPublicTags(first)
          showPub(spoken && rest ? `${spoken}\n${rest}` : spoken || rest)
          headBuf = ''
        }
      }
      // PACHETUL SUBȚIRE pentru sesiunea caldă a vizitatorului (#7, 11 iul):
      // doar directiva de limbă + mesajul NOU. Prima tură amorsează cu
      // pubPrompt complet; turele 2+ trimit doar asta → primul cuvânt rapid.
      const pubTurn =
        `${langLine}\nUser: ${lastUserText.slice(0, 1200)}\n\nAnswer the user's LAST message now.`
      const answer = await bridgeAskStream(
        pubPrompt,
        pubFiles,
        (chunk) => {
          if (chunk) feedPub(chunk) // '' = puls de viață, nu text
        },
        120_000,
        // Stall 12s (era 45s): workerul sănătos pulsează la ~3s, deci 12s fără
        // NIMIC = banda chiar e moartă — userul primește mesajul cinstit în 12s,
        // nu după 45s de așteptare (#7 latență, Adrian 10 iul).
        12_000,
        pubTurn,
        'public',
        // Cheia sesiunii calde: emailul sesiunii (unic per demo/client) —
        // izolare strictă vizitator-cu-vizitator pe worker.
        user.email,
      )
      const rawFull = (answer && answer !== BRIDGE_STALL ? answer : acc).trim()
      if (!rawFull) {
        const msg = roPub
          ? 'Nu am reușit să răspund de data asta — te rog mai încearcă o dată.'
          : "I couldn't answer this time — please try once more."
        reply.raw.write(msg)
        voice.feed(msg)
        await voice.finish()
        reply.raw.end()
        if (!isDemo) void saveMessage(user.email, 'assistant', msg)
        return
      }
      // Cap rămas nedescărcat (răspuns scurt, fără newline) → execută + arată.
      if (!headDone && headBuf) {
        headDone = true
        showPub(runPublicTags(headBuf))
        headBuf = ''
      }
      const finalText = stripPubTags(rawFull)
      // Coada nedifuzată (răspunsul final e mai lung decât ce-a curs live).
      if (answer && answer !== BRIDGE_STALL && answer.length > acc.length && answer.startsWith(acc))
        showPub(answer.slice(acc.length))
      else if (!shownAny && finalText) showPub(finalText)
      // Vocea a curs deja în timpul stream-ului (voice.feed în showPub); aici
      // doar golim coada de sinteză (plus plasa: nimic difuzat → rostește tot).
      if (!voice.fed()) voice.feed(finalText || rawFull)
      await voice.finish()
      reply.raw.end()
      // Demo = fără urme: nu salvăm istoricul și nu învățăm nimic despre el.
      if (!isDemo) {
        void saveMessage(user.email, 'assistant', finalText || rawFull)
        // Memoria învață și pe calea publică (fire-and-forget, zero latență).
        if (lastUserText.trim()) void learnFromTurn(user.email, lastUserText, finalText || rawFull)
      }
      return
    }

    const NOTE_TOOLS = [SAVE_NOTE_TOOL, LIST_NOTES_TOOL, DELETE_NOTE_TOOL, LIST_MEMORIES_TOOL, FORGET_MEMORY_TOOL]
    const BROWSER_TOOLS = [
      BROWSER_OPEN_TOOL,
      BROWSER_CLICK_TOOL,
      BROWSER_TYPE_TOOL,
      BROWSER_READ_TOOL,
      BROWSER_BACK_TOOL,
      BROWSER_SCROLL_TOOL,
      BROWSER_CLOSE_TOOL,
    ]
    // request_repair is offered ONLY to the admin AND only when his local
    // developer bridge is actually online — no point otherwise.
    const REPAIR_TOOLS = isAdmin && bridgeOnline() ? [REPAIR_TOOL] : []
    const tools: Anthropic.Tool[] = isAdmin
      ? [...googleTools, SHOW_TOOL, IMAGE_TOOL, PLAY_AVATAR_GESTURE_TOOL, DELEGATE_TOOL, LOG_GAP_TOOL, COST_TOOL, PROMO_TOOL, CODE_EXEC_TOOL, ...NOTE_TOOLS, ...BROWSER_TOOLS, ...REPAIR_TOOLS]
      : [...googleTools, SHOW_TOOL, IMAGE_TOOL, PLAY_AVATAR_GESTURE_TOOL, DELEGATE_TOOL, LOG_GAP_TOOL, CODE_EXEC_TOOL, ...NOTE_TOOLS, ...BROWSER_TOOLS]
    const baseUrl = `https://${req.headers.host ?? 'kelionai.app'}`
    // Vocea din prima frază și pe drumul API (clienți): fiecare bucată difuzată
    // intră în conductă; sinteza merge în paralel cu textul care încă curge.
    const voice = createVoiceStream(reply, userLang)
    let assistantText = ''
    let sandboxLog = '' // commands + real output from the code-execution sandbox
    let inTokens = 0
    let outTokens = 0
    let usageUsd = 0 // running provider cost this turn (for wallet debit)
    // Provider cost incurred by delegated specialist agents (their own Claude
    // calls + tool costs), accumulated so it's billed to the same wallet.
    const usage = { usd: 0 }
    // One safety net: MODEL-level only. Fable 5 is the brain; if a round fails
    // (or is refused) before any text streams, the SAME round is re-served by
    // Opus 4.8 — on the SAME paid key. REGULA LUI ADRIAN (9 iul): nu există
    // cheie de rezervă / al doilea cont; dacă acest cont pică, eroarea se vede.
    const active: Anthropic = userAnthropicKey ? new Anthropic({ apiKey: userAnthropicKey }) : anthropic
    // GAURA DE BANI (Adrian, audit 9 iul): un client care-și pune CHEIA LUI sărea
    // paywall-ul, iar dacă cheia era invalidă/fără credit, failover-ul de mai jos
    // muta conversația pe cheia NOASTRĂ de rezervă — vorbea gratis pe contul
    // nostru. Regula: o cerere pe cheia clientului NU atinge NICIODATĂ cheile
    // platformei. Pică pe cheia lui → primește o eroare clară, nu o cursă gratis.
    const usingUserKey = !!userAnthropicKey
    // Router automat capabilitate↔cost: cel mai ieftin model care poate duce
    // sarcina (șanse mari la cost mic). Dacă modelul rapid „se odihnește" după un
    // eșec, brainModel() ridică baza automat la modelul TOP.
    const chosen = chooseModel(lastUserText)
    let model = chosen === MODEL_FAST ? brainModel() : chosen
    // LANGUAGE GUARDIAN: for an ESTABLISHED language, the reply's opening is held
    // back until we confirm it's in that language; on a confident mismatch we
    // discard (nothing was sent) and re-serve the round ONCE, corrected. It is
    // fail-open — any doubt streams normally, and the correction is never gated,
    // so the reply is NEVER withheld or silent.
    const guardTag = speechPref && langName ? speechPref : null
    try {
      // Tool-use loop: stream text each round; if Claude requests tools, run them
      // and feed the results back, then continue, until it's done.
      for (let round = 0; round < 5; round++) {
        let roundText = ''
        let guardTripped = false
        // gateOn=true holds the opening for the language check; correct=true adds
        // the hard corrective and streams live (accept the result no matter what).
        const runRound = (
          c: Anthropic,
          m: string,
          correct = false,
          gateOn = true,
        ): Promise<Anthropic.Message> => {
          roundText = ''
          guardTripped = false
          let gate = ''
          let released = !gateOn || guardTag == null
          const sys =
            correct && langName
              ? `${systemPrompt}\n\nURGENT LANGUAGE CORRECTION: your previous attempt began in the WRONG language. Reply now EXCLUSIVELY in ${langName} — every single word in ${langName}.`
              : systemPrompt
          const stream = c.messages.stream({
            model: m,
            // Fable thinks internally within the output budget — give it room.
            // Headroom also covers long deliverables (a 10-minute promo script
            // is ~2000 tokens, written once in chat and once in the tool call).
            max_tokens: m === MODEL ? 5000 : 3500,
            system: sys,
            tools,
            messages: params,
          })
          stream.on('text', (delta) => {
            roundText += delta
            if (guardTripped) return // decided to discard — swallow the rest
            if (released) {
              reply.raw.write(delta)
              voice.feed(delta)
              return
            }
            gate += delta
            // Decide as soon as there's a sentence to judge (or enough text).
            if (/[.!?…\n]/.test(gate) || gate.length >= 120) {
              if (checkLang(gate, guardTag).ok) {
                released = true
                reply.raw.write(gate)
                voice.feed(gate)
              } else {
                guardTripped = true
              }
            }
          })
          return stream.finalMessage().then((msg) => {
            // Short reply that never reached a boundary: judge what we have.
            if (!released && !guardTripped && gate) {
              if (checkLang(gate, guardTag).ok) {
                reply.raw.write(gate)
                voice.feed(gate)
                released = true
              } else {
                guardTripped = true
              }
            }
            return msg
          })
        }
        let final: Anthropic.Message
        try {
          final = await runRound(active, model)
        } catch (e) {
          // Cheia clientului: NICIUN failover pe platformă, NICIO odihnă de Fable
          // provocată de cheia lui. Pică → aruncă (jos, catch-ul exterior îi dă
          // un mesaj clar despre cheie). Așa se închide cursa gratis pe contul nostru.
          if (usingUserKey) throw e
          if (roundText === '' && model === MODEL) {
            // Fable itself has a problem — rest it and re-serve on Opus 4.8
            // (same paid account; there is deliberately NO reserve key).
            restFable()
            model = MODEL_RESERVE
            final = await runRound(active, model)
          } else throw e
        }
        // A Fable safety refusal (HTTP 200, stop_reason "refusal", no content):
        // re-serve THIS request on Opus 4.8 — content-specific, so no resting.
        if (
          (final as { stop_reason?: string }).stop_reason === 'refusal' &&
          roundText === '' &&
          model === MODEL
        ) {
          model = MODEL_RESERVE
          final = await runRound(active, model)
        }
        // Guardian tripped: the opening was the wrong language and NOTHING was
        // sent — re-serve this round once, corrected and ungated (never silent).
        if (guardTripped && guardTag) {
          inTokens += final.usage.input_tokens
          outTokens += final.usage.output_tokens
          final = await runRound(active, model, true, false)
        }
        assistantText += roundText
        inTokens += final.usage.input_tokens
        outTokens += final.usage.output_tokens
        // Sandbox activity (code written + its REAL output) goes on the monitor.
        const sb = sandboxTranscript(final.content as unknown[])
        if (sb) sandboxLog += (sandboxLog ? '\n\n' : '') + sb
        if (final.stop_reason !== 'tool_use') break

        params.push({ role: 'assistant', content: final.content })
        const results: Anthropic.ToolResultBlockParam[] = []
        for (const block of final.content) {
          if (block.type === 'tool_use') {
            // A tool must NEVER crash the whole reply — always return a result so
            // the tool_use/tool_result pairing stays valid and the chat continues.
            let out: string
            try {
              // Agents inherit the user's language only when it's ESTABLISHED;
              // for adaptive (new/demo) users they mirror the task's language.
              out = await runTool(
                block, isAdmin, token, reply, baseUrl, user.email, usage,
                speechPref && langName ? langName : '',
              )
            } catch (e) {
              out = JSON.stringify({ error: e instanceof Error ? e.message : 'tool_failed' })
            }
            // Meter paid Serper searches (web + youtube) into the credit monitor.
            if (
              (block.name === 'web_search' || block.name === 'youtube_search') &&
              !out.includes('"error"')
            ) {
              usageUsd += SERPER_USD_PER_CALL
              void recordCost(user.email, 'search', SERPER_USD_PER_CALL)
            }
            // Meter generated images (Gemini image model) into the credit monitor.
            if (block.name === 'generate_image' && out.includes('"shown":true')) {
              usageUsd += IMAGE_USD_PER_CALL
              void recordCost(user.email, 'image', IMAGE_USD_PER_CALL)
            }
            results.push({ type: 'tool_result', tool_use_id: block.id, content: out })
          }
        }
        params.push({ role: 'user', content: results })
      }
      // Show the sandbox session (code + real output) as a readable, copyable
      // panel — Kelion only SPEAKS the outcome, never reads code aloud.
      if (sandboxLog.trim()) {
        reply.raw.write(
          `${CTRL}${JSON.stringify({ doc: { title: 'Sandbox — cod și rezultat', text: sandboxLog.slice(0, 8000) } })}${CTRL}`,
        )
      }
      // Vocea a curs deja în timpul stream-ului (voice.feed la fiecare bucată
      // difuzată); aici doar golim coada de sinteză.
      if (!voice.fed() && assistantText.trim()) voice.feed(assistantText)
      await voice.finish()
      reply.raw.end()
      if (assistantText.trim()) void saveMessage(user.email, 'assistant', assistantText)
      // Memory agent (learn): distil + save any new durable facts about the user,
      // off the response path so it never adds latency.
      if (lastUserText.trim() || assistantText.trim())
        void learnFromTurn(user.email, lastUserText, assistantText)
      // Record the real Claude cost for this turn (vision frames are already in
      // the input-token count, so token-based cost covers them).
      const chatUsd = claudeCost(model, inTokens, outTokens)
      usageUsd += chatUsd
      void recordCost(user.email, 'chat', chatUsd)
      // Fold in any cost run up by delegated specialist agents this turn.
      usageUsd += usage.usd
      // Charge the customer's wallet at REAL provider cost (1:1, USD→display
      // currency). The 25% margin was already taken up front at top-up, so the
      // user spends their credit at cost. The owner (admin) is exempt.
      if (
        config.stripe.secretKey &&
        user.role !== 'admin' &&
        user.role !== 'demo' &&
        !userAnthropicKey &&
        usageUsd > 0
      ) {
        const charge = usageUsd * config.stripe.usdToCurrency
        void debitWallet(user.email, charge, 'chat')
      }
    } catch (err) {
      app.log.error(err)
      if (!reply.raw.writableEnded) {
        // The model provider failed mid-turn — most often rate-limited or out of
        // credit. Tell the user calmly in THEIR language instead of a raw
        // "[connection error]"; the frontend shows AND speaks whatever we stream.
        const ro = userLang.toLowerCase().startsWith('ro')
        // Cheia proprie a picat (invalidă/expirată/fără credit): spune-i EXACT
        // asta, ca să știe că e cheia lui, nu serviciul — și că nu trecem tacit
        // pe cheia noastră (gaura de bani închisă mai sus).
        const note = usingUserKey
          ? ro
            ? 'Cheia ta Anthropic nu a funcționat (invalidă, expirată sau fără credit). Verific-o în meniul ⊕ → cheie Anthropic.'
            : 'Your Anthropic key did not work (invalid, expired, or out of credit). Check it in the ⊕ menu → Anthropic key.'
          : ro
            ? 'Îmi pare rău, momentan nu pot răspunde — serviciul este temporar indisponibil. Încearcă din nou în câteva minute.'
            : "Sorry, I can't answer right now — the service is temporarily unavailable. Please try again in a few minutes."
        reply.raw.write(assistantText.trim() ? `\n\n${note}` : note)
        // Eroarea se și AUDE (regula „niciodată tăcere totală"), nu doar se scrie.
        voice.feed(note)
        await voice.finish()
        reply.raw.end()
      }
    }
  })
}

// Turn a skill's JSON result into a structured "card" the monitor renders
// (emails, calendar, tasks, Drive, contacts, web results). Returns null when the
// tool has no card representation or errored.
interface CardItem {
  primary: string
  secondary?: string
  meta?: string
  url?: string
}
interface SkillCard {
  type: string
  title: string
  items: CardItem[]
}

// Turn a reply's server-side sandbox blocks into a readable transcript — the
// commands Kelion ran and their REAL output — for the monitor's doc panel.
function sandboxTranscript(content: unknown[]): string {
  const parts: string[] = []
  for (const b of content as Record<string, unknown>[]) {
    if (b.type === 'server_tool_use') {
      const input = (b.input ?? {}) as Record<string, unknown>
      const cmd = input.command ?? input.code ?? input.file_text
      if (typeof cmd === 'string' && cmd.trim()) parts.push(`$ ${cmd.trim()}`)
    } else if (typeof b.type === 'string' && b.type.endsWith('code_execution_tool_result')) {
      const c = (b.content ?? {}) as Record<string, unknown>
      const out = [c.stdout, c.stderr]
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
        .join('\n')
      parts.push(out.trim() || `(exit ${String(c.return_code ?? '?')})`)
    }
  }
  return parts.join('\n\n')
}

function cardFor(name: string, out: string): SkillCard | null {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(out) as Record<string, unknown>
  } catch {
    return null
  }
  if (j.error) return null
  const cut = (s: string, n = 120): string => (s.length > n ? `${s.slice(0, n)}…` : s)
  const when = (s: string): string => (s ? s.replace('T', ' ').slice(0, 16) : '')

  if (name === 'get_recent_emails' && Array.isArray(j.emails)) {
    const rows = j.emails as { subject?: string; from?: string; date?: string }[]
    return { type: 'emails', title: 'Emails', items: rows.map((e) => ({ primary: e.subject || '(no subject)', secondary: e.from || '', meta: when(e.date || '') })) }
  }
  if (name === 'get_calendar_events' && Array.isArray(j.events)) {
    const rows = j.events as { summary?: string; start?: string; location?: string }[]
    return { type: 'calendar', title: 'Calendar', items: rows.map((e) => ({ primary: e.summary || '(no title)', secondary: when(e.start || ''), meta: e.location || '' })) }
  }
  if (name === 'get_tasks' && Array.isArray(j.tasks)) {
    const rows = j.tasks as { title?: string; due?: string }[]
    return { type: 'tasks', title: 'Tasks', items: rows.map((t) => ({ primary: t.title || '', secondary: t.due ? `due ${String(t.due).slice(0, 10)}` : '' })) }
  }
  if (name === 'get_drive_files' && Array.isArray(j.files)) {
    const rows = j.files as { name?: string; mimeType?: string; modifiedTime?: string; webViewLink?: string }[]
    return { type: 'drive', title: 'Drive', items: rows.map((f) => ({ primary: f.name || '', secondary: String(f.mimeType || '').split(/[./]/).pop() || '', meta: String(f.modifiedTime || '').slice(0, 10), url: f.webViewLink || '' })) }
  }
  if (name === 'search_contacts' && Array.isArray(j.contacts)) {
    const rows = j.contacts as { name?: string; email?: string; phone?: string }[]
    return { type: 'contacts', title: 'Contacts', items: rows.map((c) => ({ primary: c.name || '', secondary: c.email || '', meta: c.phone || '' })) }
  }
  if (name === 'web_search' && Array.isArray(j.results)) {
    const rows = j.results as { title?: string; snippet?: string; link?: string }[]
    return { type: 'search', title: 'Web results', items: rows.map((r) => ({ primary: r.title || '', secondary: cut(r.snippet || ''), url: r.link || '' })) }
  }
  return null
}

// Run one specialist agent on a task Kelion delegated: its own focused prompt +
// its OWN memory namespace, the full tool set MINUS delegation (so it can never
// recurse), a bounded tool loop. Returns a concise text result for Kelion to
// relay. Fully isolated — any failure returns a string, never crashes the reply.
async function runAgent(
  spec: AgentSpec,
  task: string,
  token: string,
  reply: { raw: { write(chunk: string): void } },
  baseUrl: string,
  email: string,
  usage: { usd: number },
  lang: string,
): Promise<string> {
  if (!config.anthropicKey) return 'agent unavailable'
  try {
    const memory = await recallMemories(email, spec.id, task)
    const system =
      `You are the ${spec.name} — a specialist agent working under Kelion for one user, with a ` +
      `verified background of 25 years of professional experience in your domain. Work with the ` +
      `judgement, rigour and calm of that seniority. ` +
      `Your domain: ${spec.focus}\n\n` +
      `Kelion has handed you the task below. Carry it out fully using your tools, then reply ` +
      `with a COMPLETE plain-text result that answers every part of the task (no markdown, no ` +
      `lists) — concise in wording but never leave out anything the user asked for. If you ` +
      `cannot do it, say briefly why. When the deliverable is an email, letter, message or ` +
      `document, format it properly and in full: a greeting line, clear short paragraphs with a ` +
      `blank line between them, and a courteous closing with the sender's name — a real, ` +
      `well-structured piece, never one unformatted blob.` +
      (lang
        ? ` Write your result AND any content you produce (emails, drafts, messages, summaries) EXCLUSIVELY in ${lang}, regardless of foreign place names or search results — never drift to another language.`
        : '') +
      `${memory}`
    // Code agents (Developer/Tester) also get the real execution sandbox.
    const agentTools: Anthropic.Tool[] = spec.code
      ? [...googleTools, SHOW_TOOL, IMAGE_TOOL, CODE_EXEC_TOOL]
      : [...googleTools, SHOW_TOOL, IMAGE_TOOL]
    const params: Anthropic.MessageParam[] = [{ role: 'user', content: task }]
    let text = ''
    let agentSandbox = '' // the agent's real sandbox session (proof of execution)
    let inTok = 0
    let outTok = 0
    let agentModel = brainModel()
    for (let round = 0; round < 4; round++) {
      // Same model net as the brain: Fable → Opus 4.8 on any model problem
      // (incl. a safety refusal) — always on the single paid key, never another.
      const make = (m: string): Promise<Anthropic.Message> =>
        anthropic.messages.create({
          model: m,
          // Code agents get room to write real programs; text agents stay tight.
          max_tokens: spec.code ? 4000 : m === MODEL ? 2200 : 1500,
          system,
          tools: agentTools,
          messages: params,
        })
      let res: Anthropic.Message
      try {
        res = await make(agentModel)
      } catch (e) {
        if (agentModel !== MODEL) throw e
        restFable()
        agentModel = MODEL_RESERVE
        res = await make(agentModel)
      }
      if ((res as { stop_reason?: string }).stop_reason === 'refusal' && agentModel === MODEL) {
        agentModel = MODEL_RESERVE
        res = await make(agentModel)
      }
      inTok += res.usage.input_tokens
      outTok += res.usage.output_tokens
      const t = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      if (t) text += (text ? '\n' : '') + t
      if (spec.code) {
        const sb = sandboxTranscript(res.content as unknown[])
        if (sb) agentSandbox += (agentSandbox ? '\n\n' : '') + sb
      }
      if (res.stop_reason !== 'tool_use') break
      params.push({ role: 'assistant', content: res.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const block of res.content) {
        if (block.type === 'tool_use') {
          let out: string
          try {
            out = await runTool(block, false, token, reply, baseUrl, email, usage, lang)
          } catch (e) {
            out = JSON.stringify({ error: e instanceof Error ? e.message : 'tool_failed' })
          }
          if (
            (block.name === 'web_search' || block.name === 'youtube_search') &&
            !out.includes('"error"')
          ) {
            usage.usd += SERPER_USD_PER_CALL
            void recordCost(email, 'search', SERPER_USD_PER_CALL)
          }
          if (block.name === 'generate_image' && out.includes('"shown":true')) {
            usage.usd += IMAGE_USD_PER_CALL
            void recordCost(email, 'image', IMAGE_USD_PER_CALL)
          }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: out })
        }
      }
      params.push({ role: 'user', content: results })
    }
    const usd = claudeCost(agentModel, inTok, outTok)
    usage.usd += usd
    void recordCost(email, `agent:${spec.id}`, usd)
    // Text agents: put the finished written deliverable on the monitor as a
    // readable, copyable panel (so it isn't only spoken — the user can read it).
    // Code agents also attach their REAL sandbox session — proof of execution.
    if (spec.doc && (text.trim() || agentSandbox.trim())) {
      const body =
        text.trim() +
        (agentSandbox.trim() ? `\n\n── SANDBOX (dovada rulării) ──\n${agentSandbox.trim()}` : '')
      reply.raw.write(
        `${CTRL}${JSON.stringify({ doc: { title: spec.name, text: body.slice(0, 9000) } })}${CTRL}`,
      )
    }
    // The specialist learns to ITS OWN memory (off the response path).
    if (text.trim()) void learnFromTurn(email, task, text, spec.id)
    return text.trim() || '(task completed, no summary returned)'
  } catch (e) {
    return `agent error: ${e instanceof Error ? e.message : 'failed'}`
  }
}

// URLs that actually render inside the monitor iframe: our own pages (relative
// or same-host), YouTube (the frontend rewrites to /embed/), Waze's live-map
// embed, OpenStreetMap embeds and Google's keyed Maps Embed API. Everything
// else on the open web almost always sends X-Frame-Options/CSP and would show
// a broken panel — those go through the live browser instead (see
// show_on_screen in runTool).
function iframeSafe(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return true // relative URL (/api/image/…, /api/route…) — same-origin, safe
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'kelionai.app' || host.endsWith('.kelionai.app')) return true
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') return true
  if (host === 'embed.waze.com') return true
  if (host === 'openstreetmap.org') return true
  if (host === 'embed.windy.com' || host === 'windy.com') return true
  if (host === 'wttr.in') return true
  if ((host === 'google.com' || host.endsWith('.google.com')) && u.pathname.startsWith('/maps/embed'))
    return true
  return false
}

// Shared by every browser_* tool: puts the fresh screenshot on the monitor (a
// plain <img>-safe same-origin URL, so it renders even for sites that block
// iframes) and hands Kelion back the page text + numbered clickable elements.
function browserToolResult(
  reply: { raw: { write(chunk: string): void } },
  result: { error: string } | { url: string; title: string; text: string; elements: unknown; shotUrl: string },
): string {
  if ('error' in result) return JSON.stringify(result)
  reply.raw.write(
    `${CTRL}${JSON.stringify({ monitor: { url: result.shotUrl, title: result.title } })}${CTRL}`,
  )
  return JSON.stringify({
    shown: true,
    url: result.url,
    title: result.title,
    text: result.text,
    elements: result.elements,
  })
}

// Run one tool-use block and return the JSON string result. show_on_screen also
// emits a control frame on the live stream so the frontend opens the monitor.
async function runTool(
  block: Anthropic.ToolUseBlock,
  isAdmin: boolean,
  token: string,
  reply: { raw: { write(chunk: string): void } },
  baseUrl: string,
  email: string,
  usage: { usd: number },
  lang: string,
): Promise<string> {
  if (block.name === 'get_real_cost') {
    return isAdmin ? JSON.stringify(await getCostSummary()) : JSON.stringify({ error: 'forbidden' })
  }
  if (block.name === 'log_unsupported_request') {
    const inp = (block.input ?? {}) as { request?: string; reason?: string }
    const request = typeof inp.request === 'string' ? inp.request : ''
    const reason = typeof inp.reason === 'string' ? inp.reason : ''
    if (request) void logCapabilityGap(email, request, reason)
    return JSON.stringify({ logged: true })
  }
  if (block.name === 'save_note') {
    const inp = (block.input ?? {}) as { content?: string; title?: string }
    const content = typeof inp.content === 'string' ? inp.content : ''
    if (!content.trim()) return JSON.stringify({ error: 'empty_content' })
    const id = await saveNote(email, content, inp.title)
    return id ? JSON.stringify({ saved: true, id }) : JSON.stringify({ error: 'save_failed' })
  }
  if (block.name === 'list_notes') {
    const notes = await listNotes(email)
    return JSON.stringify({ notes })
  }
  if (block.name === 'delete_note') {
    const inp = (block.input ?? {}) as { id?: number }
    const id = Number(inp.id)
    if (!Number.isFinite(id)) return JSON.stringify({ error: 'bad_id' })
    const ok = await deleteNote(email, id)
    return JSON.stringify({ deleted: ok })
  }
  if (block.name === 'list_memories') {
    // Tot ce ține minte Kelion despre user (memoria auto-învățată) — transparent.
    const mems = await getMemories(email, 100)
    return JSON.stringify({ memories: mems.map((m) => m.content) })
  }
  if (block.name === 'forget_memory') {
    const inp = (block.input ?? {}) as { fragment?: string }
    const fragment = typeof inp.fragment === 'string' ? inp.fragment : ''
    if (fragment.trim().length < 3) return JSON.stringify({ error: 'fragment_too_short' })
    const deleted = await deleteMemory(email, fragment)
    return JSON.stringify({ deleted })
  }
  if (block.name === 'prepare_promo_clip') {
    if (!isAdmin) return JSON.stringify({ error: 'forbidden' })
    const inp = (block.input ?? {}) as {
      subject?: string
      duration_seconds?: number
      script?: string
      lang?: string
      scenes?: { at_seconds?: number; kind?: string; query?: string; url?: string; title?: string }[]
    }
    const subject = typeof inp.subject === 'string' ? inp.subject.trim() : ''
    // Any length up to 10 minutes — the voice pipeline chunks long narrations.
    const duration = Math.min(600, Math.max(5, Number(inp.duration_seconds) || 30))
    const script = typeof inp.script === 'string' ? inp.script.trim() : ''
    if (!script) return JSON.stringify({ error: 'empty_script' })
    // Resolve the shot list server-side: map/weather queries become REAL embed
    // URLs (never guessed), image scenes must point at our own image store,
    // "avatar" closes the monitor so Kelion himself fills the frame.
    const scenes: { at: number; title: string; url?: string; close?: boolean }[] = []
    for (const s of (inp.scenes ?? []).slice(0, 12)) {
      const at = Math.max(0, Math.min(Number(s.at_seconds) || 0, duration - 1))
      const title = typeof s.title === 'string' && s.title ? s.title.slice(0, 40) : subject
      if (s.kind === 'avatar') scenes.push({ at, title, close: true })
      else if ((s.kind === 'map' || s.kind === 'weather') && s.query) {
        const url = await promoSceneUrl(s.kind, s.query)
        if (url) scenes.push({ at, title, url })
      } else if (s.kind === 'image' && typeof s.url === 'string' && s.url.includes('/api/image/')) {
        scenes.push({ at, title, url: s.url })
      }
    }
    scenes.sort((a, b) => a.at - b.at)
    // Stamp the script's OWN language so the clip is always narrated with a
    // matching voice — a text/voice mismatch is exactly what silenced the voice
    // ("a crăpat") when a script saved in another language was recalled. Kelion
    // declares it explicitly (works for ANY language); the detector is backup.
    const scriptLang =
      typeof inp.lang === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/i.test(inp.lang.trim())
        ? inp.lang.trim()
        : detectLang(script)
    // Show the approved script as a readable panel (it closes itself the moment
    // recording starts — the clip never shows the text) AND arm the recorder.
    reply.raw.write(
      `${CTRL}${JSON.stringify({ doc: { title: `Scenariu ${duration}s — ${subject}`, text: script } })}${CTRL}`,
    )
    reply.raw.write(
      `${CTRL}${JSON.stringify({ promo: { subject, duration, script, scenes, lang: scriptLang } })}${CTRL}`,
    )
    return JSON.stringify({
      armed: true,
      scenes: scenes.length,
      note: 'Recorder armed. The admin must click the pulsing Rec button and pick the screen; the approved script is spoken and the scenes play automatically when recording starts.',
    })
  }
  if (block.name === 'delegate') {
    const inp = (block.input ?? {}) as { agent?: string; task?: string }
    const spec = AGENTS[String(inp.agent)]
    const task = typeof inp.task === 'string' ? inp.task.trim() : ''
    if (!spec || !task) return JSON.stringify({ error: 'unknown_agent_or_empty_task' })
    const result = await runAgent(spec, task, token, reply, baseUrl, email, usage, lang)
    return JSON.stringify({ agent: spec.id, result })
  }
  if (block.name === 'show_on_screen') {
    const inp = (block.input ?? {}) as { url?: string; title?: string }
    const url = typeof inp.url === 'string' ? inp.url : ''
    const title = typeof inp.title === 'string' ? inp.title : ''
    // Empty URL or known-embeddable content (YouTube, our own pages, Waze,
    // OSM…) → the plain iframe works, show it directly.
    if (!url || iframeSafe(url)) {
      reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title } })}${CTRL}`)
      return JSON.stringify({ shown: true, url })
    }
    // Anything else (an arbitrary website) almost always refuses to load in an
    // iframe (X-Frame-Options/CSP) and would show a broken panel — so open it
    // in the LIVE browser instead and show the real page. If even that fails,
    // fall back to the iframe attempt as a last resort.
    const live = await browserOpen(email, baseUrl, url)
    if (!('error' in live)) return browserToolResult(reply, live)
    reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title } })}${CTRL}`)
    return JSON.stringify({ shown: true, url, note: 'live_browser_failed_iframe_fallback' })
  }
  if (block.name === 'generate_image') {
    const inp = (block.input ?? {}) as { prompt?: string }
    const prompt = typeof inp.prompt === 'string' ? inp.prompt : ''
    const result = await generateImage(prompt)
    if ('error' in result) return JSON.stringify({ error: result.error })
    const url = `${baseUrl}/api/image/${result.id}`
    // Show it big on the monitor AND inline in the chat.
    reply.raw.write(
      `${CTRL}${JSON.stringify({ monitor: { url, title: prompt.slice(0, 60) }, image: { url } })}${CTRL}`,
    )
    return JSON.stringify({ shown: true, url })
  }
  if (block.name === 'browser_open') {
    const inp = (block.input ?? {}) as { url?: string }
    const url = typeof inp.url === 'string' ? inp.url : ''
    if (!url.trim()) return JSON.stringify({ error: 'empty_url' })
    return browserToolResult(reply, await browserOpen(email, baseUrl, url))
  }
  if (block.name === 'browser_click') {
    const inp = (block.input ?? {}) as { index?: number }
    const index = Number(inp.index)
    if (!Number.isFinite(index)) return JSON.stringify({ error: 'bad_index' })
    return browserToolResult(reply, await browserClick(email, baseUrl, index))
  }
  if (block.name === 'browser_type') {
    const inp = (block.input ?? {}) as { index?: number; text?: string; submit?: boolean }
    const index = Number(inp.index)
    const text = typeof inp.text === 'string' ? inp.text : ''
    if (!Number.isFinite(index)) return JSON.stringify({ error: 'bad_index' })
    return browserToolResult(reply, await browserType(email, baseUrl, index, text, !!inp.submit))
  }
  if (block.name === 'browser_read') {
    return browserToolResult(reply, await browserRead(email, baseUrl))
  }
  if (block.name === 'browser_back') {
    return browserToolResult(reply, await browserBack(email, baseUrl))
  }
  if (block.name === 'browser_scroll') {
    const inp = (block.input ?? {}) as { direction?: string }
    const direction = inp.direction === 'up' ? 'up' : 'down'
    return browserToolResult(reply, await browserScroll(email, baseUrl, direction))
  }
  if (block.name === 'browser_close') {
    await browserClose(email)
    reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: '', title: '' } })}${CTRL}`)
    return JSON.stringify({ closed: true })
  }
  if (block.name === 'request_repair') {
    if (!isAdmin) return JSON.stringify({ error: 'forbidden' })
    const inp = (block.input ?? {}) as { description?: string }
    const desc = typeof inp.description === 'string' ? inp.description.trim() : ''
    if (!desc) return JSON.stringify({ error: 'empty_description' })
    const jobId = bridgeRepair(desc)
    return jobId
      ? JSON.stringify({ sent: true, note: 'Repair request forwarded to the developer (Claude Code). It will be worked on now.' })
      : JSON.stringify({ error: 'developer_offline', note: 'The repair bridge is not running right now.' })
  }
  if (block.name === 'play_avatar_gesture') {
    const inp = (block.input ?? {}) as { gesture?: string }
    const label: GestureLabel | undefined =
      inp.gesture === 'raiseRightHand' || inp.gesture === 'salute' || inp.gesture === 'pointMonitor'
        ? inp.gesture
        : undefined
    if (!label) return JSON.stringify({ error: 'unknown_gesture' })
    reply.raw.write(`${CTRL}${JSON.stringify({ gesture: label })}${CTRL}`)
    return JSON.stringify({ played: true, gesture: label })
  }
  const out = await runGoogleTool(block.name, block.input, token)
  // Weather map or route map: if the tool returned an embeddable screen_url, show
  // it on the monitor automatically (our own maps, which always load in the
  // iframe — unlike a google.com link that refuses).
  if (block.name === 'get_weather' || block.name === 'maps_directions') {
    try {
      const parsed = JSON.parse(out) as Record<string, unknown> & {
        screen_url?: string
        location?: string
        destination?: string
      }
      if (parsed.screen_url) {
        const title =
          block.name === 'get_weather'
            ? `Weather — ${parsed.location ?? 'your location'}`
            : `Route — ${parsed.destination ?? ''}`.slice(0, 60)
        reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: parsed.screen_url, title } })}${CTRL}`)
        // Ground truth INSIDE the tool result: shown ONLY when the frame was
        // actually written — Kelion may claim "on your monitor" only on this.
        parsed.shown = true
        return JSON.stringify(parsed)
      }
    } catch {
      /* not JSON / no screen_url — nothing to show */
    }
  }
  // A searched place → always show it on the map (don't rely on Kelion choosing).
  if (block.name === 'maps_search') {
    try {
      const j = JSON.parse(out) as { places?: { name?: string; lat?: string; lon?: string }[] }
      const p = j.places?.[0]
      if (p?.lat && p?.lon) {
        const url = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}`
        reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title: (p.name ?? '').slice(0, 60) } })}${CTRL}`)
      }
    } catch {
      /* nothing to show */
    }
  }
  // A found video → always play it on the monitor.
  if (block.name === 'youtube_search') {
    try {
      const j = JSON.parse(out) as { videos?: { title?: string; link?: string }[] }
      const v = j.videos?.[0]
      if (v?.link) {
        reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: v.link, title: (v.title ?? '').slice(0, 60) } })}${CTRL}`)
      }
    } catch {
      /* nothing to show */
    }
  }
  // Structured skills (emails, calendar, tasks, Drive, contacts, web results)
  // → render a card on the monitor.
  const card = cardFor(block.name, out)
  if (card && card.items.length > 0) {
    reply.raw.write(`${CTRL}${JSON.stringify({ card })}${CTRL}`)
  }
  return out
}
