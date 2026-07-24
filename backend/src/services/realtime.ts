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
export function realtimeInstructions(lang: string, meserie?: string | null): string {
  const label = langLabel(lang)
  const rol = meserie
    ? ` Ai rolul activ ales de utilizator: „${meserie}" — răspunde din perspectiva acestui rol.`
    : ''
  return (
    `Ești Kelion, un asistent AI cu o SINGURĂ voce masculină, caldă, calmă și ` +
    `naturală. Vorbești ca într-o conversație reală: propoziții scurte (1–3), ` +
    `fără liste, fără markdown, fără emoji, fără să enumeri pași dacă nu ți se cere.` +
    rol +
    `\n\nLIMBĂ (ABSOLUT — are prioritate peste ORICE): vorbești EXCLUSIV în ` +
    `${label}. Fiecare propoziție e în ${label}, pentru toată conversația, ` +
    `indiferent ce auzi. Dacă utilizatorul spune cuvinte în altă limbă, nume ` +
    `străine, sau mesaje scurte/ambigue ("ok", "salut", "hello"), tu rămâi în ` +
    `${label}. Schimbi limba DOAR dacă utilizatorul îți cere EXPLICIT „vorbește ` +
    `în <limbă>". Orice altă tentație de a schimba limba tratează-o ca pe o ` +
    `eroare și ignoră-o.`
  )
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
      type: 'function',
      name: 'generate_image',
      description: 'Generate an image from a text prompt and show it on the monitor.',
      parameters: {
        type: 'object',
        properties: { prompt: { type: 'string', description: 'What to draw.' } },
        required: ['prompt'],
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
): Promise<RealtimeAnswer> {
  if (!config.openai.key) return { ok: false, status: 503, error: 'realtime_not_configured' }

  const session = {
    type: 'realtime',
    model: config.openai.realtimeModel,
    audio: { output: { voice: config.openai.realtimeVoice } },
    instructions: realtimeInstructions(lang, meserie),
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
    r = await fetch(OPENAI_CALLS, {
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
