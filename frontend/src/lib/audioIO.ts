import { deblocheazaAudioLaGest } from './audioGraph'
import { inscrieVoceaLuiKelion } from './vociKelion'

// Redare vocală partajată. Captura cloud full-duplex este exclusiv în
// vocalLive, iar captura offline exclusiv în micStream.
// ── PLAYBACK: the brain's voice, arriving ready-synthesized from the server ──
let curVoice: HTMLAudioElement | null = null
// ── REDAREA SIGURĂ PE MOBIL (owner, 19 aug: „nu se aude / merge aleator… e o
// singură versiune") ─────────────────────────────────────────────────────────
// De ce era ALEATOR: `new Audio().play()` (elementul <audio>) e supus politicii
// de autoplay a browserului MOBIL — un sunet ÎNTÂRZIAT (răspunsul vine la 1–2s
// după ce ai tastat) e blocat des pe telefon, dar NU pe laptop. Același cod, alt
// regulament la rulare. Când play() e blocat, cădem pe calea SIGURĂ: redăm prin
// AudioContext-ul deja DEBLOCAT pe gest (BufferSource) — un context 'running' redă
// determinist ȘI sunetul întârziat, pe mobil și pe laptop la fel.
let curSource: AudioBufferSourceNode | null = null
let ctxPending = false // sunet prin context, în curs de pornire (decode async)
let ctxRetryTimer: number | null = null // reîncercare mărginită a redării prin context

// ── LIP-SYNC: nivelul (0..1) al amplitudinii vocii redate acum ──────────────
// Golden rule: it's a visual bonus — if the analysis fails for any reason,
// the voice must stay audible, unchanged. A single AudioContext,
// reutilizat, creat lazy la prima redare (nevoie de gest de utilizator).
let levelCtx: AudioContext | null = null
let levelAnalyser: AnalyserNode | null = null
let levelSource: MediaElementAudioSourceNode | null = null
let levelBuf: Uint8Array<ArrayBuffer> | null = null
let levelRaf = 0
let voiceLevel = 0

export function getVoiceLevel(): number {
  return voiceLevel
}

/** ── GURA CĂII LIVE (8 aug) ────────────────────────────────────────────────
 *  Calea full-duplex redă prin WebAudio (bufere PCM), nu prin <audio>, deci
 *  analizatorul de mai jos n-o vede și avatarul ar vorbi cu gura închisă.
 *  Sesiunea live își împinge singură nivelul aici; același `getVoiceLevel()`
 *  hrănește gura, indiferent pe ce drum vine vocea. */
export function alimenteazaNivelVoce(v: number): void {
  voiceLevel = Math.max(0, Math.min(1, v))
}

function stopLevelLoop(): void {
  if (levelRaf) cancelAnimationFrame(levelRaf)
  levelRaf = 0
  voiceLevel = 0
}

// Routes playback through the Web Audio API ONLY to measure amplitude (RMS),
// without changing the audible playback. If any step fails, we exit quietly —
// audio.play() above stays the only one responsible for sound.
function attachLevelAnalysis(audio: HTMLAudioElement): void {
  try {
    const AC =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    if (!levelCtx) {
      levelCtx = new AC()
      levelAnalyser = levelCtx.createAnalyser()
      levelAnalyser.fftSize = 256
      levelAnalyser.smoothingTimeConstant = 0.5
      levelBuf = new Uint8Array(levelAnalyser.frequencyBinCount)
      // VOCEA LUI PE FILMARE (8 aug: „să se audă pe înregistrare vocea lui
      // Kelion"): vocea online trece prin analizorul acesta — un singur robinet
      // spre registrul vocilor, iar recorder.ts o amestecă direct în pistă.
      // O dată pe viața paginii; nu se radiază (gura clasică e permanentă).
      const destInreg = levelCtx.createMediaStreamDestination()
      levelAnalyser.connect(destInreg)
      inscrieVoceaLuiKelion(destInreg.stream)
      // DEBLOCAJ PE GEST pentru contextul de REDARE (owner, 13 aug: „audio nu
      // merge, nu-l aud"). createMediaElementSource de mai jos MUTĂ tot sunetul
      // elementului <audio> în levelCtx — dacă el e 'suspended' (politica autoplay,
      // context creat în afara unui gest), vocea devine INAUDIBILĂ deși play() a
      // reușit. E exact bug-ul microfonului din 5 aug, dar la IEȘIRE, unde
      // deblocajul pe gest lipsea. Îl armăm și aici, refolosind aceeași funcție.
      deblocheazaAudioLaGest(levelCtx)
    }
    if (levelCtx.state === 'suspended') void levelCtx.resume().catch(() => {})
    if (!levelAnalyser || !levelBuf) return

    // AUDIBILITATEA E SFÂNTĂ (regula de aur de mai sus): NU deviem sunetul prin
    // createMediaElementSource cât contextul nu e 'running' — l-ar muta într-un
    // context surd și vocea ar tăcea. Cât e 'suspended', elementul <audio> rămâne
    // pe ieșirea LUI proprie, audibil; doar gura nu se mișcă la replica asta. La
    // următoarea replică (după ce un gest a deblocat levelCtx) devierea prinde și
    // revine și lip-sync-ul. Fără garda asta, un context suspendat = voce mută.
    if (levelCtx.state !== 'running') return

    // createMediaElementSource can be called only once per element —
    // if this audio element was analyzed before (it shouldn't, it's always new),
    // or the context refuses, we silently give up the analysis, not the sound.
    if (!levelSource) {
      levelSource = levelCtx.createMediaElementSource(audio)
    } else {
      try {
        levelSource.disconnect()
      } catch {
        /* deja deconectat */
      }
      levelSource = levelCtx.createMediaElementSource(audio)
    }
    levelSource.connect(levelAnalyser)
    levelSource.connect(levelCtx.destination)

    const analyser = levelAnalyser
    const buf = levelBuf
    const step = (): void => {
      if (curVoice !== audio) {
        stopLevelLoop()
        return
      }
      voiceLevel = rmsNivel(analyser, buf)
      levelRaf = requestAnimationFrame(step)
    }
    levelRaf = requestAnimationFrame(step)
  } catch {
    // the analysis failed — the voice stays normally audible, only the mouth doesn't move
    stopLevelLoop()
  }
}

// ── LIP-SYNC-ul pentru pista live externă — ȘTERS (3 aug, „exporturi fără
// utilizator"): driveVoiceLevelFromElement + driveVoiceLevelFrom serveau
// <audio>-ul sesiunii OpenAI Realtime; chat TTS și Live folosesc focus comun.
// OpenAI; redarea trece prin playNow/attachLevelAnalysis de mai jos, care își
// mișcă singură gura). Istoria completă e în git.

// Playback queue: the brain now sends voice IN CHUNKS (utterance by utterance, see
// streamVoice/backend chat.ts) so synthesis no longer waits for the whole reply.
// Chunk 2 can arrive while chunk 1 is still playing — here one doesn't cut the other, they
// queue up and play in order, like a single uninterrupted reply. onStart
// is called once (on the reply's first chunk, mutes the microphone);
// onEnd likewise, once, after the LAST chunk of the queue has played.
const voiceQueue: string[] = []
let pendingVoiceEnd: (() => void) | null = null
// ANTI-ECHO BETWEEN UTTERANCES (Adrian, Jul 10: "you destroyed voice detection"). The voice
// now comes utterance-by-utterance: chunk 1 can FINISH playing before
// chunk 2's sound arrives (still being synthesized on the server). If at
// golirea cozii redeschideam microfonul pe loc, prindea ecoul propriei voci a
// Kelion's in the gap between utterances → false detection / barge-in that cut
// the reply. Now, when the queue empties, we do NOT reopen the microphone immediately:
// we wait out this window; if another chunk arrives, it's the same reply
// (the timer cancels, the microphone stays mute); if NOTHING more comes, only
// then onEnd is called (we reopen). It covers the synthesis gap, so the microphone
// stays mute across the WHOLE reply, exactly as before chunked voice.
let voiceGapTimer: number | null = null
const VOICE_GAP_MS = 1800
function clearGapTimer(): void {
  if (voiceGapTimer !== null) {
    window.clearTimeout(voiceGapTimer)
    voiceGapTimer = null
  }
}

// ── VOLUM UNIC PENTRU VOCEA LUI KELION (25 iul — Adrian: „volumul audio
// incontrolabil") ────────────────────────────────────────────────────────────
// Until today the app had NO volume control: the Realtime audio element
// and the TTS one started fixed at 1.0. One single value, persisted, applied to
// ALL voice elements (Realtime + TTS) — the ChatPanel slider moves it live.
const VOL_KEY = 'kelion:voice-volume'
let voiceVolume = ((): number => {
  const v = Number(globalThis.localStorage?.getItem(VOL_KEY) ?? '1')
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1
})()
const voiceElements = new Set<HTMLAudioElement>()

export function getVoiceVolume(): number {
  return voiceVolume
}

export function setVoiceVolume(v: number): void {
  voiceVolume = Math.min(1, Math.max(0, v))
  try {
    globalThis.localStorage?.setItem(VOL_KEY, String(voiceVolume))
  } catch {
    /* private/full — the volume stays for the session */
  }
  for (const el of voiceElements) el.volume = voiceVolume
}

// (registerVoiceAudioElement ȘTERS — 3 aug: îl folosea doar <audio>-ul sesiunii
// OpenAI Realtime, scoasă azi; elementele interne intră în voiceElements direct.)

/** RMS (0..1) al semnalului din analizor → nivelul gurii. Sursă unică pentru
 *  ambele bucle (elementul <audio> și BufferSource-ul de context). */
function rmsNivel(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128
    sum += v * v
  }
  return Math.min(1, Math.sqrt(sum / buf.length) * 6)
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Bucla de nivel pentru redarea prin BufferSource (mișcă gura cât ține sunetul). */
function startCtxLevelLoop(): void {
  if (!levelAnalyser || !levelBuf) return
  const analyser = levelAnalyser
  const buf = levelBuf
  const step = (): void => {
    if (!curSource) {
      stopLevelLoop()
      return
    }
    voiceLevel = rmsNivel(analyser, buf)
    levelRaf = requestAnimationFrame(step)
  }
  levelRaf = requestAnimationFrame(step)
}

/** REDARE SIGURĂ PE MOBIL: prin AudioContext-ul deblocat pe gest (BufferSource).
 *  Un context 'running' redă determinist ȘI sunetul întârziat — nu e supus
 *  blocajului de autoplay al elementului <audio>. `true` = ne-am angajat pe calea
 *  asta (decode async înăuntru; pe eșec → `done()`). `false` = context surd, cadem
 *  pe elementul <audio>. `levelCtx` există deja: l-a creat attachLevelAnalysis. */
function playViaContext(base64Mp3: string, done: () => void): boolean {
  const ctx = levelCtx
  if (!ctx || !levelAnalyser) return false
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  if (ctx.state !== 'running') return false
  const analyser = levelAnalyser
  ctxPending = true
  void (async (): Promise<void> => {
    try {
      const audioBuf = await ctx.decodeAudioData(base64ToBytes(base64Mp3).buffer)
      const src = ctx.createBufferSource()
      src.buffer = audioBuf
      const gain = ctx.createGain()
      gain.gain.value = voiceVolume
      src.connect(gain)
      gain.connect(analyser) // gura + înregistrarea (analyser e deja legat la ele)
      gain.connect(ctx.destination) // sunetul audibil
      curSource = src
      ctxPending = false
      src.onended = (): void => {
        if (curSource === src) curSource = null
        stopLevelLoop()
        done()
      }
      startCtxLevelLoop()
      src.start()
    } catch {
      ctxPending = false
      done()
    }
  })()
  return true
}

/** REÎNCERCARE MĂRGINITĂ prin context (owner, 19 aug: „se trunchiază audio…
 *  identifică și repară truncherea"): când nici <audio> nici contextul nu pot
 *  reda ACUM (mobil, fără gest care să deblocheze contextul), NU aruncăm chunk-ul
 *  tăcut — ar tăia răspunsul. Îl reîncercăm la 150ms până contextul devine
 *  'running' (un gest îl deblochează între timp), maxim ~4,5s, apoi renunțăm
 *  (done → coada merge mai departe), ca să nu blocăm gura la infinit. Cât ținem
 *  reîncercarea, `ctxPending` rămâne true — chunk-urile următoare se pun în COADĂ,
 *  nu peste, deci ordinea se păstrează. stopVoice() (barge-in) taie timerul. */
function reincearcaPrinContext(base64Mp3: string, done: () => void, ramase = 30): void {
  ctxPending = true // gura ocupată: playVoice pune următoarele bucăți în coadă
  if (playViaContext(base64Mp3, done)) return // playViaContext preia ctxPending de aici
  if (ramase <= 0) {
    ctxPending = false
    done()
    return
  }
  ctxRetryTimer = window.setTimeout(() => {
    ctxRetryTimer = null
    reincearcaPrinContext(base64Mp3, done, ramase - 1)
  }, 150)
}

function playNow(base64Mp3: string): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`[audioIO] playNow: base64=${base64Mp3.length} chars | voiceVolume=${voiceVolume}`)
    const audio = new Audio(`data:audio/mp3;base64,${base64Mp3}`)
    audio.volume = voiceVolume
    voiceElements.add(audio)
    curVoice = audio
    const done = (): void => {
      voiceElements.delete(audio)
      if (curVoice === audio) curVoice = null
      stopLevelLoop()
      playNextQueued()
    }
    audio.onended = done
    audio.onerror = done
    // attachLevelAnalysis creează/deblochează levelCtx ÎNAINTE, ca playViaContext să-l
    // aibă gata dacă play() e blocat pe mobil.
    attachLevelAnalysis(audio)
    void audio.play().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn(`[audioIO] play() blocat (autoplay): ${String(e).slice(0, 80)} → cad pe context`)
      // MOBIL: sunetul întârziat pe <audio> e blocat (autoplay) — de-aia „aleator".
      // (1) OPRIM COMPLET elementul înainte de calea sigură — altfel elementul putea
      // porni totuși un pic mai târziu (cursă cu gestul) ȘI BufferSource-ul ar reda
      // ACELAȘI chunk = DOUĂ voci pe ieșiri diferite (owner, 19 aug: „se aud 2 voci,
      // nu știi pe unde iese"). O gură, o singură ieșire.
      try { audio.pause(); audio.src = ''; audio.load() } catch { /* deja oprit */ }
      stopLevelLoop()
      voiceElements.delete(audio)
      if (curVoice === audio) curVoice = null
      // (2) Calea SIGURĂ (BufferSource pe contextul deblocat). Dacă nici contextul
      // nu e gata acum, reîncercăm mărginit — NU aruncăm chunk-ul tăcut (ar tăia
      // răspunsul: owner „se trunchiază audio").
      reincearcaPrinContext(base64Mp3, done)
    })
  } catch {
    playNextQueued()
  }
}

function playNextQueued(): void {
  const next = voiceQueue.shift()
  if (next) {
    playNow(next)
    return
  }
  // The queue emptied — but another utterance may still come (its synthesis is still on the way).
  // Do NOT reopen the microphone now; let the anti-echo window run. If another
  // chunk comes, playVoice cancels the timer; if not, only then onEnd (unmute).
  clearGapTimer()
  voiceGapTimer = window.setTimeout(() => {
    voiceGapTimer = null
    const end = pendingVoiceEnd
    pendingVoiceEnd = null
    end?.()
  }, VOICE_GAP_MS)
}

export function playVoice(base64Mp3: string, onStart?: () => void, onEnd?: () => void): void {
  pendingVoiceEnd = onEnd ?? null
  if (curVoice || curSource || ctxPending) {
    // already playing a chunk of the SAME reply — it queues up, doesn't get cut.
    // (curSource/ctxPending = redarea prin AudioContext e activă/în pornire.)
    voiceQueue.push(base64Mp3)
    return
  }
  // In a GAP between utterances (microphone already mute, we were waiting for the next chunk):
  // it's the continuation of the SAME reply — cancel the reopening, do NOT re-call
  // onStart (the microphone is already mute), keep playing.
  if (voiceGapTimer !== null) {
    clearGapTimer()
    playNow(base64Mp3)
    return
  }
  onStart?.()
  playNow(base64Mp3)
}

export function stopVoice(): void {
  clearGapTimer()
  // Taie și reîncercarea mărginită prin context (barge-in nu are voie să lase o
  // bucată să pornească după oprire — altfel vocea „oprită" revenea).
  if (ctxRetryTimer !== null) {
    window.clearTimeout(ctxRetryTimer)
    ctxRetryTimer = null
  }
  voiceQueue.length = 0
  // FIX "microphone mute forever" (Jul 24 audit, P1): the end callback (which
  // UNMUTES the Realtime session's microphone) was DISCARDED without being called
  // → after a "stop"/barge-in typed during playback, the track stayed enabled=false
  // forever = "he doesn't hear me". We execute it BEFORE deleting it.
  const end = pendingVoiceEnd
  pendingVoiceEnd = null
  end?.()
  if (curVoice) {
    try {
      curVoice.pause()
    } catch {
      /* deja oprit */
    }
    curVoice = null
  }
  // Oprim și redarea prin AudioContext (barge-in trebuie să taie și BufferSource-ul).
  if (curSource) {
    try {
      curSource.stop()
    } catch {
      /* deja oprit */
    }
    curSource = null
  }
  ctxPending = false
  stopLevelLoop()
}

export function isVoicePlaying(): boolean {
  return curVoice !== null || curSource !== null || ctxPending
}
