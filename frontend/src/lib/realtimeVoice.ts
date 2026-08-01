// ── VOCE LIVE — client OpenAI Realtime (WebRTC) ──────────────────────────────
// The FRONTEND half of voice, faithfully rebuilt from the live app (brought
// into git as the single source). The flow, verified from the live bundle:
//   1. RTCPeerConnection + microfon (addTrack)
//   2. dataChannel "oai-events" → we receive transcripts (user + Kelion) and errors
//   3. createOffer → POST /api/realtime/session {sdp, language} → answer SDP
//   4. ontrack → we play Kelion's voice and animate the avatar (audio level)
// The OpenAI key is NEVER here — the backend holds it. Model + voice + language
// are injected server-side; the client only sends the current language as a hint.

import { driveVoiceLevelFromElement, registerVoiceAudioElement, buildVoiceFeatures, estimateEnergy, estimateF0, estimateZcr, estimateCentroid, estimateRolloff, type VoiceFeatures } from './audioIO'

export type RealtimeVoiceState = 'connecting' | 'live' | 'error' | 'closed'

export interface RealtimeVoiceHandle {
  stop: () => void
  setMuted: (muted: boolean) => void
  /** Immediately interrupts Kelion's speech (manual barge-in). */
  interrupt: () => void
  /**
   * GPS ON DEMAND (Adrian, Jul 26: "only when GPS apps are used or location
   * detection is needed" — the permanent flow was explicitly rejected).
   * The position enters the context once, at startup; when a location tool
   * (weather/maps/routes) reads the REAL position of the moment, the client provides it too
   * sesiunii prin metoda asta — un item de sistem cu noii lat/lon, ca „aici"
   * to mean the place now, not the one from startup. Not polled periodically.
   */
  updateCoords: (c: { lat: number; lon: number }) => void
}

export interface RealtimeVoiceOpts {
  /** The current language (hint). The source of truth stays the preference persisted on the server. */
  language?: string
  onState?: (s: RealtimeVoiceState, note?: string) => void
  /** Transcriptul userului: (text, final). */
  onUserTranscript?: (text: string, final: boolean) => void
  /** Transcriptul lui Kelion: (text, final). */
  onAssistantTranscript?: (text: string, final: boolean) => void
  /**
   * VOICE AUTONOMY: the model requests a tool (maps/weather/web/Gmail/on-screen
   * display...). The handler executes it (usually via POST /api/realtime/tool)
   * and returns the result as a string — sent back to the model, which continues
   * speaking. Without a handler, voice stays tool-less (conversation only).
   */
  onToolCall?: (name: string, argsJson: string) => Promise<string>
  /**
   * DEVICE COMMAND FROM VOICE (camera/screen): the server interprets
   * the user's transcript with the SAME interpreter as in writing and returns the command;
   * the client executes it (switches camera front/back, closes the monitor etc.).
   */
  onDevice?: (device: DeviceCommandFrame) => void
  /** Live GPS from the device — injected into the session context (weather/"where am I"). */
  coords?: { lat: number; lon: number }
  signal?: AbortSignal
}

// The shape of the device command returned by the server (identical to {device} in the written-chat
// SSE) — the client maps it onto handleControl({ device }).
export interface DeviceCommandFrame {
  camera?: 'on' | 'off' | 'front' | 'back' | 'switch'
  screen?: { op: 'close' | 'closeAll' | 'closeKind' | 'switchKind'; kind?: string }
}

// VOICEPRINT ON THE MAIN VOICE (Adrian, Jul 26): the voiceprint tap of the
// ACTIVE session (one single session — guaranteed by the singleton). finalize()
// returns the voiceprint of the just-spoken utterance and empties the buffer. liveInject
// injects a SYSTEM message into the session (the foreign-voice warning).
let liveVoiceTap: { finalize: () => VoiceFeatures | null } | null = null
let liveInject: ((text: string) => void) | null = null

// Saves a turn into history (memory + continuity between sessions). Best-effort.
function persistTranscript(
  role: 'user' | 'assistant',
  text: string,
  onCommittedLang?: (lang: string) => void,
  onDevice?: (device: DeviceCommandFrame) => void,
): void {
  const t = text.trim()
  if (!t) return
  void fetch('/api/realtime/transcript', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      role,
      text: t,
      // Amprenta frazei tocmai rostite (numai pe turele userului) — serverul o
      // compares with the owner's reference, like in the written chat.
      voiceFeatures: role === 'user' ? (liveVoiceTap?.finalize() ?? undefined) : undefined,
    }),
  })
    .then(async (r) => {
      // The server COMMITTED the detected language (2 consecutive messages) → we anchor
      // the live session onto it (see the caller) — transcription no longer guesses.
      const j = (await r.json().catch(() => null)) as { lang?: string; device?: DeviceCommandFrame; foreignVoice?: boolean; adminUnlocked?: boolean } | null
      // FOREIGN VOICE (the voiceprint doesn't match the owner): the session immediately gets
      // the protection rule — nothing administrative until confirmation.
      if (j?.foreignVoice)
        liveInject?.(
          'ATENȚIE (verificare de timbru): vocea curentă NU se potrivește cu amprenta titularului contului. Poartă conversația normal, dar NU executa comenzi de administrare, financiare sau distructive până când titularul nu confirmă ÎN SCRIS în chat.',
        )
      // THE ADMIN PADLOCK: the voiceprint matched → the server set the unlock
      // cookie; we notify the UI (Stage) to light up the Admin button.
      if (j?.adminUnlocked) window.dispatchEvent(new Event('kelion:admin-unlock'))
      if (j?.lang && onCommittedLang) onCommittedLang(j.lang)
      // The verbal camera/screen command → the client executes it right away.
      if (j?.device && onDevice) onDevice(j.device)
    })
    .catch(() => {})
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
  if (typeof sinkEl.setSinkId !== 'function') return // iOS/Safari: rutează sistemul
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
  voiceBc = null /* browser vechi — rămâne garda pe tab */
}

/**
 * Starts a full-duplex voice session via OpenAI Realtime.
 * Throws if the microphone is refused or the backend session fails.
 */
export async function startRealtimeVoice(
  opts: RealtimeVoiceOpts = {},
): Promise<RealtimeVoiceHandle> {
  const { onState, onUserTranscript, onAssistantTranscript, onToolCall, onDevice, signal } = opts
  onState?.('connecting')

  // Any earlier session from THIS tab dies before another starts.
  activeVoice?.stop()
  activeVoice = null
  // Notify the other tabs: the voice session is HERE from now on.
  const myId = voiceSessionId()
  voiceBc?.postMessage({ takeover: myId })

  let closed = false
  const cleanups: (() => void)[] = []
  const pc = new RTCPeerConnection()

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
      pc.getSenders().forEach((s) => s.track?.stop())
    } catch {
      /* ignore */
    }
    try {
      pc.close()
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
    // The voiceprint tap: a parallel analyser on the SAME microphone (doesn't touch
    // WebRTC). It collects frames only when there's speech energy; the voiceprint
    // finalizes per utterance (at the final transcript) — like on the STT path.
    try {
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
        if (e < 0.004) return // liniște/zgomot — nu poluăm amprenta
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
          if (frames < 8) return null // prea puțin semnal — fără amprentă
          const out = buildVoiceFeatures(f0s.slice(), energies.slice(), cN ? cSum / cN : 0, rSum / frames, zSum / frames, eSum / frames)
          f0s.length = 0; energies.length = 0; cSum = 0; cN = 0; rSum = 0; zSum = 0; eSum = 0; frames = 0
          return out
        },
      }
      cleanups.push(() => {
        window.clearInterval(tick)
        liveVoiceTap = null
        liveInject = null
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
              bindMicTrack(newTrack, sender) // și noua pistă se vindecă la fel
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

    // 2) Vocea lui Kelion (pista remote) + animarea avatarului din nivelul audio.
    // SHARED ELEMENT (not a new one each time) — see the comment at
    // `getSharedAudioEl`: once unlocked by a real gesture, it stays unlocked across
    // all later automatic reopenings (voice per utterance).
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
      // gesture. The old variant swallowed the refusal (`.catch(()=>{})`) → Kelion
      // connected but "the voice was completely missing". Now, if playback is
      // blocked, we RETRY it on the first gesture (click/key/touch) and then
      // clean up the listeners — the voice starts from the first interaction.
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

    // FIX "dies silently" (Jul 24 audit, P2): before, we handled ONLY `failed`.
    // When OpenAI closes the call (session limit, idle, server drop) the state
    // goes through `disconnected`/`closed` WITHOUT ever reaching `failed` →
    // micRef stayed installed, the UI showed "listening", but there was neither hearing,
    // nor voice ("audio doesn't exist"). Now: `closed` = immediately fatal; on
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

    // 3) dataChannel — evenimentele OpenAI Realtime (transcript + erori + barge-in).
    const dc = pc.createDataChannel('oai-events')
    // The events channel closed gracefully by the server = dead session (without it
    // there are neither transcripts nor tool-calls) — treated as a fatal error.
    dc.onclose = () => {
      if (!closed) {
        stop()
        onState?.('error', 'dc-closed')
      }
    }
    // ONE SINGLE injection (Jul 25 — Adrian: "you inject a thousand times, you duplicate").
    // The instructions + tools + context come NOW in the initial session from the
    // server (multipart string, accepted by OpenAI with 201). We do NOT duplicate here
    // prin session.update — era exact stratul redundant.
    const send = (obj: unknown): void => {
      if (dc.readyState === 'open') {
        try {
          dc.send(JSON.stringify(obj))
        } catch {
          /* ignore */
        }
      }
    }
    // The partial text by id, so we save complete turns into history.
    const userText = new Map<string, string>()
    const asstText = new Map<string, string>()
    // ── THE NAME GATE, MECHANICAL (Adrian, Jul 27: "doesn't enter the chat unless
    // he hears his name — it's already done but doesn't work") ───────────────────
    // The server stopped the automatic reply (create_response:false); HERE it is
    // decided who gets a reply: (1) the utterance contains the name ("Kelion"/"Kei",
    // tolerant to transcription variations) → he replies and OPENS the conversation
    // window; (2) the window is open (recent exchange) → the conversation flows
    // freely, without repeating the name — exactly what the old Jul 24 gate lacked,
    // which demanded the name on EVERY utterance and seemed deaf; (3) otherwise → silence:
    // the room discussion isn't addressed to him. "STOP" closes the window.
    // 45s, not 120s (Adrian, Jul 31: "talks without respecting the user" —
    // talks without being called). The two-minute window, renewed on
    // every exchange, meant in practice ALWAYS OPEN: if you exchanged a word
    // with him, then talked for a minute with someone else in the room, he replied — not
    // because the gate was broken, but because it was too wide open.
    // 45s keeps the conversation flowing without repeating the name, but closes fast
    // enough that a discussion with someone else is no longer addressed to him.
    // ── REGULA LUI: „KELION" + RESTUL FRAZEI ────────────────────────────────
    // Adrian, Jul 31: "talks when no one is talking to him; what he hears that has
    // nothing to do with him, he reacts to. The implemented rule — Kelion and the rest
    // of the utterance — he doesn't apply it."
    //
    // He was right, and in the morning I had cut the window from 120s to 45s without
    // touching what kept it open: it RENEWED on every utterance that entered it,
    // AND it renewed when Kelion himself spoke. A window that renews
    // from its own content never closes while people talk in the
    // room — 45s or 120s was the same thing.
    //
    // Now the gate is per UTTERANCE, not on the clock: the name is in the utterance → the rest of the utterance is
    // the command. No name → silence. The only exception is the obvious one: if he just
    // asked you a question, you may reply without calling him again —
    // but that's ONE SINGLE reply, consumed on first use and not
    // renewed by anything.
    const REPLY_WINDOW_MS = 12_000
    // THE WINDOW IS OPEN AT SESSION START (bug found live by Adrian,
    // Jul 27, "he seems not to hear": the user just STARTED the microphone — obviously
    // they're addressing Kelion; demanding the name on the very first utterance, with a
    // transcription that mangles it, made him completely mute at opening).
    // At STARTUP the window is open for a shorter time: the user just pressed the
    // microphone, so the first seconds are clearly addressed to him — but if they say
    // nothing in 15s, silence becomes the default again.
    let replyUntil = Date.now() + 15_000
    // Regex TOLERANT to real transcription (live proof: "Kelion, ce faci" came out
    // as "Elioncevaci"): we also accept the variants without the initial consonant
    // (elion/eleon), glued to the next word.
    const NAME_RE = /[ckg]h?e?l[iy]?[oae]n|elion|eleon|\bkei\b|\bkay\b/i
    // The anti-"he doesn't hear me" net: if the VAD closed the utterance but the transcript doesn't
    // arrive (transcription failed), in an ACTIVE conversation we reply anyway.
    let speechStopTimer: number | null = null
    cleanups.push(() => {
      if (speechStopTimer != null) clearTimeout(speechStopTimer)
    })
    // The last language ANCHORED in the live session — we re-anchor only on change.
    let anchoredLang = ''
    // Apelurile de unelte: numele vine pe output_item.added, argumentele pe
    // function_call_arguments.done — legate prin call_id.
    const toolNames = new Map<string, string>()
    // The system injection becomes available with the events channel.
    liveInject = (text: string) =>
      send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } })
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
        // The transcript arrived — the "missing transcript" net is no longer needed.
        if (speechStopTimer != null) {
          clearTimeout(speechStopTimer)
          speechStopTimer = null
        }
        // THE "STOP" COMMAND (Adrian, Jul 27: "kelion doesn't obey the stop command"):
        // spoken ALONE ("stop", "taci", "gata", "oprește-te"...), it cuts AT
        // ONCE both the generation and the already-produced sound — deterministic, in the client,
        // without waiting for the model's goodwill — then leaves a silence order.
        // The second cut at 400ms also kills the reply the VAD
        // starts automatically IN REACTION to the "stop" utterance itself.
        if (/^\W*(stop|stai|taci|gata|opre[sș]te(?:-te)?|shut ?up|be quiet|basta)[\s.!…]*$/i.test(t.trim())) {
          replyUntil = 0 // STOP închide și replica — până la următorul „Kelion"
          send({ type: 'response.cancel' })
          send({ type: 'output_audio_buffer.clear' })
          send({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'system',
              content: [{ type: 'input_text', text: 'STOP de la user: taci IMEDIAT. NU răspunde la acest ordin — nicio confirmare, niciun cuvânt. Rămâi complet tăcut până când userul îți vorbește din nou.' }],
            },
          })
          window.setTimeout(() => {
            send({ type: 'response.cancel' })
            send({ type: 'output_audio_buffer.clear' })
          }, 400)
        } else if (t.trim()) {
          // THE NAME GATE, PER UTTERANCE: the name is in this utterance → the rest of the utterance
          // is the command, reply. It isn't → silence, no matter what was said
          // before. The only gate that doesn't demand the name is the reply to his own
          // question, and that one gets CONSUMED here: `replyUntil = 0` before
          // the reply, so one reply can't open the next one.
          // Here was the old mistake: the window re-pushed itself into the future on
          // EVERY utterance it accepted, so it fed on what it let
          // through — a perpetuum mobile that never closed while something
          // was heard in the room.
          const named = NAME_RE.test(t)
          const answering = Date.now() < replyUntil
          if (named || answering) {
            replyUntil = 0
            send({ type: 'response.create' })
          }
        }
        // On the language COMMITTED by the server: we anchor the LIVE session's transcription onto it
        // (session.update, no restart) — the "random language" disappears.
        // DOAR LA SCHIMBARE (25 iul — testul live al lui Adrian: „sacadat, voci
        // uncontrolled"): before, the anchor ran session.update + system
        // injection on EVERY utterance — it shook the audio session mid-reply.
        // The language doesn't change utterance by utterance; we anchor once and re-anchor
        // only when the server commits ANOTHER language.
        persistTranscript(
          'user',
          t,
          (lang) => {
            if (lang === anchoredLang) return
            anchoredLang = lang
            send({
              type: 'session.update',
              session: {
                type: 'realtime',
                audio: { input: { transcription: { model: 'gpt-4o-transcribe', language: lang } } },
              },
            })
            const names: Record<string, string> = { ro: 'Romanian', en: 'English', fr: 'French', es: 'Spanish', pt: 'Portuguese', it: 'Italian', de: 'German' }
            const nm = names[lang] ?? 'English'
            send({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'system',
                content: [{ type: 'input_text', text: `Reminder: reply ONLY in ${nm}. Never switch language. If you heard only noise or silence, stay silent.` }],
              },
            })
          },
          // VERBAL CAMERA/SCREEN COMMAND (Jul 25): the server interpreted
          // the transcript → we execute it in the client (switch camera, close the monitor).
          onDevice,
        )
      } else if (type === 'response.output_audio_transcript.delta') {
        const t = (asstText.get(itemId) ?? '') + String(m.delta ?? '')
        asstText.set(itemId, t)
        onAssistantTranscript?.(t, false)
      } else if (type === 'response.output_audio_transcript.done') {
        const t = String(m.transcript ?? asstText.get(itemId) ?? '')
        asstText.delete(itemId)
        onAssistantTranscript?.(t, true)
        persistTranscript('assistant', t)
        // Kelion finished speaking. HERE it used to be decided, until today, that anything
        // heard in the next tens of seconds is addressed to him — he kept
        // his own gate open, by speaking. Now: if he asked a QUESTION, you
        // have the right to one reply without calling him; if he only answered or
        // stated something, the gate closes at once and the name is again
        // mandatory. A statement of his is not an invitation to talk.
        replyUntil = /\?/.test(t) ? Date.now() + REPLY_WINDOW_MS : 0
      } else if (type === 'input_audio_buffer.speech_stopped') {
        // The anti-"he doesn't hear me" net (the reason the old gate was removed, Jul 24): the VAD
        // closed the utterance; if the transcript does NOT arrive within 2.8s (transcription
        // failed) and the conversation is ACTIVE, we reply anyway — a transcription
        // failure must not make him deaf in the middle of the discussion. Outside
        // the conversation (gate closed), silence stays silence.
        // The net applies ONLY to the reply to his own question — the only
        // case where we know, without a transcript, that the utterance is addressed to him. Without
        // a transcript we can't search for the name, and replying "so he doesn't seem
        // deaf" is exactly how he ended up talking over the room's discussion.
        // It gets consumed, like any reply.
        if (speechStopTimer != null) clearTimeout(speechStopTimer)
        speechStopTimer = window.setTimeout(() => {
          speechStopTimer = null
          if (Date.now() < replyUntil) {
            replyUntil = 0
            send({ type: 'response.create' })
          }
        }, 2800)
      } else if (type === 'response.output_item.added') {
        // The requested function's name — stored by call_id for the arguments step.
        const item = (m.item as Record<string, unknown>) ?? {}
        if (item.type === 'function_call') {
          toolNames.set(String(item.call_id ?? ''), String(item.name ?? ''))
        }
      } else if (type === 'response.function_call_arguments.done') {
        // VOICE AUTONOMY: executes the tool and sends the result back, then
        // asks for the reply to continue — Kelion speaks based on the result.
        const callId = String(m.call_id ?? '')
        const name = String(m.name ?? toolNames.get(callId) ?? '')
        toolNames.delete(callId)
        const argsJson = String(m.arguments ?? '{}')
        // ANTI-"2 VOICES" ON ESCALATION (Adrian, Jul 25): if the model was already uttering
        // something when it requested the tool (e.g. "let me check"), the `response.create`
        // below started a SECOND utterance OVER the first → two overlapping voices.
        // We cut any ongoing reply BEFORE uttering the tool result.
        if (name && onToolCall) {
          void onToolCall(name, argsJson)
            .catch((e) => JSON.stringify({ error: String(e).slice(0, 200) }))
            .then((output) => {
              send({ type: 'response.cancel' })
              send({
                type: 'conversation.item.create',
                item: { type: 'function_call_output', call_id: callId, output: String(output ?? '{}') },
              })
              send({ type: 'response.create' })
            })
        } else {
          // Unresolvable name (or no handler): we reply anyway — otherwise
          // the model hangs waiting for the function result.
          send({ type: 'response.cancel' })
          send({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: callId, output: '{"error":"unknown_tool"}' },
          })
          send({ type: 'response.create' })
        }
      } else if (type === 'error') {
        const err = (m.error as Record<string, unknown>) ?? {}
        const msg = String(err.message ?? err.code ?? 'realtime-error')
        // Erori BENIGNE (cancellation_failed / conversation_already_has_active_
        // response) doesn't tear down the session — we just note them and move on.
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
      const dupaCod: Record<string, string> = {
        realtime_not_configured: 'vocea nu e configurată pe server',
        upstream_timeout: 'furnizorul vocii n-a răspuns la timp — încearcă din nou',
        upstream_unreachable: 'nu am putut ajunge la furnizorul vocii — verifică rețeaua',
        upstream_5xx: 'furnizorul vocii are o pană — încearcă din nou peste puțin',
        upstream_empty: 'furnizorul vocii a răspuns gol — încearcă din nou',
        upstream_refuz: 'cererea de pornire a vocii a fost refuzată',
      }
      const note =
        res.status === 401
          ? 'trebuie să fii logat'
          : res.status === 402
            ? 'nu mai ai credit'
            : (corp?.code && dupaCod[corp.code]) || `realtime ${res.status}`
      const err = new Error(note)
      // Whoever catches the error can decide whether to show the "try again" button.
      ;(err as Error & { retryable?: boolean }).retryable = corp?.retryable !== false
      throw err
    }
    const answer = await res.text()
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    if (closed || signal?.aborted) throw new DOMException('ended-before-live', 'AbortError')

    return {
      stop,
      setMuted: (muted: boolean) => {
        pc.getSenders().forEach((s) => {
          if (s.track?.kind === 'audio') s.track.enabled = !muted
        })
      },
      // Manual barge-in: we ask the model to cut the current reply.
      interrupt: () => send({ type: 'response.cancel' }),
      // The position changed → a SYSTEM item with the new lat/lon (we don't duplicate
      // instructions via session.update — the "one single injection" rule).
      updateCoords: (c: { lat: number; lon: number }) =>
        send({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [
              {
                type: 'input_text',
                text:
                  `ACTUALIZARE GPS LIVE: poziția CURENTĂ a utilizatorului este ACUM latitudine ${c.lat.toFixed(5)}, longitudine ${c.lon.toFixed(5)}. ` +
                  'De acum, „aici", „lângă mine", „unde sunt" și vremea locală folosesc ACEASTĂ poziție (cea veche nu mai e valabilă); la get_weather pasează exact acești lat/lon.',
              },
            ],
          },
        }),
    }
  } catch (e) {
    stop()
    // FIX "double counting" (Jul 24 audit, P3): here we NO LONGER call onState('error')
    // — we throw the exception, and the catch in ChatPanel counts the start failure ITSELF.
    // Before, a single failure incremented the counter twice (onState + catch) →
    // "3 chances" were in fact 2 and full-duplex died prematurely onto STT.
    throw e
  }
}
