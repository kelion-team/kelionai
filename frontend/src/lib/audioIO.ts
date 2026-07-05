// AUDIO I/O — poarta către creier (Adrian, 4 iul). Aplicația NU sintetizează și
// NU recunoaște nimic local: microfonul captează → trimite la server (STT), iar
// vocea creierului vine gata sintetizată de pe server (Chirp 3) ca un cadru
// {audio} pe punte și aici DOAR se decodează + se redă. Zero „voce în front".
//
//  • Microfon: full-duplex (poți vorbi peste voce), filtru profesional de zgomot
//    (echoCancellation + noiseSuppression + autoGainControl), VOX (pornește la
//    voce, se oprește la tăcere) și buffer mare (nimic pierdut la fraze lungi).
//  • Redare: playVoice(base64) — decodează MP3-ul primit de la creier și-l redă;
//    cât redă, microfonul nu TRIMITE nimic (anti-ecou), dar rămâne DE VEGHE:
//    dacă aude vocea lui Adrian peste redare, anunță prin onBargeIn ca panoul
//    să taie vocea lui Kelion pe loc (ordinul: „când aude vocea mea, mă-ntrerupe").

export interface MicHandle {
  stop(): void
  setMuted(m: boolean): void
}

// ── VOX (voice activity) reglaje ────────────────────────────────────────────
const START_RMS = 0.012 // pragul de la care „e voce"
const DOMINANCE = 2.2 // vocea apropiată domină zgomotul de fond de-atâtea ori
const SILENCE_MS = 750 // tăcere care închide o frază
const MIN_UTTER_MS = 350 // sub atât = zgomot, nu frază — se ignoră
const MAX_UTTER_MS = 60_000 // buffer mare: o frază poate dura până la 60s

// ── BARGE-IN (cât vorbește Kelion) ──────────────────────────────────────────
// Praguri mai stricte decât VOX-ul normal: echoCancellation scoate vocea lui
// Kelion din microfon, dar poate rămâne un rest — cerem semnal clar și susținut
// ca să nu se taie singur.
const BARGE_RMS = 0.024 // dublul pragului normal: doar voce apropiată, clară
const BARGE_HOLD_MS = 180 // vocea trebuie să țină atât ca să taie (nu un poc)
const BARGE_GUARD_MS = 300 // fereastră de gardă după ce începe redarea (onset)

export async function startMic(
  onTranscript: (text: string) => void,
  onError: (reason: string) => void,
  getLang: () => string,
  // chemat când se aude vocea lui Adrian CÂT microfonul e mut (Kelion vorbește):
  // panoul taie vocea lui Kelion și dezmutează microfonul.
  onBargeIn?: () => void,
): Promise<MicHandle | null> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    onError('unsupported')
    return null
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch (e) {
    // Refuz de permisiune ≠ eșec trecător: refuzul nu se reîncearcă singur,
    // eșecul trecător (dispozitiv ocupat, căști scoase) da.
    const name = (e as { name?: string })?.name
    onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'failed')
    return null
  }

  const AC =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) {
    stream.getTracks().forEach((t) => t.stop())
    onError('unsupported')
    return null
  }
  const ctx = new AC()
  void ctx.resume().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)

  const mime =
    ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ??
    ''

  let muted = false
  let stopped = false
  let recording = false
  let rec: MediaRecorder | null = null
  let chunks: Blob[] = []
  let voicedMs = 0
  let silenceMs = 0
  let noiseFloor = 0.006
  let uttMs = 0
  let raf = 0
  let mutedAt = 0 // când a început muțenia (redarea vocii) — pentru garda de onset
  let bargeMs = 0 // cât timp s-a auzit voce clară peste redare

  const send = async (blob: Blob): Promise<void> => {
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
        fr.onerror = () => reject(new Error('read'))
        fr.readAsDataURL(blob)
      })
      if (!b64) return
      const r = await fetch('/api/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ audio: b64, lang: getLang() }),
      })
      if (!r.ok) return
      const j = (await r.json()) as { transcript?: string }
      const text = (j.transcript ?? '').trim()
      if (text) onTranscript(text)
    } catch {
      /* o frază pierdută nu oprește microfonul */
    }
  }

  const startRec = (): void => {
    if (recording || !mime) return
    chunks = []
    try {
      rec = new MediaRecorder(stream, { mimeType: mime })
    } catch {
      rec = new MediaRecorder(stream)
    }
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    rec.onstop = () => {
      const took = uttMs
      const blob = new Blob(chunks, { type: mime || 'audio/webm' })
      recording = false
      uttMs = 0
      // sub minim = zgomot scurt, nu-l trimitem
      if (took >= MIN_UTTER_MS && blob.size > 0) void send(blob)
    }
    rec.start()
    recording = true
    uttMs = 0
  }
  const stopRec = (): void => {
    if (recording && rec && rec.state !== 'inactive') rec.stop()
  }

  const cleanup = (): void => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(raf)
    try {
      stopRec()
    } catch {
      /* deja oprit */
    }
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
  }

  // PERMANENT ON: dacă pista moare din exterior (apel telefonic, căști Bluetooth
  // scoase, alt app ia microfonul), anunțăm — panoul redeschide microfonul singur.
  stream.getAudioTracks().forEach((t) => {
    t.addEventListener('ended', () => {
      if (stopped) return
      cleanup()
      onError('track-ended')
    })
  })

  const tick = (): void => {
    if (stopped) return
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    // podeaua de zgomot se adaptează lent când e liniște — dar NU cât redă
    // Kelion (restul de ecou ar urca podeaua și-ar surzi barge-in-ul)
    if (!recording && !muted) noiseFloor = noiseFloor * 0.95 + rms * 0.05
    const dt = 16
    const isVoice = !muted && rms > START_RMS && rms > noiseFloor * DOMINANCE

    // BARGE-IN: microfonul e mut (Kelion vorbește), dar tot ascultă. Voce clară
    // și susținută peste redare = Adrian vorbește → tăiem vocea lui Kelion.
    if (muted) {
      const pastGuard = performance.now() - mutedAt >= BARGE_GUARD_MS
      if (pastGuard && rms > BARGE_RMS && rms > noiseFloor * DOMINANCE) {
        bargeMs += dt
        if (bargeMs >= BARGE_HOLD_MS) {
          bargeMs = 0
          onBargeIn?.()
        }
      } else {
        bargeMs = 0
      }
    }

    if (recording) {
      uttMs += dt
      if (isVoice) {
        voicedMs += dt
        silenceMs = 0
      } else {
        silenceMs += dt
      }
      if (silenceMs >= SILENCE_MS || uttMs >= MAX_UTTER_MS) stopRec()
    } else if (isVoice) {
      voicedMs = 0
      silenceMs = 0
      startRec()
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return {
    stop() {
      cleanup()
    },
    setMuted(m: boolean) {
      muted = m
      if (m) {
        mutedAt = performance.now() // pornește garda anti-onset a barge-in-ului
        bargeMs = 0
      }
      // dacă începe vocea creierului cât înregistram, închidem fraza curentă
      if (m && recording) stopRec()
    },
  }
}

// ── REDARE: vocea creierului, sosită gata sintetizată de pe server ──────────
let curVoice: HTMLAudioElement | null = null

export function playVoice(base64Mp3: string, onStart?: () => void, onEnd?: () => void): void {
  try {
    stopVoice()
    const audio = new Audio(`data:audio/mp3;base64,${base64Mp3}`)
    curVoice = audio
    const done = (): void => {
      if (curVoice === audio) curVoice = null
      onEnd?.()
    }
    audio.onended = done
    audio.onerror = done
    onStart?.()
    void audio.play().catch(done)
  } catch {
    onEnd?.()
  }
}

export function stopVoice(): void {
  if (curVoice) {
    try {
      curVoice.pause()
    } catch {
      /* deja oprit */
    }
    curVoice = null
  }
}

export function isVoicePlaying(): boolean {
  return curVoice !== null
}
