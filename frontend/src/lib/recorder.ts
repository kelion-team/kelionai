// Admin-only screen+audio recorder for promo clips (TikTok / Instagram /
// Facebook). Captures the Kelion tab (avatar, monitor, chat) via getDisplayMedia
// plus the tab/system audio AND the mic (your narration), mixed into one track,
// and saves an MP4 (the format those platforms accept) to the Downloads folder.
// Falls back to WebM only if the browser can't record MP4.

export interface RecordingHandle {
  stop(): void
}

// TOATE SETĂRILE DEFAULT (Adrian, 11 iul seara: „toate setările să fie default
// setate cu audio și mărime specificate") — nimic de ales manual: mărimea
// video e specificată aici (1080p/30), audio mereu pornit (tab + mic), iar
// calitatea/bitrate-ul e fixat ca fișierul să fie previzibil pentru platforme.
const VIDEO_SIZE = { width: { ideal: 1920 }, height: { ideal: 1080 } }
const FRAME_RATE = { ideal: 30 }
const VIDEO_BPS = 8_000_000
const AUDIO_BPS = 128_000

// Prefer an MP4 (H.264/AAC) container — accepted by TikTok/Instagram/Facebook.
// ANTI-CRĂPARE (Adrian: „sistemul recording crapă"): `isTypeSupported` poate
// minți — construcția propriu-zisă a MediaRecorder-ului poate arunca chiar și
// pentru un mime „suportat". De aceea nu mai alegem mime-ul pe hârtie și
// construim o singură dată: ÎNCERCĂM efectiv construcția pe fiecare candidat
// și o păstrăm pe prima care chiar reușește; ultimul resort = fără opțiuni
// (browserul își alege singur formatul, dar înregistrarea PORNEȘTE).
function makeRecorder(stream: MediaStream): MediaRecorder | null {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const m of candidates) {
    if (!MediaRecorder.isTypeSupported(m)) continue
    try {
      return new MediaRecorder(stream, {
        mimeType: m,
        videoBitsPerSecond: VIDEO_BPS,
        audioBitsPerSecond: AUDIO_BPS,
      })
    } catch {
      /* candidatul următor */
    }
  }
  try {
    return new MediaRecorder(stream)
  } catch {
    return null
  }
}

export async function startRecording(
  onStop: () => void,
  onError: (reason: string) => void,
  baseName?: string,
): Promise<RecordingHandle | null> {
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
    onError('unsupported')
    return null
  }

  let display: MediaStream
  try {
    // „SELECTARE AUTOMATĂ" (Adrian, 11 iul): browserul preselectează TABUL
    // CURENT (aplicația, cu chatul audio) în loc să-l caute Adrian prin listă
    // — rămâne UN singur click de confirmare, cerință de securitate a
    // browserului care nu se poate ocoli.
    const opts = {
      // Mărimea e SPECIFICATĂ (1080p/30) — browserul nu mai decide singur.
      video: { frameRate: FRAME_RATE, ...VIDEO_SIZE },
      audio: true, // tab/system audio → captures Kelion's voice
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      systemAudio: 'include',
    }
    display = await navigator.mediaDevices.getDisplayMedia(opts as DisplayMediaStreamOptions)
  } catch {
    onError('denied')
    return null
  }

  // Also grab the mic so your commentary is recorded, then mix it with the tab
  // audio into a single track. Mic is best-effort — recording proceeds without it.
  let mic: MediaStream | null = null
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } })
  } catch {
    mic = null
  }

  const AC =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  let ctx: AudioContext | null = null
  let mixedTrack: MediaStreamTrack | null = null
  const displayAudio = display.getAudioTracks()
  if (AC) {
    // The mixer ALWAYS exists: tab/system audio (if shared) + the mic — one
    // clean track regardless of what was ticked in the picker.
    ctx = new AC()
    const dest = ctx.createMediaStreamDestination()
    if (displayAudio.length > 0) ctx.createMediaStreamSource(new MediaStream(displayAudio)).connect(dest)
    if (mic) ctx.createMediaStreamSource(mic).connect(dest)
    mixedTrack = dest.stream.getAudioTracks()[0] ?? null
  }

  const tracks: MediaStreamTrack[] = [...display.getVideoTracks()]
  if (mixedTrack) tracks.push(mixedTrack)
  else tracks.push(...displayAudio)
  const stream = new MediaStream(tracks)

  const cleanup = (): void => {
    display.getTracks().forEach((t) => t.stop())
    mic?.getTracks().forEach((t) => t.stop())
    void ctx?.close()
  }

  const rec = makeRecorder(stream)
  if (!rec) {
    // Nici măcar fără opțiuni nu se poate înregistra pe browserul ăsta —
    // spunem clar, nu murim în tăcere cu ecranul deja capturat.
    cleanup()
    onError('unsupported')
    return null
  }
  // Browser's own "Stop sharing" bar ends the capture track — save the clip
  // then too, never lose a take.
  const vid = display.getVideoTracks()[0]
  if (vid)
    vid.onended = () => {
      try {
        if (rec.state !== 'inactive') rec.stop()
      } catch {
        /* already stopped */
      }
    }
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  // O eroare a encoderului MID-TAKE (disc, codec, memorie) nu mai pierde
  // dubla: oprim și salvăm ce s-a strâns până atunci.
  rec.onerror = () => {
    try {
      if (rec.state !== 'inactive') rec.stop()
    } catch {
      /* already stopped */
    }
  }

  rec.onstop = () => {
    const type = rec.mimeType || 'video/webm'
    const ext = type.includes('mp4') ? 'mp4' : 'webm'
    const blob = new Blob(chunks, { type })
    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 15)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    // Suggestive name when the promo pipeline provided one (subject + length +
    // date — ready for TikTok/Instagram uploads); timestamp fallback otherwise.
    a.download = `${baseName ?? `kelion-${stamp}`}.${ext}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    globalThis.setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    cleanup()
    onStop()
  }

  // If the user stops sharing via the browser's own bar, finalize the recording.
  display.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (rec.state !== 'inactive') rec.stop()
  })

  // FĂRĂ LIMITE DE DURATĂ (Adrian: „nu trebuie să aibă setări de timp sau
  // limitări"): felii de 1s — encoderul varsă datele progresiv în loc să
  // țină toată dubla într-un singur balon până la stop, deci și dublele
  // lungi se înregistrează fără să sufoce memoria tabului.
  rec.start(1000)
  return {
    stop() {
      if (rec.state !== 'inactive') rec.stop()
      else cleanup()
    },
  }
}
