// ── MESSENGER KELION↔KELION — TRADUCEREA LIVE (Faza 2, Adrian: „traducător live
// prin kelion; eu vorbesc ro, celălalt aude în limba lui și invers") ────────────
// Peste canalul de apel: OpenAI transcrie, Responses traduce textul, apoi
// OpenAI speech (sau motorul local explicit) produce audio pentru destinatar.
import type { OrMessage } from './brainContract.js'
import { rationeazaMesaje } from './creierRationament.js'
import { transcribeCallAudio } from './openaiCallTranscription.js'
import { synthesize } from './tts.js'
import { config } from '../config.js'
import { debitWalletMinorAtomar, getSpeechLang, grantCreditMinor } from '../db.js'
import { gasesteApel, trimiteCatre } from './apel.js'

const UTTERANCE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type CallTranslationOutcome =
  | { ok: true; state: 'delivered' | 'duplicate' | 'ignored' }
  | { ok: false; code: 'invalid' | 'not_connected' | 'credit_insufficient' | 'billing_unavailable' | 'provider_failed' }

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

/** One phrase from an active call is charged once, transcribed, translated and
 * delivered. Provider/system failure refunds the product charge. */
export async function traduVorbire(deLaEmail: string, msg: unknown): Promise<CallTranslationOutcome> {
  if (!msg || typeof msg !== 'object') return { ok: false, code: 'invalid' }
  const m = msg as { callId?: unknown; utteranceId?: unknown; audio?: unknown; mime?: unknown }
  const callId = typeof m.callId === 'string' ? m.callId : ''
  const utteranceId = typeof m.utteranceId === 'string' ? m.utteranceId.toLowerCase() : ''
  const audio = typeof m.audio === 'string' ? m.audio : ''
  const mime = typeof m.mime === 'string' && m.mime ? m.mime : 'audio/webm'
  if (!callId || !UTTERANCE_ID_RE.test(utteranceId) || !audio) return { ok: false, code: 'invalid' }

  const apel = gasesteApel(callId)
  if (!apel || apel.stare !== 'conectat') return { ok: false, code: 'not_connected' }
  const de = deLaEmail.toLowerCase()
  if (apel.deLaEmail !== de && apel.catreEmail !== de) return { ok: false, code: 'not_connected' }
  const catre = apel.deLaEmail === de ? apel.catreEmail : apel.deLaEmail
  const numeDe = apel.deLaEmail === de ? apel.deLaNume : apel.catreNume

  const billingRef = `call:${callId}:${utteranceId}`
  const debit = await debitWalletMinorAtomar(
    de,
    config.billing.callUtteranceMinor,
    billingRef,
    'call translation utterance',
  )
  if (!debit.ok) {
    return {
      ok: false,
      code: debit.code === 'insufficient' ? 'credit_insufficient' : 'billing_unavailable',
    }
  }
  if (debit.duplicate) return { ok: true, state: 'duplicate' }
  let refundRequired = debit.debitedMinor > 0
  const refund = async (): Promise<void> => {
    if (!refundRequired) return
    refundRequired = false
    const restored = await grantCreditMinor(de, debit.debitedMinor, `${billingRef}:refund`)
    if (!restored) console.error('[money] call utterance refund requires reconciliation')
  }

  const limbaCatre = await limbaUserului(catre)
  const limbaNume = numeLimba(limbaCatre)

  // 1) AUDIO → transcript verificat. Responses does not accept raw audio.
  const transcript = await transcribeCallAudio(audio, {
    mime,
    userEmail: de,
    surface: 'call_translation',
    eventKey: billingRef,
  })
  if (!transcript.ok || !transcript.transcript.trim()) {
    await refund()
    return transcript.ok ? { ok: true, state: 'ignored' } : { ok: false, code: 'provider_failed' }
  }

  // 2) Transcript → translation through the single Responses brain.
  let text = ''
  try {
    const mesaje: OrMessage[] = [
      {
        role: 'system',
        content:
          `You are a live phone interpreter on a call. Translate the supplied transcript ` +
          `into ${limbaNume} (${limbaCatre}). ` +
          `Output ONLY the translation in ${limbaNume}, in a natural spoken style — no quotes, ` +
          `no notes, no speaker labels, no original text. If there is no intelligible speech, output nothing.`,
      },
      {
        role: 'user',
        content: transcript.transcript,
      },
    ]
    const r = await rationeazaMesaje(mesaje, {
      ruta: 'service.apelTraducere',
      treapta: 'rapid',
      usageContext: { userEmail: de, surface: 'call_translation' },
    })
    text = (r.text || '').trim()
  } catch {
    await refund()
    return { ok: false, code: 'provider_failed' }
  }
  if (!text) {
    await refund()
    return { ok: true, state: 'ignored' }
  }

  // 3) Translation → speech. If synthesis fails, subtitles still arrive.
  //    textul (subtitrarea), ca B să vadă măcar ce s-a spus.
  let audioB64 = ''
  try {
    const tts = await synthesize(text, limbaCatre, {
      usageContext: { userEmail: de, surface: 'call_translation_tts' },
    })
    if (tts.ok) {
      audioB64 = tts.audio.toString('base64')
    }
  } catch {
    /* fără voce — rămâne subtitrarea */
  }

  // 4) La B: subtitrarea (în limba lui) + vocea. `de_la` = numele celui care a vorbit.
  const delivered = trimiteCatre(catre, { type: 'tradus', callId, utteranceId, text, audio: audioB64, de_la: numeDe })
  if (delivered === 0) {
    await refund()
    return { ok: false, code: 'not_connected' }
  }
  refundRequired = false
  return { ok: true, state: 'delivered' }
}

// ── HANDS-FREE: „SPUI RĂSPUNDE ȘI SE FACE LEGĂTURA" (Adrian) ────────────────────
// Cât sună un apel, ce spune cel sunat se clasifică din voce: ANSWER / DECLINE /
// NONE. The audio is transcribed first; the classifier receives text only.
export async function intentApel(
  email: string,
  callId: string,
  utteranceId: string,
  audioB64: string,
  mime: string,
): Promise<'answer' | 'decline' | 'none'> {
  const normalizedEmail = email.toLowerCase()
  const apel = gasesteApel(callId)
  if (
    !audioB64 ||
    !UTTERANCE_ID_RE.test(utteranceId) ||
    !apel ||
    apel.stare !== 'suna' ||
    apel.catreEmail !== normalizedEmail
  ) return 'none'
  try {
    const transcript = await transcribeCallAudio(audioB64, {
      mime,
      userEmail: normalizedEmail,
      surface: 'call_intent',
      eventKey: `intent:${callId}:${utteranceId.toLowerCase()}`,
    })
    if (!transcript.ok || !transcript.transcript.trim()) return 'none'
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
        content: transcript.transcript,
      },
    ]
    const r = await rationeazaMesaje(mesaje, {
      ruta: 'service.apelTraducere',
      treapta: 'rapid',
      usageContext: { userEmail: normalizedEmail, surface: 'call_intent' },
    })
    const t = (r.text || '').trim().toUpperCase()
    if (t === 'ANSWER') return 'answer'
    if (t === 'DECLINE') return 'decline'
    return 'none'
  } catch {
    return 'none'
  }
}
