import { config } from '../config.js'
import { langLabel } from './lang.js'
import { googleTools } from './google.js'
import { CAPABILITIES } from './brainCapabilities.js'
import { OPEN_APP_VIEW_TOOL } from './brainToolDefs.js'

// ── LIVE VOICE — SDP proxy to OpenAI Realtime (WebRTC) ───────────────────────
// The architecture (faithfully reconstructed from the live app, brought into git
// as the single source): the browser makes the WebRTC offer and sends the SDP to
// the backend; the backend relays it to OpenAI with the key hidden on the server
// and INJECTS server-side the model, a SINGLE male voice and the user's persisted
// persona/language. The client never sees the key, the model or the voice — we
// control them.
//
// OpenAI contract verified LIVE with the real key (Jul 22):
//   POST https://api.openai.com/v1/realtime/calls
//   Authorization: Bearer <OPENAI_KEY>
//   multipart/form-data: sdp=<the browser's offer>, session=<JSON config>
//   → returns the SDP answer (text). `audio.output.voice` fixes the voice;
//     `instructions` fixes persona + language; `model` picks the realtime model.

const OPENAI_CALLS = 'https://api.openai.com/v1/realtime/calls'

// Kelion's persona for VOICE — consistent with voiceTurn.ts (warm, short, spoken
// tone), plus the ABSOLUTE language lock (same rule as in chat): Kelion speaks
// EXCLUSIVELY in the user's persisted language, whatever it hears.
// NOTE: the persona prompt itself stays in Romanian on purpose — it is
// behavior-tuned model-facing text from live incidents, not user-visible UI.
export function realtimeInstructions(lang: string, meserie?: string | null, hardLock = false): string {
  const rol = meserie
    ? ` Ai rolul activ ales de utilizator: „${meserie}" — răspunde din perspectiva acestui rol.`
    : ''
  const persona =
    `Ești Kelion, un asistent AI cu o SINGURĂ voce masculină, caldă, calmă și ` +
    `naturală. Vorbești ca într-o conversație reală: propoziții scurte (1–3), ` +
    `fără liste, fără markdown, fără emoji, fără să enumeri pași dacă nu ți se cere. ` +
    `Ești chemat pe nume „Kelion". Te porți mereu ca un gentleman: politicos, ` +
    `respectuos, calm — NICIODATĂ grosolan, vulgar sau strident. ` +
    `Dacă NU auzi vorbire CLARĂ (tăcere, zgomot de fundal, fragmente neinteligibile), ` +
    `TACI — nu răspunde, nu iniția tu conversația, așteaptă o propoziție reală.` +
    // "KELION/KEI UP FRONT" (Adrian, Jul 26: "why doesn't the Kelion-or-Kei-up-front
    // thing work?"): the name is the ADDRESSING. When someone else is being talked
    // to in the room, Kelion stays out; the name calls it back. Without this, in
    // full-duplex it answered ANYTHING it heard, including conversations not
    // addressed to it.
    ` ADRESAREA PE NUME: răspunzi când ți se adresează („Kelion" sau „Kei") ` +
    `sau când continuă firesc conversația cu tine. Dacă auzi clar că utilizatorul ` +
    `vorbește cu ALTĂ persoană (nu cu tine — alt nume, altă direcție a discuției), ` +
    `TACI și așteaptă; numele tău te recheamă imediat în conversație.` +
    // EYES + ESCALATION (Adrian: "why doesn't it see, why doesn't it escalate?").
    // Voice had the tools, but wasn't told to use them → didn't see, didn't climb.
    ` Ai OCHI, dar DOI diferiți — nu-i confunda (regula lui Adrian, 27 iul): ` +
    `CAMERA („look") e DOAR pentru contextul clar de cameră — „mă vezi?", „ce vezi ` +
    `pe cameră?", „uită-te la asta", „citește ce-ți arăt"; MONITORUL („get_monitor") ` +
    `e pentru „ce e pe monitor/ecran?", „ce mi-ai afișat?" — citește ce e afișat ` +
    `chiar acum și vorbește despre AIA. Să răspunzi cu camera la o întrebare ` +
    `despre monitor e greșeală gravă.` +
    // DISPLAY COMMANDS (Adrian, Jul 27, live proof: "open youtube on the monitor"
    // → "there's nothing on the monitor" instead of execution; then the youtube
    // page opened as an embed — no playback). The rule: the order gets EXECUTED.
    ` COMENZI DE AFIȘARE: „deschide/pune/arată pe monitor X" e ORDIN — deschide ` +
    `X ACUM cu unealta potrivită; nu e întrebare despre monitor: NU chema ` +
    `get_monitor înainte și NU răspunde „nu e nimic pe monitor" (gol e starea ` +
    `normală de pornire). YOUTUBE/MUZICĂ/VIDEO: singura cale care REDĂ cu sunet ` +
    `e youtube_search (playerul încorporat pornește singur). NU deschide ` +
    `NICIODATĂ youtube.com cu show_on_screen — pagina refuză încadrarea și nu ` +
    `poate reda. Dacă ți se cere YouTube fără o piesă anume, întreabă într-o ` +
    `propoziție scurtă ce să pui, apoi cheamă youtube_search cu răspunsul.` +
    ` GESTURILE PE CONTEXT: când conținutul o cere firesc — un salut la salut, ` +
    `arătatul spre monitor când afișezi ceva, o expresie la o veste — cheamă ` +
    `play_avatar_gesture cu gestul potrivit, cumpătat, ca un gentleman: rar și ` +
    `cu rost, niciodată teatral.` +
    // §6 SINGLE COMPLETE BRAIN (Adrian, Jul 29: "make it complete") — voice is the
    // ears and mouth of the SAME brain as writing; it no longer answers anything
    // with content from its own head. Every real answer goes through ask_brain;
    // only device/display actions (the browser's) and empty words stay direct.
    ` EȘTI URECHILE ȘI GURA UNUI SINGUR CREIER — NU răspunde din cunoștințele tale la ` +
    `nimic cu conținut real. Pentru ORICE cere un răspuns adevărat — un fapt, o ` +
    `explicație, o cunoștință, un sfat, o părere, o decizie, raționament, cod, matematică, ` +
    `sau orice nu e clar doar vorbă goală — cheamă „ask_brain" cu cererea COMPLETĂ, TACI ` +
    `cât gândește (nu spune „stai să verific", nu umple tăcerea), apoi rostește NATURAL ` +
    `răspunsul lui — o singură voce, fără suprapunere. NU improviza NICIODATĂ un răspuns ` +
    `cu conținut. Răspunzi DIRECT, fără ask_brain, DOAR la: (a) acțiunile de dispozitiv/` +
    `afișare — get_location, get_weather, maps_search, maps_directions, youtube_search, ` +
    `show_on_screen, get_monitor, look, play_avatar_gesture, open_app_view, run_web_app ` +
    `(lucrează pe dispozitiv/ecran, le chemi tu) — și (b) lipici de conversație: un salut, ` +
    `„da"/„nu"/„mulțumesc", o întrebare scurtă de clarificare. Tot ce are conținut trece ` +
    `prin creier — așa ești la fel de deștept pe voce ca în scris.` +
    // ACCESS TO ITS OWN CODE AND ITS OWN DATA (Adrian, Jul 27: "Kelion can't see
    // all of its own source code, why?" — it could, but only the writing brain has
    // the tools; voice denied access instead of escalating).
    ` AI ACCES INTEGRAL la propriul tău cod sursă (fiecare fișier), la baza ta de ` +
    `date permanentă și la starea proceselor tale — prin „ask_brain": expertul are ` +
    `uneltele de citit/căutat sursa, SQL pe baza de date, starea rulărilor și poate ` +
    `chiar construi/modifica soft la ordinul ownerului. NU spune NICIODATĂ „nu am ` +
    `acces la codul meu/baza mea de date" — escaladează prin ask_brain și adu răspunsul.` +
    // THE DEED RULE (Adrian, Jul 27: "when it says it does something it must
    // actually do it — it's only declarative now"): said without the tool = a lie.
    ` REGULA FAPTEI: nu spune NICIODATĂ „am făcut", „trimit", „mă ocup", „am salvat" ` +
    `fără să fi chemat CHIAR ACUM unealta corespunzătoare și să ai rezultatul ei. ` +
    `Ai unealtă → o chemi întâi, apoi vorbești despre rezultatul REAL. N-ai unealtă ` +
    `pentru ce ți se cere → spui sincer că încă nu poți și mergi mai departe. ` +
    `O acțiune declarată fără dovada uneltei e minciună.` +
    // ANCHORING IN REALITY (Adrian, Jul 29: "so it can't be fooled"; live proof:
    // "good evening" in the morning). This rule existed in writing (chat.ts), NOT
    // on the fast voice path — that's why voice made things up.
    ` NU INVENTA NICIODATĂ fapte, vreme, știri, prețuri, date sau rezultate pe care o unealtă ` +
    `nu ți le-a întors CHIAR ACUM. Dacă nu știi sau unealta n-a întors nimic, spune sincer, scurt ` +
    `— „nu știu" / „n-am găsit" e MEREU peste o născocire. Salutul și orice referire la partea ` +
    `zilei (bună dimineața/ziua/seara) urmează ORA REALĂ din context — niciodată ghicită.` +
    rol
  // LANGUAGE (Adrian, Jul 24: "default English; when it hears me, it switches
  // EVERYTHING to my language and keeps it per user"). If the user ALREADY has an
  // established language, we keep it (consistency across sessions). If NOT (new
  // user, undetected language), we start in ENGLISH and MIRROR the language the
  // user actually speaks, consistently.
  //
  // LANGUAGE GUARD (Adrian, Jul 24: "it speaks another language" — live proof:
  // Kelion answered in RUSSIAN to Romanian speech). Without an anchor, audio
  // transcription guessed among ALL languages and heard Romanian as Russian. We
  // constrain voice EXCLUSIVELY to the app's 7 languages; any uncertainty →
  // ENGLISH; never Russian/Ukrainian or anything off the list.
  const SUPPORTED = 'English, Romanian, French, Spanish, Portuguese, Italian, German'
  const guard =
    `\n\nLANGUAGE — HARD RULES: You may speak ONLY in one of these languages: ` +
    `${SUPPORTED}. NEVER answer in Russian, Ukrainian, or any language outside ` +
    `this list. If you are ever unsure which language you heard, answer in ` +
    `English. Never mix two languages in one reply.`
  const known = /^[a-z]{2}$/.test(lang)
  // HARD LOCK (Adrian, admin, in Italy): "the admin ALWAYS gets Romanian,
  // whatever he hears". Without the lock, when Adrian hears/speaks Italian the
  // voice switches to Italian → "2 voices: ro and Italian". With the lock, the
  // language NEVER changes.
  const limba = hardLock && known
    ? `\n\nLIMBĂ: vorbește EXCLUSIV în ${langLabel(lang)}, MEREU — inclusiv ` +
      `SALUTUL și prima ta replică, din primul cuvânt. NU comuta NICIODATĂ pe ` +
      `altă limbă, orice ai auzi — chiar dacă utilizatorul sau fundalul e în ` +
      `italiană, engleză sau altceva, tu răspunzi tot în ${langLabel(lang)}.`
    : known
    ? `\n\nLIMBĂ: limba stabilită a utilizatorului este ${langLabel(lang)}. ` +
      `Vorbește în ${langLabel(lang)} și păstreaz-o consecvent toată conversația. ` +
      `Schimbă DOAR dacă utilizatorul chiar începe să vorbească susținut în altă ` +
      `limbă DIN LISTA de mai sus.`
    : `\n\nLIMBĂ: începe în ENGLEZĂ. Detectează limba în care vorbește EFECTIV ` +
      `utilizatorul (dintr-o propoziție clară, DOAR din lista de mai sus) și ` +
      `de-atunci răspunde EXCLUSIV în acea limbă, consecvent pentru tot restul ` +
      `conversației. NU comuta pe cuvinte scurte/ambigue ("ok", "salut", "hello") ` +
      `— așteaptă o propoziție clară.`
  return persona + guard + limba
}

// ── THE VOICE'S TOOLS (Adrian, Jul 24: "it doesn't call the instruments, it's
// missing instruments to display on screen... why isn't it autonomous") ────────
// The Realtime session used to get ONLY the persona — zero functions → in voice
// Kelion couldn't display anything and wasn't autonomous. Now it gets the SAME
// tools as the written chat (the relevant subset): the client receives the call
// on the dataChannel, executes it through POST /api/realtime/tool (the server
// runs runGoogleTool with its keys) and opens the monitor from screen_url.
// show_on_screen executes directly in the client (the monitor is the browser's).
// SINGLE SOURCE (SINGLE BRAIN §1, Adrian: "don't decimate the duplications"):
// the names of the Google skills on voice now come from the single registry
// (brainCapabilities), NOT from a parallel hardcoded list. Zero duplication,
// zero drift — if the registry changes, voice changes too, from one place. The
// voice's ceiling of 31 stays (MEASURED limit of OpenAI Realtime: at 22:09 with
// 31 tools → 201 in 0.4s; at 22:20 with 37 → 504 always). What doesn't fit on
// voice is shown explicitly in `dormantOnVoice()`, never hidden.
export const VOICE_TOOL_NAMES = new Set(
  CAPABILITIES.filter((c) => c.category === 'google' && c.voice).map((c) => c.name),
)

export function realtimeTools(
  dynamic: { name: string; description: string; input_schema: unknown }[] = [],
): { type: 'function'; name: string; description: string; parameters: unknown }[] {
  const fromGoogle = googleTools
    .filter((t) => VOICE_TOOL_NAMES.has(t.name))
    .map((t) => ({
      type: 'function' as const,
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema,
    }))
  // AUTO-EXTENSION: approved dynamic tools, available in voice too — BUT UNDER
  // THE PROVEN CEILING (Jul 28 audit, finding #4): at 31 tools startup gives 201
  // in 0.4s; at 37 it gives 504 on EVERY attempt (the chronology above). Dynamic
  // tools bypassed the ceiling: every skill installed through propose_tool was
  // added ON TOP of the 31 → voice fell back into the 504 outage. We let dynamic
  // tools in only as long as they fit under the threshold; the rest stay in the
  // written chat (where the session doesn't have this limit).
  const MAX_VOICE_TOOLS = 31
  const roomForDynamic = Math.max(0, MAX_VOICE_TOOLS - fromGoogle.length - 13) // 13 = the fixed tools below
  const fromDynamic = dynamic.slice(0, roomForDynamic).map((t) => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }))
  return [
    ...fromGoogle,
    ...fromDynamic,
    {
      // GPS ON REQUEST (the Jul 26 outage: after removing the permanent flow —
      // Adrian's rule "only when location detection is needed" — voice had NO way
      // to learn the position → "GPS is not accessible". This tool executes IN THE
      // BROWSER (the client reads the device's real GPS on the spot), not through
      // /api/realtime/tool.
      type: 'function',
      name: 'get_location',
      description:
        "Read the user's REAL current position from the device GPS, right now. Call it whenever the user asks where they are, says \"here\"/\"near me\", or an answer needs their current location and you don't have FRESH coordinates. Returns lat/lon. Never guess or refuse a location question without calling this first.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      type: 'function',
      name: 'show_on_screen',
      description:
        "Show a web page on the user's monitor (the surface behind you). Call with an empty url to CLEAR the screen when the conversation moves to a new subject.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to display, or empty string to clear the screen.' },
          title: { type: 'string', description: 'Short tab title.' },
        },
        required: ['url'],
      },
    },
    {
      // CODE PLAYGROUND IN VOICE (Adrian, Jul 25): Kelion writes a complete web
      // page and runs it live on the monitor (sandboxed frame); the user can save it.
      type: 'function',
      name: 'run_web_app',
      description:
        "Write a COMPLETE standalone web page (HTML with inline CSS+JS) and run it LIVE on the user's monitor, in a sandboxed frame. Use to build/test a small working thing on the spot: a clock, calculator, to-do list, chart, form, mini-game, animation, demo. The user sees it running and can save it. Prefer this over show_on_screen whenever the user asks you to build/make/test a page, app, widget, clock, calculator or game — never embed an external site for these. Self-contained (no network-loaded scripts).",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short panel title / save file name.' },
          html: { type: 'string', description: 'The FULL self-contained HTML document (inline CSS + JS).' },
        },
        required: ['title', 'html'],
      },
    },
    {
      // REAL ACCESS TO THE APP (Adrian, Jul 24: "in full-duplex Kelion must be
      // able to enter any tab of the app, for real"). Opens the app's own panels
      // by voice — the client executes directly (it's its UI). Batch C: the
      // declaration comes from the SINGLE source (brainToolDefs) and is CONVERTED
      // to the Realtime format. Before, it was rewritten here letter by letter —
      // if a new panel appeared, voice and writing silently diverged.
      type: 'function',
      name: OPEN_APP_VIEW_TOOL.name,
      description: OPEN_APP_VIEW_TOOL.description ?? '',
      parameters: OPEN_APP_VIEW_TOOL.input_schema,
    },
    {
      // VISION IN VOICE (Adrian: "why doesn't it see?"). Kelion looks through the
      // user's camera. The client injects the current frame into `image` before
      // sending the call to the server (see ChatPanel onToolCall).
      type: 'function',
      name: 'get_monitor',
      description:
        "See what is FACTUALLY on YOUR MONITOR right now — the surface AND its real render state (stareReala: 'ok' rendered, 'error' failed, 'loading'). Call it when the user asks what's on screen, AND right after you show something to confirm it truly appeared. If stareReala is 'error', do NOT say you showed it — try another way and repeat until 'ok'. This is NOT the camera — the physical world goes through look.",
      parameters: { type: 'object', properties: {} },
    },
    {
      type: 'function',
      name: 'look',
      description:
        "Look through the user's CAMERA at the physical world in front of them RIGHT NOW. Call this ONLY when the context clearly refers to the camera or the real space: 'mă vezi?', 'ce vezi pe cameră?', 'uită-te la asta', 'citește ce-ți arăt'. NEVER for questions about the MONITOR/screen content ('ce e pe monitor?', 'ce mi-ai afișat?') — for those call get_monitor instead; answering a monitor question with the camera is a serious mistake.",
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Optional: what specifically to look for or read.' },
        },
        required: [],
      },
    },
    {
      type: 'function',
      name: 'generate_image',
      description: 'Generate an image from a text prompt and show it on the monitor.',
      parameters: {
        type: 'object',
        properties: { prompt: { type: 'string', description: 'What to draw.' } },
        required: ['prompt'],
      },
    },
    {
      // ESCALATION IN VOICE (Adrian, Jul 24: "automatically scale the models by
      // difficulty level, from live voice chat up to very heavy requests"): on a
      // HEAVY request, the voice model hands the question to the BRAIN (the work
      // model — Claude/GPT through OpenRouter) and speaks the expert's answer.
      type: 'function',
      name: 'ask_brain',
      description:
        "The SINGLE BRAIN behind you — the same one that answers in writing. Call it for ANY request that needs a real answer: knowledge, facts, an explanation, advice, an opinion, a decision, analysis, coding, math, reasoning — i.e. almost everything except pure device/display actions and small-talk. Pass the user's FULL request with any context; you get back the answer to speak aloud (summarize naturally, no markdown). You are the MOUTH of this brain, not the source of answers — do not answer substantive things yourself.",
      parameters: {
        type: 'object',
        properties: {
          request: { type: 'string', description: "The user's full request, with any needed context." },
        },
        required: ['request'],
      },
    },
    // VOICE↔CHAT PARITY (Adrian, Jul 25: "all enabled, Kelion must be able to use
    // them"): notes, memory, gestures, role — callable from voice too, as in writing.
    {
      type: 'function',
      name: 'save_note',
      description: 'Save a short note for the user to remember later.',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'The note text.' } }, required: ['text'] },
    },
    {
      type: 'function',
      name: 'list_notes',
      description: "List the user's saved notes.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      type: 'function',
      name: 'delete_note',
      description: 'Delete a saved note by its id.',
      parameters: { type: 'object', properties: { id: { type: 'number', description: 'The note id to delete.' } }, required: ['id'] },
    },
    {
      type: 'function',
      name: 'play_avatar_gesture',
      description:
        "Make the avatar perform a short gesture — YOU direct the movement: bind it to the action in progress. Presenting something on the monitor (weather, map, document) → 'arata-inainte' (point with the right hand at the screen) WHILE you present it; greeting → 'salut'; thanks → 'multumire'; good news → 'entuziasm'; thinking → 'ganditor'; also: uimire, surpriza, aprobare, acord-discret, stai-putin, dezamagire, nedumerire, victorie, plecaciune, dans (only if explicitly asked). Composed gentleman: nothing on neutral replies, never the same gesture twice in a row.",
      parameters: { type: 'object', properties: { gesture: { type: 'string', description: 'Gesture name.' } }, required: ['gesture'] },
    },
    {
      type: 'function',
      name: 'set_active_role',
      description: "Set or clear the user's active professional role (meserie). Pass id 0 to clear.",
      parameters: { type: 'object', properties: { id: { type: 'number', description: 'Role id, or 0 to clear.' } }, required: ['id'] },
    },
  ]
}

// THE FAILURE REASON, MACHINE-READABLE (Jul 28): the client got only "502" and
// could neither explain to the user nor decide whether a retry was worth it. The
// codes from here go up unchanged in the route's JSON body.
export type RealtimeFailCode =
  | 'realtime_not_configured' // we have no key — not the upstream's fault
  | 'upstream_timeout' // we cut the wire: OpenAI's edge didn't answer in time
  | 'upstream_unreachable' // network down / DNS / TLS
  | 'upstream_5xx' // 500/502/503/504 from OpenAI's edge (the Cloudflare page)
  | 'upstream_empty' // 2xx but empty SDP answer → the browser has nothing to negotiate
  | 'upstream_refuz' // 4xx: our request is wrong (don't retry)

export type RealtimeAnswer =
  | { ok: true; sdp: string }
  | { ok: false; status: number; code: RealtimeFailCode; error: string; attempts: number }

// ── THE ROBUSTNESS OF VOICE STARTUP (Jul 28) ──────────────────────────────────
// Budgets MEASURED on real traffic, not guessed:
//   • a HEALTHY start returns 201 in ~0.4s (3/3 reproductions, Jul 27);
//   • a SICK one burns ~15s and returns 504 with a Cloudflare HTML page.
// So 6s is already 15 times a healthy start's budget: what hasn't answered by
// then won't answer at all. We cut the wire OURSELVES before the edge reaches
// its own ~15s 504 and spend the saved seconds on a NEW connection — that's the
// difference between 3 real chances and a single long useless one.
const ATTEMPT_TIMEOUT_MS = 6_000
const MAX_ATTEMPTS = 3
// The route's TOTAL ceiling: the user sits with the microphone open, staring at
// the screen. 6s + 0.35s + 6s + 1s + 6s = 19.35s worst case — all 3 attempts
// get the full window and we still exit faster than the previous 31s, when there
// were only two attempts on the same broken connection.
const TOTAL_BUDGET_MS = 21_000

/** THE VOICE LEAVING FOR OPENAI, chosen among the ones we know.
 *
 *  An unknown name — from an old database, from a list changed at OpenAI, or
 *  simply empty — falls back to the default voice and is NOT sent to the API. If
 *  it were sent, the session would return 400 and the person would be left
 *  without voice, with no way to suspect that the culprit is a preference once
 *  saved in their account.
 *
 *  Pure and exported so it can be tested without network. */
export function resolveVoice(cerut?: string | null): string {
  return cerut && config.openai.realtimeVoices.includes(cerut) ? cerut : config.openai.realtimeVoice
}

// Relay an SDP offer to OpenAI Realtime and return the SDP answer.
export async function openaiRealtimeAnswer(
  offerSdp: string,
  lang: string,
  meserie?: string | null,
  hardLock = false,
  contextBlock = '',
  voicePref?: string | null,
): Promise<RealtimeAnswer> {
  if (!config.openai.key)
    return { ok: false, status: 503, code: 'realtime_not_configured', error: 'realtime_not_configured', attempts: 0 }

  // Approved dynamic tools (auto-extension) — in voice too.
  const { dynamicToolDefs } = await import('./dynamicTools.js')
  const dynamic = await dynamicToolDefs().catch(() => [])

  // The ISO-639-1 code of the user's language — a HINT for transcription ONLY
  // when the language is KNOWN (persisted). When it isn't (new user), we fix
  // NOTHING — transcription detects the spoken language on its own (otherwise
  // we'd have pushed it wrongly toward a specific language and "misinterpreted"
  // it — the bug seen live with French).
  const iso = /^[a-z]{2}$/.test((lang || '').toLowerCase()) ? lang.toLowerCase() : ''

  const persona = realtimeInstructions(lang, meserie, hardLock)
  const ctx = contextBlock || ''
  const tools = realtimeTools(dynamic)

  // THE SESSION, WITH ONE DEGRADATION STEP (Jul 28). Sizes MEASURED on the live
  // source, not estimated: persona + the 31 tools = ~18KB (of which ~13.8KB the
  // tools and ~5.4KB just their descriptions), plus context (memory + 20
  // replies) → ~26KB in total. We do NOT remove tools from the session: tools
  // ARE the way voice acts, and the API's "tools per response" variant would
  // move the decision into the client (another file, another chunk of code) — a
  // much bigger rewrite than the problem. On the LAST attempt, though, we send a
  // slimmed session: the same NAMES and the same PARAMETERS (so voice can still
  // call ANY tool), only the descriptions shortened and the context capped —
  // ~8KB less. If the upstream really is drowning in the body, we still start
  // with full voice; if not, we've lost nothing: on the happy path (attempt 1)
  // the session leaves untouched.
  const voceAleasa = resolveVoice(voicePref)

  const buildSession = (slim: boolean, model: string, voice: string): Record<string, unknown> => ({
    type: 'realtime',
    model,
    audio: {
      // ── ULTRA-PERFORMANT AUDIO DETECTION (Adrian, Jul 24: "audio detection
      // broken") ─────────────────────────────────────────────────────────────
      input: {
        // Ambient noise reduction (microphone near the mouth) → VAD and
        // transcription no longer trip over background, room, echo.
        noise_reduction: { type: 'near_field' },
        // Transcription of the user's speech with the BIG model (not "mini") +
        // the language hint ONLY when known → exact transcript. Without this, GA
        // NEVER emits the user's transcript.
        transcription: iso
          ? { model: config.openai.realtimeTranscribeModel, language: iso }
          : { model: config.openai.realtimeTranscribeModel },
        // SEMANTIC VAD: a model decides when the user has truly finished
        // speaking (not on raw silence). `interrupt_response:true` = real barge-in.
        // THE NAME GATE, MECHANICAL (Adrian's order: "Kelion must not initiate
        // conversations; it doesn't enter the chat unless it hears its name").
        // The rule in the prompt alone kept losing — with `create_response:true`
        // the model took the floor on ANY phrase. Now the response is NOT
        // created automatically: the CLIENT (realtimeVoice.ts) creates it ONLY if
        // the transcript contains the name ("Kelion"/"Kei", regex tolerant of
        // mangled transcription) OR the conversation is already active (a 120s
        // window renewed at every exchange, OPEN at session start — the "it
        // can't hear me" lesson from Jul 24/27). Anti-deafness nets in the
        // client: missing transcript after speech_stopped → answer anyway if the
        // conversation is active. "STOP" closes the window until the next name.
        turn_detection: {
          type: 'semantic_vad',
          eagerness: config.openai.realtimeVadEagerness,
          create_response: false,
          interrupt_response: true,
        },
      },
      output: { voice },
    },
    // A SINGLE injection (Jul 25 — Adrian: "you're injecting for the umpteenth
    // time, you're duplicating"). Instructions + context (memory + history) go in
    // HERE, in the initial session, which is ACCEPTED by OpenAI (201). There is
    // no second layer through session.update anymore — that was exactly the
    // duplication.
    // THE PERSONA IS NEVER CUT (language, the name gate, the deed rule) — we only
    // cap the CONTEXT, the variable and fattest part.
    instructions: persona + (slim ? ctx.slice(0, 1200) : ctx),
    // Voice autonomy: the same tools as in the written chat (see realtimeTools).
    tools: slim ? tools.map((t) => ({ ...t, description: t.description.slice(0, 160) })) : tools,
    // DON'T RAISE THIS TO 'required' — a rule, not a preference. At SESSION level,
    // 'required' forces the model to call a tool on EVERY response, including the
    // response that processes the previous tool's result → a tool loop it never
    // exits and Kelion never speaks at all.
    // Enforcing the deed is done PER RESPONSE, from the client, only on order
    // turns: { type:'response.create', response:{ tool_choice:'required' | {type:'function',name} } }
    // The next turn returns to 'auto' on its own, without session.update. See
    // frontend/src/lib/realtimeVoice.ts (the deed gate in voice).
    tool_choice: 'auto',
  })

  // THE BODY IS REBUILT ON EVERY ATTEMPT.
  // The suspicion "a FormData is consumed once, so the retry resends an empty
  // body" was MEASURED, not assumed: on Node 22.22.2 (undici), the same FormData
  // object resent 3 times put the WHOLE body on the wire every time (19218
  // bytes, with Content-Length, no chunked). So that's NOT what broke the Jul 27
  // retry. We rebuild it per attempt anyway, because the last one sends a
  // DIFFERENT (slimmed) session — and because a rebuilt body is immune to any
  // future undici change anyway.
  const buildForm = (slim: boolean, model: string, voice: string): FormData => {
    const form = new FormData()
    form.append('sdp', offerSdp)
    // AS A STRING, NOT A BLOB (Jul 25 — the 3rd "speaks Russian" + "doesn't
    // see/escalate in voice" incident): the Blob went into form-data as a FILE
    // (filename="blob") and OpenAI's parser IGNORED it — that's why
    // "missing_model" asked for the model in the URL although it was in the JSON:
    // the session was NOT read AT ALL. So neither the instructions, nor the
    // voice, nor the language, nor the tools ever applied — the model ran on
    // DEFAULT (mirrored the perceived language, answered noise). A plain string =
    // a normal form field, parsed.
    form.append('session', JSON.stringify(buildSession(slim, model, voice)))
    return form
  }

  // FINAL VOICE FIX (live proof Jul 24: OpenAI "missing_model"): the GA Realtime
  // API requires the model as a URL PARAMETER, not only in the session JSON.
  // MODEL CASCADE (Jul 28 — live proof: `gpt-realtime` returned Cloudflare 504
  // on ALL 3 attempts, with a valid key and a live endpoint; retrying on the
  // same dead model = zero chances). Attempt 1 = the main model; subsequent
  // attempts move to the fallback models from config/env.
  const models = [config.openai.realtimeModel, ...config.openai.realtimeModelFallbacks].filter(
    (m, i, a) => a.indexOf(m) === i,
  )
  const callsUrlFor = (model: string): string => `${OPENAI_CALLS}?model=${encodeURIComponent(model)}`

  // ── WHY THE TIMEOUT "DIDN'T FIRE", although the route held 31s ─────────────
  // Nothing was broken: AbortSignal.timeout(20s) was armed correctly, PER
  // attempt, and started right at fetch. Only no attempt ever reached 20s —
  // OpenAI's edge (Cloudflare) closed on its own with 504 around ~15s, so the
  // fetch finished NORMALLY, response in hand. The 31s in the log are exactly
  // 15s (attempt 1) + 0.9s pause + 15s (attempt 2): the time DOUBLED by the
  // added retry, not a hung fetch. Conclusion: a 20s ceiling is greater than the
  // upstream's real patience, so it never gets to be useful. Now we cut at 10s
  // and spend the difference on something else.
  //
  // ── AND WHY THE RETRY DIDN'T HELP ───────────────────────────────────────────
  // Because it left on the SAME connection: undici keeps the socket in the pool
  // even after a 504, and the retry 0.9s later re-entered exactly the path that
  // had just failed → the same 504, predictably. From the second attempt on we
  // request a NEW connection. Verified locally on Node 22.22.2: 3 requests
  // without the header = 2 sockets (reuse), 3 requests with `Connection: close`
  // = 3 sockets (zero reuse).
  //
  // Short and growing pause: we skip a few-hundred-ms hiccup of the edge, but if
  // it's a real outage we don't burn the budget standing idle.
  const pause = (attempt: number): Promise<void> =>
    new Promise((res) => setTimeout(res, attempt === 1 ? 350 : 1_000))

  const startedAt = Date.now()
  let lastStatus = 502
  let lastErr = ''
  let lastCode: RealtimeFailCode = 'upstream_unreachable'
  let attempts = 0

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Don't start an attempt that can't fit in the remaining budget anyway — it
    // would keep the user hanging on a request we ourselves abandon.
    const left = TOTAL_BUDGET_MS - (Date.now() - startedAt)
    if (left < 2_000) break
    attempts = attempt

    const headers: Record<string, string> = { Authorization: `Bearer ${config.openai.key}` }
    if (attempt > 1) headers.connection = 'close'
    // This attempt's model: 1 = main, 2+ = the cascade's fallbacks. If no
    // fallbacks are configured, the main one stays (the old behavior).
    const model = models[Math.min(attempt - 1, models.length - 1)]

    let r: Response
    try {
      r = await fetch(callsUrlFor(model), {
        method: 'POST',
        headers,
        // SLIM FROM THE SECOND ATTEMPT (Jul 28 audit, finding #4): before, only
        // the 3rd attempt slimmed the session — attempts 1-2 each burned ~6s with
        // the full body. If the first (full body) failed, the second already goes
        // lean: more real chances in the same time budget.
        // THE CHOSEN VOICE only on the first attempt. If the first fails, the
        // second leaves on the default voice: a person's preference must not
        // leave their voice dead, however exotic the name saved in their account.
        body: buildForm(attempt >= 2, model, attempt === 1 ? voceAleasa : config.openai.realtimeVoice),
        signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, left)),
      })
    } catch (e) {
      // AbortError/TimeoutError = OUR ceiling (the upstream was too slow);
      // anything else = network/DNS/TLS. Both are retried — that was missing.
      const nume = (e as Error | undefined)?.name ?? ''
      const expirat = nume === 'AbortError' || nume === 'TimeoutError'
      lastCode = expirat ? 'upstream_timeout' : 'upstream_unreachable'
      lastStatus = expirat ? 504 : 502
      lastErr = `${lastCode}: ${String(e).slice(0, 160)}`
      if (attempt < MAX_ATTEMPTS) {
        await pause(attempt)
        continue
      }
      break
    }

    const text = await r.text().catch(() => '')
    if (r.ok && text.trim()) return { ok: true, sdp: text }
    if (r.ok) {
      // 2xx WITH AN EMPTY BODY is still a dead start: the browser would throw on
      // setRemoteDescription and the user would see "no voice" at a cheerful 200.
      lastCode = 'upstream_empty'
      lastStatus = 502
      lastErr = 'empty SDP answer from upstream'
      if (attempt < MAX_ATTEMPTS) {
        await pause(attempt)
        continue
      }
      break
    }

    lastStatus = r.status
    lastErr = text.slice(0, 300)
    // 5xx (including the 504 with the Cloudflare page), 408 and 429 = TRANSIENT
    // edge trouble → try again. The rest of 4xx = our request is wrong
    // ("missing_model", invalid key): retrying would only delay the real error
    // by a few seconds, with no extra chance.
    const trecator = r.status >= 500 || r.status === 408 || r.status === 429
    lastCode = trecator ? 'upstream_5xx' : 'upstream_refuz'
    // With a model cascade, a clean refusal (4xx) on the CURRENT model doesn't
    // bury the start if the next attempt would use a DIFFERENT model (e.g. a
    // wrong fallback name → 404; the next in the list may be good). With no new
    // models to try, the behavior stays exactly the old one: 4xx = stop.
    const nextModel = models[Math.min(attempt, models.length - 1)]
    if (attempt < MAX_ATTEMPTS && (trecator || nextModel !== model)) {
      await pause(attempt)
      continue
    }
    break
  }
  return { ok: false, status: lastStatus, code: lastCode, error: lastErr, attempts }
}
