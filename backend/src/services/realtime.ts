import { config } from '../config.js'
import { langLabel } from './lang.js'

// ── LIVE VOICE — SDP proxy to OpenAI Realtime (WebRTC) ───────────────────────
// THE NEW ARCHITECTURE (Adrian, Aug 1: "rewrite the whole chat procedure,
// written and audio full-duplex, with escalation — let the BRAIN use the
// model's voice and functions; there must not be two separate entities"):
//
// The Realtime session is now PURE EARS AND MOUTH:
//   • EARS — it transcribes what the user says (input transcription, semantic
//     VAD, barge-in). The transcript goes to the ONE brain (POST /api/chat —
//     the same pipeline as writing, with the same tools, the same escalation
//     ladder, the same billing).
//   • MOUTH — when the brain has spoken (its text reply), the client injects a
//     system item starting with "ROSTEȘTE:" and the model speaks it VERBATIM,
//     with the one male voice. It NEVER answers from its own head.
//
// What DISAPPEARS with the old design: the 31-tool session list, ask_brain,
// voiceBrainTurn — the whole second entity that thought in parallel with the
// brain (the live "two voices at once" bug). There are NO tools here at all:
// every action, from weather to deploys, belongs to the single brain, which
// voice reaches exactly like writing.
//
// OpenAI contract verified LIVE with the real key (Jul 22):
//   POST https://api.openai.com/v1/realtime/calls
//   Authorization: Bearer <OPENAI_KEY>
//   multipart/form-data: sdp=<the browser's offer>, session=<JSON config>
//   → returns the SDP answer (text). `audio.output.voice` fixes the voice;
//     `instructions` fixes persona + language; `model` picks the realtime model.

const OPENAI_CALLS = 'https://api.openai.com/v1/realtime/calls'

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
  hardLock = false,
  voicePref?: string | null,
): Promise<RealtimeAnswer> {
  if (!config.openai.key)
    return { ok: false, status: 503, code: 'realtime_not_configured', error: 'realtime_not_configured', attempts: 0 }

  // The ISO-639-1 code of the user's language — a HINT for transcription ONLY
  // when the language is KNOWN (persisted). When it isn't (new user), we fix
  // NOTHING — transcription detects the spoken language on its own (otherwise
  // we'd have pushed it wrongly toward a specific language and "misinterpreted"
  // it — the bug seen live with French).
  const iso = /^[a-z]{2}$/.test((lang || '').toLowerCase()) ? lang.toLowerCase() : ''

  const persona = realtimeInstructions(lang, hardLock)

  // THE SESSION (Aug 1): ears + mouth only. NO tools — the 31-tool ceiling that
  // plagued every July incident is gone for good, because nothing here acts:
  // the ONE brain (the /api/chat pipeline) does all the thinking and all the
  // doing, exactly as in writing. The session carries only: transcription
  // (ears), the voice (mouth), VAD with create_response:false (the client
  // decides when anything is spoken — through ROSTEȘTE items only).
  const voceAleasa = resolveVoice(voicePref)

  const buildSession = (model: string, voice: string): Record<string, unknown> => ({
    type: 'realtime',
    model,
    audio: {
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
        // `create_response:false` stays LAW: the model NEVER speaks on its own —
        // the client creates a response ONLY for a ROSTEȘTE item (the brain's
        // words). The name gate (who gets a brain turn at all) lives in the
        // client (realtimeVoice.ts), unchanged.
        turn_detection: {
          type: 'semantic_vad',
          eagerness: config.openai.realtimeVadEagerness,
          create_response: false,
          interrupt_response: true,
        },
      },
      output: { voice },
    },
    instructions: persona,
    // NO tools registered on the session: a session with nothing to call can
    // never grow a second brain. This is the structural fix for "two voices at
    // once".
  })

  // THE BODY IS REBUILT ON EVERY ATTEMPT (measured undici behavior, Jul 28 —
  // see the git history for the full saga; the rebuilt body is immune to any
  // future undici change anyway).
  const buildForm = (model: string, voice: string): FormData => {
    const form = new FormData()
    form.append('sdp', offerSdp)
    // AS A STRING, NOT A BLOB (Jul 25): the Blob went into form-data as a FILE
    // and OpenAI's parser IGNORED it — the session never applied. A plain
    // string = a normal form field, parsed.
    form.append('session', JSON.stringify(buildSession(model, voice)))
    return form
  }

  // FINAL VOICE FIX (live proof Jul 24: OpenAI "missing_model"): the GA Realtime
  // API requires the model as a URL PARAMETER, not only in the session JSON.
  // MODEL CASCADE (Jul 28): attempt 1 = the main model; subsequent attempts move
  // to the fallback models from config/env.
  const models = [config.openai.realtimeModel, ...config.openai.realtimeModelFallbacks].filter(
    (m, i, a) => a.indexOf(m) === i,
  )
  const callsUrlFor = (model: string): string => `${OPENAI_CALLS}?model=${encodeURIComponent(model)}`

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
        // THE CHOSEN VOICE only on the first attempt. If the first fails, the
        // second leaves on the default voice: a person's preference must not
        // leave their voice dead, however exotic the name saved in their account.
        body: buildForm(model, attempt === 1 ? voceAleasa : config.openai.realtimeVoice),
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
