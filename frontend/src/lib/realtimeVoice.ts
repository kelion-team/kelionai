// ── LIVE VOICE — OpenAI Realtime client (WebRTC): EARS + MOUTH ───────────────
// THE NEW ARCHITECTURE (Adrian, Aug 1: "rewrite the whole chat procedure,
// written and audio full-duplex, with escalation — let the BRAIN use the
// model's voice and functions; there must not be two separate entities"):
//
//   • EARS — the session transcribes what the user says. The final transcript
//     passes the NAME GATE and, if addressed to Kelion, goes to the ONE brain
//     through opts.onAddressed → the exact same send() as typed text (the same
//     pipeline, the same tools, the same escalation ladder, the same billing).
//   • MOUTH — the brain's reply streams back as text; the client feeds it
//     sentence by sentence through handle.speak(): a system item starting with
//     "ROSTEȘTE:" which the model speaks VERBATIM. The session has NO tools
//     and NEVER answers from its own head — the "two voices / two entities"
//     bug is impossible by construction.
//   • THE MOUTH MOVES TO GOOGLE (Adrian, Aug 2 — direct order: "gura lui
//     Kelion trece pe Google Chirp 3 HD; OpenAI rămâne doar rezervă"). The
//     ears were already Chirp 3 streaming (free), but the mouth still ran on
//     OpenAI Realtime — $65 in two weeks, proven live, and the account hit
//     zero credits. Now: a probe on /api/tts/status decides. google:true →
//     CHIRP-MOUTH mode, no WebRTC session at all — the server synthesizes the
//     voice itself (Google TTS Chirp 3 HD, 1M chars/month free tier) and
//     streams it as {audio} frames. google:false / probe failed → the OpenAI
//     Realtime path below, unchanged — strictly the reserve.
//
// The OpenAI key is NEVER here — the backend holds it. Model + voice + language
// are injected server-side; the client only sends the current language as a hint.

import { driveVoiceLevelFromElement, registerVoiceAudioElement, buildVoiceFeatures, estimateEnergy, estimateF0, estimateZcr, estimateCentroid, estimateRolloff, stopVoice, type VoiceFeatures } from './audioIO'
import { startMicStream, urechiChirpDisponibile, marcheazaUrechiChirpMoarte, type MicStreamHandle } from './micStream'

export type RealtimeVoiceState = 'connecting' | 'live' | 'error' | 'closed'

export interface RealtimeVoiceHandle {
  /**
   * CHIRP-MOUTH MODE (Adrian, Aug 2 — "gura pe Google Chirp 3 HD, OpenAI doar
   * rezervă"): true when the session runs entirely on Google — Chirp 3 ears +
   * the server's Chirp 3 HD voice arriving as {audio} frames. ChatPanel reads
   * this and does NOT mark the handle isRealtime: those frames ARE Kelion's
   * voice now (they must play, and the server must keep synthesizing them).
   */
  guraChirp?: boolean
  stop: () => void
  setMuted: (muted: boolean) => void
  /** Immediately interrupts Kelion's speech (manual barge-in). */
  interrupt: () => void
  /**
   * THE MOUTH: queues a piece of the BRAIN's reply to be spoken verbatim
   * (a "ROSTEȘTE:" item + response.create). Pieces are spoken in order,
   * one response at a time; the queue drains on response.done.
   */
  speak: (text: string) => void
  /**
   * Cuts whatever is being spoken right now and empties the speech queue
   * (barge-in / STOP / a replaced brain turn). The brain's turn itself is
   * untouched — this only silences the mouth.
   */
  stopSpeaking: () => void
}

export interface RealtimeVoiceOpts {
  /** The current language (hint). The source of truth stays the preference persisted on the server. */
  language?: string
  onState?: (s: RealtimeVoiceState, note?: string) => void
  /** The user's transcript: (text, final). */
  onUserTranscript?: (text: string, final: boolean) => void
  /** What the mouth is saying: (text, final). For UI state only — the brain's reply already streams into the chat through send(). */
  onAssistantTranscript?: (text: string, final: boolean) => void
  /**
   * THE EARS → THE BRAIN: a final transcript passed the name gate (the user
   * addressed Kelion). The client sends it to the ONE brain via the normal
   * send() — identical to a typed message. `vf` is the voiceprint of the
   * utterance (speaker verification, same as on the STT path).
   */
  onAddressed?: (text: string, vf: VoiceFeatures | null, speaker?: string) => void
  /**
   * The VAD heard speech start while Kelion was SILENT (never while he
   * speaks — echo protection; a real talk-over still cuts his speech the
   * moment its transcript passes the gate and starts a new brain turn).
   */
  onSpeechStart?: () => void
  /** Live GPS from the device — kept for the session-start payload (server context). */
  coords?: { lat: number; lon: number }
  signal?: AbortSignal
}

// VOICEPRINT ON THE MAIN VOICE (Adrian, Jul 26): the voiceprint tap of the
// ACTIVE session (one single session — guaranteed by the singleton). finalize()
// returns the voiceprint of the just-spoken utterance and empties the buffer.
let liveVoiceTap: { finalize: () => VoiceFeatures | null } | null = null

// Language anchoring + the voiceprint padlock (Aug 1: this NO LONGER saves
// messages — the spoken turn reaches history through /api/chat, which owns the
// one single save, exactly like a typed turn). What stays here, for every
// utterance, addressed or not:
//   • the server tracks the spoken language and, once committed, we pin the
//     session's transcription onto it (no more "random language");
//   • the voiceprint is compared against the owner's reference — a match arms
//     the admin padlock (kelion:admin-unlock), a mismatch injects the
//     protection warning into the session.
// ── THE VOICE VERDICT (one POST per utterance) ──────────────────────────────
// The server compares the utterance's voiceprint with the holder's reference
// and answers with WHO is speaking:
//   • holder          → the turn goes to the brain (and the admin padlock may
//                       unlock — kelion:admin-unlock);
//   • foreign + guest → an APPROVED guest (recognised by timbre): allowed,
//                       with guest rights — `speaker` rides to /api/chat;
//   • foreign + guestPending → the holder just opened a window: allowed, the
//                       brain asks the holder to confirm keeping the print;
//   • foreign alone   → IGNORED COMPLETELY (women, men, TV, radio — Adrian,
//                       Aug 1): the turn NEVER reaches the brain, nothing is
//                       said, nothing is shown.
// The turn AWAITS this verdict — before it, nothing goes to the brain.
export interface TranscriptVerdict {
  lang?: string
  foreignVoice?: boolean
  adminUnlocked?: boolean
  guest?: { id: number; name: string; relation: string }
  guestPending?: { id: number; name: string; relation: string }
}
async function transcriptVerdict(text: string, vf: VoiceFeatures | null): Promise<TranscriptVerdict | null> {
  const t = text.trim()
  if (!t) return null
  try {
    const r = await fetch('/api/realtime/transcript', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ role: 'user', text: t, voiceFeatures: vf ?? undefined }),
    })
    return (await r.json().catch(() => null)) as TranscriptVerdict | null
  } catch {
    return null
  }
}

// ── THE MOUTH'S PROBE (Adrian, Aug 2 — "gura pe Google Chirp 3 HD; OpenAI
// doar rezervă") ─────────────────────────────────────────────────────────────
// Contract with the backend: GET /api/tts/status (with the session cookie) →
// { google: boolean }. google:true → the voice session starts in CHIRP-MOUTH
// mode (no WebRTC, zero OpenAI cost). google:false or a fallen probe →
// today's behavior (OpenAI Realtime) — exactly the reserve Adrian asked for.
// The server's ANSWER is cached per page session (like the ears probe in
// micStream.ts); a network/HTTP failure is NOT cached, so the next voice
// start re-asks. The probe runs lazily at the first voice start (the route
// wants a logged-in session — probing at module load could cache a guest's
// answer for the whole page session).
// THE 401 CASE (Aug 2 — live logs): the route requires the session cookie;
// one probe fired before the session was established and got 401, the mouth
// fell onto the OpenAI reserve (zero credits) and Kelion went MUTE — while a
// later probe got 200. The rule: a non-OK probe (401 above all) is NOT a
// "google:false" answer and is NEVER cached — the mouth's mode is chosen per
// voice start, so the very next start re-probes and can still get Chirp.
let guraChirpStare: boolean | null = null
function guraChirpDisponibila(): Promise<boolean> {
  if (guraChirpStare !== null) return Promise.resolve(guraChirpStare)
  if (typeof fetch !== 'function') return Promise.resolve(false)
  return fetch('/api/tts/status', { credentials: 'include', cache: 'no-store' })
    .then(async (r) => {
      // 401/network/5xx: NOT a verdict — nothing is cached, the next voice
      // start asks again. Only a 200 body decides (and caches) the mode.
      if (!r.ok) return false
      const j = (await r.json().catch(() => null)) as { google?: boolean } | null
      const ok = j?.google === true
      guraChirpStare = ok
      return ok
    })
    .catch(() => false) // probe fallen → the OpenAI reserve (not cached either)
}

// ── ONE SINGLE VOICE SESSION, ACROSS ALL TABS (Jul 25 — Adrian: "the Russian comes
// peste chatul live, mai e un canal") ────────────────────────────────────────
// Two Realtime sessions in parallel (an old tab left open, a restart in a
// race) = two overlapping voices, and the old one without config → Russian. Double guard:
// (1) per-tab singleton — starting a session STOPS the previous one;
// (2) BroadcastChannel between tabs — the new session closes the others'.
let activeVoice: { stop: () => void } | null = null
const VOICE_BC = 'kelion-voice'
// PERSISTENT AUDIO ELEMENT (Jul 25 — Adrian: "in the current setup it has no
// audio"): un `<audio>` nou creat la fiecare (re)pornire a sesiunii poate lovi
// the browser's autoplay block if that start doesn't come from a direct
// user gesture. Fix: ONE SINGLE element, created once and
// REUSED on every start — once unlocked by a real gesture, it stays
// unlocked (we only change `srcObject`, not the element).
let sharedAudioEl: HTMLAudioElement | null = null
function getSharedAudioEl(): HTMLAudioElement {
  if (sharedAudioEl && document.body.contains(sharedAudioEl)) return sharedAudioEl
  const el = document.createElement('audio')
  el.autoplay = true
  el.style.display = 'none'
  document.body.appendChild(el)
  sharedAudioEl = el
  return el
}

// ── AUDIO OUTPUT TO BLUETOOTH HEADPHONES (Adrian, Jul 29: "why can't the
// audio go to bluetooth headphones?") ─────────────────────────────────────────
// The cause (code fact): the app NEVER routed audio output — the
// <audio> element played on the default device and didn't react to headphones connecting.
// setSinkId (Chromium desktop/Android) binds the element to a specific device;
// on iOS Safari it does NOT exist (the system routes by itself — here it's a harmless no-op).
// The rule: if headphones/BT appear, we PREFER them; otherwise we follow the default. We reapply on
// every `devicechange`, so the sound MIGRATES to the headphones when you connect them
// mid-conversation. Failure-tolerant: whatever fails → we stay on default, without
// breaking playback. Labels need the microphone permission (we have it —
// the voice session is active), otherwise labels come empty and we stay on default.
const AUDIO_OUT_RE = /bluetooth|blueto|airpod|headset|headphone|c[ăa][șs]ti|wireless|buds|earbud|hands?-?free/i
async function routeAudioOutput(el: HTMLAudioElement): Promise<void> {
  const sinkEl = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  if (typeof sinkEl.setSinkId !== 'function') return // iOS/Safari: the system routes
  try {
    let target = 'default'
    if (navigator.mediaDevices?.enumerateDevices) {
      const devs = await navigator.mediaDevices.enumerateDevices()
      const bt = devs.find((d) => d.kind === 'audiooutput' && AUDIO_OUT_RE.test(d.label))
      if (bt?.deviceId) target = bt.deviceId
    }
    await sinkEl.setSinkId(target)
  } catch {
    /* the device disappeared / refused — we stay on default, the sound doesn't break */
  }
}
const voiceSessionId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
let voiceBc: BroadcastChannel | null = null
try {
  voiceBc = new BroadcastChannel(VOICE_BC)
} catch {
  voiceBc = null /* old browser — the per-tab guard stays */
}

/**
 * Starts the ears+mouth voice session via OpenAI Realtime.
 * Throws if the microphone is refused or the backend session fails.
 */
export async function startRealtimeVoice(
  opts: RealtimeVoiceOpts = {},
): Promise<RealtimeVoiceHandle> {
  const { onState, onUserTranscript, onAssistantTranscript, onAddressed, onSpeechStart, signal } = opts
  onState?.('connecting')

  // Any earlier session from THIS tab dies before another starts.
  activeVoice?.stop()
  activeVoice = null
  // Notify the other tabs: the voice session is HERE from now on.
  const myId = voiceSessionId()
  voiceBc?.postMessage({ takeover: myId })

  let closed = false
  const cleanups: (() => void)[] = []
  // THE WEBRTC SESSION EXISTS ONLY ON THE OPENAI RESERVE PATH (Adrian, Aug 2):
  // in chirp-mouth mode no RTCPeerConnection is built at all — zero OpenAI
  // cost. The reserve path stores its pc here so stop() can tear it down.
  let pcRezerva: RTCPeerConnection | null = null

  const stop = (): void => {
    if (closed) return
    closed = true
    if (activeVoice === handleShell) activeVoice = null
    for (const c of cleanups) {
      try {
        c()
      } catch {
        /* ignore */
      }
    }
    try {
      pcRezerva?.getSenders().forEach((s) => s.track?.stop())
    } catch {
      /* ignore */
    }
    try {
      pcRezerva?.close()
    } catch {
      /* ignore */
    }
    onState?.('closed')
  }

  // The "shadow" handle for the singleton: exists before the return, so stop()
  // can clean the global reference on any path (error included).
  const handleShell = { stop }
  activeVoice = handleShell
  // Another tab started a session → ours closes (one voice, always).
  if (voiceBc) {
    const onTakeover = (ev: MessageEvent): void => {
      const d = ev.data as { takeover?: string } | null
      if (d?.takeover && d.takeover !== myId && !closed) {
        stop()
        onState?.('error', 'preluat-de-alt-tab')
      }
    }
    voiceBc.addEventListener('message', onTakeover)
    cleanups.push(() => voiceBc?.removeEventListener('message', onTakeover))
  }

  if (signal) {
    if (signal.aborted) {
      stop()
      throw new DOMException('aborted', 'AbortError')
    }
    signal.addEventListener('abort', stop, { once: true })
  }

  try {
    // 1) Microphone — with echo/noise cancellation so Kelion doesn't hear himself in a loop.
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    cleanups.push(() => mic.getTracks().forEach((t) => t.stop()))
    // THE BIG STEP (Adrian, Aug 1 — „faci acum pasul mare" + „Chirp 3 hd peste
    // tot"): when Chirp 3 streaming exists, THE LIVE EARS ARE GOOGLE CHIRP 3.
    // The mic audio no longer flows to OpenAI AT ALL — no input audio billed,
    // no more weak gpt-4o-transcribe („Chelion", invented words). The WebRTC
    // session keeps ONE job: the MOUTH. The ear (PCM → /api/asr-stream →
    // finals) starts below and feeds THE SAME gates (timbre → stop → name).
    const urechiChirp = await urechiChirpDisponibile().catch(() => false)
    // THE MOUTH'S PROBE (Aug 2): chirp-mouth mode needs BOTH Google pieces —
    // the ear IS the session here, there is no WebRTC left to hang anything
    // on. No Chirp ears → the whole session falls onto the OpenAI reserve.
    const guraChirp = urechiChirp ? await guraChirpDisponibila().catch(() => false) : false
    let chirpEar: MicStreamHandle | null = null
    cleanups.push(() => chirpEar?.stop())

    // ── THE GATE, SHARED BY BOTH MOUTHS (hoisted, Aug 2) ────────────────────
    // Until Aug 2 this gate lived INSIDE the WebRTC wiring. Chirp-mouth mode
    // has no dataChannel at all, so the gate now stands on its own and both
    // mouths feed their finals through it — the exact same rules: the TIMBRE
    // gate is awaited, a foreign voice with no guest approval is ignored
    // COMPLETELY, the spoken STOP cuts the mouth at once, and the NAME gate
    // decides per utterance if the turn goes to the brain at all.
    // The two mode-dependent pieces are filled in by each mode BEFORE any
    // transcript can arrive: the language anchor (the OpenAI session pins the
    // committed language; Chirp detects it per utterance) and the mouth-cutter
    // (the OpenAI response queue vs. the server's {audio} playback).
    const REPLY_WINDOW_MS = 12_000
    // THE WINDOW IS OPEN AT SESSION START (bug found live by Adrian, Jul 27):
    // the user just STARTED the microphone — obviously they're addressing
    // Kelion; demanding the name on the very first utterance made him
    // completely mute at opening. If they say nothing in 15s, silence becomes
    // the default again.
    let replyUntil = Date.now() + 15_000
    // Regex TOLERANT to real transcription (live proof: "Kelion, ce faci" came out
    // as "Elioncevaci"): we also accept the variants without the initial consonant
    // (elion/eleon), glued to the next word.
    const NAME_RE = /[ckg]h?e?l[iy]?[oae]n|elion|eleon|\bkei\b|\bkay\b/i
    // The last language ANCHORED in the live session — we re-anchor only on change.
    let anchoredLang = ''
    let ancoreazaLimba: (lang: string) => void = () => {}
    let taieGura: () => void = () => {}
    const poartaDupaTranscript = (t: string, vf: VoiceFeatures | null): void => {
      // THE TIMBRE GATE IS AWAITED (Adrian, Aug 1: "dacă nu-mi identifică
      // vocea, trebuie să ignore ce aude — femei, bărbați, tv, radio").
      // NOTHING leaves for the brain before the server says WHO is speaking.
      void (async () => {
        const verdict = await transcriptVerdict(t, vf)
        // The language COMMITTED by the server anchors the LIVE session's
        // transcription — ONLY ON CHANGE, and only where a transcription
        // session exists (the OpenAI reserve; Chirp detects it per utterance).
        if (verdict?.lang && verdict.lang !== anchoredLang) {
          anchoredLang = verdict.lang
          ancoreazaLimba(verdict.lang)
        }
        // THE ADMIN PADLOCK: the voiceprint matched → the server set the
        // unlock cookie; we notify the UI to light up the Admin button.
        if (verdict?.adminUnlocked) window.dispatchEvent(new Event('kelion:admin-unlock'))
        // THE STRICT GATE: a voice that is neither the holder NOR an allowed
        // guest is ignored COMPLETELY — no brain turn, no reply, no warning,
        // no trace in the chat. This is what stops him from answering the TV.
        const guest = verdict?.guest ?? verdict?.guestPending
        if (verdict?.foreignVoice && !guest) {
          console.info('[voce] voce străină — ignorată complet (nu ajunge la creier)')
          return
        }
        const speaker = verdict?.guest
          ? `guest:${verdict.guest.id}:${verdict.guest.name}${verdict.guest.relation ? ` (${verdict.guest.relation})` : ''}`
          : verdict?.guestPending
            ? `guest-pending:${verdict.guestPending.id}:${verdict.guestPending.name}${verdict.guestPending.relation ? ` (${verdict.guestPending.relation})` : ''}`
            : undefined
        // THE "STOP" COMMAND (Adrian, Jul 27): spoken ALONE, it cuts AT ONCE
        // whatever the mouth is saying and empties its queue. Holder/guest
        // only — a stranger's "stop" is ignored with everything else above.
        if (/^\W*(stop|stai|taci|gata|opre[sș]te(?:-te)?|shut ?up|be quiet|basta)[\s.!…]*$/i.test(t.trim())) {
          replyUntil = 0 // STOP closes the reply window too — until the next "Kelion"
          taieGura()
          return
        }
        if (!t.trim()) return
        // THE GATE: the name is in this utterance → to the brain. It isn't →
        // silence, no matter what was said before. The nameless reply to his
        // own question gets CONSUMED here (`replyUntil = 0`), so one reply
        // can't open the next one — the old perpetuum mobile that never
        // closed while something was heard in the room.
        const named = NAME_RE.test(t)
        const answering = Date.now() < replyUntil
        if (named || answering) {
          replyUntil = 0
          onAddressed?.(t, vf, speaker)
        }
      })()
    }

    // ── THE ONE CHIRP EAR (both modes) ──────────────────────────────────────
    // Chirp-mouth mode and the OpenAI-mouth mode start the SAME ear with the
    // SAME wiring; only the two mode-dependent pieces differ — what happens
    // when speech begins (whose mouth gets cut) and where the session falls
    // when the ear dies (named in the log line). One starter keeps the wiring
    // identical by construction — the two copies cannot silently diverge.
    const pornesteUrecheaChirp = (rezerva: string, onSpeechBegin: () => void) =>
      startMicStream({
        preWarmedStream: mic,
        onLive: (t) => onUserTranscript?.(t, false),
        onPhrase: (t, vf) => {
          onUserTranscript?.(t, true)
          poartaDupaTranscript(t, vf)
        },
        onError: (reason) => {
          if (closed) return
          console.error(`[voce] urechea Chirp a murit (${reason}) — sesiunea se reface pe ${rezerva}`)
          marcheazaUrechiChirpMoarte()
          stop()
          onState?.('error', `urechi-chirp-${reason}`)
        },
        getLang: () => anchoredLang || opts.language || '',
        onSpeechBegin,
        storePendingFeatures: false,
      })

    // ── CHIRP-MOUTH MODE (Adrian, Aug 2 — the direct order) ──────────────────
    // google:true at the probe → NO RTCPeerConnection, NO /api/realtime/session,
    // ZERO OpenAI cost: the ears are Chirp 3 streaming (as since Aug 1) and
    // the mouth is the server's own Chirp 3 HD synthesis, which arrives as
    // {audio} frames and is played by ChatPanel through playVoice (audioIO).
    // The handle is flagged `guraChirp` so the panel does NOT mark it
    // isRealtime — otherwise the {audio} frames would stay suppressed and the
    // server would stop synthesizing (serverVoiceOff).
    if (guraChirp) {
      // The mouth-cutter of this mode: the server's Chirp playback stops here.
      taieGura = stopVoice
      const ear = await pornesteUrecheaChirp('rezerva OpenAI', () => {
        // BARGE-IN (Aug 2): your voice cuts Kelion's Chirp playback on the
        // spot — the aborted turn drains the rest of the server synthesis.
        stopVoice()
        onSpeechStart?.()
      })
      if (!ear) {
        // The probe lied (race with a config change) — the onError above
        // already marked the ear dead and announced; just fail the start so
        // the panel counts it and the next attempt lands on the reserve.
        throw new Error('chirp_ear_unavailable')
      }
      chirpEar = ear
      onState?.('live')
      console.info('[voce] urechi + gură pe Google Chirp 3 HD — OpenAI doar rezervă')
      return {
        guraChirp: true,
        stop,
        setMuted: (muted: boolean) => {
          // The mic belongs to the Chirp ear — mute it there (there are no
          // WebRTC senders in this mode at all).
          chirpEar?.setMuted(muted)
        },
        // Manual barge-in: cut the server's Chirp playback right now.
        interrupt: () => stopVoice(),
        // THE MOUTH IS THE SERVER'S (Aug 2): the reply's audio arrives by
        // itself as {audio} frames — speak() only watches the sentences for
        // Kelion's QUESTIONS, to open the one-reply window exactly like the
        // OpenAI mouth's transcript.done does.
        speak: (text: string) => {
          if (/\?/.test(text)) replyUntil = Date.now() + REPLY_WINDOW_MS
        },
        stopSpeaking: () => stopVoice(),
      }
    }

    // ── THE OPENAI RESERVE PATH (the pre-Aug-2 behavior, unchanged) ──────────
    const pc = new RTCPeerConnection()
    pcRezerva = pc
    // The voiceprint tap: a parallel analyser on the SAME microphone (doesn't touch
    // WebRTC). It collects frames only when there's speech energy; the voiceprint
    // finalizes per utterance (at the final transcript) — like on the STT path.
    // CHIRP EARS: the ear's own graph collects the features per utterance and
    // hands them over with each final — no second tap needed.
    if (!urechiChirp) try {
      const tapCtx = new AudioContext()
      const tapSrc = tapCtx.createMediaStreamSource(mic)
      const tapAn = tapCtx.createAnalyser()
      tapAn.fftSize = 2048
      tapSrc.connect(tapAn)
      const tBuf = new Float32Array(tapAn.fftSize)
      const fBuf = new Float32Array(tapAn.frequencyBinCount)
      const f0s: number[] = []
      const energies: number[] = []
      let cSum = 0, cN = 0, rSum = 0, zSum = 0, eSum = 0, frames = 0
      const tick = window.setInterval(() => {
        tapAn.getFloatTimeDomainData(tBuf)
        const e = estimateEnergy(tBuf)
        if (e < 0.004) return // silence/noise — don't pollute the voiceprint
        energies.push(e); eSum += e; zSum += estimateZcr(tBuf)
        const f0 = estimateF0(tBuf, tapCtx.sampleRate)
        if (f0 > 0) f0s.push(f0)
        tapAn.getFloatFrequencyData(fBuf)
        const c = estimateCentroid(fBuf, tapCtx.sampleRate, tapAn.fftSize)
        if (c > 0) { cSum += c; cN++ }
        rSum += estimateRolloff(fBuf, tapCtx.sampleRate, tapAn.fftSize)
        frames++
      }, 150)
      liveVoiceTap = {
        finalize: () => {
          if (frames < 8) return null // too little signal — no voiceprint
          const out = buildVoiceFeatures(f0s.slice(), energies.slice(), cN ? cSum / cN : 0, rSum / frames, zSum / frames, eSum / frames)
          f0s.length = 0; energies.length = 0; cSum = 0; cN = 0; rSum = 0; zSum = 0; eSum = 0; frames = 0
          return out
        },
      }
      cleanups.push(() => {
        window.clearInterval(tick)
        liveVoiceTap = null
        void tapCtx.close().catch(() => {})
      })
    } catch {
      /* no voiceprint tap — voice works normally, voiceprinting stays on STT */
    }
    // HEALING THE HEARING IN PLACE (Adrian, Jul 27: "there are multiple bugs on his
    // hearing"; F12 showed `input-ended` — the microphone track DIES on device
    // change/browser suspension). Before, an ended track killed
    // the WHOLE session (stop + error + full reconnect = seconds of deafness
    // + a counted "failure" toward falling onto the robotic voice). Now: RE-ASKS
    // for the microphone and replaces the track IN PLACE (replaceTrack) — the WebRTC session
    // stays alive, hearing returns in under a second. Only if the re-ask fails
    // (permission withdrawn, no device) do we declare the error, as before.
    // CHIRP EARS: the mic never reaches WebRTC — the mouth is RECEIVE-ONLY.
    if (urechiChirp) {
      pc.addTransceiver('audio', { direction: 'recvonly' })
    } else {
    const bindMicTrack = (track: MediaStreamTrack, sender: RTCRtpSender): void => {
      track.addEventListener(
        'ended',
        () => {
          if (closed) return
          void navigator.mediaDevices
            .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
            .then(async (fresh) => {
              if (closed) {
                fresh.getTracks().forEach((t) => t.stop())
                return
              }
              const newTrack = fresh.getAudioTracks()[0]
              if (!newTrack) throw new Error('no_audio_track')
              await sender.replaceTrack(newTrack)
              cleanups.push(() => fresh.getTracks().forEach((t) => t.stop()))
              bindMicTrack(newTrack, sender) // the new track heals the same way
              console.log('[realtime] microfon reînnoit în loc (input-ended vindecat, sesiunea a rămas vie)')
            })
            .catch(() => {
              if (!closed) {
                stop()
                onState?.('error', 'input-ended')
              }
            })
        },
        { once: true },
      )
    }
    for (const track of mic.getTracks()) {
      const sender = pc.addTrack(track, mic)
      bindMicTrack(track, sender)
    }
    }

    // 2) Kelion's voice (the remote track) + avatar animation from the audio level.
    // SHARED ELEMENT (not a new one each time) — see the comment at
    // `getSharedAudioEl`: once unlocked by a real gesture, it stays unlocked across
    // all later automatic reopenings.
    const audioEl = getSharedAudioEl()
    // CONTROLLABLE VOLUME (Jul 25): the Realtime voice follows the app's global
    // volume (the chat slider) — until today it started fixed at 1.0, unadjustable.
    const unregisterVol = registerVoiceAudioElement(audioEl)
    cleanups.push(unregisterVol)
    // Do NOT remove the element from the DOM at stop() — it's shared between sessions; only
    // the session releases it, the element stays for the next reopening.
    cleanups.push(() => {
      audioEl.srcObject = null
    })
    // HEADPHONES/BT OUTPUT: route now + reapply whenever the devices change
    // (you connect headphones mid-conversation → the sound migrates).
    void routeAudioOutput(audioEl)
    const onDeviceChange = (): void => {
      void routeAudioOutput(audioEl)
    }
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    cleanups.push(() => navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange))
    let stopLip: (() => void) | null = null
    pc.ontrack = (ev) => {
      audioEl.srcObject = ev.streams[0] ?? new MediaStream([ev.track])
      // AUTOPLAY: the browser can refuse audio playback until a user
      // gesture. If playback is blocked, we RETRY it on the first gesture
      // (click/key/touch) and then clean up the listeners.
      const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const
      const removeUnlock = (): void => {
        for (const g of GESTURES) window.removeEventListener(g, unlock)
      }
      const unlock = (): void => {
        void audioEl.play?.().then(removeUnlock).catch(() => {})
      }
      void audioEl.play?.().catch(() => {
        for (const g of GESTURES) window.addEventListener(g, unlock, { passive: true })
      })
      cleanups.push(removeUnlock)
      stopLip?.()
      stopLip = driveVoiceLevelFromElement(audioEl)
      cleanups.push(() => stopLip?.())
    }

    // FIX "dies silently" (Jul 24 audit, P2): `closed` = immediately fatal; on
    // `disconnected` we give a 4s respite (ICE can recover) and only then
    // declare the session dead — the ChatPanel handler restarts by itself.
    let discTimer: number | null = null
    const clearDisc = (): void => {
      if (discTimer != null) {
        clearTimeout(discTimer)
        discTimer = null
      }
    }
    cleanups.push(clearDisc)
    pc.onconnectionstatechange = () => {
      if (closed) return
      const st = pc.connectionState
      if (st === 'connected') {
        clearDisc()
        onState?.('live')
      } else if (st === 'failed' || st === 'closed') {
        clearDisc()
        stop()
        onState?.('error', `connection-${st}`)
      } else if (st === 'disconnected') {
        clearDisc()
        discTimer = window.setTimeout(() => {
          if (!closed && pc.connectionState === 'disconnected') {
            stop()
            onState?.('error', 'connection-disconnected')
          }
        }, 4000)
      }
    }

    // 3) dataChannel — the OpenAI Realtime events (transcripts + speech state + errors).
    const dc = pc.createDataChannel('oai-events')
    // The events channel closed gracefully by the server = dead session.
    dc.onclose = () => {
      if (!closed) {
        stop()
        onState?.('error', 'dc-closed')
      }
    }
    // ONE SINGLE injection (Jul 25): the instructions + voice + language come in
    // the initial session from the server. We never duplicate them via
    // session.update — the only session.update here pins the transcription
    // LANGUAGE when the server commits a new one.
    const send = (obj: unknown): void => {
      if (dc.readyState === 'open') {
        try {
          dc.send(JSON.stringify(obj))
        } catch {
          /* ignore */
        }
      }
    }
    // The partial user text by item id.
    const userText = new Map<string, string>()
    const asstText = new Map<string, string>()

    // ── THE MOUTH: a serial speech queue ─────────────────────────────────────
    // The brain's reply arrives sentence by sentence (ChatPanel's feeder). Each
    // piece becomes a system item starting with the speak prefix the persona
    // was taught, followed by ONE response request. Exactly one response may be
    // active at a time — the queue drains on response.done (which the API also
    // sends for a cancelled response, so a stopSpeaking() can never wedge it).
    const SPEAK_PREFIX = 'ROSTEȘTE: '
    const speakQueue: string[] = []
    let speakActive = false
    const drainSpeak = (): void => {
      if (closed || speakActive) return
      const next = speakQueue.shift()
      if (!next) return
      speakActive = true
      send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: SPEAK_PREFIX + next }] },
      })
      send({ type: 'response.create' })
    }
    const speak = (text: string): void => {
      const t = text.trim()
      if (!t || closed) return
      speakQueue.push(t)
      drainSpeak()
    }
    const stopSpeaking = (): void => {
      speakQueue.length = 0
      if (speakActive) {
        send({ type: 'response.cancel' })
        send({ type: 'output_audio_buffer.clear' })
        // speakActive stays true until response.done arrives (guaranteed for a
        // cancelled response) — a new speak() before that lands in the queue
        // and drains right after, never over the cancelled utterance.
      }
    }

    // ── THE GATE'S MODE PIECES (OpenAI reserve path) ─────────────────────────
    // The shared gate itself now stands ABOVE the mouth branch (Aug 2 hoist).
    // Here the OpenAI session fills its two pieces: pin the transcription
    // language the server committed (only with OpenAI ears — Chirp detects it
    // per utterance) and cut the mouth through the response queue.
    // THE MODEL IS THE SERVER'S (audit Aug 2): a literal here used to override
    // OPENAI_REALTIME_TRANSCRIBE_MODEL from the env on every language commit —
    // changing the model in prod "worked" only until the first anchor. The
    // session answer now carries the configured model in `x-transcribe-model`;
    // the literal below is only the net for a header that never arrived.
    let transcribeModel = 'gpt-4o-transcribe'
    ancoreazaLimba = (lang: string): void => {
      if (!urechiChirp)
        send({
          type: 'session.update',
          session: {
            type: 'realtime',
            audio: { input: { transcription: { model: transcribeModel, language: lang } } },
          },
        })
    }
    taieGura = stopSpeaking

    dc.onmessage = (ev) => {
      let m: Record<string, unknown>
      try {
        m = JSON.parse(String(ev.data)) as Record<string, unknown>
      } catch {
        return
      }
      const type = String(m.type ?? '')
      const itemId = String((m.item_id as string) ?? (m.response_id as string) ?? '')

      if (type === 'conversation.item.input_audio_transcription.delta') {
        const t = (userText.get(itemId) ?? '') + String(m.delta ?? '')
        userText.set(itemId, t)
        onUserTranscript?.(t, false)
      } else if (type === 'conversation.item.input_audio_transcription.completed') {
        const t = String(m.transcript ?? userText.get(itemId) ?? '')
        userText.delete(itemId)
        onUserTranscript?.(t, true)
        // The voiceprint of THIS utterance — finalized once, then shared between
        // the padlock (transcriptVerdict) and the brain turn (onAddressed).
        const vf = liveVoiceTap?.finalize() ?? null
        poartaDupaTranscript(t, vf)
      } else if (type === 'response.output_audio_transcript.delta') {
        const t = (asstText.get(itemId) ?? '') + String(m.delta ?? '')
        asstText.set(itemId, t)
        onAssistantTranscript?.(t, false)
      } else if (type === 'response.output_audio_transcript.done') {
        const t = String(m.transcript ?? asstText.get(itemId) ?? '')
        asstText.delete(itemId)
        onAssistantTranscript?.(t, true)
        // Kelion finished speaking. If what he said was a QUESTION, you have the
        // right to one reply without calling him; if he only answered or stated
        // something, the gate closes at once and the name is mandatory again.
        replyUntil = /\?/.test(t) ? Date.now() + REPLY_WINDOW_MS : 0
      } else if (type === 'response.done') {
        // A mouth response ended (naturally or cancelled) — drain the queue.
        speakActive = false
        drainSpeak()
      } else if (type === 'input_audio_buffer.speech_started') {
        // ECHO PROTECTION: while Kelion speaks we ignore VAD starts — on
        // speakers, residual echo would make him cut himself mid-sentence.
        // A REAL talk-over isn't lost: its transcript still arrives, passes the
        // gate and starts a new brain turn, which silences the mouth anyway.
        if (!speakActive) onSpeechStart?.()
      } else if (type === 'error') {
        const err = (m.error as Record<string, unknown>) ?? {}
        const msg = String(err.message ?? err.code ?? 'realtime-error')
        // BENIGN errors (cancellation_failed / already-active response) don't
        // tear down the session — we just note them and move on.
        if (/cancel|active_response/i.test(`${String(err.code ?? '')} ${msg}`)) {
          console.warn('realtime eroare benignă:', msg)
        } else {
          // FATAL: we stop the session BEFORE announcing — otherwise it stayed alive
          // (mic captured, billing) and a SECOND microphone started in parallel.
          stop()
          onState?.('error', msg)
        }
      }
    }

    // ── THE CHIRP EAR STARTS (the big step, Aug 1) ───────────────────────────
    // The SAME mic stream feeds the Chirp ear; the finals flow through
    // poartaDupaTranscript — the exact gate the OpenAI transcripts used.
    // onSpeechBegin = barge-in signal (echo protection: ignored while the
    // mouth speaks). If the ear DIES mid-session we mark it and close — the
    // next start falls onto the proven OpenAI ears, never into a retry loop.
    if (urechiChirp) {
      const ear = await pornesteUrecheaChirp('urechile OpenAI', () => {
        if (!speakActive) onSpeechStart?.()
      })
      if (!ear) {
        // The probe lied (race with a config change) — the onError above
        // already marked the ear dead; close and let the panel restart.
        stop()
        onState?.('error', 'urechi-chirp-ws')
        throw new Error('chirp_ear_unavailable')
      }
      chirpEar = ear
      console.info('[voce] urechile live sunt Chirp 3 (Google) — gura rămâne pe sesiunea Realtime')
    }

    // 4) SDP: local offer → backend (proxy to OpenAI) → answer.
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const res = await fetch('/api/realtime/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      signal,
      // THE TIME ANCHOR (the "good evening" in the morning fix): voice got the GPS but NOT
      // the time — the voice brain guessed the part of day. We send the real time + the device's
      // timezone, exactly like the written chat, so the greeting follows the true clock.
      body: JSON.stringify({
        sdp: pc.localDescription?.sdp ?? '',
        language: opts.language,
        coords: opts.coords,
        now: new Date().toISOString(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        // THE BIG STEP (Aug 1): with Chirp ears the session is PURE MOUTH —
        // no input transcription, no VAD, no input audio billed.
        ears: urechiChirp ? 'chirp' : 'openai',
      }),
    })
    if (!res.ok) {
      // THE REASON, IN HUMAN TERMS (D7). The server has long been sending a structured
      // body (`code`, `retryable`), but the client threw it away and showed
      // "realtime 502" — a number that says nothing and helps no one
      // decide whether retrying is worth it.
      const corp = (await res.json().catch(() => null)) as
        | { code?: string; retryable?: boolean }
        | null
      // NEUTRAL FOR PAYING USERS (Adrian, Aug 1): no "provider", no internals —
      // the human hears only what to DO ("try again"). Codes stay in the log.
      const dupaCod: Record<string, string> = {
        realtime_not_configured: 'vocea nu e disponibilă momentan — încearcă din nou',
        upstream_timeout: 'vocea n-a răspuns la timp — încearcă din nou',
        upstream_unreachable: 'vocea nu s-a putut conecta — verifică rețeaua',
        upstream_5xx: 'vocea are o pană temporară — încearcă din nou peste puțin',
        upstream_empty: 'vocea n-a răspuns — încearcă din nou',
        upstream_refuz: 'vocea nu a putut porni — încearcă din nou',
      }
      const note =
        res.status === 401
          ? 'trebuie să fii logat'
          : res.status === 402
            ? 'nu mai ai credit'
            : (corp?.code && dupaCod[corp.code]) || `realtime ${res.status}`
      const err = new Error(note) as Error & { code?: string; retryable?: boolean }
      // THE MACHINE CODE RIDES ALONG (audit Aug 2): the note above only ever
      // reached console.error — a user out of credit was told the voice was
      // "temporarily unavailable" and promised a self-retry that could never
      // succeed. With `code`, ChatPanel shows the REAL reason in his language.
      err.code = res.status === 401 ? 'need_login' : res.status === 402 ? 'need_credit' : corp?.code
      // A missing session or an empty wallet does not fix itself by retrying.
      err.retryable = res.status === 401 || res.status === 402 ? false : corp?.retryable !== false
      throw err
    }
    // The transcribe model the SERVER is configured with (see the note at
    // `transcribeModel` above) — the header is the single source of truth.
    const modelHdr = res.headers.get('x-transcribe-model')
    if (modelHdr) transcribeModel = modelHdr
    const answer = await res.text()
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    if (closed || signal?.aborted) throw new DOMException('ended-before-live', 'AbortError')

    return {
      stop,
      setMuted: (muted: boolean) => {
        // CHIRP EARS: the mic belongs to the ear — mute it there (the WebRTC
        // senders list is empty in receive-only mode).
        chirpEar?.setMuted(muted)
        pc.getSenders().forEach((s) => {
          if (s.track?.kind === 'audio') s.track.enabled = !muted
        })
      },
      // Manual barge-in: silence the mouth right now.
      interrupt: stopSpeaking,
      speak,
      stopSpeaking,
    }
  } catch (e) {
    stop()
    // FIX "double counting" (Jul 24 audit, P3): here we NO LONGER call onState('error')
    // — we throw the exception, and the catch in ChatPanel counts the start failure ITSELF.
    throw e
  }
}
