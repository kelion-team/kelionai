// Admin-only screen+audio recorder for promo clips (TikTok / Instagram /
// Facebook). Captures the Kelion tab (avatar, monitor, chat) via getDisplayMedia
// plus the tab/system audio (Kelion's voice) AND the mic (your narration), mixed
// into one track, and saves an MP4 (the format those platforms accept) to the
// Downloads folder. Falls back to WebM only if the browser can't record MP4.

import { setVoiceTap } from './voice'

export interface RecordingHandle {
  stop(): void
}

// Prefer an MP4 (H.264/AAC) container — accepted by TikTok/Instagram/Facebook.
function pickMime(): string {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const m of candidates) if (MediaRecorder.isTypeSupported(m)) return m
  return ''
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
    display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true, // tab/system audio → captures Kelion's voice
    })
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
    // The mixer ALWAYS exists: tab/system audio (if shared) + the mic + a direct
    // tap of Kelion's own voice (see setVoiceTap below) — so the clip has his
    // voice even when "share tab audio" wasn't ticked in the picker.
    ctx = new AC()
    const dest = ctx.createMediaStreamDestination()
    if (displayAudio.length > 0) ctx.createMediaStreamSource(new MediaStream(displayAudio)).connect(dest)
    if (mic) ctx.createMediaStreamSource(mic).connect(dest)
    const mixCtx = ctx
    setVoiceTap((s) => {
      try {
        mixCtx.createMediaStreamSource(s).connect(dest)
      } catch {
        /* a failed tap must never break the recording */
      }
    })
    mixedTrack = dest.stream.getAudioTracks()[0] ?? null
  }

  const tracks: MediaStreamTrack[] = [...display.getVideoTracks()]
  if (mixedTrack) tracks.push(mixedTrack)
  else tracks.push(...displayAudio)
  const stream = new MediaStream(tracks)

  const mime = pickMime()
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
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

  const cleanup = (): void => {
    setVoiceTap(null) // stop feeding TTS clips into the (now gone) mixer
    display.getTracks().forEach((t) => t.stop())
    mic?.getTracks().forEach((t) => t.stop())
    void ctx?.close()
  }

  rec.onstop = () => {
    const type = mime || 'video/webm'
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

  rec.start()
  return {
    stop() {
      if (rec.state !== 'inactive') rec.stop()
      else cleanup()
    },
  }
}
