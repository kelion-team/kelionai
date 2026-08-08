import { openMicGraph } from './audioGraph'
// MICROFON LOCAL — SEGMENTARE PE VAD, AUDIO BRUT LA CREIER (Adrian, 5 aug:
// „urechea o scoți total ca modelul are tot; tot decis de creierul unic").
//
// AICI NU MAI EXISTĂ NICIUN STT. Nu se mai deschide niciun WebSocket de
// transcriere pe server, nu mai vine niciun transcript. Microfonul:
//   1. ascultă cu un VAD LOCAL (prag absolut + dominanță peste podeaua de zgomot);
//   2. când aude voce, ADUNĂ cadrele PCM 16kHz ale frazei (+ un pre-roll ca să nu
//      piardă prima silabă) și amprenta vocală (pentru verificarea vorbitorului);
//   3. când vorbirea se OPREȘTE (o pauză mai lungă decât PAUZA_FRAZA), ÎNCHIDE
//      fraza și o predă prin onPhrase('', features, audioWav) — DOAR audio, fără
//      text. Creierul unic (Gemini 3 Pro) aude fraza brută și decide singur dacă i
//      se vorbește; poarta de nume (regex pe transcript stâlcit) a dispărut.
//
// Ce rămâne neatins: pre-roll-ul, amprenta vocală (buffer-ele de features),
// barge-in-ul local (cât Kelion vorbește, microfonul e mut și tot detectează
// vocea care-l întrerupe), mute-ul, auto-vindecarea grafului la track-ended, și
// pornirea aproape instantă cu un stream pre-încălzit.

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

import { TARGET_RATE, downsample, float32ToPcm16 } from './pcm'
// PAUZA care ÎNCHIDE fraza (Adrian, 3 aug — latența „nu mă aude"): o tăcere mai
// lungă de-atât = sfârșit de rostire → fraza pleacă la creier. Nu prea scurt
// (ar tăia o propoziție la o respirație), nu prea lung (ar întârzia răspunsul).
const PAUZA_FRAZA_MS = 1400
// Prag ABSOLUT de voce (0.012 — valoarea dovedită live: mai sus taie microfoanele
// liniștite). Protecția anti-zgomot reală stă în DOMINANCE + amprenta de pe server.
const VOICE_RMS = 0.012
const DOMINANCE = 2.2 // vocea apropiată trebuie să domine podeaua de zgomot de-atâtea ori
const VOICED_FRAMES_TO_OPEN = 2 // câte cadre de voce consecutive ca să pornim (un poc = 1 cadru, se ignoră)
const PRE_ROLL_MS = 400 // buffer înainte de declanșare — primele cadre vocale nu se pierd
// BARGE-IN cât Kelion vorbește (Adrian, 3 aug: „să pot vorbi peste el"). Praguri
// mai stricte decât VOX-ul normal: echoCancellation scoate vocea lui Kelion din
// microfon, dar un reziduu prin difuzor poate rămâne — cerem semnal clar,
// susținut, după o gardă de onset, ca să nu se taie singur.
const BARGE_RMS = 0.024 // dublul pragului normal: doar voce apropiată, clară
const BARGE_HOLD_MS = 180 // vocea trebuie să țină atât ca să taie (nu un poc)
const BARGE_GUARD_MS = 300 // fereastră de gardă după ce începe muțenia (onset redare)

export interface MicStreamHandle {
  stop(): void
  setMuted(muted: boolean): void
  listening: true
}

export interface MicStreamOpts {
  // fraza curentă, LIVE — fără STT nu mai avem text, dar semnalul rămâne (deschis
  // = '🎙️', închis = '') ca banda să arate că se ascultă / s-a terminat.
  onLive: (text: string) => void
  // FRAZA ÎNTREAGĂ, la pauză → merge la creier ca AUDIO brut. `text` e mereu ''
  // (nu mai există transcript pe client); `features` = amprenta vocală a frazei
  // (poarta de timbru); `audio` = WAV 16kHz base64 pe care Gemini îl aude nativ.
  onPhrase: (text: string, features: VoiceFeatures | null, audio?: string) => void
  onError: (reason: string) => void
  getLang: () => string
  // vocea s-a auzit cât Kelion vorbea → barge-in (taie vocea lui Kelion)
  onBargeIn?: () => void
  // s-a auzit ÎNCEPUT de vorbire (VAD local) — semnalul de barge-in / anti-ecou
  onSpeechBegin?: () => void
  // DEFAULT true: amprenta frazei ajunge și în store-ul comun (calea de dictare o
  // consumă pe /api/chat). Calea full-duplex trece false — o ia direct din onPhrase.
  storePendingFeatures?: boolean
  // stream pre-încălzit: la apăsarea butonului „microfon" chemăm getUserMedia
  // înainte de startMicStream, ca activarea să fie aproape instantă.
  preWarmedStream?: MediaStream
}

// COMPAT: realtimeVoice cheamă asta când urechea moare — fără STT nu mai există
// „ureche moartă", dar păstrăm exportul ca no-op ca să nu rupem apelul.
export function marcheazaUrechiChirpMoarte(): void {
  /* fără STT — nimic de marcat; păstrat pentru compatibilitatea apelului */
}

// AUDIO NATIV → CREIER: împachetează cadrele PCM 16kHz (Float32) ale frazei într-un
// WAV mono 16-bit, ca data-URI base64 — formatul dovedit că Gemini îl „aude" nativ.
// Întoarce '' dacă nu e destul audio; orice eroare cade grațios (fraza nu pleacă).
const MAX_PHRASE_SAMPLES = TARGET_RATE * 20 // cap la ~20s de voce (memorie/upload mărginite)
function wavDataUri16k(chunks: Float32Array[]): string {
  let total = 0
  for (const c of chunks) total += c.length
  if (total < TARGET_RATE / 10) return '' // sub ~0.1s = nimic util
  const pcm = float32ToPcm16(chunks)
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

export async function startMicStream(opts: MicStreamOpts): Promise<MicStreamHandle | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    opts.onError('unsupported')
    return null
  }
  // Aceeași deschidere de microfon ca vocea (lib/audioGraph.ts) — o singură sursă.
  const firstGraph = await openMicGraph(opts.onError, opts.preWarmedStream)
  if (!firstGraph) return null

  // GRAFUL SE POATE RECONSTRUI ÎN LOC (Aug 2): un track de microfon poate muri
  // mid-sesiune (suspend browser, device grab). Nodurile de mai jos sunt `let`, ca
  // onTrackEnded să redeschidă microfonul prin același openMicGraph și să le
  // recableze FĂRĂ să atingă starea frazei sau buffer-ele de amprentă.
  let stream = firstGraph.stream
  let ctx = firstGraph.ctx
  let source: MediaStreamAudioSourceNode
  let proc: ScriptProcessorNode
  let featAnalyser: AnalyserNode
  // <ArrayBuffer> explicit: TS 5.7+ tipează un Float32Array simplu ca
  // Float32Array<ArrayBufferLike>, pe care getterele AnalyserNode (strict
  // Float32Array<ArrayBuffer>) îl refuză — build-ul frontend pica pe asta.
  let featTimeBuf: Float32Array<ArrayBuffer>
  let featFreqBuf: Float32Array<ArrayBuffer>

  let closed = false
  let muted = false
  let lastVoiceAt = 0
  // BARGE-IN: de când e mut (gardă de onset) și de când ține vocea de întrerupere.
  let mutedSince = 0
  let bargeSince = 0
  let noiseFloor = 0.006 // podeaua de zgomot adaptivă (pentru dominanță)
  let voicedRun = 0 // câte cadre de voce consecutive (anti-poc)
  let phraseOpen = false // e o frază în curs de adunare?
  let phraseTimer: ReturnType<typeof setTimeout> | null = null
  let framesSent = 0
  let maxRms = 0
  // Diagnostic de captare (Adrian, 6 aug — „nu preia audio"): un log rar din
  // onAudioProcess ca să se vadă la runtime dacă procesarea rulează + starea ctx.
  let diagCadre = 0
  // Starea de la ultimul rând scris + momentul ultimului puls: împreună fac
  // diferența între „nu s-a schimbat nimic" și „nu mai rulează nimic".
  let ultimaStare = ''
  let ultimulPuls = 0

  // Pre-roll ring: păstrează ultimele ~400ms de audio CHIAR ÎNAINTE ca VAD-ul să
  // declare „voce". La declanșare, aceste cadre intră primele în frază — fixează
  // pierderea primelor silabe.
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
      if (phrasePcmLen < MAX_PHRASE_SAMPLES) {
        phrasePcm.push(new Float32Array(ds))
        phrasePcmLen += ds.length
        framesSent++
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
  // Cadrele PCM 16kHz ale frazei curente — vocea BRUTĂ trimisă la creier la închidere.
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

  const resetPhrase = (): void => {
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
    phraseOpen = false
  }

  // ÎNCHIDE fraza: împachetează audio-ul brut + amprenta și le predă creierului.
  const closePhrase = (): void => {
    if (phraseTimer) {
      clearTimeout(phraseTimer)
      phraseTimer = null
    }
    if (!phraseOpen) return
    lastVoiceAt = 0
    opts.onLive('') // golește banda la sfârșit de frază
    const features = finalizeFeatures()
    // ── O FRAZĂ ARUNCATĂ TREBUIE SĂ SE VADĂ (Adrian, 8 aug, din consola lui) ──
    // Aici fraza pleca doar `if (audio)`, iar `catch { audio = undefined }`
    // înghițea și motivul. Adică: omul vorbea, vedea în consolă doar
    // `frazaDeschisa: true → false`, și NIMIC după. N-avea cum să distingă
    // „fraza n-a plecat" de „a plecat și creierul n-a răspuns" — două defecte
    // complet diferite, arătând identic. Aceeași familie ca „£0.00": o operație
    // care n-a avut loc, raportată ca tăcere.
    const durataMs = Math.round((phrasePcmLen / 16000) * 1000)
    let audio: string | undefined
    let motivAruncare = ''
    try {
      audio = wavDataUri16k(phrasePcm) || undefined
      if (!audio) motivAruncare = `fără audio util (${phrasePcmLen} eșantioane, ${durataMs} ms, ${phraseFrames} cadre)`
    } catch (e) {
      audio = undefined
      motivAruncare = `împachetarea WAV a picat: ${e instanceof Error ? e.message : String(e)}`
    }
    if (audio) {
      if (features && opts.storePendingFeatures !== false) setPendingVoiceFeatures(features)
      console.info('[frază] plec la creier', { ms: durataMs, cadre: phraseFrames, octeti: audio.length, amprenta: !!features })
      opts.onPhrase('', features, audio)
    } else {
      console.warn('[frază] ARUNCATĂ, nu ajunge la creier —', motivAruncare)
    }
    resetPhrase()
  }

  const armPhraseTimer = (): void => {
    if (phraseTimer) clearTimeout(phraseTimer)
    phraseTimer = setTimeout(closePhrase, PAUZA_FRAZA_MS)
  }

  const onAudioProcess = (e: AudioProcessingEvent): void => {
    if (closed) return
    // ── DIAGNOSTICUL NU MAI ÎNEACĂ CONSOLA (Adrian, 8 aug, consola lui) ──────
    // Scria un rând pe secundă, la nesfârșit, cu aceleași trei valori. În
    // captura lui, 45 de rânduri identice `[captare]` acopereau complet orice
    // alt semnal — inclusiv rândul care ar fi spus dacă fraza a plecat sau nu.
    // Un diagnostic care ascunde diagnosticul e mai rău decât niciunul.
    // Acum scrie DOAR la SCHIMBARE de stare (asta e informația) + un puls rar,
    // ca „liniște" să rămână distinctibil de „graful e mort".
    diagCadre++
    const stareAcum = `${ctx.state}|${muted}|${phraseOpen}`
    const acumMs = performance.now()
    if (stareAcum !== ultimaStare || acumMs - ultimulPuls > 15000) {
      if (stareAcum !== ultimaStare) console.info('[captare]', { ctx: ctx.state, muted, frazaDeschisa: phraseOpen })
      else console.info('[captare] puls', { ctx: ctx.state, muted, frazaDeschisa: phraseOpen, cadre: diagCadre })
      ultimaStare = stareAcum
      ultimulPuls = acumMs
    }
    // BARGE-IN cât Kelion vorbește: cât e MUT (anti-ecou) NU acumulăm audio (ar fi
    // ecoul lui), dar calculăm volumul și, la voce clară SUSȚINUTĂ (peste garda de
    // onset), îl întrerupem prin onBargeIn. Calea normală (dezmuțit) rămâne neatinsă.
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
    if (rms > maxRms) maxRms = rms
    const now = performance.now()
    // Podea de zgomot adaptivă: urcă încet cât e liniște. Voce reală = peste pragul
    // absolut ȘI dominând podeaua de-atâtea ori. Fără asta, orice zgomot > 0.012
    // ar deschide o frază fantomă.
    const voiced = rms > VOICE_RMS && rms > noiseFloor * DOMINANCE
    if (!voiced) noiseFloor = noiseFloor * 0.97 + rms * 0.03

    // Pre-roll: păstrăm mereu ultimele cadre, chiar înainte ca VAD-ul să declare voce.
    pushPreRoll(input)

    // Un poc (1 cadru) nu deschide fraza — cerem câteva cadre consecutive.
    voicedRun = voiced ? voicedRun + 1 : 0
    const inSpeech = lastVoiceAt > 0 && now - lastVoiceAt <= PAUZA_FRAZA_MS
    const becameVoiced = voicedRun >= VOICED_FRAMES_TO_OPEN
    const isOnset = becameVoiced && !inSpeech

    if (isOnset) {
      // Prima voce reală (sau reluare după o pauză): deschidem fraza, trimitem
      // pre-roll-ul întâi (ca să nu pierdem primele silabe) și anunțăm barge-in.
      lastVoiceAt = now
      if (!phraseOpen) {
        phraseOpen = true
        opts.onLive('🎙️')
      }
      opts.onSpeechBegin?.()
      flushPreRoll()
      armPhraseTimer()
      // Cadrul curent e deja în pre-roll și a fost adunat — nu-l re-adăugăm.
      return
    }
    if (becameVoiced || inSpeech) {
      lastVoiceAt = now
      if (phraseOpen) armPhraseTimer() // fiecare cadru de voce reamână închiderea
    }
    // adunăm DOAR cât e voce sau în coada scurtă de după — nu strângem liniște
    if (!phraseOpen || !lastVoiceAt || now - lastVoiceAt > PAUZA_FRAZA_MS) return
    collectFrame()
    const ds = downsample(input, ctx.sampleRate)
    // Copie — bufferul de intrare se reciclează între apeluri; fără copie am stoca zgomot.
    if (phrasePcmLen < MAX_PHRASE_SAMPLES) {
      phrasePcm.push(new Float32Array(ds))
      phrasePcmLen += ds.length
      framesSent++
    } else {
      // depășit capul de ~20s → închidem fraza acum (nu o lăsăm să crească la infinit)
      closePhrase()
    }
  }

  // TRACK-UL DE MICROFON A MURIT (suspend browser, device grab, cască scoasă):
  // redeschidem microfonul O DATĂ prin același openMicGraph și reconstruim graful
  // în loc; starea frazei și buffer-ele de amprentă supraviețuiesc. Doar dacă
  // redeschiderea eșuează escaladăm.
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
      // Recablăm ÎNTÂI, dărâmăm graful vechi DUPĂ — niciodată un moment fără graf.
      const old = { proc, source, stream, ctx }
      wireGraph(g)
      try {
        old.proc.disconnect()
        old.source.disconnect()
      } catch {
        /* deja plecat */
      }
      old.stream.getTracks().forEach((t) => t.stop())
      void old.ctx.close().catch(() => {})
      console.info('[micStream] microfon redeschis în loc (track-ended vindecat, urechea a rămas vie)')
    })()
  }

  // Construiește (sau reconstruiește) tot graful audio pe un stream de microfon:
  // source → ScriptProcessor (tap PCM) și source → analyser (tap amprentă).
  const wireGraph = (g: { stream: MediaStream; ctx: AudioContext }): void => {
    stream = g.stream
    ctx = g.ctx
    void ctx.resume().catch(() => {})
    source = ctx.createMediaStreamSource(stream)
    // ScriptProcessor e deprecat dar universal și fără fișier separat — cel mai
    // sigur pentru „merge pur și simplu", exact ce trebuie pe calea critică a vocii.
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

  // DEBLOCAJ CONTINUU AL CONTEXTULUI (Adrian, 6 aug: „se deschide să preia dar nu
  // se preia nimic audio"). Cauza rădăcină: AudioContext poate rămâne 'suspended'
  // (pornit fără gest) și atunci `onaudioprocess` NU rulează NICIODATĂ → microfonul
  // e SURD deși becul „ascult" e aprins. Trezirea pe gest (deblocheazaAudioLaGest)
  // NU acoperă VORBIREA (nu e gest). Aici forțăm `resume()` periodic cât urechea e
  // activă — un context deja 'running' îl ignoră (no-op), deci zero risc.
  const resumeTimer = setInterval(() => {
    if (closed) return
    if (ctx.state !== 'running') void ctx.resume().catch(() => {})
  }, 1200)

  const stop = (): void => {
    if (closed) return
    closed = true
    clearInterval(resumeTimer)
    if (phraseTimer) clearTimeout(phraseTimer)
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
