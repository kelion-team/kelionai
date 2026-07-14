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
  // stream pre-încălzit: la apăsarea butonului "mic on" apelăm getUserMedia
  // înainte de startMicStream, ca activarea să fie aproape instant.
  preWarmedStream?: MediaStream
}

function floatToPcm16(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out.buffer
}

// MOSTRA AUDIO pentru butonul „play" din admin (Adrian, 14 iul: „trebuie să am buton
// play să aud vocea"). Împachetăm PCM16 16kHz (exact ce trimitem la Google) ca WAV
// mono → data-URL. SINCRON, deci clipul e gata pe obiectul de features înainte de
// trimitere (fără race, spre deosebire de MediaRecorder-ul asincron din calea batch).
function pcm16ToWavDataUrl(chunks: Float32Array[], sampleRate: number): string {
  let total = 0
  for (const c of chunks) total += c.length
  if (total === 0) return ''
  const buf = new ArrayBuffer(44 + total * 2)
  const view = new DataView(buf)
  const wr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  wr(0, 'RIFF')
  view.setUint32(4, 36 + total * 2, true)
  wr(8, 'WAVE')
  wr(12, 'fmt ')
  view.setUint32(16, 16, true) // sub-chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits/sample
  wr(36, 'data')
  view.setUint32(40, total * 2, true)
  let off = 44
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]))
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return `data:audio/wav;base64,${btoa(bin)}`
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
  if (opts.preWarmedStream && opts.preWarmedStream.getAudioTracks().length > 0) {
    stream = opts.preWarmedStream
  } else {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (e) {
      const name = (e as { name?: string })?.name
      opts.onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'failed')
      return null
    }
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
  // PLASĂ contra „mic-ului mut": dacă am trimis voce dar Google NU întoarce NIMIC
  // în 15s, streamingul e stricat (WS/auth/format) → cădem pe calea batch dovedită.
  let sentAudio = false
  let gotAnyMsg = false
  let silentTimer: ReturnType<typeof setTimeout> | null = null

  // Inel de pre-roll: păstrează ultimele ~400 ms de audio CHIAR ȘI când VAD-ul
  // încă n-a declarat „voce". Când declanșează, trimitem mai întâi bufferul,
  // apoi fluxul curent — rezolvă pierderea primelor silabe (până acum primele
  // 2-3 cadre ajungeau la Google doar după ce VAD-ul acumula cadre consecutive).
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
      addClipAudio(ds)
      try {
        ws?.send(floatToPcm16(ds))
        if (!sentAudio) {
          sentAudio = true
          silentTimer = setTimeout(() => {
            if (!gotAnyMsg && !closed) opts.onError('silent')
          }, 15000)
        }
      } catch {
        /* o bucată pierdută nu oprește fluxul */
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

  // MOSTRA AUDIO a frazei (PCM16 16kHz acumulat) — pentru butonul „play" din admin.
  const phrasePcm: Float32Array[] = []
  let phrasePcmLen = 0
  const MAX_CLIP_SAMPLES = TARGET_RATE * 8 // ~8s — destul cât să auzi vocea, mic ca mărime
  const addClipAudio = (ds: Float32Array): void => {
    if (phrasePcmLen >= MAX_CLIP_SAMPLES) return
    phrasePcm.push(ds.slice())
    phrasePcmLen += ds.length
  }

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
    phrasePcm.length = 0
    phrasePcmLen = 0
  }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  try {
    ws = new WebSocket(`${proto}://${location.host}/api/asr-stream`)
    ws.binaryType = 'arraybuffer'
  } catch {
    // WS n-a pornit → curăță graful audio și cade pe batch (nu lăsa AudioContext
    // + microfon agățate — scurgere/rasă din audit 10 iul).
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
    // Dacă Google n-a dat „final" în 3s, folosește ultimul parțial — altfel o
    // frază scurtă/de coadă se pierdea complet (bug audit 10 iul).
    const text = (phraseFinal || lastPartial).trim()
    phraseFinal = ''
    lastPartial = ''
    opts.onLive('') // golește MEREU banda la sfârșit de frază (nu rămâne agățat)
    if (text) {
      const features = finalizeFeatures()
      if (features) {
        // Atașăm mostra audio SINCRON (WAV din PCM-ul acumulat) — e gata pe obiect
        // înainte ca fraza să plece la creier, deci ajunge la salvarea amprentei.
        const clip = pcm16ToWavDataUrl(phrasePcm, TARGET_RATE)
        if (clip && clip.length <= 600_000) features.clip = clip
        setPendingVoiceFeatures(features)
      }
      opts.onPhrase(text)
    }
    resetFeatures()
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
      let m: { type?: string; transcript?: string; error?: string }
      try {
        m = JSON.parse(String(ev.data))
      } catch {
        return
      }
      // Doar transcript real dovedește că STT funcționează. SPEECH_ACTIVITY_BEGIN
      // confirmă doar că serverul aude voce, NU și că transcrie — dacă l-am lăsa
      // să dezarmeze plasa, Kelion ar rămâne mut (aude voce, dar nu livrează text).
      if (m.type === 'partial' && typeof m.transcript === 'string') {
        gotAnyMsg = true
        if (silentTimer) {
          clearTimeout(silentTimer)
          silentTimer = null
        }
        // LIVE: finaluri validate + parțialul care crește acum
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
        if (muted) opts.onBargeIn?.()
      } else if (m.type === 'error' && !closed) {
        opts.onError('silent')
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
    // PODEA DE ZGOMOT adaptivă (ca la batch): urcă lent când e liniște. Vocea
    // reală = peste pragul absolut ȘI dominând podeaua de-atâtea ori. Fără asta
    // orice zgomot de fond > 0.012 curgea la Google (transcrieri fantomă).
    const voiced = rms > VOICE_RMS && rms > noiseFloor * DOMINANCE
    if (!voiced) noiseFloor = noiseFloor * 0.97 + rms * 0.03

    // Pre-roll: păstrăm mereu ultimele cadre audio, chiar și înainte ca VAD-ul
    // să declare „voce". Când declanșează, le trimitem înaintea fluxului curent.
    pushPreRoll(input)

    // Un poc scurt (1 cadru) nu deschide fluxul — cerem câteva cadre consecutive.
    voicedRun = voiced ? voicedRun + 1 : 0
    const inSpeech = lastVoiceAt > 0 && now - lastVoiceAt <= TAIL_MS
    const becameVoiced = voicedRun >= VOICED_FRAMES_TO_OPEN
    const isOnset = becameVoiced && !inSpeech

    if (isOnset) {
      // Prima voce REALĂ detectată (sau reluare după o pauză mai mare decât coada):
      // trimitem mai întâi pre-roll-ul, ca primele silabe să nu se piardă.
      lastVoiceAt = now
      flushPreRoll()
      // Cadrul curent este deja în pre-roll și a fost trimis — nu-l retrimite.
      return
    }
    if (becameVoiced || inSpeech) lastVoiceAt = now
    // trimite DOAR cât e voce sau în coada de 3.2s de după — fără tăcere la Google
    if (!lastVoiceAt || now - lastVoiceAt > TAIL_MS) return
    collectFrame()
    const ds = downsample(input, ctx.sampleRate)
    addClipAudio(ds)
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
