import { config } from '../config.js'
import { langLabel } from './lang.js'
import { googleTools } from './google.js'

// ── VOCE LIVE — proxy SDP către OpenAI Realtime (WebRTC) ─────────────────────
// Arhitectura (reconstruită fidel din aplicația live, adusă în git ca sursă
// unică): browserul face oferta WebRTC și trimite SDP-ul la backend; backendul
// îl relayează la OpenAI cu cheia ascunsă pe server și INJECTEAZĂ server-side
// modelul, o SINGURĂ voce masculină și persona/limba persistată a userului.
// Clientul nu vede niciodată cheia, modelul sau vocea — le controlăm noi.
//
// Contract OpenAI verificat LIVE cu cheia reală (22 iul):
//   POST https://api.openai.com/v1/realtime/calls
//   Authorization: Bearer <OPENAI_KEY>
//   multipart/form-data: sdp=<oferta browserului>, session=<JSON config>
//   → întoarce answer-ul SDP (text). `audio.output.voice` fixează vocea;
//     `instructions` fixează persona + limba; `model` alege modelul realtime.

const OPENAI_CALLS = 'https://api.openai.com/v1/realtime/calls'

// Persona Kelion pentru VOCE — consistentă cu voiceTurn.ts (ton cald, scurt,
// vorbit), plus blocajul ABSOLUT de limbă (aceeași regulă ca în chat): Kelion
// vorbește EXCLUSIV în limba persistată a userului, orice ar auzi.
export function realtimeInstructions(lang: string, meserie?: string | null, hardLock = false): string {
  const rol = meserie
    ? ` Ai rolul activ ales de utilizator: „${meserie}" — răspunde din perspectiva acestui rol.`
    : ''
  const persona =
    `Ești Kelion, un asistent AI cu o SINGURĂ voce masculină, caldă, calmă și ` +
    `naturală. Vorbești ca într-o conversație reală: propoziții scurte (1–3), ` +
    `fără liste, fără markdown, fără emoji, fără să enumeri pași dacă nu ți se cere. ` +
    `Ești chemat pe nume „Kelion". Te porți mereu ca un gentleman: politicos, ` +
    `respectuos, calm — NICIODATĂ grosolan, vulgar sau strident.` +
    // OCHI + ESCALADARE (Adrian: „de ce nu vede, de ce nu escaladează?"). Vocea
    // avea uneltele, dar nu i se spunea să le folosească → nu vedea, nu urca.
    ` Ai OCHI: poți vedea prin camera utilizatorului. Când te întreabă ce vezi, ` +
    `îți arată ceva, îți cere să te uiți sau să citești ceva, ori vrea descrisă ` +
    `scena/un obiect — cheamă unealta „look" și spune ce vezi.` +
    ` Pentru cereri GRELE (analiză, cod, matematică, raționament lung, planificare, ` +
    `explicații aprofundate) NU improviza: cheamă unealta „ask_brain" cu întrebarea ` +
    `completă și rostește natural răspunsul expertului. Cererile simple le răspunzi direct.` +
    rol
  // LIMBA (Adrian, 24 iul: „default engleză; când mă aude, schimbă TOT pe limba
  // mea și o menține per user"). Dacă userul ARE deja o limbă stabilită, o
  // păstrăm (consistență între sesiuni). Dacă NU (user nou, limbă nedetectată),
  // pornim în ENGLEZĂ și OGLINDIM limba pe care o vorbește userul, stabil.
  //
  // GARDĂ DE LIMBĂ (Adrian, 24 iul: „vorbește în altă limbă" — dovadă live:
  // Kelion răspundea în RUSĂ la vorbire românească). Fără ancoră, transcrierea
  // audio ghicea printre TOATE limbile și auzea româna ca rusă. Constrângem
  // vocea EXCLUSIV la cele 7 limbi ale aplicației; orice nesiguranță → ENGLEZĂ;
  // niciodată rusă/ucraineană sau altceva din afara listei.
  const SUPPORTED = 'English, Romanian, French, Spanish, Portuguese, Italian, German'
  const guard =
    `\n\nLANGUAGE — HARD RULES: You may speak ONLY in one of these languages: ` +
    `${SUPPORTED}. NEVER answer in Russian, Ukrainian, or any language outside ` +
    `this list. If you are ever unsure which language you heard, answer in ` +
    `English. Never mix two languages in one reply.`
  const known = /^[a-z]{2}$/.test(lang)
  // HARD LOCK (Adrian, admin, în Italia): „adminul primește română MEREU,
  // indiferent ce aude". Fără lock, când Adrian aude/spune italiană vocea comuta
  // pe italiană → „2 voci: ro și italiană". Cu lock, limba NU se schimbă NICIODATĂ.
  const limba = hardLock && known
    ? `\n\nLIMBĂ: vorbește EXCLUSIV în ${langLabel(lang)}, MEREU, pentru tot ` +
      `restul conversației. NU comuta NICIODATĂ pe altă limbă, orice ai auzi — ` +
      `chiar dacă utilizatorul sau fundalul e în italiană, engleză sau altceva, ` +
      `tu răspunzi tot în ${langLabel(lang)}.`
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

// ── UNELTELE VOCII (Adrian, 24 iul: „nu apelează instrumentele, îi lipsesc
// instrumente de a afișa pe ecran... de ce nu e autonom") ────────────────────
// Sesiunea Realtime primea DOAR persona — zero funcții → în voce Kelion nu
// putea afișa nimic și nu era autonom. Acum primește ACELEAȘI unelte ca chatul
// scris (subsetul relevant): clientul primește apelul pe dataChannel, îl
// execută prin POST /api/realtime/tool (serverul rulează runGoogleTool cu
// cheile lui) și deschide monitorul din screen_url. show_on_screen se execută
// direct în client (monitorul e al browserului).
const VOICE_TOOL_NAMES = new Set([
  'web_search', 'get_weather', 'maps_search', 'maps_directions', 'youtube_search',
  'translate_text', 'wikipedia_lookup', 'convert_currency', 'get_time',
  'get_calendar_events', 'get_recent_emails', 'send_email', 'create_calendar_event',
  'get_drive_files', 'get_tasks', 'add_task', 'search_contacts', 'add_contact',
])

export function realtimeTools(): { type: 'function'; name: string; description: string; parameters: unknown }[] {
  const fromGoogle = googleTools
    .filter((t) => VOICE_TOOL_NAMES.has(t.name))
    .map((t) => ({
      type: 'function' as const,
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema,
    }))
  return [
    ...fromGoogle,
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
      // ACCES REAL LA APLICAȚIE (Adrian, 24 iul: „în full-duplex Kelion trebuie
      // să poată intra în orice tab al aplicației, real"). Deschide panourile
      // proprii ale aplicației prin voce — clientul execută direct (e UI-ul lui).
      type: 'function',
      name: 'open_app_view',
      description:
        "Open a panel/tab INSIDE the Kelionai app on the user's screen (not a web page). Use when the user asks to open settings, their wallet/credits, contact, the admin panel, or go back to the main screen. For the admin panel you may also pass a section.",
      parameters: {
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
            enum: ['finance', 'users', 'visitors', 'vchat', 'history', 'gaps', 'share', 'stores', 'inbox'],
            description: 'Optional admin section (only when view=admin).',
          },
        },
        required: ['view'],
      },
    },
    {
      // VEDEREA ÎN VOCE (Adrian: „de ce nu vede?"). Kelion privește prin camera
      // userului. Clientul injectează cadrul curent în `image` înainte de a
      // trimite apelul la server (vezi ChatPanel onToolCall).
      type: 'function',
      name: 'look',
      description:
        "Look through the user's camera and see what is in front of them RIGHT NOW. Call this whenever the user asks what you see, asks you to look at or read something they show you, or to describe their surroundings or an object.",
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
      // ESCALADAREA ÎN VOCE (Adrian, 24 iul: „incrementează automat modelele pe
      // nivel de dificultate, de la chat live voce până la cereri foarte grele"):
      // la o cerere GREA, modelul de voce predă întrebarea CREIERULUI (modelul
      // work — Claude/GPT prin OpenRouter) și rostește răspunsul expertului.
      type: 'function',
      name: 'ask_brain',
      description:
        "HEAVY requests only — deep analysis, architecture, coding, math, long multi-step reasoning, anything that needs an expert brain. Pass the user's full request; you get back the expert answer to read aloud (summarize naturally, do not read markdown).",
      parameters: {
        type: 'object',
        properties: {
          request: { type: 'string', description: "The user's full request, with any needed context." },
        },
        required: ['request'],
      },
    },
  ]
}

export type RealtimeAnswer =
  | { ok: true; sdp: string }
  | { ok: false; status: number; error: string }

// Relay o ofertă SDP la OpenAI Realtime și întoarce answer-ul SDP.
export async function openaiRealtimeAnswer(
  offerSdp: string,
  lang: string,
  meserie?: string | null,
  hardLock = false,
): Promise<RealtimeAnswer> {
  if (!config.openai.key) return { ok: false, status: 503, error: 'realtime_not_configured' }

  // Codul ISO-639-1 al limbii userului — INDICIU pentru transcriere DOAR când
  // limba e CUNOSCUTĂ (persistată). Când nu e (user nou), NU fixăm nimic —
  // transcrierea detectează singură limba vorbită (altfel am fi împins-o greșit
  // spre o limbă anume și „interpreta greșit" — bug-ul văzut live cu franceza).
  const iso = /^[a-z]{2}$/.test((lang || '').toLowerCase()) ? lang.toLowerCase() : ''

  const session = {
    type: 'realtime',
    model: config.openai.realtimeModel,
    audio: {
      // ── DETECȚIE AUDIO ULTRA-PERFORMANTĂ (Adrian, 24 iul: „detecția audio
      // defectă") ──────────────────────────────────────────────────────────
      input: {
        // Reducere de zgomot ambiental (microfon aproape de gură) → VAD-ul și
        // transcrierea nu se mai încurcă în fundal, cameră, ecou.
        noise_reduction: { type: 'near_field' },
        // Transcrierea vorbirii userului cu modelul MARE (nu „mini") + indiciul
        // de limbă DOAR când e cunoscută → transcript exact. Fără asta, GA nu
        // emite NICIODATĂ transcriptul userului.
        transcription: iso
          ? { model: config.openai.realtimeTranscribeModel, language: iso }
          : { model: config.openai.realtimeTranscribeModel },
        // VAD SEMANTIC: un model decide când userul chiar a terminat de vorbit
        // (nu pe tăcere brută). `create_response:true` = Kelion răspunde când
        // termini de vorbit (full-duplex RESPONSIV — auzul NU are voie să pice),
        // `interrupt_response:true` = barge-in real. NOTĂ: cuvântul de trezire
        // strict (`create_response:false` + gating pe „Kelion") a fost SCOS
        // definitiv — dacă transcrierea nu prindea EXACT numele, Kelion nu mai
        // răspundea deloc („nu mă aude"). Kelion răspunde când termini de vorbit.
        turn_detection: {
          type: 'semantic_vad',
          eagerness: config.openai.realtimeVadEagerness,
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice: config.openai.realtimeVoice },
    },
    instructions: realtimeInstructions(lang, meserie, hardLock),
    // Autonomia vocii: aceleași unelte ca în chatul scris (vezi realtimeTools).
    tools: realtimeTools(),
    tool_choice: 'auto',
  }

  const form = new FormData()
  form.append('sdp', offerSdp)
  form.append(
    'session',
    new Blob([JSON.stringify(session)], { type: 'application/json' }),
  )

  let r: Response
  try {
    // FIX FINAL VOCE (dovadă live 24 iul: OpenAI „missing_model"): API-ul Realtime
    // GA cere modelul ca PARAMETRU ÎN URL, nu doar în JSON-ul de sesiune.
    const callsUrl = `${OPENAI_CALLS}?model=${encodeURIComponent(config.openai.realtimeModel)}`
    r = await fetch(callsUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openai.key}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e) {
    return { ok: false, status: 502, error: `upstream_unreachable: ${String(e).slice(0, 120)}` }
  }

  const text = await r.text().catch(() => '')
  if (!r.ok) return { ok: false, status: r.status, error: text.slice(0, 300) }
  return { ok: true, sdp: text }
}
