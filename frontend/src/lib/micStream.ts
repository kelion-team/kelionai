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
//
// THE SELF-HEALING EAR (Adrian, Aug 2 — the standing order: "solutions, not
// patches"; live data: 57 "voce realtime a picat" in 24h, one per redeploy):
// an unexpected WS drop used to kill the ear MID-SESSION — no reconnect, no
// error, just deaf — and the death mark was PERMANENT for the page session, so
// every later session landed on the zero-credit OpenAI reserve and the mic
// died completely. Now: (a) the WS reconnects BY ITSELF on any unexpected
// drop (same mic graph, fresh socket, the start frame resent), with a bounded
// budget (5 reconnects inside any 60s window) — only an exhausted budget
// escalates through onError; (b) the death mark is a 60s COOLDOWN after which
// the capability probe runs again (deploys are routine here); (c) a dead mic
// track reopens ONCE in place before escalating. A clean stop() NEVER
// reconnects. Barge-in, mute, pre-roll, voiceprint and the 15s 'silent'
// safety net (its timer resets on every reconnect) are untouched.

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
const PHRASE_PAUSE_MS = 3000 // pauză care închide fraza pe CEAS (rezervă, dacă serverul nu dă speech_end)
// ÎNCHIDEREA FRAZEI PE SEMNAL, NU PE CEAS (Adrian, 3 aug — latența „nu mă aude"):
// serverul trimite `speech_end` când VAD-ul Google detectează sfârșitul vorbirii
// (asr-stream.ts:240). Când vine, închidem fraza după o grație SCURTĂ (prinde un
// ultim 'final'), nu după 3000ms — ~2.2s mai repede până pleacă la creier.
// Ceasul de 3000ms rămâne plasa pentru cazul în care speech_end nu vine.
const PHRASE_PAUSE_AFTER_END_MS = 800
// Prag ABSOLUT de voce — readus la 0.012 (valoarea din #35, cu care dictarea
// a mers live): ridicarea la 0.02 din #36 tăia complet microfoanele mai
// liniștite (urechea „nu auzea nimic" — nu trecea NIMIC de VAD), iar
// protecția anti-zgomot reală stă oricum în DOMINANCE + anti-poc + poarta de
// timbru de pe server, nu într-un prag absolut mai sus.
const VOICE_RMS = 0.012 // prag ABSOLUT de voce (sub el = zgomot de fond, peste = posibilă voce)
const DOMINANCE = 2.2 // vocea apropiată trebuie să domine podeaua de zgomot de-atâtea ori
const VOICED_FRAMES_TO_OPEN = 2 // câte cadre de voce consecutive ca să pornim (un poc = 1 cadru, se ignoră)
const TAIL_MS = 3200 // cât mai trimitem după ultima voce (prinde coada frazei)
const PRE_ROLL_MS = 400 // buffer înainte de declanșare — primele cadre vocale nu mai sunt pierdute
// BARGE-IN cât Kelion vorbește (Adrian, 3 aug: „să pot vorbi peste el"). Praguri
// mai stricte decât VOX-ul normal: echoCancellation scoate vocea lui Kelion din
// microfon, dar un reziduu prin difuzor poate rămâne — cerem semnal clar,
// susținut, după o gardă de onset, ca să nu se taie singur.
const BARGE_RMS = 0.024 // dublul pragului normal: doar voce apropiată, clară
const BARGE_HOLD_MS = 180 // vocea trebuie să țină atât ca să taie (nu un poc)
const BARGE_GUARD_MS = 300 // fereastră de gardă după ce începe muțenia (onset redare)

// THE SELF-HEALING BUDGET (Aug 2): how many WS reconnects the ear attempts
// inside any sliding 60s window before it gives up and escalates. A stable
// connection earns its budget back as the window slides.
const RECONNECT_BUDGET = 5
const RECONNECT_WINDOW_MS = 60_000
// THE EAR'S COOLDOWN (Aug 2): a dead ear is NOT a life sentence. After this
// long, /api/asr-stream/capability is re-probed and a healthy (redeployed)
// server earns the ear back without a page reload.
const URECHI_COOLDOWN_MS = 60_000

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
let chirpEarCooldownUntil = 0

// The ear is marked down, but ONLY for the cooldown (Aug 2 — was permanent,
// which is exactly how one redeploy deafened Kelion for the whole page
// session and threw him onto the zero-credit OpenAI reserve).
function markUrechiIndisponibile(): void {
  streamingAsrAvailable = false
  chirpEarCooldownUntil = Date.now() + URECHI_COOLDOWN_MS
  capabilityProbe = null
}

function canStreamAsr(): Promise<boolean> {
  // The cooldown expired → forget the mark and probe the server again.
  if (streamingAsrAvailable === false && Date.now() >= chirpEarCooldownUntil) {
    streamingAsrAvailable = null
    capabilityProbe = null
  }
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
  onPhrase: (text: string, features: VoiceFeatures | null, audio?: string) => void
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
// OpenAI ears instead of looping into the same failure. NOT permanent (Aug
// 2): it is a cooldown — after URECHI_COOLDOWN_MS the capability probe runs
// again, because deploys are routine on this host.
export function marcheazaUrechiChirpMoarte(): void {
  markUrechiIndisponibile()
}

function floatToPcm16(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out.buffer
}

// AUDIO NATIV → CREIER (Adrian, 3 aug): împachetează cadrele PCM 16kHz (Float32)
// ale frazei într-un WAV mono 16-bit, ca data-URI base64 — exact formatul dovedit
// că Gemini îl „aude" nativ (feasibilitate confirmată pe server). Returnează ''
// dacă nu e destul audio; orice eroare cade grațios (fraza pleacă doar cu text).
const MAX_PHRASE_SAMPLES = TARGET_RATE * 20 // cap la ~20s de voce (memorie/upload mărginite)
function wavDataUri16k(chunks: Float32Array[]): string {
  let total = 0
  for (const c of chunks) total += c.length
  if (total < TARGET_RATE / 10) return '' // sub ~0.1s = nimic util
  const pcm = new Int16Array(total)
  let o = 0
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]))
      pcm[o++] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
  }
  const bytes = new Uint8Array(44 + pcm.byteLength)
  const dv = new DataView(bytes.buffer)
  const wr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
  }
  wr(0, 'RIFF')
  dv.setUint32(4, 36 + pcm.byteLength, true)
  wr(8, 'WAVE')
  wr(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, 1, true) // mono
  dv.setUint32(24, TARGET_RATE, true)
  dv.setUint32(28, TARGET_RATE * 2, true) // byte rate
  dv.setUint16(32, 2, true) // block align
  dv.setUint16(34, 16, true) // bits
  wr(36, 'data')
  dv.setUint32(40, pcm.byteLength, true)
  bytes.set(new Uint8Array(pcm.buffer), 44)
  let bin = ''
  // Bucăți MICI (8192) la fromCharCode: spread-ul cu zeci de mii de argumente
  // poate arunca „Maximum call stack" pe unele motoare — 8192 e sigur peste tot.
  const CH = 0x2000
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  }
  return `data:audio/wav;base64,${btoa(bin)}`
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
  const firstGraph = await openMicGraph(opts.onError, opts.preWarmedStream)
  if (!firstGraph) return null

  // THE AUDIO GRAPH IS REBUILDABLE IN PLACE (Aug 2): a mic track can die
  // mid-session (browser suspend, device grab). The nodes below are `let` so
  // onTrackEnded can reopen the microphone through the same openMicGraph and
  // rewire them WITHOUT touching the WS, the phrase state or the voiceprint
  // buffers — the ear survives the device hiccup.
  let stream = firstGraph.stream
  let ctx = firstGraph.ctx
  let source: MediaStreamAudioSourceNode
  let proc: ScriptProcessorNode
  let featAnalyser: AnalyserNode
  // Explicit <ArrayBuffer>: TS 5.7+ types a bare Float32Array as
  // Float32Array<ArrayBufferLike>, which the AnalyserNode getters (strict
  // Float32Array<ArrayBuffer>) refuse — the whole frontend build broke on it.
  let featTimeBuf: Float32Array<ArrayBuffer>
  let featFreqBuf: Float32Array<ArrayBuffer>

  let closed = false
  let muted = false
  let ws: WebSocket | null = null
  let wsReady = false
  let lastVoiceAt = 0
  // BARGE-IN: de când e mut (gardă de onset) și de când ține vocea de întrerupere.
  let mutedSince = 0
  let bargeSince = 0
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
  // THE DEAF-EAR DIAGNOSTIC (Adrian, Aug 2 — „microfonul nu aude nimic", live):
  // the server journal and the client watchdog each saw only THEIR half. When
  // the watchdog fires we now report — through the console hook, straight into
  // client_errors — how much audio ACTUALLY left the browser and how loud the
  // loudest frame was. Read together with the server's per-socket close line
  // (routes/asr-stream.ts), the next live test says WHICH leg is deaf:
  //   cadre=0 / rmsMax tiny → the mic or the VAD (client leg);
  //   cadre>0, server saw 0 → the transport; both saw frames → the Google leg.
  let framesSent = 0
  let maxRms = 0
  const raporteazaSilent = (): void => {
    console.error(
      `[voce] urechea Chirp silent — diagnostic: cadreAudioTrimise=${framesSent}, ` +
        `rmsMax=${maxRms.toFixed(4)} (pragVAD=${VOICE_RMS}), rataAudioContext=${ctx.sampleRate}Hz`,
    )
    opts.onError('silent')
  }
  // THE RECONNECT LEDGER (Aug 2): timestamps of the reconnects inside the
  // sliding window — the budget is "RECONNECT_BUDGET inside any 60s", not a
  // lifetime count, so a stable connection earns its budget back.
  const reconnectsAt: number[] = []
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

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
      // AUDIO NATIV — și pre-roll-ul intră în fraza pentru creier (agenții de
      // debug, 3 aug: prima silabă ajungea la Chirp dar LIPSEA din WAV-ul trimis
      // la Gemini — vocea brută pornea ciuntită exact cu ce repară pre-roll-ul).
      if (phrasePcmLen < MAX_PHRASE_SAMPLES) {
        phrasePcm.push(new Float32Array(ds))
        phrasePcmLen += ds.length
      }
      try {
        ws?.send(floatToPcm16(ds))
        framesSent++
        if (!sentAudio) {
          sentAudio = true
          silentTimer = setTimeout(() => {
            if (!gotAnyMsg && !closed) raporteazaSilent()
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
  // AUDIO NATIV: cadrele PCM 16kHz ale frazei curente, adunate ca să fie trimise
  // ca voce BRUTĂ la creier (Gemini) la închiderea frazei.
  let phrasePcm: Float32Array[] = []
  let phrasePcmLen = 0

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
    phrasePcm = []
    phrasePcmLen = 0
    phraseF0.length = 0
    phraseEnergies.length = 0
    phraseCentroidSum = 0
    phraseCentroidCount = 0
    phraseRolloffSum = 0
    phraseZcrSum = 0
    phraseEnergySum = 0
    phraseFrames = 0
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
      // AUDIO NATIV: vocea BRUTĂ a frazei (WAV 16kHz) pentru creierul care aude
      // nativ. Orice eroare de împachetare cade grațios → fraza pleacă doar cu
      // text (comportamentul de dinainte), nu se rupe nimic.
      let audio: string | undefined
      try {
        audio = wavDataUri16k(phrasePcm) || undefined
      } catch {
        audio = undefined
      }
      opts.onPhrase(text, features, audio)
    }
    resetFeatures()
  }

  // pause > 3s since the LAST transcript chunk → the utterance is over.
  const armPhraseTimer = (): void => {
    if (phraseTimer) clearTimeout(phraseTimer)
    phraseTimer = setTimeout(closePhrase, PHRASE_PAUSE_MS)
  }

  // ONE SINGLE escalation to batch: on a server refusal BOTH `onerror` AND
  // `onclose` used to fire, and ChatPanel restarted the mic twice — exactly
  // the short restart loop we want eliminated. Every path (refusal, exhausted
  // reconnect budget) comes through here, once.
  let fellBack = false
  const fallbackToBatch = (): void => {
    if (fellBack || closed) return
    fellBack = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    opts.onError('ws')
  }

  // THE SELF-HEALING RECONNECT (Aug 2): transparent, bounded, never on a
  // clean stop. The 15s 'silent' safety net RESETS here — the fresh socket
  // re-arms it when the first voice frame goes out.
  const scheduleReconnect = (): void => {
    if (closed || fellBack || reconnectTimer) return
    const now = Date.now()
    while (reconnectsAt.length > 0 && now - reconnectsAt[0] > RECONNECT_WINDOW_MS) reconnectsAt.shift()
    if (reconnectsAt.length >= RECONNECT_BUDGET) {
      // The budget ran out — ONLY NOW we escalate (the old immediate behavior).
      fallbackToBatch()
      return
    }
    reconnectsAt.push(now)
    if (silentTimer) {
      clearTimeout(silentTimer)
      silentTimer = null
    }
    sentAudio = false
    gotAnyMsg = false
    // Small backoff (400ms → 3.2s): a redeploy blip heals before the user
    // finishes the sentence; a dead server hits the budget in seconds, not minutes.
    const delay = Math.min(400 * 2 ** (reconnectsAt.length - 1), 3200)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      openWs()
    }, delay)
  }

  // Opens ONE socket and wires its handlers. Called for the first connection
  // and for every self-healing reconnect — the mic graph, the phrase state
  // and the VAD are untouched by the swap.
  const openWs = (): void => {
    if (closed || fellBack) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    let sock: WebSocket
    try {
      sock = new WebSocket(`${proto}://${location.host}/api/asr-stream`)
      sock.binaryType = 'arraybuffer'
    } catch {
      // The constructor itself threw (malformed URL, blocked) — heal like any drop.
      scheduleReconnect()
      return
    }
    ws = sock
    wsReady = false
    sock.onopen = () => {
      if (closed || sock !== ws) return
      wsReady = true
      try {
        sock.send(JSON.stringify({ type: 'start', lang: opts.getLang() }))
      } catch {
        /* resumes on the first chunk */
      }
    }
    sock.onmessage = (ev) => {
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
      } else if (m.type === 'speech_end') {
        // Google a detectat sfârșitul vorbirii → închide fraza REPEDE (grație
        // scurtă ca să prindem un ultim 'final'), nu aștepta ceasul de 3000ms.
        // Doar dacă avem ceva transcris; altfel lăsăm plasa de timp să lucreze.
        if (!closed && (phraseFinal || lastPartial).trim()) {
          if (phraseTimer) clearTimeout(phraseTimer)
          phraseTimer = setTimeout(closePhrase, PHRASE_PAUSE_AFTER_END_MS)
        }
      } else if (m.type === 'error' && !closed) {
        // The SERVER declared the Google stream persistently dead (its own
        // reconnect budget is already spent — see routes/asr-stream.ts):
        // no client-side reconnect can fix that → escalate at once.
        opts.onError('silent')
      }
    }
    sock.onerror = () => {
      // onclose ALWAYS follows an onerror — the single handling point below.
      // (Before, both fired the fallback and ChatPanel restarted twice.)
    }
    sock.onclose = (ev) => {
      if (closed || sock !== ws) return // clean stop() or a stale socket — NEVER reconnect
      wsReady = false
      // CONTRACT cu backend/src/routes/asr-stream.ts: (1011, 'asr_not_configured')
      // = "the server has no streaming STT at all". Not a drop to heal but a
      // config refusal → cooldown (NOT the old permanent mark) + batch.
      // The reason can be swallowed by a proxy, so we also accept the bare
      // code: 1011 isn't used anywhere else on this route.
      if (ev.code === 1011 || ev.reason === 'asr_not_configured') {
        markUrechiIndisponibile()
        fallbackToBatch()
        return
      }
      // ANY other close — a redeploy, a proxy idle timeout, a network blip:
      // the ear heals itself, transparently. Only an exhausted budget escalates.
      scheduleReconnect()
    }
  }

  const onAudioProcess = (e: AudioProcessingEvent): void => {
    if (closed || !ws || !wsReady || ws.readyState !== WebSocket.OPEN) return
    // BARGE-IN cât Kelion vorbește (Adrian, 3 aug: „să pot vorbi peste el"): cât e
    // MUT (anti-ecou) NU trimitem și NU acumulăm audio (ar fi ecoul lui), dar
    // calculăm local volumul și, la voce clară SUSȚINUTĂ (peste garda de onset),
    // îl întrerupem prin onBargeIn. Calea normală (dezmuțit) rămâne neatinsă.
    if (muted) {
      const inp = e.inputBuffer.getChannelData(0)
      let s2 = 0
      for (let i = 0; i < inp.length; i++) s2 += inp[i] * inp[i]
      const rmsMut = Math.sqrt(s2 / inp.length)
      const tNow = performance.now()
      if (mutedSince === 0) mutedSince = tNow
      if (tNow - mutedSince > BARGE_GUARD_MS && rmsMut > BARGE_RMS) {
        if (bargeSince === 0) bargeSince = tNow
        else if (tNow - bargeSince >= BARGE_HOLD_MS) {
          bargeSince = 0
          opts.onBargeIn?.()
        }
      } else {
        bargeSince = 0
      }
      return
    }
    mutedSince = 0
    bargeSince = 0
    const input = e.inputBuffer.getChannelData(0)
    let sum = 0
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
    const rms = Math.sqrt(sum / input.length)
    if (rms > maxRms) maxRms = rms // diagnosticul urechii moarte (vezi raporteazaSilent)
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
    // AUDIO NATIV: adună aceleași cadre 16kHz care merg la Chirp, ca să le trimitem
    // ca voce brută la creier la finalul frazei. Copie — bufferul de intrare se
    // reciclează între apeluri; fără copie am stoca zgomot.
    if (phrasePcmLen < MAX_PHRASE_SAMPLES) {
      phrasePcm.push(new Float32Array(ds))
      phrasePcmLen += ds.length
    }
    try {
      ws.send(floatToPcm16(ds))
      framesSent++
      if (!sentAudio) {
        sentAudio = true
        // first real voice sent → we arm the 15s "mute mic" safety net
        silentTimer = setTimeout(() => {
          if (!gotAnyMsg && !closed) raporteazaSilent()
        }, 15000)
      }
    } catch {
      /* a lost chunk does not stop the stream */
    }
  }

  // THE MIC TRACK DIED (browser suspend, device grab, headset unplugged):
  // before, the ear died with it and NOBODY reopened the mic — the session
  // fell onto the OpenAI reserve and (zero credits) the mic went mute. Now we
  // reopen the microphone ONCE through the same openMicGraph and rebuild the
  // audio graph in place; the WS, the phrase state and the voiceprint
  // collection survive. Only if the reopen fails do we escalate, as before.
  let micReopened = false
  const onTrackEnded = (): void => {
    if (closed) return
    if (micReopened) {
      opts.onError('track-ended')
      return
    }
    micReopened = true
    void (async () => {
      const g = await openMicGraph(() => {}, null)
      if (closed) {
        g?.stream.getTracks().forEach((t) => t.stop())
        if (g) void g.ctx.close().catch(() => {})
        return
      }
      if (!g) {
        opts.onError('track-ended')
        return
      }
      // Rewire FIRST, tear down the old graph after — never a moment with no graph.
      const old = { proc, source, stream, ctx }
      wireGraph(g)
      try {
        old.proc.disconnect()
        old.source.disconnect()
      } catch {
        /* already gone */
      }
      old.stream.getTracks().forEach((t) => t.stop())
      void old.ctx.close().catch(() => {})
      console.info('[micStream] microfon redeschis în loc (track-ended vindecat, urechea a rămas vie)')
    })()
  }

  // Builds (or rebuilds) the whole audio graph on a mic stream: source →
  // ScriptProcessor (PCM tap) and source → analyser (voiceprint tap), the
  // frame handler, and the track-ended healer.
  const wireGraph = (g: { stream: MediaStream; ctx: AudioContext }): void => {
    stream = g.stream
    ctx = g.ctx
    void ctx.resume().catch(() => {})
    source = ctx.createMediaStreamSource(stream)
    // ScriptProcessor is deprecated but universal and needs no separate file — the
    // safest for "just works", exactly what's needed on the voice critical path.
    proc = ctx.createScriptProcessor(4096, 1, 1)

    // Analizor paralel pentru features vocale (identificare speaker + gen).
    featAnalyser = ctx.createAnalyser()
    featAnalyser.fftSize = 2048
    source.connect(featAnalyser)
    featTimeBuf = new Float32Array(featAnalyser.fftSize)
    featFreqBuf = new Float32Array(featAnalyser.frequencyBinCount)

    proc.onaudioprocess = onAudioProcess
    source.connect(proc)
    proc.connect(ctx.destination) // necesar ca onaudioprocess să ruleze în unele browsere
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', onTrackEnded))
  }

  wireGraph(firstGraph)
  openWs()

  const stop = (): void => {
    if (closed) return
    closed = true
    if (phraseTimer) clearTimeout(phraseTimer)
    if (silentTimer) clearTimeout(silentTimer)
    // A clean stop NEVER reconnects: the healing timer dies with the session.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
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
