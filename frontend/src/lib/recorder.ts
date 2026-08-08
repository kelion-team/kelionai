// Admin-only screen+audio recorder for promo clips (TikTok / Instagram /
// Facebook). Captures the Kelion tab (avatar, monitor, chat) via getDisplayMedia
// plus the tab/system audio AND the mic (your narration), mixed into one track,
// and saves an MP4 (the format those platforms accept) to the Downloads folder.
// Falls back to WebM only if the browser can't record MP4.

import { vocileLuiKelion } from './vociKelion'

export interface RecordingHandle {
  stop(): void
}

// ALL DEFAULT SETTINGS (Adrian, Jul 11 evening: "all settings should be default
// set with specified audio and size") — nothing to choose manually: the video
// size is specified here (1080p/30), audio always on (tab + mic), and
// the quality/bitrate is fixed so the file is predictable for platforms.
const VIDEO_SIZE = { width: { ideal: 1920 }, height: { ideal: 1080 } }
const FRAME_RATE = { ideal: 30 }
const VIDEO_BPS = 8_000_000
const AUDIO_BPS = 128_000

// Prefer an MP4 (H.264/AAC) container — accepted by TikTok/Instagram/Facebook.
// ANTI-CRASH (Adrian: "the recording system crashes"): `isTypeSupported` can
// lie — the actual construction of the MediaRecorder can throw even
// for a "supported" mime. That's why we no longer pick the mime on paper and
// build once: we actually TRY the construction on each candidate
// and keep the first that really succeeds; the last resort = no options
// (the browser picks its own format, but the recording STARTS).
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
      /* the next candidate */
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
    // ALEGEREA E A OMULUI (Adrian, 8 aug: „când apăs Rec trebuie să mă lase să
    // înregistrez SELECȚIA"). Decizia veche din 11 iul („selecție automată")
    // punea `preferCurrentTab: true`, care îngusta dialogul browserului la
    // tabul curent — nu se mai putea alege fereastră sau ecran. Acum se
    // deschide alegătorul ÎNTREG (tab / fereastră / tot ecranul); tabul
    // aplicației rămâne în listă (selfBrowserSurface), audio-ul de sistem la fel.
    const opts = {
      // The size is SPECIFIED (1080p/30) — the browser no longer decides on its own.
      video: { frameRate: FRAME_RATE, ...VIDEO_SIZE },
      audio: true, // tab/system audio → captures Kelion's voice
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
    ctx = new AC()
    // FILMAREA MUTĂ (8 aug, ownerul: „am făcut o înregistrare dar nu s-a
    // înregistrat sunetul"). Contextul audio se creează DUPĂ două await-uri
    // (alegătorul de ecran + microfonul) — gestul de click e demult consumat,
    // iar browserul are voie să-l pornească 'suspended'. Un context suspendat
    // nu procesează NIMIC: destinația mixerului scoate tăcere perfectă și
    // filmarea iese mută chiar cu microfonul acordat. resume() îl pornește.
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
    const dest = ctx.createMediaStreamDestination()
    let surseAudio = 0
    if (displayAudio.length > 0) {
      ctx.createMediaStreamSource(new MediaStream(displayAudio)).connect(dest)
      surseAudio++
    }
    if (mic) {
      ctx.createMediaStreamSource(mic).connect(dest)
      surseAudio++
    }
    // VOCEA LUI KELION PRIN CONSTRUCȚIE (8 aug, ownerul a măsurat: „bifa era
    // pusă dar nu se auzea în înregistrare decât a mea de la microfon").
    // Captura de tab a Chrome EXCLUDE audio-ul care circulă prin WebRTC — și
    // exact așa se redă vocea live (bucla AEC pc1↔pc2). Bifa „Distribuie
    // audio" nu poate aduce ce browserul nu dă. De-aia luăm vocea DIRECT de la
    // sursă: fiecare gură a lui Kelion și-a înscris fluxul în registru, iar
    // aici îl vărsăm în mixer — vocea e pe filmare orice ar alege omul.
    for (const s of vocileLuiKelion()) {
      try {
        ctx.createMediaStreamSource(s).connect(dest)
        surseAudio++
      } catch {
        /* flux mort (sesiune închisă între timp) — restul surselor rămân */
      }
    }
    // Un mixer FĂRĂ nicio sursă e doar o pistă de tăcere — nu o punem în
    // filmare (ex.: „Fereastră" în Chrome n-are audio de sistem, iar micul a
    // fost refuzat). Lipsa se SPUNE, nu se maschează cu liniște.
    mixedTrack = surseAudio > 0 ? (dest.stream.getAudioTracks()[0] ?? null) : null
    if (surseAudio === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rec] filmarea pornește FĂRĂ sunet: nici audio de sistem (bifează „Distribuie audio" în dialogul de alegere), nici microfon',
      )
    }
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
    // Not even without options can you record on this browser —
    // we say so clearly, we don't die silently with the screen already captured.
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
  // A MID-TAKE encoder error (disc, codec, memory) no longer loses
  // the dub: we stop and save what has been gathered so far.
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

  // NO DURATION LIMITS (Adrian: "it must not have time settings or
  // limitations"): 1s slices — the encoder spills data progressively instead of
  // holding the whole dub in a single blob until stop, so even long dubs
  // record without suffocating the tab's memory.
  rec.start(1000)
  return {
    stop() {
      if (rec.state !== 'inactive') rec.stop()
      else cleanup()
    },
  }
}
