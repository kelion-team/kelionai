import { createTurnManager, type TurnManager } from './turnManager'

// AUDIO I/O — full-duplex, decalaj 0 (Adrian, 5 iul). Aplicația NU sintetizează
// și NU recunoaște nimic local: microfonul captează → PCM16 → SERVER (STT v2
// streaming, endpointing pe server), iar vocea creierului vine gata sintetizată
// de pe server și aici DOAR se redă. Zero „voce în front".
//
//  • Microfon: DESCHIS PERMANENT cu AEC (echoCancellation scoate din microfon
//    exact vocea lui Kelion → poți vorbi PESTE ea fără să se declanșeze pe el
//    însuși). Audio în STREAMING către /api/asr-stream (nu record→stop→trimite).
//  • Manager de tur ([[turnManager]]): barge-in instant (server: speech_begin /
//    partial → tai vocea), fără tăiat la început (microfonul curge continuu).
//  • Redare: playVoice(base64) — redă + anunță managerul (voiceStarted/voiceEnded).

export interface MicHandle {
  stop(): void
  setMuted(m: boolean): void
}

// Managerul de tur trăiește la nivel de modul: microfonul îl HRĂNEȘTE cu
// evenimente ASR, iar playVoice îl anunță când Kelion vorbește/tace — așa
// barge-in-ul și starea sunt coordonate într-un singur loc.
let turn: TurnManager | null = null

// TELEMETRIE latență (#11): ultima latență de răspuns (frază finală → prima voce),
// în ms. „Decalaj 0" dovedit cu cifre. UI-ul se abonează prin onVoiceLatency.
let lastVoiceLatencyMs: number | null = null
let latencyListener: ((ms: number) => void) | null = null
export function getLastVoiceLatency(): number | null {
  return lastVoiceLatencyMs
}
export function onVoiceLatency(cb: ((ms: number) => void) | null): void {
  latencyListener = cb
}

export async function startMic(
  onTranscript: (text: string) => void,
  onError: (reason: string) => void,
  getLang: () => string,
): Promise<MicHandle | null> {
  const AC =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (
    !navigator.mediaDevices?.getUserMedia ||
    !AC ||
    typeof AudioWorkletNode === 'undefined' ||
    typeof WebSocket === 'undefined'
  ) {
    onError('unsupported')
    return null
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true, // AEC — scoate vocea lui Kelion din microfon (barge-in real)
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    })
  } catch (e) {
    const name = (e as { name?: string })?.name
    onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'failed')
    return null
  }

  let stopped = false
  let muted = false
  const ctx = new AC()
  void ctx.resume().catch(() => {})

  // efectele managerului: barge-in taie vocea; fraza finală merge la creier.
  turn = createTurnManager({
    onStopVoice: () => stopVoice(),
    onUtterance: (text) => onTranscript(text),
    onLatency: (ms) => {
      lastVoiceLatencyMs = ms
      latencyListener?.(ms)
      // dovadă în consolă (observabilă la testul live)
      try {
        console.info(`[voce] latență răspuns: ${ms} ms`)
      } catch {
        /* fără consolă */
      }
    },
  })

  // ── WebSocket către ASR-ul în streaming (cookie-ul de sesiune merge automat) ─
  const wsUrl = location.origin.replace(/^http/, 'ws') + '/api/asr-stream'
  let ws: WebSocket | null = null
  let wsReady = false
  const pending: ArrayBuffer[] = [] // cadre audio până se deschide WS

  const openWs = (): void => {
    try {
      ws = new WebSocket(wsUrl)
    } catch {
      if (!stopped) setTimeout(openWs, 1500)
      return
    }
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      wsReady = true
      try {
        ws?.send(JSON.stringify({ type: 'start', lang: getLang() }))
      } catch {
        /* start pierdut — reconectarea reface */
      }
      for (const buf of pending.splice(0)) {
        try {
          ws?.send(buf)
        } catch {
          /* cadru pierdut */
        }
      }
    }
    ws.onmessage = (ev) => {
      let m: { type?: string; transcript?: string }
      try {
        m = JSON.parse(String(ev.data)) as { type?: string; transcript?: string }
      } catch {
        return
      }
      if (!turn) return
      if (m.type === 'speech_begin') turn.speechBegin()
      else if (m.type === 'speech_end') turn.speechEnd()
      else if (m.type === 'partial') turn.partial(m.transcript ?? '')
      else if (m.type === 'final') turn.final(m.transcript ?? '')
    }
    ws.onclose = () => {
      wsReady = false
      if (!stopped) setTimeout(openWs, 1500) // reconectare cât microfonul e viu
    }
    ws.onerror = () => {
      try {
        ws?.close()
      } catch {
        /* deja închis */
      }
    }
  }
  openWs()

  // ── Microfon → worklet PCM16 (fir de audio) → WS ────────────────────────────
  const source = ctx.createMediaStreamSource(stream)
  let node: AudioWorkletNode
  try {
    await ctx.audioWorklet.addModule('/pcm16-worklet.js')
    node = new AudioWorkletNode(ctx, 'pcm16-downsampler')
  } catch {
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
    try {
      ;(ws as WebSocket | null)?.close()
    } catch {
      /* deja închis */
    }
    onError('failed')
    return null
  }
  node.port.onmessage = (ev: MessageEvent) => {
    if (stopped || muted) return
    const buf = ev.data as ArrayBuffer
    if (wsReady && ws) {
      try {
        ws.send(buf)
      } catch {
        /* cadru pierdut */
      }
    } else if (pending.length < 200) {
      pending.push(buf) // tampon de pornire până se deschide WS
    }
  }
  source.connect(node)
  // NU conectăm node → destination: worklet-ul doar postează date, nu vrem ecou.

  const cleanup = (): void => {
    if (stopped) return
    stopped = true
    try {
      node.port.onmessage = null
      source.disconnect()
      node.disconnect()
    } catch {
      /* deja deconectat */
    }
    try {
      ws?.close()
    } catch {
      /* deja închis */
    }
    ws = null
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
    if (turn) {
      turn.reset()
      turn = null
    }
  }

  // PERMANENT ON: dacă pista moare din exterior (apel, căști scoase, alt app ia
  // microfonul), anunțăm — panoul redeschide microfonul singur.
  stream.getAudioTracks().forEach((t) => {
    t.addEventListener('ended', () => {
      if (stopped) return
      cleanup()
      onError('track-ended')
    })
  })

  return {
    stop() {
      cleanup()
    },
    // gate MANUAL (buton mut). În full-duplex NU se mai mută la redare — AEC +
    // managerul de tur se ocupă de ecou și barge-in.
    setMuted(m: boolean) {
      muted = m
    },
  }
}

// ── REDARE: vocea creierului, sosită gata sintetizată de pe server ──────────
let curVoice: HTMLAudioElement | null = null
// Coadă de bucăți (streaming pe fraze, TTS): redate LEGAT, în ordine. Barge-in /
// stopVoice golește coada. voiceStarted/voiceEnded se anunță O DATĂ pe replică.
const voiceQueue: string[] = []
let speaking = false
let endCb: (() => void) | null = null

// LIP-SYNC (Adrian): gura avatarului urmează AMPLITUDINEA REALĂ a sunetului, nu
// o animație falsă. Tapez redarea cu un AnalyserNode și expun nivelul (0..1),
// pe care AvatarModel îl citește în fiecare cadru. `getVoiceLevel()` = 0 în tăcere.
let playCtx: AudioContext | null = null
let voiceLevel = 0
let levelRAF = 0

export function getVoiceLevel(): number {
  return voiceLevel
}

// Rutează redarea prin WebAudio ca să-i pot măsura amplitudinea — DAR numai dacă
// contextul e deja pornit (gest de utilizator). Altfel NU ating redarea (rămâne
// audibilă simplă), doar fără mișcarea gurii de data asta. Zero risc de voce mută.
function attachLevelAnalysis(audio: HTMLAudioElement): void {
  try {
    const AC =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    if (!playCtx) playCtx = new AC()
    void playCtx.resume().catch(() => {})
    if (playCtx.state !== 'running') return // context suspendat → redare simplă
    const src = playCtx.createMediaElementSource(audio)
    const analyser = playCtx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.5
    src.connect(playCtx.destination) // audibil
    src.connect(analyser) // priză de nivel (analyser-ul nu merge mai departe)
    const data = new Float32Array(analyser.fftSize)
    cancelAnimationFrame(levelRAF)
    const loop = (): void => {
      if (curVoice !== audio) {
        voiceLevel = 0
        return
      }
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const rms = Math.sqrt(sum / data.length)
      voiceLevel = Math.min(1, rms * 6) // scalare la 0..1 pentru gură
      levelRAF = requestAnimationFrame(loop)
    }
    levelRAF = requestAnimationFrame(loop)
  } catch {
    /* fără lip-sync dacă routing-ul audio eșuează — vocea rămâne audibilă */
  }
}

function startNext(): void {
  const next = voiceQueue.shift()
  if (next === undefined) {
    curVoice = null
    voiceLevel = 0
    if (speaking) {
      speaking = false
      turn?.voiceEnded()
      const cb = endCb
      endCb = null
      cb?.()
    }
    return
  }
  const audio = new Audio(`data:audio/mp3;base64,${next}`)
  curVoice = audio
  const finish = (): void => {
    if (curVoice !== audio) return // înlocuit/oprit
    curVoice = null
    startNext() // legăm bucata următoare (fără voiceEnded între bucăți)
  }
  audio.onended = finish
  audio.onerror = finish
  attachLevelAnalysis(audio) // lip-sync (fără să rupă audibilitatea)
  void audio.play().catch(finish)
}

// Adaugă o bucată de voce în coadă. first=true → replică NOUĂ: golește coada
// (și oprește redarea) unei replici anterioare înainte s-o pornească.
export function enqueueVoice(base64Mp3: string, first = false, onEnd?: () => void): void {
  if (first) {
    voiceQueue.length = 0
    if (curVoice) {
      try {
        curVoice.pause()
      } catch {
        /* deja oprit */
      }
      curVoice = null
    }
  }
  if (onEnd) endCb = onEnd
  voiceQueue.push(base64Mp3)
  if (!speaking) {
    speaking = true
    turn?.voiceStarted() // → „speaking"; barge-in-ul poate tăia toată coada
    startNext()
  } else if (!curVoice) {
    startNext() // relansare dacă s-a golit între timp
  }
}

// Redare de sine stătătoare (salut/landing): o singură bucată, cu onStart/onEnd.
export function playVoice(base64Mp3: string, onStart?: () => void, onEnd?: () => void): void {
  stopVoice() // închide curat orice redare anterioară (îi cheamă onEnd o dată)
  onStart?.()
  enqueueVoice(base64Mp3, true, onEnd)
}

export function stopVoice(): void {
  const wasSpeaking = speaking
  voiceQueue.length = 0
  if (curVoice) {
    try {
      curVoice.pause()
    } catch {
      /* deja oprit */
    }
  }
  curVoice = null
  voiceLevel = 0
  speaking = false
  turn?.voiceEnded() // no-op dacă managerul e deja în „listening" (barge-in)
  const cb = endCb
  endCb = null
  if (wasSpeaking) cb?.() // pause() NU declanșează onended → chemăm noi onEnd
}

export function isVoicePlaying(): boolean {
  return curVoice !== null || voiceQueue.length > 0
}
