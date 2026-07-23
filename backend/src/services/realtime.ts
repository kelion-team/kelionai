import { config } from '../config.js'
import { langLabel } from './lang.js'

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
