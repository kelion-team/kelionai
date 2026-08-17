// ── MESSENGER KELION↔KELION — TRADUCEREA LIVE (Faza 2, Adrian: „traducător live
// prin kelion; eu vorbesc ro, celălalt aude în limba lui și invers") ────────────
// Peste canalul de apel din Faza 1: o frază rostită de A vine ca `{type:'vorbire'}`,
// Gemini o TRANSCRIE + TRADUCE în limba lui B, Chirp o ROSTEȘTE în limba lui B, iar
// rezultatul (text + audio) pleacă la B ca `{type:'tradus'}`. Simetric pe invers.
// Fiecare pas e contorizat (recordCost) — costul nu se pierde.
import type { OrMessage } from './brainContract.js'
import { config } from '../config.js'
import { rationeazaMesaje } from './creierRationament.js'
import { synthesize } from './tts.js'
import { ttsCost } from './cost.js'
import { getSpeechLang, recordCost } from '../db.js'
import { gasesteApel, trimiteCatre } from './apel.js'

function numeLimba(cod: string): string {
  const baza = (cod || 'en').split('-')[0]
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(baza) || baza
  } catch {
    return baza
  }
}

/** Limba în care AUDE userul `email` (preferința salvată; altfel engleză). */
async function limbaUserului(email: string): Promise<string> {
  try {
    const l = await getSpeechLang(email)
    return l && l.trim() ? l.trim() : 'en'
  } catch {
    return 'en'
  }
}

/** O frază rostită de `deLaEmail` într-un apel → tradusă + rostită la celălalt.
 *  Nu aruncă niciodată (rulează din handlerul WS): la orice pas picat, tace. */
export async function traduVorbire(deLaEmail: string, msg: unknown): Promise<void> {
  if (!msg || typeof msg !== 'object') return
  const m = msg as { callId?: unknown; audio?: unknown; mime?: unknown }
  const callId = typeof m.callId === 'string' ? m.callId : ''
  const audio = typeof m.audio === 'string' ? m.audio : ''
  const mime = typeof m.mime === 'string' && m.mime ? m.mime : 'audio/webm'
  if (!callId || !audio) return

  const apel = gasesteApel(callId)
  if (!apel) return
  const de = deLaEmail.toLowerCase()
  if (apel.deLaEmail !== de && apel.catreEmail !== de) return // nu ești în apel
  const catre = apel.deLaEmail === de ? apel.catreEmail : apel.deLaEmail
  const numeDe = apel.deLaEmail === de ? apel.deLaNume : apel.catreNume

  const limbaCatre = await limbaUserului(catre)
  const limbaNume = numeLimba(limbaCatre)

  // 1) AUDIO → TRADUCERE (Gemini, nativ pe voce). Un singur apel: aude fraza și
  //    scoate direct traducerea în limba lui B.
  let text = ''
  try {
    const mesaje: OrMessage[] = [
      {
        role: 'system',
        content:
          `You are a live phone interpreter on a call. The audio is ONE person speaking. ` +
          `Transcribe what they say and translate the meaning into ${limbaNume} (${limbaCatre}). ` +
          `Output ONLY the translation in ${limbaNume}, in a natural spoken style — no quotes, ` +
          `no notes, no speaker labels, no original text. If there is no intelligible speech, output nothing.`,
      },
      {
        role: 'user',
        content: [{ type: 'audio_url', audio_url: { url: `data:${mime};base64,${audio}` } }],
      },
    ]
    const r = await rationeazaMesaje(mesaje, { ruta: 'service.apelTraducere', treapta: 'rapid' })
    text = (r.text || '').trim()
    if (r.costUsd > 0) void recordCost(de, 'gemini', r.costUsd)
  } catch {
    return // urechea a picat — nu inventăm o traducere
  }
  if (!text) return

  // 2) TRADUCERE → VOCE (Chirp, în limba lui B). Dacă TTS pică, tot trimitem
  //    textul (subtitrarea), ca B să vadă măcar ce s-a spus.
  let audioB64 = ''
  try {
    const tts = await synthesize(text, limbaCatre, {})
    if (tts.ok) {
      audioB64 = tts.audio.toString('base64')
      void recordCost(catre, 'tts:google', ttsCost(text.length))
    }
  } catch {
    /* fără voce — rămâne subtitrarea */
  }

  // 3) La B: subtitrarea (în limba lui) + vocea. `de_la` = numele celui care a vorbit.
  trimiteCatre(catre, { type: 'tradus', callId, text, audio: audioB64, de_la: numeDe })
}

// ── HANDS-FREE: „SPUI RĂSPUNDE ȘI SE FACE LEGĂTURA" (Adrian) ────────────────────
// Cât sună un apel, ce spune cel sunat se clasifică din voce: ANSWER / DECLINE /
// NONE. Independent de limbă (Gemini decide din audio), ca să meargă „răspunde",
// „da", „answer", „pronto"… fără listă de cuvinte pe fiecare limbă. Doar în timpul
// sonorului; costă un apel Gemini pe frază (mic — o vorbă), contorizat.
export async function intentApel(email: string, audioB64: string, mime: string): Promise<'answer' | 'decline' | 'none'> {
  if (!audioB64) return 'none'
  try {
    const mesaje: OrMessage[] = [
      {
        role: 'system',
        content:
          `An incoming call is ringing. The audio is the person deciding whether to take the call. ` +
          `Reply with EXACTLY one word: ANSWER (they want to answer/accept — e.g. "răspunde", "da", ` +
          `"answer", "yes", "pronto", "hallo", "accept"), DECLINE (they refuse — e.g. "refuză", "nu", ` +
          `"no", "decline", "later"), or NONE (unclear, silence, background noise, or unrelated speech). ` +
          `Output only that one word.`,
      },
      {
        role: 'user',
        content: [{ type: 'audio_url', audio_url: { url: `data:${mime || 'audio/webm'};base64,${audioB64}` } }],
      },
    ]
    const r = await rationeazaMesaje(mesaje, { ruta: 'service.apelTraducere', treapta: 'rapid' })
    if (r.costUsd > 0) void recordCost(email, 'gemini', r.costUsd)
    const t = (r.text || '').trim().toUpperCase()
    if (t.includes('ANSWER')) return 'answer'
    if (t.includes('DECLINE')) return 'decline'
    return 'none'
  } catch {
    return 'none'
  }
}

