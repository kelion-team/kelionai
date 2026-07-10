// MICROFON ÎN STREAMING — dictare LIVE (Adrian, 10 iul): pe măsură ce vorbește,
// fiecare cuvânt apare pe bandă instantaneu (rezultate PARȚIALE), se VALIDEAZĂ
// când e confirmat (rezultat FINAL), așa pentru toată fraza; la o PAUZĂ > 3s
// se închide fraza și pleacă la creier. Backend: WS /api/asr-stream → Google
// chirp_3 streaming (vezi routes/asr-stream.ts).
//
// Audio: capturăm PCM brut cu un ScriptProcessor (fără worklet extern, ca să nu
// mai apară „mic-ul mut" de la încărcarea modulului), îl reducem la 16kHz mono
// LINEAR16 și-l trimitem în cadre binare. Trimitem cadre DOAR când e voce (+3s
// coadă) ca să nu curgă tăcere spre Google (cost degeaba).

const TARGET_RATE = 16000
const PHRASE_PAUSE_MS = 3000 // pauză care închide fraza (ordinul lui Adrian)
const VOICE_RMS = 0.012 // sub atât = tăcere (nu trimitem cadre)
const TAIL_MS = 3200 // cât mai trimitem după ultima voce (prinde coada frazei)

export interface MicStreamHandle {
  stop(): void
  setMuted(muted: boolean): void
  listening: true
}

export interface MicStreamOpts {
  // fraza curentă, LIVE (finaluri validate + parțialul în curs) — pentru bandă
  onLive: (text: string) => void
  // fraza întreagă, la pauză > 3s → se trimite creierului
  onPhrase: (text: string) => void
  onError: (reason: string) => void
  getLang: () => string
  // s-a auzit voce cât Kelion vorbea → barge-in (taie vocea lui Kelion)
  onBargeIn?: () => void
}

function floatToPcm16(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out.buffer
}

// reducere de rată liniară (ctx.sampleRate → 16kHz) — suficient pentru voce
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
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch (e) {
    const name = (e as { name?: string })?.name
    opts.onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'failed')
    return null
  }

  const AC =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) {
    stream.getTracks().forEach((t) => t.stop())
    opts.onError('unsupported')
    return null
  }
  const ctx = new AC()
  void ctx.resume().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  // ScriptProcessor e depreciat dar universal și fără fișier separat — cel mai
  // sigur pentru „doar merge", exact ce trebuie pe calea critică a vocii.
  const proc = ctx.createScriptProcessor(4096, 1, 1)

  let closed = false
  let muted = false
  let ws: WebSocket | null = null
  let wsReady = false
  let lastVoiceAt = 0
  let phraseFinal = '' // finalurile validate din fraza curentă
  let phraseTimer: ReturnType<typeof setTimeout> | null = null
  // PLASĂ contra „mic-ului mut": dacă am trimis voce dar Google NU întoarce NIMIC
  // în 15s, streamingul e stricat (WS/auth/format) → cădem pe calea batch dovedită.
  let sentAudio = false
  let gotAnyMsg = false
  let silentTimer: ReturnType<typeof setTimeout> | null = null

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  try {
    ws = new WebSocket(`${proto}://${location.host}/api/asr-stream`)
    ws.binaryType = 'arraybuffer'
  } catch {
    opts.onError('failed')
  }

  const closePhrase = (): void => {
    const text = phraseFinal.trim()
    phraseFinal = ''
    if (phraseTimer) {
      clearTimeout(phraseTimer)
      phraseTimer = null
    }
    if (text) opts.onPhrase(text)
  }

  // pauză > 3s de la ULTIMA bucată de transcript → fraza s-a terminat.
  const armPhraseTimer = (): void => {
    if (phraseTimer) clearTimeout(phraseTimer)
    phraseTimer = setTimeout(closePhrase, PHRASE_PAUSE_MS)
  }

  if (ws) {
    ws.onopen = () => {
      wsReady = true
      try {
        ws?.send(JSON.stringify({ type: 'start', lang: opts.getLang() }))
      } catch {
        /* se reia la prima bucată */
      }
    }
    ws.onmessage = (ev) => {
      gotAnyMsg = true
      if (silentTimer) {
        clearTimeout(silentTimer)
        silentTimer = null
      }
      let m: { type?: string; transcript?: string }
      try {
        m = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (m.type === 'partial' && typeof m.transcript === 'string') {
        // LIVE: finaluri validate + parțialul care crește acum
        const live = `${phraseFinal} ${m.transcript}`.trim()
        opts.onLive(live)
        armPhraseTimer()
      } else if (m.type === 'final' && typeof m.transcript === 'string') {
        phraseFinal = `${phraseFinal} ${m.transcript}`.trim()
        opts.onLive(phraseFinal)
        armPhraseTimer()
      } else if (m.type === 'speech_begin') {
        if (muted) opts.onBargeIn?.()
      }
    }
    ws.onerror = () => {
      if (!closed) opts.onError('ws')
    }
    ws.onclose = () => {
      wsReady = false
    }
  }

  proc.onaudioprocess = (e: AudioProcessingEvent): void => {
    if (closed || muted || !ws || !wsReady || ws.readyState !== WebSocket.OPEN) return
    const input = e.inputBuffer.getChannelData(0)
    let sum = 0
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
    const rms = Math.sqrt(sum / input.length)
    const now = performance.now()
    if (rms > VOICE_RMS) lastVoiceAt = now
    // trimite DOAR cât e voce sau în coada de 3.2s de după — fără tăcere la Google
    if (now - lastVoiceAt > TAIL_MS) return
    const ds = downsample(input, ctx.sampleRate)
    try {
      ws.send(floatToPcm16(ds))
      if (!sentAudio) {
        sentAudio = true
        // am trimis prima voce reală → armăm plasa de 15s pentru „mic mut"
        silentTimer = setTimeout(() => {
          if (!gotAnyMsg && !closed) opts.onError('silent')
        }, 15000)
      }
    } catch {
      /* o bucată pierdută nu oprește fluxul */
    }
  }

  source.connect(proc)
  proc.connect(ctx.destination) // necesar ca onaudioprocess să ruleze în unele browsere

  // pista moare din exterior (apel, căști scoase) → anunțăm, panoul redeschide.
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
      ws?.send(JSON.stringify({ type: 'stop' }))
    } catch {
      /* ignoră */
    }
    try {
      ws?.close()
    } catch {
      /* ignoră */
    }
    try {
      proc.disconnect()
      source.disconnect()
    } catch {
      /* ignoră */
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
