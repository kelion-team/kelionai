import { openMicGraph } from './audioGraph'
// STREAMING MICROPHONE — LIVE dictation (Adrian, Jul 10): as he speaks,
// each word appears on the band instantly (PARTIAL results), gets VALIDATED
// when confirmed (FINAL result), and so on for the whole utterance; on a PAUSE > 3s
// the utterance closes and goes to the brain. Backend: WS /api/asr-stream → Google
// chirp_3 streaming (vezi routes/asr-stream.ts).
//
// Audio: we capture raw PCM with a ScriptProcessor (no external worklet, so the
// "mute mic" from module loading doesn't reappear), downsample it to 16kHz mono
// LINEAR16 and send it in binary frames. We send frames ONLY when there's voice (+3s
// tail) so silence doesn't flow to Google (wasted cost).

import {
  estimateF0,
  estimateCentroid,
  estimateZcr,
  estimateEnergy,
  estimateRolloff,
  buildVoiceFeatures,
  setPendingVoiceFeatures,
  type VoiceFeatures,
} from './audioIO.js'

const TARGET_RATE = 16000
const PHRASE_PAUSE_MS = 3000 // pauză care închide fraza (ordinul lui Adrian)
const VOICE_RMS = 0.02 // prag ABSOLUT de voce (ridicat de la 0.012 — scoate zgomotul de fond)
const DOMINANCE = 2.2 // vocea apropiată trebuie să domine podeaua de zgomot de-atâtea ori
const VOICED_FRAMES_TO_OPEN = 2 // câte cadre de voce consecutive ca să pornim (un poc = 1 cadru, se ignoră)
const TAIL_MS = 3200 // cât mai trimitem după ultima voce (prinde coada frazei)
const PRE_ROLL_MS = 400 // buffer înainte de declanșare — primele cadre vocale nu mai sunt pierdute

// ── STREAMING STT: DISPONIBIL SAU NU? (28 iul) ──────────────────────────────
// WHY this code exists: on the host (VPS) GOOGLE_SERVICE_ACCOUNT_JSON is NOT set
// — verified live in the env file. Without it the /api/asr-stream route refuses
// the upgrade (closes with 1011 'asr_not_configured'), and the BROWSER wrote red in
// consola lui Adrian «WebSocket connection to 'wss://kelionai.app/api/asr-stream'
// failed» on every microphone start. That message is printed by the browser,
// not us — no try/catch can swallow it; the only fix is to NOT open the WS
// when the server can't serve it anyway.
// So we ask the server ONCE on page load and, if
// streaming is missing, we immediately hand dictation to BATCH (/api/asr → has fallback to
// OpenAI in backend/src/services/asr.ts). The house rule: dictation degrades
// SILENTLY (loses only the live partials), never dies and never loops
// retries. When Google IS configured, the probe says `true` and streaming works
// exactly as before.
let streamingAsrAvailable: boolean | null = null
let capabilityProbe: Promise<boolean> | null = null

function canStreamAsr(): Promise<boolean> {
  if (streamingAsrAvailable !== null) return Promise.resolve(streamingAsrAvailable)
  if (typeof fetch !== 'function') {
    streamingAsrAvailable = true
    return Promise.resolve(true)
  }
  capabilityProbe ??= fetch('/api/asr-stream/capability', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<{ streaming?: boolean }>) : null))
    .then((j) => {
      // Older server / unexpected response → we assume streaming WORKS
      // (comportamentul de dinainte), iar plasa din `onclose` prinde restul.
      const ok = j ? j.streaming !== false : true
      streamingAsrAvailable = ok
      return ok
    })
    .catch(() => true)
  return capabilityProbe
}

// We probe from the start (one tiny request, at module load), so
// pressing "microphone" waits for NO round trip — the voice path
// stays under 1s, as the rule says.
void canStreamAsr()

export interface MicStreamHandle {
  stop(): void
  setMuted(muted: boolean): void
  listening: true
}

export interface MicStreamOpts {
  // the current utterance, LIVE (validated finals + the ongoing partial) — for the band
  onLive: (text: string) => void
  // the whole utterance, on pause > 3s → sent to the brain; the utterance's
  // voice features ride along (the full-duplex timbre gate needs them directly)
  onPhrase: (text: string, features: VoiceFeatures | null) => void
  onError: (reason: string) => void
  getLang: () => string
  // voice was heard while Kelion spoke → barge-in (cuts Kelion's voice)
  onBargeIn?: () => void
  // Google heard speech START (any time, muted or not) — the full-duplex
  // barge-in signal (the echo protection lives with the caller)
  onSpeechBegin?: () => void
  // DEFAULT true: the utterance's features also land in the shared pending
  // store (the dictation path consumes them on /api/chat). The full-duplex
  // path passes false — it gets the features directly through onPhrase, and
  // the shared store stays clean for typed turns.
  storePendingFeatures?: boolean
  // pre-warmed stream: on pressing the "mic on" button we call getUserMedia
  // before startMicStream, so activation is nearly instant.
  preWarmedStream?: MediaStream
}

// THE CHIRP EARS PROBE (Aug 1 — the big step): the full-duplex voice session
// asks this BEFORE choosing its ears. true → ears are Chirp 3 streaming (this
// module); false → the session keeps the OpenAI Realtime transcription.
export function urechiChirpDisponibile(): Promise<boolean> {
  return canStreamAsr()
}

// If a started Chirp ear DIES mid-session (Google outage, WS drop), the
// caller marks it here and the NEXT voice session starts on the proven
// OpenAI ears instead of looping into the same failure.
export function marcheazaUrechiChirpMoarte(): void {
  streamingAsrAvailable = false
}

function floatToPcm16(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out.buffer
}

// linear downsampling (ctx.sampleRate → 16kHz) — enough for voice
function downsample(input: Float32Array, inRate: number): Float32Array {
  if (inRate === TARGET_RATE) return input
  const ratio = inRate / TARGET_RATE
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) out[i] = input[Math.floor(i * ratio)]
  return out
}

export async function startMicStream(opts: MicStreamOpts): Promise<MicStreamHandle | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    opts.onError('unsupported')
    return null
  }
  // The server has no streaming STT → we exit BEFORE any WebSocket (and
  // before getUserMedia, unless we were given a pre-warmed stream).
  // The pre-warmed capture STOPS here, otherwise the mic stayed on
  // for nothing while the batch path opens its own capture.
  // 'ws' is the label ChatPanel already maps to "switch to batch for
  // the rest of the session" — we reuse it so we don't touch the panel.
  if (!(await canStreamAsr())) {
    opts.preWarmedStream?.getTracks().forEach((t) => t.stop())
    opts.onError('ws')
    return null
  }
  // The same microphone opening as voice (lib/audioGraph.ts) — single source.
  const graph = await openMicGraph(opts.onError, opts.preWarmedStream)
  if (!graph) return null
  const { stream, ctx } = graph
  void ctx.resume().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  // ScriptProcessor is deprecated but universal and needs no separate file — the
  // safest for "just works", exactly what's needed on the voice critical path.
  const proc = ctx.createScriptProcessor(4096, 1, 1)

  // Analizor paralel pentru features vocale (identificare speaker + gen).
  const featAnalyser = ctx.createAnalyser()
  featAnalyser.fftSize = 2048
  source.connect(featAnalyser)
  const featTimeBuf = new Float32Array(featAnalyser.fftSize)
  const featFreqBuf = new Float32Array(featAnalyser.frequencyBinCount)

  let closed = false
  let muted = false
  let ws: WebSocket | null = null
  let wsReady = false
  let lastVoiceAt = 0
  let noiseFloor = 0.006 // podeaua de zgomot adaptivă (pentru dominanță)
  let voicedRun = 0 // câte cadre de voce consecutive (anti-poc)
  let phraseFinal = '' // finalurile validate din fraza curentă
  let lastPartial = '' // ultimul parțial (dacă Google nu dă „final" în 3s)
  let phraseTimer: ReturnType<typeof setTimeout> | null = null
  // SAFETY NET against the "mute mic": if we sent voice but Google returns NOTHING
  // in 15s, streaming is broken (WS/auth/format) → we fall onto the proven batch path.
  let sentAudio = false
  let gotAnyMsg = false
  let silentTimer: ReturnType<typeof setTimeout> | null = null

  // Pre-roll ring: keeps the last ~400 ms of audio EVEN WHEN the VAD
  // hasn't declared "voice" yet. When it fires, we send the buffer first,
  // then the current stream — fixes the loss of the first syllables (until now the first
  // 2-3 frames reached Google only after the VAD accumulated consecutive frames).
  const preRoll: { frame: Float32Array }[] = []
  const pushPreRoll = (frame: Float32Array): void => {
    preRoll.push({ frame: frame.slice() })
    const frameMs = (frame.length / ctx.sampleRate) * 1000
    const maxFrames = Math.max(1, Math.ceil(PRE_ROLL_MS / frameMs))
    while (preRoll.length > maxFrames) preRoll.shift()
  }
  const flushPreRoll = (): void => {
    for (const { frame } of preRoll) {
      const ds = downsample(frame, ctx.sampleRate)
      try {
        ws?.send(floatToPcm16(ds))
        if (!sentAudio) {
          sentAudio = true
          silentTimer = setTimeout(() => {
            if (!gotAnyMsg && !closed) opts.onError('silent')
          }, 15000)
        }
      } catch {
        /* a lost chunk doesn't stop the stream */
      }
    }
    preRoll.length = 0
  }

  // Buffer-e pentru features vocale ale frazei curente.
  const phraseF0: number[] = []
  const phraseEnergies: number[] = []
  let phraseCentroidSum = 0
  let phraseCentroidCount = 0
  let phraseRolloffSum = 0
  let phraseZcrSum = 0
  let phraseEnergySum = 0
  let phraseFrames = 0

  const collectFrame = (): void => {
    featAnalyser.getFloatTimeDomainData(featTimeBuf)
    const energy = estimateEnergy(featTimeBuf)
    const f0 = estimateF0(featTimeBuf, ctx.sampleRate)
    phraseEnergies.push(energy)
    phraseEnergySum += energy
    phraseZcrSum += estimateZcr(featTimeBuf)
    if (f0 > 0) phraseF0.push(f0)
    featAnalyser.getFloatFrequencyData(featFreqBuf)
    const centroid = estimateCentroid(featFreqBuf, ctx.sampleRate, featAnalyser.fftSize)
    if (centroid > 0) {
      phraseCentroidSum += centroid
      phraseCentroidCount++
    }
    phraseRolloffSum += estimateRolloff(featFreqBuf, ctx.sampleRate, featAnalyser.fftSize)
    phraseFrames++
  }

  const finalizeFeatures = (): VoiceFeatures | null => {
    if (phraseFrames < 8) return null
    const centroid = phraseCentroidCount > 0 ? phraseCentroidSum / phraseCentroidCount : 0
    return buildVoiceFeatures(
      phraseF0,
      phraseEnergies,
      centroid,
      phraseRolloffSum / phraseFrames,
      phraseZcrSum / phraseFrames,
      phraseEnergySum / phraseFrames,
    )
  }

  const resetFeatures = (): void => {
    phraseF0.length = 0
    phraseEnergies.length = 0
    phraseCentroidSum = 0
    phraseCentroidCount = 0
    phraseRolloffSum = 0
    phraseZcrSum = 0
    phraseEnergySum = 0
    phraseFrames = 0
  }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  try {
    ws = new WebSocket(`${proto}://${location.host}/api/asr-stream`)
    ws.binaryType = 'arraybuffer'
  } catch {
    // WS didn't start → clean up the audio graph and fall to batch (don't leave AudioContext
    // + microphone hanging — leak/race from the Jul 10 audit).
    try {
      proc.disconnect()
      source.disconnect()
    } catch {
      /* deja deconectat */
    }
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
    opts.onError('failed')
    return null
  }

  const closePhrase = (): void => {
    if (phraseTimer) {
      clearTimeout(phraseTimer)
      phraseTimer = null
    }
    // If Google gave no "final" in 3s, use the last partial — otherwise a
    // short/tail utterance was lost completely (Jul 10 audit bug).
    const text = (phraseFinal || lastPartial).trim()
    phraseFinal = ''
    lastPartial = ''
    opts.onLive('') // golește MEREU banda la sfârșit de frază (nu rămâne agățat)
    if (text) {
      const features = finalizeFeatures()
      if (features && opts.storePendingFeatures !== false) setPendingVoiceFeatures(features)
      opts.onPhrase(text, features)
    }
    resetFeatures()
  }

  // pause > 3s since the LAST transcript chunk → the utterance is over.
  const armPhraseTimer = (): void => {
    if (phraseTimer) clearTimeout(phraseTimer)
    phraseTimer = setTimeout(closePhrase, PHRASE_PAUSE_MS)
  }

  // ONE SINGLE handover to batch: on a server refusal BOTH fire
  // (`onerror` AND `onclose`), and ChatPanel restarted the mic twice —
  // exactly the short restart loop we want eliminated.
  let fellBack = false
  const fallbackToBatch = (): void => {
    if (fellBack || closed) return
    fellBack = true
    opts.onError('ws')
  }

  if (ws) {
    ws.onopen = () => {
      wsReady = true
      try {
        ws?.send(JSON.stringify({ type: 'start', lang: opts.getLang() }))
      } catch {
        /* resumes on the first chunk */
      }
    }
    ws.onmessage = (ev) => {
      let m: { type?: string; transcript?: string; error?: string }
      try {
        m = JSON.parse(String(ev.data))
      } catch {
        return
      }
      // Only real transcript proves STT works. SPEECH_ACTIVITY_BEGIN
      // only confirms the server hears voice, NOT that it transcribes — if we let it
      // disarm the safety net, Kelion would stay mute (hears voice, but delivers no text).
      if (m.type === 'partial' && typeof m.transcript === 'string') {
        gotAnyMsg = true
        if (silentTimer) {
          clearTimeout(silentTimer)
          silentTimer = null
        }
        // LIVE: validated finals + the partial growing now
        lastPartial = m.transcript
        const live = `${phraseFinal} ${m.transcript}`.trim()
        opts.onLive(live)
        armPhraseTimer()
      } else if (m.type === 'final' && typeof m.transcript === 'string') {
        gotAnyMsg = true
        if (silentTimer) {
          clearTimeout(silentTimer)
          silentTimer = null
        }
        phraseFinal = `${phraseFinal} ${m.transcript}`.trim()
        opts.onLive(phraseFinal)
        armPhraseTimer()
      } else if (m.type === 'speech_begin') {
        opts.onSpeechBegin?.()
        if (muted) opts.onBargeIn?.()
      } else if (m.type === 'error' && !closed) {
        opts.onError('silent')
      }
    }
    ws.onerror = () => {
      fallbackToBatch()
    }
    ws.onclose = (ev) => {
      wsReady = false
      // CONTRACT cu backend/src/routes/asr-stream.ts: (1011, 'asr_not_configured')
      // = "the server has no streaming STT". We remember it for the WHOLE page
      // session, so later mic starts skip the WS right away
      // (see the guard at the top of startMicStream) — zero console errors, zero
      // retries. The reason can be swallowed by a proxy, so we also accept
      // the bare code: 1011 isn't used anywhere else on this route.
      if (ev.code === 1011 || ev.reason === 'asr_not_configured') streamingAsrAvailable = false
      // Refuz CURAT de la server (ex. 1011 asr_not_configured, 1008 auth):
      // only onclose arrives, never onerror — without this net the batch
      // fallback never fired (permanently deaf). 'ws' is the label
      // ChatPanel maps to falling into batch.
      if (!gotAnyMsg) fallbackToBatch()
    }
  }

  proc.onaudioprocess = (e: AudioProcessingEvent): void => {
    if (closed || muted || !ws || !wsReady || ws.readyState !== WebSocket.OPEN) return
    const input = e.inputBuffer.getChannelData(0)
    let sum = 0
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
    const rms = Math.sqrt(sum / input.length)
    const now = performance.now()
    // Adaptive NOISE FLOOR (like batch): rises slowly when quiet. Real
    // voice = above the absolute threshold AND dominating the floor this many times. Without it
    // any background noise > 0.012 flowed to Google (phantom transcriptions).
    const voiced = rms > VOICE_RMS && rms > noiseFloor * DOMINANCE
    if (!voiced) noiseFloor = noiseFloor * 0.97 + rms * 0.03

    // Pre-roll: we always keep the latest audio frames, even before the VAD
    // declares "voice". When it fires, we send them ahead of the current stream.
    pushPreRoll(input)

    // A short blip (1 frame) doesn't open the stream — we require a few consecutive frames.
    voicedRun = voiced ? voicedRun + 1 : 0
    const inSpeech = lastVoiceAt > 0 && now - lastVoiceAt <= TAIL_MS
    const becameVoiced = voicedRun >= VOICED_FRAMES_TO_OPEN
    const isOnset = becameVoiced && !inSpeech

    if (isOnset) {
      // First REAL voice detected (or resuming after a pause longer than the tail):
      // we send the pre-roll first, so the first syllables aren't lost.
      lastVoiceAt = now
      flushPreRoll()
      // The current frame is already in the pre-roll and was sent — don't resend it.
      return
    }
    if (becameVoiced || inSpeech) lastVoiceAt = now
    // sends ONLY while there's voice or in the 3.2s tail after — no silence to Google
    if (!lastVoiceAt || now - lastVoiceAt > TAIL_MS) return
    collectFrame()
    const ds = downsample(input, ctx.sampleRate)
    try {
      ws.send(floatToPcm16(ds))
      if (!sentAudio) {
        sentAudio = true
        // first real voice sent → we arm the 15s "mute mic" safety net
        silentTimer = setTimeout(() => {
          if (!gotAnyMsg && !closed) opts.onError('silent')
        }, 15000)
      }
    } catch {
      /* a lost chunk does not stop the stream */
    }
  }

  source.connect(proc)
  proc.connect(ctx.destination) // necesar ca onaudioprocess să ruleze în unele browsere

  // the track dies from outside (call, headset unplugged) → we notify, the panel reopens.
  stream.getAudioTracks().forEach((t) =>
    t.addEventListener('ended', () => {
      if (!closed) opts.onError('track-ended')
    }),
  )

  const stop = (): void => {
    if (closed) return
    closed = true
    if (phraseTimer) clearTimeout(phraseTimer)
    if (silentTimer) clearTimeout(silentTimer)
    try {
      // Only on an OPEN socket: send() on a closed one doesn't throw — it spits
      // «WebSocket is already in CLOSING or CLOSED state» into the console (seen
      // live at the Jul 28 network drop), and try/catch can't stop it.
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }))
    } catch {
      /* ignore */
    }
    try {
      ws?.close()
    } catch {
      /* ignore */
    }
    try {
      proc.disconnect()
      source.disconnect()
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
  }

  return {
    stop,
    setMuted: (m: boolean) => {
      muted = m
    },
    listening: true,
  }
}
