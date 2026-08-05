import { config } from '../config.js'
import { langLabel } from './lang.js'

// ── LIVE VOICE — GOOGLE + GEMINI (OpenAI scos complet, Adrian 3 aug) ──────────
// Sesiunea vocală NU mai are proxy SDP către OpenAI, iar STT-ul a fost scos
// TOTAL (voce unificată, 5 aug): urechea e VAD local pe client, fraza brută
// (audio) merge la creierul unic (/api/chat), care aude și decide singur; gura e
// Google TTS Chirp 3 HD, sintetizată de server și trimisă ca {audio}.
//
// Ce a mai rămas AICI, pure și fără rețea, DOAR pentru suita de teste care le
// prinde (voce.test.ts / voice.test.ts / realtime.test.ts):
//   • realtimeInstructions — persona istorică a gurii (verbatim „ROSTEȘTE:",
//     tăcere implicită, gardul de limbă). Nu mai e apelată de niciun drum viu.
//   • resolveVoice — alegerea vocii cu plasă de siguranță (nume necunoscut →
//     vocea implicită). Nu mai pleacă nimic spre OpenAI.

// The voice session's persona: a loudspeaker, not a brain. Short on purpose —
// every rule here exists because a live incident proved it necessary.
// NOTE: model-facing text, deliberately not user-visible UI.
export function realtimeInstructions(lang: string, hardLock = false): string {
  const persona =
    `You are Kelion's VOICE — the ears and mouth of a single brain that thinks ` +
    `elsewhere (the same brain that answers in the written chat). ` +
    `You NEVER answer the user from your own knowledge, NEVER improvise content, ` +
    `NEVER comment on what you hear. Silence is your default state. ` +
    // THE MOUTH RULE: the only thing you ever say is what the brain hands you.
    `THE MOUTH RULE: when you receive a system item starting with „ROSTEȘTE:”, ` +
    `you speak EXACTLY the text that follows — word for word, with warm, natural, ` +
    `calm intonation, like a gentleman. No additions, no omissions, no ` +
    `translation, no commentary before or after. If the text is in a language, ` +
    `you speak it in THAT language, exactly as written. ` +
    // THE EARS RULE: hearing is not answering.
    `THE EARS RULE: everything the user says is transcribed automatically and ` +
    `read by the brain — you do NOT respond to it, not even to greetings or ` +
    `questions. You never take the floor on your own. ` +
    `If you are ever tempted to say something that did not come in a „ROSTEȘTE:” ` +
    `item — stay silent.`
  // LANGUAGE GUARD (Adrian, Jul 24 — live proof: the voice answered in RUSSIAN
  // to Romanian speech). The ROSTEȘTE texts arrive already in the right
  // language; this fence only stops the model from inventing its own words in a
  // language outside the app.
  const SUPPORTED = 'English, Romanian, French, Spanish, Portuguese, Italian, German'
  const guard =
    `\n\nLANGUAGE — HARD RULES: You may speak ONLY in one of these languages: ` +
    `${SUPPORTED}. The „ROSTEȘTE:” texts arrive already in the correct language — ` +
    `speak them as they are, never translate them.`
  const known = /^[a-z]{2}$/.test(lang)
  // HARD LOCK (Adrian, admin, in Italy): his brain answers in Romanian, so the
  // mouth speaks Romanian — the lock just pins the transcription hint and keeps
  // the guard unambiguous.
  const limba = hardLock && known
    ? `\n\nLIMBĂ: the user's language is ${langLabel(lang)}. Everything you ` +
      `speak arrives in ${langLabel(lang)} — never switch.`
    : known
    ? `\n\nLIMBĂ: the user's established language is ${langLabel(lang)}.`
    : `\n\nLIMBĂ: the user's language is English by default; „ROSTEȘTE:” texts ` +
      `arrive in the user's real language — speak them exactly as written.`
  return persona + guard + limba
}

/** VOCEA — UNICĂ, CHIRP (3 aug: vocile OpenAI realtime au fost extirpate).
 *
 *  Nu mai există listă de voci din care să alegi: orice cerere — nume vechi de
 *  voce OpenAI dintr-o bază veche, gol, null — cade pe STILUL Chirp unic al
 *  aplicației (config.ttsVoiceStyle, implicit Charon — masculin). Pură și
 *  exportată ca să fie testabilă fără rețea. */
export function resolveVoice(_cerut?: string | null): string {
  return config.ttsVoiceStyle
}
